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
let requestCounter = 0;
function request(baseUrl, method, route, options) {
  options = options || {};
  const headers = { ...options.headers };
  if (!headers["x-forwarded-for"]) {
    requestCounter++;
    headers["x-forwarded-for"] = "127.0.0." + (requestCounter % 250);
  }
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const url = new URL(route, baseUrl);
    const payload = options.body === undefined ? null : JSON.stringify(options.body);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}), ...headers },
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
  let approvedAdminPasscode = "";
  let adminBPasscode = "";
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
      approvedAdminPasscode = approval.data.passcode;
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
    await step("Admins have fully isolated private environments (multi-tenant)", async () => {
      const emailB = "admin-b-" + Date.now() + "@example.com";
      const regB = await request(server.baseUrl, "POST", "/api/admins/register", { body: { fullName: "מנהל ב", email: emailB, phone: "0501111111", organization: "מטה ב", planId: "monthly" } });
      assert.equal(regB.status, 200);
      
      const ownerList = await request(server.baseUrl, "GET", "/api/admins/registration-requests", { headers: adminHeaders });
      const pendingB = ownerList.data.find((item) => item.email === emailB);
      const appB = await request(server.baseUrl, "POST", "/api/admins/" + pendingB.id + "/approve", { headers: adminHeaders });
      assert.equal(appB.status, 200);
      adminBPasscode = appB.data.passcode;

      const headersA = { "x-admin-passcode": approvedAdminPasscode };
      const headersB = { "x-admin-passcode": adminBPasscode };

      const uploadA = await request(server.baseUrl, "POST", "/api/projects/upload", {
        headers: headersA,
        body: { projectName: "פרויקט של א", contacts: [] }
      });
      assert.equal(uploadA.status, 200);
      const projAId = uploadA.data.project.id;

      const uploadB = await request(server.baseUrl, "POST", "/api/projects/upload", {
        headers: headersB,
        body: { projectName: "פרויקט של ב", contacts: [] }
      });
      assert.equal(uploadB.status, 200);
      const projBId = uploadB.data.project.id;

      const listA = await request(server.baseUrl, "GET", "/api/projects", { headers: headersA });
      assert.ok(listA.data.some((p) => p.id === projAId));
      assert.ok(!listA.data.some((p) => p.id === projBId));

      const listB = await request(server.baseUrl, "GET", "/api/projects", { headers: headersB });
      assert.ok(listB.data.some((p) => p.id === projBId));
      assert.ok(!listB.data.some((p) => p.id === projAId));

      const saveSettingsA = await request(server.baseUrl, "POST", "/api/settings", {
        headers: headersA,
        body: { settings: { campaign_name: "קמפיין א" } }
      });
      assert.equal(saveSettingsA.status, 200);

      const getSettingsB = await request(server.baseUrl, "GET", "/api/settings?passcode=" + adminBPasscode);
      assert.equal(getSettingsB.data.campaign_name, "מטה ב");

      const phone = "0555555555";
      const loginA = await request(server.baseUrl, "POST", "/api/login", {
        body: { name: "טלפן של א", phone, projectId: projAId }
      });
      assert.equal(loginA.status, 200);
      assert.ok(loginA.data.projects.some((p) => p.id === projAId));

      const loginB = await request(server.baseUrl, "POST", "/api/login", {
        body: { name: "טלפן של ב", phone, projectId: projBId }
      });
      assert.equal(loginB.status, 200);
      assert.ok(loginB.data.projects.some((p) => p.id === projBId));
      assert.ok(!loginB.data.projects.some((p) => p.id === projAId));

      return "multitenancy isolation verified successfully";
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
      const permanentDelete = await request(server.baseUrl, "DELETE", "/api/projects/" + projectId + "/permanent", { headers: adminHeaders });
      assert.equal(permanentDelete.status, 200);
      assert.equal(permanentDelete.data.success, true);
      const afterDeleteList = await request(server.baseUrl, "GET", "/api/projects", { headers: adminHeaders });
      assert.ok(!afterDeleteList.data.some((p) => p.id === projectId), "project should be permanently removed");
      return "archive blocks calls, export still works, permanent delete verified";
    });
    await step("License expiration enforcement", async () => {
      const emailExp = "expired-admin-" + Date.now() + "@example.com";
      const register = await request(server.baseUrl, "POST", "/api/admins/register", { body: { fullName: "מנהל פג תוקף", email: emailExp, phone: "0507776666", organization: "מטה פג תוקף", planId: "monthly" } });
      assert.equal(register.status, 200);
      
      const ownerList = await request(server.baseUrl, "GET", "/api/admins/registration-requests", { headers: adminHeaders });
      const pendingAdmin = ownerList.data.find((item) => item.email === emailExp);
      
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      const approval = await request(server.baseUrl, "POST", "/api/admins/" + pendingAdmin.id + "/approve", { 
        headers: adminHeaders,
        body: { expiresAt: pastDate }
      });
      assert.equal(approval.status, 200);
      const expiredPasscode = approval.data.passcode;
      const expiredHeaders = { "x-admin-passcode": expiredPasscode };
      
      const validate = await request(server.baseUrl, "POST", "/api/admins/validate", { body: { passcode: expiredPasscode } });
      assert.equal(validate.status, 200);
      assert.equal(validate.data.isExpired, true);
      
      const stats = await request(server.baseUrl, "GET", "/api/stats/admin", { headers: expiredHeaders });
      assert.equal(stats.status, 200);
      assert.equal(stats.data.isExpired, true);
      
      const settings = await request(server.baseUrl, "GET", "/api/settings?passcode=" + expiredPasscode);
      assert.equal(settings.status, 200);
      assert.equal(settings.data.campaign_name, "מטה פג תוקף");
      
      const upload = await request(server.baseUrl, "POST", "/api/projects/upload", { 
        headers: expiredHeaders,
        body: { projectName: "ניסיון העלאה", contacts: makeContacts(2) } 
      });
      assert.equal(upload.status, 403);
      assert.equal(upload.data.error, "license_expired");
      
      const emailC = "admin-c-" + Date.now() + "@example.com";
      const regC = await request(server.baseUrl, "POST", "/api/admins/register", { body: { fullName: "מנהל ג", email: emailC, phone: "0505554444", organization: "מטה ג", planId: "monthly" } });
      const ownerList2 = await request(server.baseUrl, "GET", "/api/admins/registration-requests", { headers: adminHeaders });
      const pendingC = ownerList2.data.find((item) => item.email === emailC);
      const appC = await request(server.baseUrl, "POST", "/api/admins/" + pendingC.id + "/approve", { headers: adminHeaders });
      const passC = appC.data.passcode;
      const headersC = { "x-admin-passcode": passC };
      
      const uploadC = await request(server.baseUrl, "POST", "/api/projects/upload", { 
        headers: headersC, 
        body: { projectName: "פרויקט ג", contacts: makeContacts(5) } 
      });
      assert.equal(uploadC.status, 200);
      const projId = uploadC.data.project.id;
      
      const callerPhone = "0500000009";
      const callerLogin = await request(server.baseUrl, "POST", "/api/login", { body: { name: "טלפן ג", phone: callerPhone, projectId: projId } });
      assert.equal(callerLogin.status, 200);
      
      const expireC = await request(server.baseUrl, "POST", "/api/admins/" + pendingC.id + "/approve", { 
        headers: adminHeaders,
        body: { expiresAt: pastDate }
      });
      assert.equal(expireC.status, 200);
      
      const callerLoginBlocked = await request(server.baseUrl, "POST", "/api/login", { body: { name: "טלפן ג", phone: callerPhone, projectId: projId } });
      assert.equal(callerLoginBlocked.status, 402);
      assert.equal(callerLoginBlocked.data.error, "license_expired");
      
      const nextBlocked = await request(server.baseUrl, "GET", "/api/contacts/next?callerId=" + callerLogin.data.id + "&projectId=" + projId, { headers: { "x-caller-phone": callerPhone } });
      assert.equal(nextBlocked.status, 402);
      
      const exportXlsx = await request(server.baseUrl, "GET", "/api/projects/" + projId + "/export.xlsx?passcode=" + passC);
      assert.equal(exportXlsx.status, 200);
      
      // Test update-expiry route
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const updateExpiry = await request(server.baseUrl, "POST", "/api/admins/" + pendingC.id + "/update-expiry", {
        headers: adminHeaders,
        body: { expiresAt: futureDate }
      });
      assert.equal(updateExpiry.status, 200);
      assert.equal(new Date(updateExpiry.data.expiresAt).toISOString(), new Date(futureDate).toISOString());
      
      // Verify that the admin is active again
      const validateActive = await request(server.baseUrl, "POST", "/api/admins/validate", { body: { passcode: passC } });
      assert.equal(validateActive.status, 200);
      assert.equal(validateActive.data.isExpired, false);
      
      // Set the expiration date to 13 months ago (over 1 year)
      const overOneYearAgo = new Date();
      overOneYearAgo.setMonth(overOneYearAgo.getMonth() - 13);
      const setOldExpiry = await request(server.baseUrl, "POST", "/api/admins/" + pendingC.id + "/update-expiry", {
        headers: adminHeaders,
        body: { expiresAt: overOneYearAgo.toISOString() }
      });
      assert.equal(setOldExpiry.status, 200);
      
      // Trigger the backend cleanupExpiredData manually
      const backendModulePath = path.join(ROOT, "backend", "dist", "server.js");
      const backend = require(backendModulePath);
      await backend.cleanupExpiredData();
      
      // Verify that admin C is deleted
      const validateDeleted = await request(server.baseUrl, "POST", "/api/admins/validate", { body: { passcode: passC } });
      assert.equal(validateDeleted.status, 401);
      
      const ownerListAfterCleanup = await request(server.baseUrl, "GET", "/api/admins/registration-requests", { headers: adminHeaders });
      const foundC = ownerListAfterCleanup.data.find((item) => item.id === pendingC.id);
      assert.ok(!foundC, "Admin expired for more than 1 year should be cleaned up from database");
      
      return "licensing expiry, update-expiry, and 1-year data deletion cleanup verified successfully";
    });
    await step("Dangerous reset endpoints are disabled", async () => {
      const contactsReset = await request(server.baseUrl, "POST", "/api/contacts/reset", { headers: adminHeaders });
      const callersReset = await request(server.baseUrl, "POST", "/api/callers/reset", { headers: adminHeaders });
      assert.equal(contactsReset.status, 403);
      assert.equal(callersReset.status, 403);
      return "reset routes returned 403";
    });
    await step("Security headers are present on responses", async () => {
      const res = await request(server.baseUrl, "GET", "/api/settings");
      assert.equal(res.headers["x-frame-options"], "DENY");
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["x-xss-protection"], "1; mode=block");
      assert.match(res.headers["strict-transport-security"], /max-age=/);
      return "headers verified successfully";
    });
    await step("Rate limiting blocks brute-force login attempts", async () => {
      // The rate limit for login is 50 requests per windowMs.
      // We will make 51 requests to /api/login and verify the 51st returns 429.
      const payload = { name: "טלפן ספאם", phone: "0501112222" };
      const headers = { "x-forwarded-for": "8.8.8.8" };
      for (let i = 0; i < 50; i++) {
        const res = await request(server.baseUrl, "POST", "/api/login", { body: payload, headers });
        // The first 50 logins should return 200 or 400 (if invalid params), but NOT 429
        assert.notEqual(res.status, 429);
      }
      const resBlocked = await request(server.baseUrl, "POST", "/api/login", { body: payload, headers });
      assert.equal(resBlocked.status, 429);
      assert.equal(resBlocked.data.error, "Too many requests, please try again later.");
      return "rate limiter blocked 51st attempt with 429";
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
