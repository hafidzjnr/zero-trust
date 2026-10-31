
const express = require("express");
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env")
});

const db = require("../../shared/database");
const { verifyServiceRequest } = require("../../shared/service-auth");

const app = express();

app.use(express.json());

// Verifikasi Gateway Secret dan token sebelum menangani endpoint layanan.
app.use(verifyServiceRequest);

// Tampilkan transkrip sendiri untuk mahasiswa dan transkrip mana pun untuk admin.
app.get("/transkrip/:nim", (req, res) => {
  const actor = req.actor;
  const nim = req.params.nim;

  if (actor.role !== "mahasiswa" && actor.role !== "admin") {
    return res.status(403).json({
      error: "Role tidak diizinkan melihat transkrip"
    });
  }

  if (actor.role === "mahasiswa") {
    const student = db.prepare(`
      SELECT id, nim
      FROM users
      WHERE id = ? AND role = 'mahasiswa'
    `).get(actor.id);

    if (!student || student.nim !== nim) {
      return res.status(403).json({
        error: "Mahasiswa hanya dapat melihat transkrip sendiri"
      });
    }
  }

  const student = db.prepare(`
    SELECT id, nim, name
    FROM users
    WHERE nim = ? AND role = 'mahasiswa'
  `).get(nim);

  if (!student) {
    return res.status(404).json({
      error: "Mahasiswa tidak ditemukan"
    });
  }

  const rows = db.prepare(`
    SELECT
      c.class_name,
      t.score,
      t.synced_at
    FROM transcripts t
    JOIN classes c ON c.id = t.class_id
    WHERE t.student_id = ?
    ORDER BY c.class_name
  `).all(student.id);

  return res.json({
    student: {
      nim: student.nim,
      name: student.name
    },
    transcripts: rows
  });
});

// Sinkronkan nilai kelas ke transkrip hanya untuk Grade Service.
app.post("/transkrip/sinkron", (req, res) => {
  const actor = req.actor;

  if (
    actor.role !== "service" ||
    actor.username !== "grade-service"
    ) {
    return res.status(403).json({
      error: "Hanya Grade Service yang dapat menyinkronkan transkrip"
    });
  }

  const classId = Number(req.body?.classId);

  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({
      error: "classId harus berupa bilangan bulat positif"
    });
  }

  const kelas = db.prepare(`
    SELECT id, finalized
    FROM classes
    WHERE id = ?
  `).get(classId);

  if (!kelas) {
    return res.status(404).json({
      error: "Kelas tidak ditemukan"
    });
  }

  if (!kelas.finalized) {
    return res.status(409).json({
      error: "Kelas belum difinalisasi"
    });
  }

  const grades = db.prepare(`
    SELECT student_id, class_id, score
    FROM grades
    WHERE class_id = ?
  `).all(classId);

  const syncTransaction = db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO transcripts (
        student_id,
        class_id,
        score,
        synced_at
      )
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(student_id, class_id)
      DO UPDATE SET
        score = excluded.score,
        synced_at = datetime('now')
    `);

    for (const grade of grades) {
      upsert.run(
        grade.student_id,
        grade.class_id,
        grade.score
      );
    }
  });

  syncTransaction();

  return res.json({
    message: "Transkrip berhasil disinkronkan",
    classId,
    syncedRecords: grades.length
  });
});

const port = Number(process.env.PORT_TRANSKRIP || 3002);

app.listen(port, () => {
  console.log(`Transcript Service berjalan di http://localhost:${port}`);
});
