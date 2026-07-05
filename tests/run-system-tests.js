const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { performance } = require("node:perf_hooks");

const ROOT = path.resolve(__dirname, "..");
const ADMIN_PASSCODE = "halevi2026";
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeCmd = process.execPath;
const args = new Set(process.argv.slice(2));
const results = [];

function elapsed(start) { return Math.round(performance.now() - start); }
function line(status, name, durationMs, details) {
  results.push({ status, name, durationMs, details: details || "" });
  const label = status === "PASS" ? "[PASS]" : "[FAIL]";
  console.log(label + " " + name + " (" + durationMs + "ms)" + (details ? " - " + details : ""));
}
async function step(name, fn) {
  const start = performance.now();
  try { line("PASS", name, elapsed(start), await fn()); }
  catch (error) { line("FAIL", name, elapsed(start), error.stack || error.message || String(error)); }
}
function runCommand(name, command, commandArgs, options) {
  options = options || {};
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(command, commandArgs, { cwd: options.cwd || ROOT, env: { ...process.env, ...(options.env || {}) }, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      const durationMs = elapsed(start);
      if (code === 0) return resolve({ stdout, stderr, durationMs });
      const tail = (stderr || stdout).split(/\r?\n/).slice(-50).join("\n");
      reject(new Error(name + " exited with " + code + " after " + durationMs + "ms\n" + tail));
    });
  });
}
function request(baseUrl, method, route, options) {
  options = options || {};
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const url = new URL(route, baseUrl);
    const payload = options.body === undefined ? null : JSON.stringify(options.body);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}), ...(options.headers || {}) },
      timeout: options.timeoutMs || 8000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const raw = buffer.toString("utf8");
        let data = raw;
        try { data = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, buffer, raw, data, durationMs: elapsed(started) });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out: " + method + " " + route)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
async function waitForServer(baseUrl) {
  const deadline = performance.now() + 15000;
  let lastError;
  while (performance.now() < deadline) {
    try {
      const res = await request(baseUrl, "GET", "/api/settings", { timeoutMs: 1000 });
      if (res.status === 200) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Server did not become ready: " + (lastError ? lastError.message : "no response"));
}
function makeContacts(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: "בדיקת מערכת " + (index + 1),
    phone: "050" + String(7000000 + index).padStart(7, "0"),
    city: "ירושלים",
    sector: "בדיקה",
    notes: "contact-" + (index + 1),
  }));
}
async function startBackend() {
  const port = 5300 + Math.floor(Math.random() * 1000);
  const baseUrl = "http://127.0.0.1:" + port;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "total-victory-test-"));
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  const previousCwd = process.cwd();
  const previousEnv = {
    PORT: process.env.PORT,
    USE_MEMORY_DB: process.env.USE_MEMORY_DB,
    NODE_ENV: process.env.NODE_ENV,
    SMTP_HOST: process.env.SMTP_HOST,
    REGISTRATION_WEBHOOK_URL: process.env.REGISTRATION_WEBHOOK_URL,
  };
  process.chdir(tempDir);
  process.env.PORT = String(port);
  process.env.USE_MEMORY_DB = "true";
  process.env.NODE_ENV = "test";
  process.env.SMTP_HOST = "";
  process.env.REGISTRATION_WEBHOOK_URL = "";

  const backendModulePath = path.join(ROOT, "backend", "dist", "server.js");
  delete require.cache[require.resolve(backendModulePath)];
  const backend = require(backendModulePath);
  const server = await backend.startServer(port);
  await waitForServer(baseUrl);

  return {
    baseUrl,
    tempDir,
    stop: async () => {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      process.chdir(previousCwd);
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function runBackendBuildCheck() {
  await step("Backend TypeScript build", async () => {
    const result = await runCommand("backend build", npmCmd, ["run", "build"], { cwd: path.join(ROOT, "backend") });
    return "tsc completed in " + result.durationMs + "ms";
  });
}
async function runBuildChecks(includeFrontends) {
  await runBackendBuildCheck();
  if (!includeFrontends) return;
  for (const app of ["frontend-admin", "frontend-caller", "frontend-tv"]) {
    await step(app + " production build", async () => {
      const result = await runCommand(app + " build", npmCmd, ["run", "build"], { cwd: path.join(ROOT, app) });
      return "build completed in " + result.durationMs + "ms";
    });
  }
}

async function runBackendIntegrationChecks() {
  let server;
  await step("Start isolated backend test server", async () => { server = await startBackend(); return server.baseUrl; });
  if (!server) return;
  const adminHeaders = { "x-admin-passcode": ADMIN_PASSCODE };
  try {
    await step("Admin API rejects missing passcode", async () => {
      const stats = await request(server.baseUrl, "GET", "/api/stats/admin");
      assert.equal(stats.status, 401);
      const upload = await request(server.baseUrl, "POST", "/api/projects/upload", { body: { projectName: "חסימה", contacts: makeContacts(1) } });
      assert.equal(upload.status, 401);
      return "protected admin routes require a passcode";
    });
    await step("Public settings expose configurable statuses only", async () => {
      const res = await request(server.baseUrl, "GET", "/api/settings");
      assert.equal(res.status, 200);
      assert.ok(res.durationMs < 1000, "settings endpoint too slow: " + res.durationMs + "ms");
      assert.equal(Object.hasOwn(res.data, "polymarket_url"), false);
      assert.equal(Object.hasOwn(res.data, "win_percentage"), false);
      const options = JSON.parse(res.data.call_status_options);
      assert.equal(options.length, 4);
      assert.ok(options.every((item) => item.id && item.label));
      return "response " + res.durationMs + "ms";
    });
    let pendingEmail = "";
    await step("Admin registration stays private for owner review", async () => {
      pendingEmail = "owner-review-" + Date.now() + "@example.com";
      const register = await request(server.baseUrl, "POST", "/api/admins/register", { body: { fullName: "בדיקת מנהל", email: pendingEmail, phone: "0509998888", organization: "מטה בדיקות", planId: "monthly" } });
      assert.equal(register.status, 200);
      assert.equal(register.data.success, true);
      assert.equal(register.data.mode, "owner_private_review");
      assert.equal(Object.hasOwn(register.data, "whatsappUrl"), false);
      const blocked = await request(server.baseUrl, "GET", "/api/admins/registration-requests");
      assert.equal(blocked.status, 403);
      const ownerList = await request(server.baseUrl, "GET", "/api/admins/registration-requests", { headers: adminHeaders });
      assert.equal(ownerList.status, 200);
      assert.ok(ownerList.data.some((item) => item.email === pendingEmail));
      const pendingAdmin = ownerList.data.find((item) => item.email === pendingEmail);
      assert.equal(pendingAdmin.status, "PENDING");
      const approval = await request(server.baseUrl, "POST", "/api/admins/" + pendingAdmin.id + "/approve", { headers: adminHeaders });
      assert.equal(approval.status, 200);
      assert.ok(approval.data.passcode);
      const afterApproval = await request(server.baseUrl, "GET", "/api/admins/registration-requests", { headers: adminHeaders });
      assert.equal(afterApproval.status, 200);
      const approvedAdmin = afterApproval.data.find((item) => item.email === pendingEmail);
      assert.ok(approvedAdmin, "approved admin should remain in owner registration list");
      assert.equal(approvedAdmin.status, "ACTIVE");
      assert.ok(approvedAdmin.passcode);
      assert.ok(approvedAdmin.approvedAt);
      const csv = await request(server.baseUrl, "GET", "/api/admins/registration-requests.csv?passcode=" + ADMIN_PASSCODE);
      assert.equal(csv.status, 200);
      assert.match(csv.raw, /owner-review-/);
      return "private list and CSV verified";
    });
    await step("Admin status settings persist for caller menus", async () => {
      const customOptions = [
        { id: "SUCCESS", label: "תומך בבדיקה", active: true },
        { id: "NOT_INTERESTED", label: "לא מעוניין", active: true },
        { id: "NO_ANSWER", label: "אין מענה", active: true },
        { id: "INVALID_NUMBER", label: "שגוי", active: false },
      ];
      const save = await request(server.baseUrl, "POST", "/api/settings", { headers: adminHeaders, body: { settings: { call_status_options: JSON.stringify(customOptions) } } });
      assert.equal(save.status, 200);
      const settings = await request(server.baseUrl, "GET", "/api/settings");
      const options = JSON.parse(settings.data.call_status_options);
      assert.equal(options.find((item) => item.id === "SUCCESS").label, "תומך בבדיקה");
      assert.equal(options.find((item) => item.id === "INVALID_NUMBER").active, false);
      return "saved " + options.length + " options";
    });
    let projectId;
    const callers = [];
    await step("Upload contacts and register 30 callers", async () => {
      const upload = await request(server.baseUrl, "POST", "/api/projects/upload", { headers: adminHeaders, body: { projectName: "בדיקת עומס הקצאה", fileName: "contacts-test.json", contacts: makeContacts(45) } });
      assert.equal(upload.status, 200);
      assert.equal(upload.data.inserted, 45);
      projectId = upload.data.project.id;
      for (let index = 0; index < 30; index++) {
        const phone = "052" + String(8000000 + index).padStart(7, "0");
        const login = await request(server.baseUrl, "POST", "/api/login", { body: { name: "טלפן בדיקה " + (index + 1), phone } });
        assert.equal(login.status, 200);
        callers.push({ id: login.data.id, phone });
        const assign = await request(server.baseUrl, "POST", "/api/projects/" + projectId + "/callers", { headers: adminHeaders, body: { phone } });
        assert.equal(assign.status, 200);
      }
      return "project " + projectId + ", callers " + callers.length;
    });
    await step("Caller API rejects missing or mismatched identity", async () => {
      const noHeader = await request(server.baseUrl, "GET", "/api/contacts/next?callerId=" + callers[0].id + "&projectId=" + projectId);
      assert.equal(noHeader.status, 401);
      const mismatch = await request(server.baseUrl, "GET", "/api/contacts/next?callerId=" + callers[0].id + "&projectId=" + projectId, { headers: { "x-caller-phone": callers[1].phone } });
      assert.equal(mismatch.status, 403);
      return "caller identity is enforced";
    });
    await step("Caller saves personal WhatsApp template settings", async () => {
      const caller = callers[0];
      const settingsSave = await request(server.baseUrl, "POST", "/api/callers/" + caller.id + "/settings", {
        headers: { "x-caller-phone": caller.phone },
        body: { whatsappTemplate: "שלום {name}, תודה רבה!" }
      });
      assert.equal(settingsSave.status, 200);
      assert.equal(settingsSave.data.success, true);
      assert.equal(settingsSave.data.caller.whatsappTemplate, "שלום {name}, תודה רבה!");
      return "personal WhatsApp template saved successfully";
    });
    await step("Caller registers and joins a project independently via invite link", async () => {
      const invitePhone = "0539999999";
      const login = await request(server.baseUrl, "POST", "/api/login", {
        body: { name: "טלפן הצטרפות עצמאית", phone: invitePhone, projectId }
      });
      assert.equal(login.status, 200);
      assert.ok(login.data.projects.some((p) => p.id === projectId), "caller should be linked to the invite project");
      return "caller joined project independently";
    });
    let allocated = [];
    await step("30 simultaneous callers receive unique contacts", async () => {
      const started = performance.now();
      const responses = await Promise.all(callers.map((caller) => request(server.baseUrl, "GET", "/api/contacts/next?callerId=" + caller.id + "&projectId=" + projectId, { headers: { "x-caller-phone": caller.phone }, timeoutMs: 10000 })));
      const duration = elapsed(started);
      assert.ok(duration < 2500, "allocation batch too slow: " + duration + "ms");
      responses.forEach((res) => assert.equal(res.status, 200));
      allocated = responses.map((res) => res.data);
      assert.equal(allocated.length, 30);
      assert.ok(allocated.every((contact) => contact && contact.id));
      assert.equal(new Set(allocated.map((contact) => contact.id)).size, 30);
      return "30 unique contacts in " + duration + "ms";
    });
    await step("Call result requires the allocated caller", async () => {
      const contact = allocated[0];
      const otherCaller = callers[1];
      const rejected = await request(server.baseUrl, "POST", "/api/calls", { headers: { "x-caller-phone": otherCaller.phone }, body: { callerId: otherCaller.id, contactId: contact.id, status: "SUCCESS" } });
      assert.equal(rejected.status, 409);
      return "misassigned call update blocked";
    });
    await step("Call note is optional and call is recorded", async () => {
      const caller = callers[0];
      const contact = allocated[0];
      const call = await request(server.baseUrl, "POST", "/api/calls", { headers: { "x-caller-phone": caller.phone }, body: { callerId: caller.id, contactId: contact.id, status: "SUCCESS" } });
      assert.equal(call.status, 200);
      assert.equal(call.data.status, "SUCCESS");
      assert.equal(call.data.contact.callNotes, null);
      const stats = await request(server.baseUrl, "GET", "/api/stats/admin", { headers: adminHeaders });
      assert.equal(stats.status, 200);
      assert.equal(stats.data.summary.success, 1);
      return "stats response " + stats.durationMs + "ms";
    });
    await step("No-answer contacts are not retried before three hours", async () => {
      const caller = callers[1];
      const contact = allocated[1];
      const noAnswer = await request(server.baseUrl, "POST", "/api/calls", { headers: { "x-caller-phone": caller.phone }, body: { callerId: caller.id, contactId: contact.id, status: "NO_ANSWER", callNotes: "" } });
      assert.equal(noAnswer.status, 200);
      const otherCaller = callers[2];
      const next = await request(server.baseUrl, "GET", "/api/contacts/next?callerId=" + otherCaller.id + "&projectId=" + projectId, { headers: { "x-caller-phone": otherCaller.phone } });
      assert.equal(next.status, 200);
      assert.notEqual(next.data.id, contact.id);
      return "NO_ANSWER " + contact.id + " was not immediately recycled";
    });
    await step("Archived projects stop assignment but keep exportable data", async () => {
      const archive = await request(server.baseUrl, "DELETE", "/api/projects/" + projectId, { headers: adminHeaders });
      assert.equal(archive.status, 200);
      assert.equal(archive.data.archived, true);
      const blockedNext = await request(server.baseUrl, "GET", "/api/contacts/next?callerId=" + callers[3].id + "&projectId=" + projectId, { headers: { "x-caller-phone": callers[3].phone } });
      assert.equal(blockedNext.status, 403);
      const stats = await request(server.baseUrl, "GET", "/api/stats/admin", { headers: adminHeaders });
      assert.equal(stats.data.summary.total, 0);
      const exportCsv = await request(server.baseUrl, "GET", "/api/projects/" + projectId + "/export.csv?passcode=" + ADMIN_PASSCODE);
      assert.equal(exportCsv.status, 200);
      assert.match(exportCsv.raw, /בדיקת מערכת/);
      const noPass = await request(server.baseUrl, "GET", "/api/projects/" + projectId + "/export.xlsx");
      assert.equal(noPass.status, 401);
      const exportXlsx = await request(server.baseUrl, "GET", "/api/projects/" + projectId + "/export.xlsx?passcode=" + ADMIN_PASSCODE);
      assert.equal(exportXlsx.status, 200);
      assert.equal(exportXlsx.headers["content-type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const restore = await request(server.baseUrl, "POST", "/api/projects/" + projectId + "/restore", { headers: adminHeaders });
      assert.equal(restore.status, 200);
      assert.equal(restore.data.archived, false);
      return "archive blocks calls, export still works";
    });
    await step("Dangerous reset endpoints are disabled", async () => {
      const contactsReset = await request(server.baseUrl, "POST", "/api/contacts/reset", { headers: adminHeaders });
      const callersReset = await request(server.baseUrl, "POST", "/api/callers/reset", { headers: adminHeaders });
      assert.equal(contactsReset.status, 403);
      assert.equal(callersReset.status, 403);
      return "reset routes returned 403";
    });
  } finally {
    await step("Stop isolated backend test server", async () => { await server.stop(); return "temporary database removed"; });
  }
}
async function main() {
  console.log("TOTAL VICTORY SYSTEM TESTS");
  console.log("==========================");
  console.log("Started: " + new Date().toISOString() + "\n");
  if (args.has("--backend-only")) await runBuildChecks(false);
  else await runBuildChecks(true);
  if (!args.has("--builds-only")) await runBackendIntegrationChecks();
  const failed = results.filter((item) => item.status === "FAIL");
  const passed = results.filter((item) => item.status === "PASS");
  const totalMs = results.reduce((sum, item) => sum + item.durationMs, 0);
  console.log("\nSUMMARY");
  console.log("=======");
  console.log("Passed: " + passed.length);
  console.log("Failed: " + failed.length);
  console.log("Measured step time: " + totalMs + "ms");
  if (failed.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });
