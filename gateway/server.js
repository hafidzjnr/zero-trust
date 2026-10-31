const express = require("express");
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env")
});

const authRouter = require("./auth");
const { requireZeroTrust, writeAudit } = require("./middleware");
const policyEngine = require("./policy-engine")

const app = express();

app.use(express.json());

app.use("/auth", authRouter);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "API Gateway"
  });
});

app.use(requireZeroTrust);
app.use(policyEngine);

async function proxyToService(req, res, targetPort) {
  const endpoint = req.originalUrl;
  const deviceId = req.get("X-Device-ID");
  const subject =
    req.user?.username ||
    req.service?.name ||
    "anonymous";

  try {
    const url = `http://127.0.0.1:${targetPort}${req.originalUrl}`;

    const headers = {
      "X-Gateway-Secret": process.env.GATEWAY_SECRET
    };

    const authorization = req.get("Authorization");

    if (authorization) {
      headers.Authorization = authorization;
    }

    if (deviceId) {
      headers["X-Device-ID"] = deviceId;
    }

    const options = {
      method: req.method,
      headers
    };

    if (!["GET", "HEAD"].includes(req.method)) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(req.body ?? {});
    }

    const upstream = await fetch(url, options);
    const responseBody = await upstream.text();

    let reason = `Layanan tujuan merespons HTTP ${upstream.status}`;

    try {
      const parsed = JSON.parse(responseBody);

      if (parsed.error) {
        reason = String(parsed.error);
      } else if (parsed.message) {
        reason = String(parsed.message);
      } else if (upstream.ok) {
        reason = "Permintaan diterima oleh layanan tujuan";
      }
    } catch {
      if (upstream.ok) {
        reason = "Permintaan diterima oleh layanan tujuan";
      }
    }

    writeAudit(
      subject,
      endpoint,
      deviceId,
      upstream.ok ? "allow" : "deny",
      reason
    );

    res.status(upstream.status);

    const contentType = upstream.headers.get("content-type");

    if (contentType) {
      res.set("Content-Type", contentType);
    }

    return res.send(responseBody);
  } catch (error) {
    console.error("Gateway proxy error:", error.message);

    writeAudit(
      subject,
      endpoint,
      deviceId,
      "deny",
      "Service tujuan tidak dapat dihubungi"
    );

    return res.status(502).json({
      error: "Service tujuan tidak dapat dihubungi"
    });
  }
}

app.all(/^\/nilai(?:\/.*)?$/, (req, res) =>
  proxyToService(req, res, Number(process.env.PORT_NILAI || 3001))
);

app.all(/^\/kelas(?:\/.*)?$/, (req, res) =>
  proxyToService(req, res, Number(process.env.PORT_NILAI || 3001))
);

app.all(/^\/transkrip(?:\/.*)?$/, (req, res) =>
  proxyToService(req, res, Number(process.env.PORT_TRANSKRIP || 3002))
);

app.get("/protected", (req, res) => {
  writeAudit(
    req.user.username,
    req.originalUrl,
    req.get("X-Device-ID"),
    "allow",
    "Token valid dan perangkat terdaftar; endpoint diagnostik berhasil"
  );

  return res.json({
    message: "Akses berhasil melewati Zero Trust",
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role
    }
  });
});

const port = Number(process.env.PORT_GATEWAY || 3000);

app.listen(port, () => {
  console.log(`API Gateway berjalan di http://localhost:${port}`);
});
