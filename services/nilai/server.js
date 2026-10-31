
const express = require("express");
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env")
});

const db = require("../../shared/database");
const { verifyServiceRequest } = require("../../shared/service-auth");

const app = express();
app.use(express.json());
app.use(verifyServiceRequest);


function withinAccessHours() {
  const hour = new Date().getHours();
  const startHour = Number(process.env.ACCESS_START_HOUR ?? 7);
  const endHour = Number(process.env.ACCESS_END_HOUR ?? 21);

  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    startHour < 0 ||
    startHour > 23 ||
    endHour < 1 ||
    endHour > 24 ||
    startHour >= endHour
  ) {
    throw new Error("Konfigurasi jam akses tidak valid");
  }

  return hour >= startHour && hour < endHour;
}


// Mengambil nilai mahasiswa sendiri atau nilai kelas yang diampu dosen.
app.get("/nilai", (req, res) => {
  const actor = req.actor;

  if (actor.role === "mahasiswa") {
    const rows = db.prepare(`
      SELECT g.id, c.class_name, g.score, c.finalized
      FROM grades g
      JOIN classes c ON c.id = g.class_id
      WHERE g.student_id = ?
      ORDER BY c.class_name
    `).all(actor.id);

    return res.json(rows);
  }

  if (actor.role === "dosen") {
    const rows = db.prepare(`
      SELECT g.id, u.nim, u.name AS student_name,
             c.class_name, g.score, c.finalized
      FROM grades g
      JOIN classes c ON c.id = g.class_id
      JOIN users u ON u.id = g.student_id
      WHERE c.lecturer_id = ?
      ORDER BY c.class_name, u.nim
    `).all(actor.id);

    return res.json(rows);
  }

  return res.status(403).json({
    error: "Role tidak diizinkan melihat nilai"
  });
});

// Memperbarui nilai setelah memeriksa role, kepemilikan kelas, dan status finalisasi.
app.put("/nilai/:id", (req, res) => {
  const actor = req.actor;

  if (actor.role !== "dosen") {
    return res.status(403).json({
      error: "Hanya dosen yang dapat mengubah nilai"
    });
  }

  if (!withinAccessHours()) {
    return res.status(403).json({
      error: "Perubahan nilai hanya diizinkan pukul 07.00-21.00"
    });
  }

  const score = req.body?.score;

  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100
  ) {
    return res.status(400).json({
      error: "score harus berupa angka antara 0 dan 100"
    });
  }

  const grade = db.prepare(`
    SELECT g.id, c.lecturer_id, c.finalized
    FROM grades g
    JOIN classes c ON c.id = g.class_id
    WHERE g.id = ?
  `).get(Number(req.params.id));

  if (!grade) {
    return res.status(404).json({
      error: "Nilai tidak ditemukan"
    });
  }

  if (grade.lecturer_id !== actor.id) {
    return res.status(403).json({
      error: "Dosen tidak mengampu kelas ini"
    });
  }

  if (grade.finalized) {
    return res.status(409).json({
      error: "Nilai tidak dapat diubah setelah finalisasi"
    });
  }

  db.prepare("UPDATE grades SET score = ? WHERE id = ?")
    .run(score, grade.id);

  return res.json({
    message: "Nilai berhasil diperbarui",
    gradeId: grade.id,
    score
  });
});

// Memfinalisasi kelas lalu meminta sinkronisasi transkrip melalui Gateway.
app.post("/kelas/:id/finalisasi", async (req, res) => {
  const actor = req.actor;

  if (actor.role !== "dosen") {
    return res.status(403).json({
      error: "Hanya dosen yang dapat memfinalisasi kelas"
    });
  }

  if (!withinAccessHours()) {
    return res.status(403).json({
      error: "Finalisasi hanya diizinkan pukul 07.00-21.00"
    });
  }

  const kelas = db.prepare(`
    SELECT id, class_name, lecturer_id, finalized
    FROM classes
    WHERE id = ?
  `).get(Number(req.params.id));

  if (!kelas) {
    return res.status(404).json({
      error: "Kelas tidak ditemukan"
    });
  }

  if (kelas.lecturer_id !== actor.id) {
    return res.status(403).json({
      error: "Dosen tidak mengampu kelas ini"
    });
  }

  if (kelas.finalized) {
    return res.status(409).json({
      error: "Kelas sudah difinalisasi"
    });
  }

  // Tandai kelas final agar Transcript Service dapat memvalidasinya saat sinkronisasi.
  const updateResult = db.prepare(`
    UPDATE classes
    SET finalized = 1
    WHERE id = ? AND finalized = 0
  `).run(kelas.id);

  if (updateResult.changes !== 1) {
    return res.status(409).json({
      error: "Status kelas berubah. Periksa status finalisasi."
    });
  }

  try {
    const gateway = `http://127.0.0.1:${Number(
      process.env.PORT_GATEWAY || 3000
    )}`;

    // Minta service token Gateway dengan kredensial Grade Service.
    const tokenResponse = await fetch(`${gateway}/auth/service`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: process.env.SERVICE_CLIENT_ID,
        clientSecret: process.env.SERVICE_CLIENT_SECRET
      })
    });

    if (!tokenResponse.ok) {
      throw new Error("Gateway menolak penerbitan service token");
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.accessToken) {
      throw new Error("Service token tidak ditemukan dalam respons");
    }

    // Kirim permintaan sinkronisasi melalui API Gateway.
    const syncResponse = await fetch(
      `${gateway}/transkrip/sinkron`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenData.accessToken}`
        },
        body: JSON.stringify({
          classId: kelas.id
        })
      }
    );

    const responseText = await syncResponse.text();
    let syncData;

    try {
      syncData = JSON.parse(responseText);
    } catch {
      syncData = { detail: responseText };
    }

    if (!syncResponse.ok) {
      // Batalkan status final jika sinkronisasi ditolak.
      db.prepare(`
        UPDATE classes
        SET finalized = 0
        WHERE id = ?
      `).run(kelas.id);

      return res.status(502).json({
        error: "Sinkronisasi transkrip gagal; status finalisasi dibatalkan",
        detail: syncData
      });
    }

    return res.json({
      message: "Kelas difinalisasi dan transkrip berhasil disinkronkan",
      classId: kelas.id,
      transcriptSync: syncData
    });
  } catch (error) {
    console.error("Transcript sync error:", error.message);

    // Batalkan status final jika penerbitan token atau sinkronisasi gagal.
    db.prepare(`
      UPDATE classes
      SET finalized = 0
      WHERE id = ?
    `).run(kelas.id);

    return res.status(502).json({
      error: "Sinkronisasi transkrip gagal; status finalisasi dibatalkan"
    });
  }
});

const port = Number(process.env.PORT_NILAI || 3001);

app.listen(port, () => {
  console.log(`Grade Service berjalan di http://localhost:${port}`);
});
