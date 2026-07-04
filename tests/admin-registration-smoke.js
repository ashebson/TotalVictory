const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OWNER_PASSCODE = "halevi2026";

function request(baseUrl, method, route, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
        ...(options.headers || {}),
      },
      timeout: options.timeoutMs || 8000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = raw;
        try { data = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, raw, data });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Timed out: " + method + " " + route)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await request(baseUrl, "GET", "/api/settings", { timeoutMs: 1000 });
      if (res.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError || new Error("Server did not start");
}

async function main() {
  const port = 5400 + Math.floor(Math.random() * 1000);
  const baseUrl = "http://127.0.0.1:" + port;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tv-admin-registration-"));
  const previousCwd = process.cwd();
  const previousEnv = { ...process.env };
  let server;

  try {
    process.chdir(tempDir);
    process.env.PORT = String(port);
    process.env.USE_MEMORY_DB = "true";
    process.env.NODE_ENV = "test";
    process.env.SMTP_HOST = "";
    process.env.NOTIFICATION_WEBHOOK_URL = "";

    const backendPath = path.join(ROOT, "backend", "dist", "server.js");
    delete require.cache[require.resolve(backendPath)];
    server = await require(backendPath).startServer(port);
    await waitForServer(baseUrl);

    const email = "registration-smoke-" + Date.now() + "@example.com";
    const register = await request(baseUrl, "POST", "/api/admins/register", {
      body: {
        fullName: "Smoke Test Admin",
        email,
        phone: "0501234567",
        organization: "Smoke Test HQ",
        planId: "monthly",
      },
    });
    assert.equal(register.status, 200, register.raw);
    assert.equal(register.data.success, true);

    const ownerHeaders = { "x-admin-passcode": OWNER_PASSCODE };
    const pendingList = await request(baseUrl, "GET", "/api/admins/registration-requests", { headers: ownerHeaders });
    assert.equal(pendingList.status, 200, pendingList.raw);
    const pendingAdmin = pendingList.data.find((item) => item.email === email);
    assert.ok(pendingAdmin, "new admin registration should appear in owner list");
    assert.equal(pendingAdmin.status, "PENDING");
    assert.ok(pendingAdmin.passcode, "owner list should include the future admin passcode");

    const approval = await request(baseUrl, "POST", "/api/admins/" + pendingAdmin.id + "/approve", { headers: ownerHeaders });
    assert.equal(approval.status, 200, approval.raw);
    assert.ok(approval.data.passcode, "approval should return passcode");

    const approvedList = await request(baseUrl, "GET", "/api/admins/registration-requests", { headers: ownerHeaders });
    assert.equal(approvedList.status, 200, approvedList.raw);
    const approvedAdmin = approvedList.data.find((item) => item.email === email);
    assert.ok(approvedAdmin, "approved admin should remain in owner list");
    assert.equal(approvedAdmin.status, "ACTIVE");
    assert.ok(approvedAdmin.passcode, "approved admin should keep passcode in owner list");
    assert.ok(approvedAdmin.approvedAt, "approved admin should include approval date");

    console.log("PASS admin registration appears, stays after approval, and includes passcode/date");
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    process.chdir(previousCwd);
    process.env = previousEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
