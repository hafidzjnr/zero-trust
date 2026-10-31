const jwt = require("jsonwebtoken");
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env")
});

const db = require("../shared/database");

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;

function writeAudit(subject, endpoint, deviceId, result, reason) {
  db.prepare(`
    INSERT INTO audit_logs
      (subject, endpoint, device_id, result, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    subject || "anonymous",
    endpoint,
    deviceId || null,
    result,
    reason
  );
}

function deny(res, endpoint, subject, deviceId, status, reason) {
  writeAudit(subject, endpoint, deviceId, "deny", reason);

  return res.status(status).json({
    error: reason
  });
}

function requireZeroTrust(req, res, next) {
  const endpoint = req.originalUrl;
  const deviceId = req.get("X-Device-ID");
  const authorization = req.get("Authorization");

  if (req.path.startsWith("/auth/")) {
    return next();
  }

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return deny(
      res, endpoint, null, deviceId, 401,
      "Access token wajib disertakan"
    );
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    return deny(
      res, endpoint, null, deviceId, 401,
      "Access token tidak ditemukan"
    );
  }

  let payload;

  try {
    payload = jwt.verify(token, ACCESS_SECRET);
  } catch {
    return deny(
      res, endpoint, null, deviceId, 401,
      "Access token tidak valid atau kedaluwarsa"
    );
  }

  if (payload.role === "service" || payload.tokenType === "service") {
    const allowedServiceRequest =
      payload.role === "service" &&
      payload.tokenType === "service" &&
      payload.sub === "grade-service" &&
      req.method === "POST" &&
      req.path === "/transkrip/sinkron";

    if (!allowedServiceRequest) {
      return deny(
        res,
        endpoint,
        payload.sub,
        deviceId,
        403,
        "Service token tidak diizinkan untuk endpoint ini"
      );
    }

    req.service = { name: "grade-service" };
    return next();
  }

  const userId = Number(payload.sub);

  if (!Number.isInteger(userId) || userId <= 0) {
    return deny(
      res, endpoint, payload.username, deviceId, 401,
      "Identitas pada token tidak valid"
    );
  }

  const user = db.prepare(`
    SELECT id, nim, name, username, role
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) {
    return deny(
      res, endpoint, payload.username, deviceId, 401,
      "Pengguna tidak ditemukan"
    );
  }

  if (!deviceId) {
    return deny(
      res, endpoint, user.username, null, 403,
      "Header X-Device-ID wajib disertakan"
    );
  }

  const device = db.prepare(`
    SELECT id
    FROM devices
    WHERE user_id = ? AND device_id = ?
  `).get(user.id, deviceId);

  if (!device) {
    return deny(
      res, endpoint, user.username, deviceId, 403,
      "Perangkat tidak terdaftar untuk pengguna ini"
    );
  }

  req.user = {
    id: user.id,
    nim: user.nim,
    name: user.name,
    username: user.username,
    role: user.role
  };

  return next();
}

module.exports = {
  requireZeroTrust,
  writeAudit
};
