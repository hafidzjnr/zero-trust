const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env")
});

const db = require("../shared/database");
const { writeAudit } = require("./middleware");

function denyPolicy(req, res, status, reason) {
  writeAudit(
    req.user?.username || req.service?.name || "anonymous",
    req.originalUrl,
    req.get("X-Device-ID"),
    "deny",
    reason
  );

  return res.status(status).json({ error: reason });
}

function withinAccessHours() {
  const start = Number(process.env.ACCESS_START_HOUR ?? 7);
  const end = Number(process.env.ACCESS_END_HOUR ?? 21);

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > 23 ||
    end < 1 ||
    end > 24 ||
    start >= end
  ) {
    throw new Error("Konfigurasi jam akses tidak valid");
  }

  const hour = new Date().getHours();
  return hour >= start && hour < end;
}

function policyEngine(req, res, next) {
  const route = req.path;
  const method = req.method;
  const user = req.user;

  if (route === "/nilai" && method === "GET") {
    if (user && ["mahasiswa", "dosen"].includes(user.role)) {
      return next();
    }

    return denyPolicy(
      req, res, 403,
      "Hanya mahasiswa dan dosen yang dapat melihat nilai"
    );
  }

  const gradeMatch = route.match(/^\/nilai\/(\d+)$/);

  if (gradeMatch && method === "PUT") {
    if (!user || user.role !== "dosen") {
      return denyPolicy(
        req, res, 403,
        "Hanya dosen yang dapat mengubah nilai"
      );
    }

    const gradeId = Number(gradeMatch[1]);

    const grade = db.prepare(`
      SELECT
        g.id,
        g.class_id,
        c.lecturer_id,
        c.finalized
      FROM grades g
      JOIN classes c ON c.id = g.class_id
      WHERE g.id = ?
    `).get(gradeId);

    if (!grade) {
      return denyPolicy(req, res, 404, "Data nilai tidak ditemukan");
    }

    if (grade.lecturer_id !== user.id) {
      return denyPolicy(
        req, res, 403,
        "Dosen tidak berhak mengubah nilai pada kelas ini"
      );
    }

    if (grade.finalized) {
      return denyPolicy(
        req, res, 403,
        "Nilai tidak dapat diubah karena kelas sudah difinalisasi"
      );
    }

    if (!withinAccessHours()) {
      return denyPolicy(
        req, res, 403,
        "Perubahan nilai hanya diizinkan pukul 07.00-21.00"
      );
    }

    return next();
  }

  const classMatch = route.match(/^\/kelas\/(\d+)\/finalisasi$/);

  if (classMatch && method === "POST") {
    if (!user || user.role !== "dosen") {
      return denyPolicy(
        req, res, 403,
        "Hanya dosen yang dapat memfinalisasi kelas"
      );
    }

    const classId = Number(classMatch[1]);

    const kelas = db.prepare(`
      SELECT id, lecturer_id, finalized
      FROM classes
      WHERE id = ?
    `).get(classId);

    if (!kelas) {
      return denyPolicy(req, res, 404, "Kelas tidak ditemukan");
    }

    if (kelas.lecturer_id !== user.id) {
      return denyPolicy(
        req, res, 403,
        "Dosen tidak berhak memfinalisasi kelas ini"
      );
    }

    if (kelas.finalized) {
      return denyPolicy(
        req, res, 403,
        "Kelas sudah difinalisasi"
      );
    }

    if (!withinAccessHours()) {
      return denyPolicy(
        req, res, 403,
        "Finalisasi hanya diizinkan pukul 07.00-21.00"
      );
    }

    return next();
  }

  if (route === "/transkrip/sinkron" && method === "POST") {
    if (req.service?.name !== "grade-service") {
      return denyPolicy(
        req, res, 403,
        "Sinkronisasi transkrip hanya diizinkan untuk Grade Service"
      );
    }

    return next();
  }

  const transcriptMatch = route.match(/^\/transkrip\/([^/]+)$/);

  if (transcriptMatch && method === "GET") {
    const nim = decodeURIComponent(transcriptMatch[1]);

    if (!user) {
      return denyPolicy(
        req, res, 403,
        "Identitas pengguna diperlukan untuk mengakses transkrip"
      );
    }

    if (user.role === "admin") {
      return next();
    }

    if (user.role === "mahasiswa" && user.nim === nim) {
      return next();
    }

    if (user.role === "mahasiswa") {
      return denyPolicy(
        req, res, 403,
        "Mahasiswa hanya dapat melihat transkrip sendiri"
      );
    }

    return denyPolicy(
      req, res, 403,
      "Peran pengguna tidak diizinkan mengakses transkrip"
    );
  }

  // Tolak metode dan endpoint akademik yang belum memiliki kebijakan akses.
  if (
    route === "/nilai" ||
    route.startsWith("/nilai/") ||
    route === "/kelas" ||
    route.startsWith("/kelas/") ||
    route === "/transkrip" ||
    route.startsWith("/transkrip/")
  ) {
    return denyPolicy(
      req, res, 403,
      "Metode atau endpoint belum memiliki kebijakan akses"
    );
  }

  // Teruskan endpoint di luar area akademik yang diproteksi.
  return next();
}

module.exports = policyEngine;
