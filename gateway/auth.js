
const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env")
});

const db = require("../shared/database");
const router = express.Router();

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error("JWT_ACCESS_SECRET dan JWT_REFRESH_SECRET wajib diisi di .env");
}

const ACCESS_MINUTES = Number(process.env.ACCESS_TOKEN_MINUTES || 10);
const REFRESH_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 1);

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function audit(subject, endpoint, deviceId, result, reason) {
  db.prepare(`
    INSERT INTO audit_logs
      (subject, endpoint, device_id, result, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(subject || "anonymous", endpoint, deviceId || null, result, reason);
}

function getUserByUsername(username) {
  return db.prepare(`
    SELECT id, nim, name, username, password_hash, role
    FROM users
    WHERE username = ?
  `).get(username);
}

// Menerbitkan token setelah kredensial dan perangkat terdaftar lolos verifikasi.
router.post("/login", async (req, res) => {
  const { username, password, deviceId } = req.body || {};

  if (!username || !password || !deviceId) {
    audit(username, "/auth/login", deviceId, "deny", "Missing credentials or device ID");
    return res.status(400).json({
      error: "username, password, dan deviceId wajib diisi"
    });
  }

  try {
    const user = getUserByUsername(username);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      audit(username, "/auth/login", deviceId, "deny", "Invalid credentials");
      return res.status(401).json({ error: "Username atau password salah" });
    }

    const device = db.prepare(`
      SELECT id FROM devices
      WHERE user_id = ? AND device_id = ?
    `).get(user.id, deviceId);

    if (!device) {
      audit(username, "/auth/login", deviceId, "deny", "Device not registered");
      return res.status(403).json({ error: "Perangkat belum terdaftar" });
    }

    const claims = {
      sub: String(user.id),
      role: user.role,
      username: user.username
    };

    const accessToken = jwt.sign(claims, ACCESS_SECRET, {
      expiresIn: `${ACCESS_MINUTES}m`
    });

    const refreshToken = jwt.sign(
      { sub: String(user.id), type: "refresh" },
      REFRESH_SECRET,
      { expiresIn: `${REFRESH_DAYS}d` }
    );

    const decodedRefresh = jwt.decode(refreshToken);

    db.prepare(`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).run(
      user.id,
      hashToken(refreshToken),
      new Date(decodedRefresh.exp * 1000).toISOString()
    );

    audit(username, "/auth/login", deviceId, "allow", "Login successful");

    return res.json({
      message: "Login berhasil",
      accessToken,
      refreshToken,
      expiresInMinutes: ACCESS_MINUTES,
      user: {
        id: user.id,
        nim: user.nim,
        name: user.name,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Terjadi kesalahan server" });
  }
});

// Menerbitkan access token baru setelah refresh token tervalidasi.
router.post("/refresh", (req, res) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken wajib diisi" });
  }

  try {
    const payload = jwt.verify(refreshToken, REFRESH_SECRET);

    if (payload.type !== "refresh") {
      return res.status(401).json({ error: "Refresh token tidak valid" });
    }

    const stored = db.prepare(`
      SELECT * FROM refresh_tokens
      WHERE token_hash = ? AND user_id = ?
    `).get(hashToken(refreshToken), Number(payload.sub));

    if (!stored || stored.revoked || new Date(stored.expires_at) <= new Date()) {
      return res.status(401).json({
        error: "Refresh token tidak valid, kedaluwarsa, atau sudah dicabut"
      });
    }

    const user = db.prepare(`
      SELECT id, username, role
      FROM users WHERE id = ?
    `).get(Number(payload.sub));

    if (!user) {
      return res.status(401).json({ error: "Pengguna tidak ditemukan" });
    }

    const accessToken = jwt.sign({
      sub: String(user.id),
      role: user.role,
      username: user.username
    }, ACCESS_SECRET, {
      expiresIn: `${ACCESS_MINUTES}m`
    });

    return res.json({
      accessToken,
      expiresInMinutes: ACCESS_MINUTES
    });
  } catch {
    return res.status(401).json({ error: "Refresh token tidak valid atau kedaluwarsa" });
  }
});

// Mencabut refresh token yang digunakan untuk logout.
router.post("/logout", (req, res) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken wajib diisi" });
  }

  try {
    const payload = jwt.verify(refreshToken, REFRESH_SECRET);

    const result = db.prepare(`
      UPDATE refresh_tokens
      SET revoked = 1
      WHERE token_hash = ?
        AND user_id = ?
        AND revoked = 0
    `).run(hashToken(refreshToken), Number(payload.sub));

    if (result.changes === 0) {
      return res.status(401).json({
        error: "Refresh token tidak ditemukan atau sudah dicabut"
      });
    }

    audit(String(payload.sub), "/auth/logout", null, "allow", "Refresh token revoked");

    return res.json({ message: "Logout berhasil; refresh token dicabut" });
  } catch {
    return res.status(401).json({ error: "Refresh token tidak valid atau kedaluwarsa" });
  }
});


function safeSecretEqual(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") {
    return false;
  }

  const a = Buffer.from(received);
  const b = Buffer.from(expected);

  return a.length === b.length &&
    a.length > 0 &&
    crypto.timingSafeEqual(a, b);
}

// Menerbitkan service token hanya jika kredensial Grade Service cocok.
router.post("/service", (req, res) => {
  const { clientId, clientSecret } = req.body || {};

  if (
    !safeSecretEqual(clientId, process.env.SERVICE_CLIENT_ID) ||
    !safeSecretEqual(clientSecret, process.env.SERVICE_CLIENT_SECRET)
  ) {
    audit("unknown-service", "/auth/service", null, "deny",
      "Invalid service credentials");

    return res.status(401).json({
      error: "Kredensial service tidak valid"
    });
  }

  const serviceToken = jwt.sign({
    sub: "grade-service",
    role: "service",
    tokenType: "service"
  }, ACCESS_SECRET, {
    expiresIn: `${Number(process.env.SERVICE_TOKEN_MINUTES || 5)}m`
  });

  audit("grade-service", "/auth/service", null, "allow",
    "Service token issued");

  return res.json({
    accessToken: serviceToken,
    tokenType: "Bearer",
    expiresInMinutes: Number(process.env.SERVICE_TOKEN_MINUTES || 5)
  });
});

module.exports = router;
