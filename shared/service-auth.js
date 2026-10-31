const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env")
});

const db = require("./database");

function secretMatches(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") {
    return false;
  }

const a = Buffer.from(received);
  const b = Buffer.from(expected);

return a.length > 0 &&
    a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

function verifyServiceRequest(req, res, next) {
  // Verifikasi secret Gateway sebelum memproses permintaan internal.
  if (!secretMatches(
    req.get("X-Gateway-Secret"),
    process.env.GATEWAY_SECRET
  )) {
    return res.status(403).json({
      error: "Gateway secret tidak valid"
    });
  }

  const authorization = req.get("Authorization");

if (!authorization || !authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Bearer token wajib disertakan"
    });
  }

  let payload;

try {
    payload = jwt.verify(
      authorization.slice(7).trim(),
      process.env.JWT_ACCESS_SECRET
    );
  } catch {
    return res.status(401).json({
      error: "Token tidak valid atau kedaluwarsa"
    });
  }

// Pastikan token service hanya mewakili Grade Service.
  if (payload.role === "service" || payload.tokenType === "service") {
    if (
      payload.role !== "service" ||
      payload.tokenType !== "service" ||
      payload.sub !== "grade-service"
    ) {
      return res.status(403).json({
        error: "Identitas service tidak valid"
      });
    }

req.actor = {
      id: null,
      username: "grade-service",
      role: "service"
    };

return next();
  }

// Cocokkan identitas dan role token pengguna dengan data terbaru di database.
  const userId = Number(payload.sub);

if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      error: "Identitas pengguna tidak valid"
    });
  }

const user = db.prepare(`
    SELECT id, nim, name, username, role
    FROM users
    WHERE id = ?
  `).get(userId);

if (!user || user.role !== payload.role) {
    return res.status(401).json({
      error: "Identitas atau role pengguna tidak valid"
    });
  }

req.actor = user;
  next();
}

module.exports = { verifyServiceRequest };