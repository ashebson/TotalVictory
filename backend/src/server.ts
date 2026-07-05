import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import zlib from "zlib";
import path from "path";
import fs from "fs/promises";
import nodemailer from "nodemailer";

const DATA_FILE = path.resolve(process.cwd(), "data/local-db.json");
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "20mb";
const MAX_UPLOAD_BYTES = Number.parseInt(process.env.MAX_UPLOAD_BYTES || String(15 * 1024 * 1024), 10);
const MAX_CONTACTS_PER_UPLOAD = Number.parseInt(process.env.MAX_CONTACTS_PER_UPLOAD || "50000", 10);

const app = express();
const server = http.createServer(app);
const prisma = process.env.USE_MEMORY_DB === "true" ? null : new PrismaClient();

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "DELETE"] },
});

app.use(cors());

// --- Security Headers Middleware ---
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// --- In-Memory Rate Limiting System ---
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();
function rateLimiter(limit: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (process.env.NODE_ENV === "test") return next();
    const rawIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(",")[0].trim();
    const now = Date.now();
    let rateData = ipRequestCounts.get(ip);
    if (!rateData || now > rateData.resetTime) {
      rateData = { count: 0, resetTime: now + windowMs };
    }
    rateData.count++;
    ipRequestCounts.set(ip, rateData);
    if (rateData.count > limit) {
      return res.status(429).json({ error: "Too many requests, please try again later." });
    }
    next();
  };
}

// Clean expired rate-limit entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [ip, rateData] of ipRequestCounts.entries()) {
    if (now > rateData.resetTime) {
      ipRequestCounts.delete(ip);
    }
  }
}, 60_000);

app.use(express.json({ limit: JSON_BODY_LIMIT }));

type Project = { id: number; adminId: number; name: string; sourceFileName?: string | null; sourceHeaders?: string[]; createdAt: Date };
type Caller = { id: number; adminId: number; name: string; phone: string; whatsappTemplate?: string | null; createdAt: Date };
type Contact = { id: number; projectId: number; name: string; phone: string; city?: string | null; sector?: string | null; familySize?: number | null; notes?: string | null; status: string; callNotes?: string | null; sourceData?: Record<string, string>; lastCalledAt?: Date | null; callerId?: number | null };
type CallLog = { id: number; projectId: number; callerId: number; contactId: number; status: string; timestamp: Date };
type Store = { projects: Project[]; callers: Caller[]; contacts: Contact[]; callerProjects: { callerId: number; projectId: number }[]; callLogs: CallLog[]; settings: { adminId: number; key: string; value: string }[]; admins: any[]; subscriptions: any[]; ids: { project: number; caller: number; contact: number; callLog: number; admin: number; subscription: number } };

const memory: Store = { projects: [], callers: [], contacts: [], callerProjects: [], callLogs: [], settings: [], admins: [], subscriptions: [], ids: { project: 1, caller: 1, contact: 1, callLog: 1, admin: 1, subscription: 1 } };

// --- Settings Cache (DB-First with Delta Sync) ---
const settingsCache = new Map<string, string>();
let settingsCacheLastSync = new Date(0);
const SETTINGS_SYNC_INTERVAL_MS = 10_000;

async function syncSettingsCache() {
  if (!prisma) return;
  try {
    const updated = await prisma.setting.findMany({
      where: { updatedAt: { gt: settingsCacheLastSync } },
    });
    const now = new Date();
    for (const s of updated) {
      settingsCache.set(`${s.adminId}_${s.key}`, s.value);
    }
    settingsCacheLastSync = now;
  } catch (err) {
    console.error('Settings cache sync error:', err);
  }
}

function startSettingsCacheSync() {
  if (!prisma) return;
  syncSettingsCache();
  setInterval(syncSettingsCache, SETTINGS_SYNC_INTERVAL_MS);
}

// --- Stats Cache (15s TTL) ---
const statsCache = new Map<string, { data: any; expiresAt: number }>();
const STATS_CACHE_TTL_MS = 15_000;

function getCachedStats(key: string): any | null {
  const entry = statsCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  return null;
}

function setCachedStats(key: string, data: any) {
  statsCache.set(key, { data, expiresAt: Date.now() + STATS_CACHE_TTL_MS });
}

function invalidateStatsCache(adminId?: number) {
  if (adminId !== undefined) {
    statsCache.delete(`admin_${adminId}`);
    statsCache.delete(`tv_${adminId}`);
  } else {
    statsCache.clear();
  }
}

let contactAllocationQueue = Promise.resolve();
function enqueueContactAllocation<T>(work: () => T | Promise<T>) {
  const result = contactAllocationQueue.then(work, work);
  contactAllocationQueue = result.then(() => undefined, () => undefined);
  return result;
}

const defaultCallStatusOptions = [
  { id: "SUCCESS", label: "שיחה מוצלחת", active: true, className: "success" },
  { id: "NOT_INTERESTED", label: "לא מעוניין", active: true, className: "no-interest" },
  { id: "NO_ANSWER", label: "אין מענה", active: true, className: "no-answer" },
  { id: "INVALID_NUMBER", label: "מספר שגוי", active: true, className: "invalid" },
];

const defaultSettings = [
  { key: "whatsapp_template", value: "שלום {name}, שמחנו לשוחח איתך. נשמח לתמיכתך במועמד/ת במסגרת מערכת הבחירות. ביחד נצליח!" },
  { key: "campaign_name", value: "מטה טלפנים דיגיטלי" },
  { key: "target_calls", value: "5000" },
  { key: "call_status_options", value: JSON.stringify(defaultCallStatusOptions) },
  { key: "archived_project_ids", value: "[]" },
];

function cleanPhone(phone: unknown) { return String(phone || "").replace(/\D/g, ""); }
function normalizeHeader(value: string) { return value.trim().replace(/^"|"$/g, "").toLowerCase(); }

function settingValue(adminId: number, key: string, fallback: string) {
  if (prisma) {
    const cached = settingsCache.get(`${adminId}_${key}`);
    if (cached !== undefined) return cached;
    const defaultValue = defaultSettings.find((item) => item.key === key)?.value || fallback;
    return defaultValue;
  }
  let setting = memory.settings.find((item) => item.adminId === adminId && item.key === key);
  if (!setting) {
    const defaultValue = defaultSettings.find((item) => item.key === key)?.value || fallback;
    setting = { adminId, key, value: defaultValue };
    memory.settings.push(setting);
  }
  return setting.value;
}

function parseJsonSetting<T>(adminId: number, key: string, fallback: T): T {
  try {
    const raw = settingValue(adminId, key, "");
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function getCallStatusOptions(adminId: number) {
  const configured = parseJsonSetting<any[]>(adminId, "call_status_options", defaultCallStatusOptions);
  const byId = new Map(configured.map((item) => [String(item.id || ""), item]));
  const options = defaultCallStatusOptions.map((base) => {
    const item = byId.get(base.id) || {};
    const label = String(item.label || base.label).trim().slice(0, 40) || base.label;
    return { ...base, label, active: item.active !== false };
  });
  return options.some((item) => item.active) ? options : defaultCallStatusOptions;
}

function callStatusLabel(adminId: number, status: string) {
  return getCallStatusOptions(adminId).find((item) => item.id === status)?.label || status;
}

function archivedProjectIds(adminId: number) {
  return parseJsonSetting<number[]>(adminId, "archived_project_ids", []).map(Number).filter(Number.isFinite);
}

function isProjectArchived(projectId: number) {
  if (prisma) {
    for (const [cacheKey, cacheValue] of settingsCache) {
      if (cacheKey.endsWith("_archived_project_ids")) {
        try {
          const list = JSON.parse(cacheValue);
          if (Array.isArray(list) && list.map(Number).includes(projectId)) {
            return true;
          }
        } catch {}
      }
    }
    return false;
  }
  const project = memory.projects.find((p) => p.id === projectId);
  if (!project) return false;
  return archivedProjectIds(project.adminId).includes(projectId);
}

async function setProjectArchived(adminId: number, projectId: number, archived: boolean) {
  const ids = new Set(archivedProjectIds(adminId));
  if (archived) ids.add(projectId); else ids.delete(projectId);
  const value = JSON.stringify([...ids]);
  if (prisma) {
    await persistSetting(adminId, "archived_project_ids", value);
  } else {
    let existing = memory.settings.find((item) => item.adminId === adminId && item.key === "archived_project_ids");
    if (existing) existing.value = value; else memory.settings.push({ adminId, key: "archived_project_ids", value });
  }
}

function activeContacts(adminId?: number) {
  return memory.contacts.filter((contact) => {
    const project = memory.projects.find((p) => p.id === contact.projectId);
    if (!project) return false;
    if (adminId !== undefined && project.adminId !== adminId) return false;
    return !isProjectArchived(contact.projectId);
  });
}

function activeProjects(adminId?: number) {
  return memory.projects.filter((project) => {
    if (adminId !== undefined && project.adminId !== adminId) return false;
    return !isProjectArchived(project.id);
  });
}

async function saveStore() {
  if (process.env.USE_MEMORY_DB === "true") {
    await saveMemoryStore();
  } else {
    await savePrismaStore();
  }
}

async function sendRegistrationNotification(admin: any, planId: string) {
  const adminDetails = `שם: ${admin.fullName}
ארגון: ${admin.organization}
טלפון: ${admin.phone}
אימייל: ${admin.email}
מסלול: ${planLabel(planId)}
מספר בקשה: ${admin.id}`;

  const messageText = `הרשמת מנהל חדש במערכת TVictory:
${adminDetails}`;

  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: messageText,
          text: messageText,
        }),
      });
      console.log("Notification webhook sent successfully");
    } catch (err: any) {
      console.error("Error sending notification webhook:", err.message);
    }
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;
  const notifyEmail = process.env.OWNER_NOTIFICATION_EMAIL || process.env.NOTIFY_EMAIL || "yehuda2363@gmail.com";

  if (smtpHost && smtpUser && smtpPass && notifyEmail) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465 || process.env.SMTP_SECURE === "true",
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: smtpFrom,
        to: notifyEmail,
        subject: `TVictory - הרשמת מנהל חדש: ${admin.fullName}`,
        text: messageText,
        html: `<div dir="rtl" style="font-family: sans-serif;">
          <h2>הרשמת מנהל חדש במערכת TVictory</h2>
          <p><strong>פרטי הנרשם:</strong></p>
          <ul>
            <li><strong>שם מלא:</strong> ${admin.fullName}</li>
            <li><strong>ארגון:</strong> ${admin.organization}</li>
            <li><strong>טלפון:</strong> ${admin.phone}</li>
            <li><strong>אימייל:</strong> ${admin.email}</li>
            <li><strong>מסלול:</strong> ${planLabel(planId)}</li>
            <li><strong>מספר בקשה:</strong> ${admin.id}</li>
          </ul>
        </div>`,
      });
      console.log("Notification email sent successfully");
    } catch (err: any) {
      console.error("Error sending notification email:", err.message);
    }
  }
}

function authenticateOwner(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const customHeader = req.headers["x-admin-passcode"];
  const queryPasscode = req.query.passcode;
  const passcode = (authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : authHeader)
    || (typeof customHeader === "string" ? customHeader : undefined)
    || (typeof queryPasscode === "string" ? queryPasscode : undefined);
  if (passcode !== "halevi2026") return res.status(403).json({ error: "Owner access required" });
  (req as any).adminId = 1;
  next();
}

function isExpiredAdmin(adminId: number): boolean {
  if (adminId === 1) return false;
  const sub = [...memory.subscriptions]
    .reverse()
    .find((s) => s.adminId === adminId && s.status === "ACTIVE");
  if (!sub) return true;
  if (!sub.expiresAt) return false;
  return new Date(sub.expiresAt).getTime() < Date.now();
}

async function authenticateAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const customHeader = req.headers["x-admin-passcode"];
  const queryPasscode = req.query.passcode;
  
  const passcode = (authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : authHeader) 
    || (typeof customHeader === "string" ? customHeader : undefined)
    || (typeof queryPasscode === "string" ? queryPasscode : undefined);

  if (!passcode) {
    return res.status(401).json({ error: "Admin passcode is required" });
  }
  
  if (passcode === "halevi2026") {
    (req as any).adminId = 1;
    return next();
  }
  
  const admin = prisma
    ? await prisma.admin.findFirst({ where: { passcode, status: "ACTIVE" } })
    : memory.admins.find((item) => item.passcode === passcode && item.status === "ACTIVE");
  if (!admin) {
    return res.status(401).json({ error: "Invalid or inactive admin passcode" });
  }
  
  (req as any).adminId = admin.id;

  if (isExpiredAdmin(admin.id)) {
    const allowedPaths = [
      "/api/stats/admin",
      "/api/settings",
    ];
    const path = req.path;
    const isExport = path.includes("/export.xlsx") || path.includes("/export.csv");
    if (req.method === "GET" && (allowedPaths.includes(path) || isExport)) {
      return next();
    }
    return res.status(403).json({ 
      error: "license_expired", 
      message: "רישיון המערכת פג. הנתונים שמורים, אך לא ניתן לבצע פעולה זו." 
    });
  }

  next();
}

async function authenticateCaller(req: express.Request, res: express.Response, next: express.NextFunction) {
  const phoneHeader = req.headers["x-caller-phone"];
  const callerIdQuery = req.query.callerId || req.body.callerId;
  const callerIdParam = req.params.callerId;
  
  if (!phoneHeader) {
    return res.status(401).json({ error: "Caller phone is required" });
  }
  
  const normalizedPhone = cleanPhone(phoneHeader);
  const caller = prisma
    ? await prisma.caller.findFirst({ where: { phone: normalizedPhone } })
    : memory.callers.find((item) => item.phone === normalizedPhone);
  if (!caller) {
    return res.status(401).json({ error: "Caller phone not registered" });
  }
  
  if (isExpiredAdmin(caller.adminId)) {
    return res.status(402).json({ 
      error: "license_expired", 
      message: "רישיון המערכת פג. אנא פנה למנהל המטה." 
    });
  }
  
  const requestedCallerId = callerIdQuery || callerIdParam;
  if (requestedCallerId && Number(requestedCallerId) !== caller.id) {
    return res.status(403).json({ error: "Caller ID mismatch" });
  }
  
  (req as any).caller = caller;
  next();
}

function splitCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') { current += '"'; i++; }
    else if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) { cells.push(current.trim()); current = ""; }
    else current += ch;
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, ""));
}

function compactHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/^"|"$/g, "")
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[\s_\-./:()'"״׳]+/g, "");
}

function headerHas(header: string, aliases: string[]) {
  return aliases.some((alias) => header.includes(compactHeader(alias)));
}

type HeaderMap = {
  name?: number;
  firstName?: number;
  lastName?: number;
  phone?: number;
  mobilePhoneIndexes?: number[];
  phoneIndexes?: number[];
  city?: number;
  sector?: number;
  familySize?: number;
  notes?: number;
};

const headerAliases = {
  name: ["שם", "שםמלא", "שם מלא", "fullname", "full name", "name", "contactname", "שםהמצביע", "שם מצביע", "לקוח"],
  firstName: ["שםפרטי", "שם פרטי", "firstname", "first name", "givenname", "private name"],
  lastName: ["שםמשפחה", "שם משפחה", "lastname", "last name", "surname", "familyname", "family name"],
  mobilePhone: ["טלפוןנייד", "טלפון נייד", "נייד", "סלולרי", "פלאפון", "ניידאישי", "נייד אישי", "mobile", "cell", "cellphone", "cell phone", "mobilephone", "mobile phone"],
  phone: ["טלפון", "מספרטלפון", "מספר טלפון", "טלפוןבית", "טלפון בית", "בית", "phone", "telephone", "tel", "phone1", "primaryphone", "homephone", "home phone"],
  city: ["עיר", "ישוב", "יישוב", "מגורים", "כתובת", "address", "city", "town", "locality", "settlement"],
  sector: ["מגזר", "קבוצה", "תתקבוצה", "תת קבוצה", "sector", "group", "subgroup", "category"],
  familySize: ["נפשות", "גודלמשפחה", "גודל משפחה", "משפחה", "familysize", "family size", "household", "householdsize"],
  notes: ["הערות", "הערה", "סימון", "מענייןאותנו", "מעניין אותנו", "notes", "note", "comment", "comments", "status", "remark", "remarks"],
};

function mapHeaders(headers: string[]) {
  const map: HeaderMap = {};
  headers.forEach((header, index) => {
    const h = compactHeader(header);
    if (!h) return;
    if (map.lastName === undefined && headerHas(h, headerAliases.lastName)) map.lastName = index;
    else if (map.firstName === undefined && headerHas(h, headerAliases.firstName)) map.firstName = index;
    else if (map.name === undefined && headerHas(h, headerAliases.name) && !headerHas(h, headerAliases.firstName) && !headerHas(h, headerAliases.lastName)) map.name = index;
    else if (headerHas(h, headerAliases.mobilePhone)) {
      if (!Array.isArray(map.mobilePhoneIndexes)) map.mobilePhoneIndexes = [];
      map.mobilePhoneIndexes.push(index);
      if (map.phone === undefined) map.phone = index;
    }
    else if (headerHas(h, headerAliases.phone)) {
      if (!Array.isArray(map.phoneIndexes)) map.phoneIndexes = [];
      map.phoneIndexes.push(index);
      if (map.phone === undefined) map.phone = index;
    }
    else if (map.city === undefined && headerHas(h, headerAliases.city)) map.city = index;
    else if (map.sector === undefined && headerHas(h, headerAliases.sector)) map.sector = index;
    else if (map.familySize === undefined && headerHas(h, headerAliases.familySize)) map.familySize = index;
    else if (map.notes === undefined && headerHas(h, headerAliases.notes)) map.notes = index;
  });
  return map;
}

function headerScore(map: HeaderMap) {
  let score = 0;
  if (map.phone !== undefined) score += 5;
  if (map.name !== undefined) score += 5;
  if (map.firstName !== undefined) score += 3;
  if (map.lastName !== undefined) score += 3;
  if (map.city !== undefined) score += 1;
  if (map.sector !== undefined) score += 1;
  if (map.notes !== undefined) score += 1;
  if (map.phone !== undefined && (map.name !== undefined || (map.firstName !== undefined && map.lastName !== undefined))) score += 10;
  return score;
}

function findHeaderRow(rows: string[][]) {
  let best = { index: 0, map: mapHeaders(rows[0] || []), score: -1 };
  rows.slice(0, Math.min(rows.length, 25)).forEach((row, index) => {
    const map = mapHeaders(row);
    const score = headerScore(map);
    if (score > best.score) best = { index, map, score };
  });
  return best;
}

function choosePhone(cells: string[], headerMap: HeaderMap) {
  const mobileIndexes = Array.isArray(headerMap.mobilePhoneIndexes) ? headerMap.mobilePhoneIndexes : [];
  const regularIndexes = Array.isArray(headerMap.phoneIndexes)
    ? headerMap.phoneIndexes
    : [headerMap.phone].filter((item) => item !== undefined);
  const orderedIndexes = [...mobileIndexes, ...regularIndexes.filter((index) => !mobileIndexes.includes(index))];
  for (const index of orderedIndexes) {
    const cleaned = cleanPhone(cells[index]);
    if (cleaned.length >= 9) return cells[index]?.trim();
  }
  return orderedIndexes.length ? cells[orderedIndexes[0]]?.trim() : undefined;
}

function buildSourceData(headers: string[], cells: string[]) {
  const data: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = String(header || "Column " + (index + 1)).trim() || "Column " + (index + 1);
    data[key] = cells[index] ?? "";
  });
  return data;
}

function normalizeRows(rows: string[][]) {
  if (rows.length < 2) return [];
  const { index: headerIndex, map: headerMap } = findHeaderRow(rows);
  if ((headerMap.name === undefined && (headerMap.firstName === undefined || headerMap.lastName === undefined)) || headerMap.phone === undefined) {
    throw new Error("Required columns not found: name/full name or first+last name, and phone");
  }
  const headers = rows[headerIndex].map((header, index) => String(header || "Column " + (index + 1)).trim() || "Column " + (index + 1));
  return rows.slice(headerIndex + 1).map((cells) => {
    const fullName = headerMap.name !== undefined
      ? cells[headerMap.name]?.trim()
      : [cells[headerMap.firstName!]?.trim(), cells[headerMap.lastName!]?.trim()].filter(Boolean).join(" ");
    return {
      name: fullName,
      phone: choosePhone(cells, headerMap),
      city: headerMap.city !== undefined ? cells[headerMap.city]?.trim() : undefined,
      sector: headerMap.sector !== undefined ? cells[headerMap.sector]?.trim() : undefined,
      familySize: headerMap.familySize !== undefined ? cells[headerMap.familySize]?.trim() : undefined,
      notes: headerMap.notes !== undefined ? cells[headerMap.notes]?.trim() : undefined,
      sourceData: buildSourceData(headers, cells),
      sourceHeaders: headers,
    };
  }).filter((row) => row.name && row.phone);
}

function parseCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g)?.length || 0) > (lines[0].match(/,/g)?.length || 0) ? ";" : ",";
  return normalizeRows(lines.map((line) => splitCsvLine(line, delimiter)));
}

function decodeXml(text: string) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function columnIndex(cellRef: string) {
  const letters = (cellRef.match(/[A-Z]+/i)?.[0] || "A").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function readZip(buffer: Buffer) {
  const entries: Record<string, Buffer> = {};
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("קובץ XLSX לא תקין");
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    entries[fileName] = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXlsx(base64: string) {
  const entries = readZip(Buffer.from(base64, "base64"));
  const sharedXml = entries["xl/sharedStrings.xml"]?.toString("utf8") || "";
  const sharedStrings = Array.from(sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)).map((match) => Array.from(match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((part) => decodeXml(part[1])).join(""));
  const workbookXml = entries["xl/workbook.xml"]?.toString("utf8") || "";
  const firstSheetId = workbookXml.match(/<sheet[^>]*r:id="(rId\d+)"/)?.[1];
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (firstSheetId && entries["xl/_rels/workbook.xml.rels"]) {
    const rels = entries["xl/_rels/workbook.xml.rels"].toString("utf8");
    const relMatch = new RegExp('<Relationship[^>]*Id="' + firstSheetId + '"[^>]*Target="([^"]+)"').exec(rels);
    if (relMatch) sheetPath = ("xl/" + relMatch[1].replace(/^\//, "")).replace("xl/xl/", "xl/");
  }
  const sheetXml = entries[sheetPath]?.toString("utf8") || entries["xl/worksheets/sheet1.xml"]?.toString("utf8");
  if (!sheetXml) throw new Error("לא נמצא גיליון ראשון בקובץ XLSX");
  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1] || "A" + (rows.length + 1);
      const type = attrs.match(/t="([^"]+)"/)?.[1];
      const value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || "";
      row[columnIndex(ref)] = type === "s" ? sharedStrings[Number(value)] || "" : decodeXml(value);
    }
    rows.push(row.map((cell) => cell || ""));
  }
  return normalizeRows(rows);
}

function exportStatusLabel(adminId: number, status: string) {
  if (status === "PENDING") return "ממתין לשיחה";
  return callStatusLabel(adminId, status);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

async function projectExportRows(projectId: number) {
  let project: any;
  let projectContacts: any[];
  if (prisma) {
    project = await prisma.project.findUnique({ where: { id: projectId } });
    projectContacts = await prisma.contact.findMany({ where: { projectId }, orderBy: { id: "asc" } });
  } else {
    project = memory.projects.find((item) => item.id === projectId);
    projectContacts = memory.contacts.filter((contact) => contact.projectId === projectId).sort((a, b) => a.id - b.id);
  }
  const adminId = project ? project.adminId : 1;
  const originalHeaders = Array.from(new Set([
    ...(project?.sourceHeaders || []),
    ...projectContacts.flatMap((contact) => Object.keys(contact.sourceData || {})),
  ])).filter(Boolean);
  const systemHeaders = ["סטטוס", "הערות", "תאריך שיחה אחרונה"];
  const fallbackHeaders = originalHeaders.length ? [] : ["Name", "Phone", "City", "Sector", "FamilySize", "Notes"];
  const headers = [...originalHeaders, ...fallbackHeaders, ...systemHeaders];
  const rows = projectContacts.map((contact) => {
    const originalValues = originalHeaders.length
      ? originalHeaders.map((header) => contact.sourceData?.[header] ?? "")
      : [contact.name, contact.phone, contact.city, contact.sector, contact.familySize, contact.notes];
    return [
      ...originalValues,
      exportStatusLabel(adminId, contact.status),
      contact.callNotes || "",
      contact.lastCalledAt ? new Date(contact.lastCalledAt).toLocaleDateString("he-IL") : "",
    ];
  });
  return { headers, rows };
}

async function projectExportCsv(projectId: number) {
  const { headers, rows } = await projectExportRows(projectId);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

async function projectExportXlsx(projectId: number) {
  const { headers, rows } = await projectExportRows(projectId);
  const workbook = XLSX.utils.book_new();
  const table = [headers, ...rows].map((row) => row.map((value) => String(value ?? "")));
  const worksheet = XLSX.utils.aoa_to_sheet(table);
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(45, Math.max(12, String(header || "").length + 4)) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, "נתונים");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function assertUploadPayloadSize(payload: any) {
  const base64Content = payload.fileContentBase64 ? String(payload.fileContentBase64) : "";
  const textContent = payload.fileText ? String(payload.fileText) : "";
  const estimatedBytes = base64Content ? Buffer.byteLength(base64Content, "base64") : Buffer.byteLength(textContent, "utf8");
  if (estimatedBytes > MAX_UPLOAD_BYTES) {
    const maxMb = Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024);
    throw new Error("הקובץ גדול מדי לעיבוד בטוח. נסה לפצל אותו לקבצים קטנים יותר, עד " + maxMb + "MB לקובץ.");
  }
}

function enforceUploadContactLimit(contacts: any[]) {
  if (contacts.length > MAX_CONTACTS_PER_UPLOAD) {
    throw new Error("הקובץ מכיל יותר מדי רשומות להעלאה אחת. נסה לפצל אותו לקבצים של עד " + MAX_CONTACTS_PER_UPLOAD.toLocaleString("he-IL") + " רשומות.");
  }
  return contacts;
}

function parseUploadedContacts(payload: any) {
  assertUploadPayloadSize(payload);
  let contacts: any[];
  if (Array.isArray(payload.contacts)) contacts = payload.contacts;
  else if (payload.fileContentBase64 && String(payload.fileName || "").toLowerCase().endsWith(".xlsx")) contacts = parseXlsx(payload.fileContentBase64);
  else if (payload.fileText) contacts = parseCsv(String(payload.fileText));
  else throw new Error("לא התקבל קובץ נתונים תקין");
  return enforceUploadContactLimit(contacts);
}

async function projectStatsFromDb(projectId: number) {
  if (!prisma) return projectStatsFromMemory(projectId);
  const groups = await prisma.contact.groupBy({
    by: ["status"],
    where: { projectId },
    _count: true,
  });
  const counts: Record<string, number> = {};
  let total = 0;
  for (const g of groups) { counts[g.status] = g._count; total += g._count; }
  return {
    total,
    pending: counts["PENDING"] || 0,
    success: counts["SUCCESS"] || 0,
    notInterested: counts["NOT_INTERESTED"] || 0,
    noAnswer: counts["NO_ANSWER"] || 0,
    invalidNumber: counts["INVALID_NUMBER"] || 0,
    totalCalled: total - (counts["PENDING"] || 0),
  };
}

function projectStatsFromMemory(projectId: number) {
  const projectContacts = memory.contacts.filter((contact) => contact.projectId === projectId);
  return {
    total: projectContacts.length,
    pending: projectContacts.filter((contact) => contact.status === "PENDING").length,
    success: projectContacts.filter((contact) => contact.status === "SUCCESS").length,
    notInterested: projectContacts.filter((contact) => contact.status === "NOT_INTERESTED").length,
    noAnswer: projectContacts.filter((contact) => contact.status === "NO_ANSWER").length,
    invalidNumber: projectContacts.filter((contact) => contact.status === "INVALID_NUMBER").length,
    totalCalled: projectContacts.filter((contact) => contact.status !== "PENDING").length,
  };
}

function projectStats(projectId: number) {
  return projectStatsFromMemory(projectId);
}

async function allStatsFromDb(adminId: number) {
  if (!prisma) return allStatsFromMemory(adminId);
  const archivedIds = archivedProjectIds(adminId);
  const groups = await prisma.contact.groupBy({
    by: ["status"],
    where: {
      project: { adminId },
      projectId: archivedIds.length ? { notIn: archivedIds } : undefined,
    },
    _count: true,
  });
  const counts: Record<string, number> = {};
  let total = 0;
  for (const g of groups) { counts[g.status] = g._count; total += g._count; }
  return {
    total,
    pending: counts["PENDING"] || 0,
    success: counts["SUCCESS"] || 0,
    notInterested: counts["NOT_INTERESTED"] || 0,
    noAnswer: counts["NO_ANSWER"] || 0,
    invalidNumber: counts["INVALID_NUMBER"] || 0,
    totalCalled: total - (counts["PENDING"] || 0),
  };
}

function allStatsFromMemory(adminId: number) {
  const contacts = activeContacts(adminId);
  return {
    total: contacts.length,
    pending: contacts.filter((contact) => contact.status === "PENDING").length,
    success: contacts.filter((contact) => contact.status === "SUCCESS").length,
    notInterested: contacts.filter((contact) => contact.status === "NOT_INTERESTED").length,
    noAnswer: contacts.filter((contact) => contact.status === "NO_ANSWER").length,
    invalidNumber: contacts.filter((contact) => contact.status === "INVALID_NUMBER").length,
    totalCalled: contacts.filter((contact) => contact.status !== "PENDING").length,
  };
}

function allStats(adminId: number) {
  return allStatsFromMemory(adminId);
}

async function tvStats(adminId: number = 1) {
  const stats = await allStatsFromDb(adminId);
  const getSetting = (key: string, fallback: string) => settingValue(adminId, key, fallback);

  let leaderboard: any[];
  let recentCalls: any[];

  if (prisma) {
    const callerStats = await prisma.callLog.groupBy({
      by: ["callerId"],
      where: { project: { adminId } },
      _count: true,
    });
    const successStats = await prisma.callLog.groupBy({
      by: ["callerId"],
      where: { project: { adminId }, status: "SUCCESS" },
      _count: true,
    });
    const successMap = new Map(successStats.map((s) => [s.callerId, s._count]));
    const callerIds = callerStats.filter((c) => c._count > 0).map((c) => c.callerId);
    const callerRecords = await prisma.caller.findMany({ where: { id: { in: callerIds } } });
    const callerMap = new Map(callerRecords.map((c) => [c.id, c]));
    leaderboard = callerStats
      .filter((c) => c._count > 0)
      .map((c) => {
        const caller = callerMap.get(c.callerId);
        const successCount = successMap.get(c.callerId) || 0;
        return {
          id: c.callerId,
          name: caller?.name || "טלפן",
          totalCalls: c._count,
          successCalls: successCount,
          successRate: c._count ? Math.round((successCount / c._count) * 100) : 0,
        };
      })
      .sort((a, b) => b.successCalls - a.successCalls || b.totalCalls - a.totalCalls)
      .slice(0, 10);

    const recentLogs = await prisma.callLog.findMany({
      where: { project: { adminId } },
      orderBy: { timestamp: "desc" },
      take: 10,
      include: { caller: true, contact: true },
    });
    recentCalls = recentLogs.map((log) => ({
      id: log.id,
      callerName: log.caller?.name || "טלפן",
      contactName: log.contact?.name || "איש קשר",
      status: log.status,
      timestamp: log.timestamp,
    }));
  } else {
    leaderboard = memory.callers
      .filter((caller) => caller.adminId === adminId)
      .map((caller) => {
        const logs = memory.callLogs.filter((log) => log.callerId === caller.id);
        const successLogs = logs.filter((log) => log.status === "SUCCESS");
        return {
          id: caller.id,
          name: caller.name,
          totalCalls: logs.length,
          successCalls: successLogs.length,
          successRate: logs.length ? Math.round((successLogs.length / logs.length) * 100) : 0,
        };
      })
      .filter((caller) => caller.totalCalls > 0)
      .sort((a, b) => b.successCalls - a.successCalls || b.totalCalls - a.totalCalls)
      .slice(0, 10);

    recentCalls = [...memory.callLogs]
      .filter((log) => {
        const project = memory.projects.find((p) => p.id === log.projectId);
        return project && project.adminId === adminId;
      })
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
      .slice(0, 10)
      .map((log) => {
        const caller = memory.callers.find((item) => item.id === log.callerId);
        const contact = memory.contacts.find((item) => item.id === log.contactId);
        return {
          id: log.id,
          callerName: caller?.name || "טלפן",
          contactName: contact?.name || "איש קשר",
          status: log.status,
          timestamp: log.timestamp,
        };
      });
  }

  const projects = prisma
    ? (await prisma.project.findMany({ where: { adminId } })).filter((p) => !archivedProjectIds(adminId).includes(p.id))
    : activeProjects(adminId);
  const serialized = await Promise.all(projects.map((p) => serializeProjectAsync(p)));

  return {
    ...stats,
    totalContacts: stats.total,
    calledContacts: stats.totalCalled,
    successCalls: stats.success,
    leaderboard,
    recentCalls,
    targetCalls: Number.parseInt(getSetting("target_calls", "5000"), 10) || 5000,
    campaignName: getSetting("campaign_name", "מטה טלפנים דיגיטלי"),
    projects: serialized,
  };
}

function serializeProject(project: Project) {
  const callerIds = memory.callerProjects.filter((link) => link.projectId === project.id).map((link) => link.callerId);
  return { ...project, archived: isProjectArchived(project.id), stats: projectStats(project.id), callers: memory.callers.filter((caller) => callerIds.includes(caller.id)) };
}

async function serializeProjectAsync(project: any) {
  if (!prisma) return serializeProject(project as Project);
  const callerProjectLinks = await prisma.callerProject.findMany({ where: { projectId: project.id } });
  const callerIds = callerProjectLinks.map((l) => l.callerId);
  const callers = callerIds.length ? await prisma.caller.findMany({ where: { id: { in: callerIds } } }) : [];
  const stats = await projectStatsFromDb(project.id);
  return { ...project, archived: isProjectArchived(project.id), stats, callers };
}

function getCallerProjects(callerId: number) {
  const projectIds = memory.callerProjects.filter((link) => link.callerId === callerId).map((link) => link.projectId);
  return activeProjects().filter((project) => projectIds.includes(project.id)).map(serializeProject);
}

function nextId(items: { id: number }[]) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

async function initIdsFromDb() {
  if (!prisma) return;
  const [maxProject, maxCaller, maxContact, maxCallLog, maxAdmin, maxSubscription] = await Promise.all([
    prisma.project.aggregate({ _max: { id: true } }),
    prisma.caller.aggregate({ _max: { id: true } }),
    prisma.contact.aggregate({ _max: { id: true } }),
    prisma.callLog.aggregate({ _max: { id: true } }),
    prisma.admin.aggregate({ _max: { id: true } }),
    prisma.subscription.aggregate({ _max: { id: true } }),
  ]);
  memory.ids = {
    project: (maxProject._max.id || 0) + 1,
    caller: (maxCaller._max.id || 0) + 1,
    contact: (maxContact._max.id || 0) + 1,
    callLog: (maxCallLog._max.id || 0) + 1,
    admin: (maxAdmin._max.id || 0) + 1,
    subscription: (maxSubscription._max.id || 0) + 1,
  };
}

async function loadPrismaStore() {
  if (!prisma) return;
  const [projects, callers, contacts, callerProjects, callLogs, settings, admins, subscriptions] = await Promise.all([
    prisma.project.findMany({ orderBy: { id: "asc" } }),
    prisma.caller.findMany({ orderBy: { id: "asc" } }),
    prisma.contact.findMany({ orderBy: { id: "asc" } }),
    prisma.callerProject.findMany({ orderBy: { id: "asc" } }),
    prisma.callLog.findMany({ orderBy: { id: "asc" } }),
    prisma.setting.findMany(),
    prisma.admin.findMany({ orderBy: { id: "asc" } }),
    prisma.subscription.findMany({ orderBy: { id: "asc" } }),
  ]);
  memory.projects = projects.map((item: any) => ({ ...item, adminId: item.adminId, sourceHeaders: Array.isArray(item.sourceHeaders) ? item.sourceHeaders : [], createdAt: new Date(item.createdAt) }));
  memory.callers = callers.map((item: any) => ({ ...item, adminId: item.adminId, phone: cleanPhone(item.phone), whatsappTemplate: item.whatsappTemplate || null, createdAt: new Date(item.createdAt) }));
  memory.contacts = contacts.map((item: any) => ({ ...item, sourceData: item.sourceData || null, lastCalledAt: item.lastCalledAt ? new Date(item.lastCalledAt) : null }));
  memory.callerProjects = callerProjects.map((item: any) => ({ callerId: item.callerId, projectId: item.projectId }));
  memory.callLogs = callLogs.map((item: any) => ({ ...item, timestamp: new Date(item.timestamp) }));
  memory.settings = settings.map((item: any) => ({ adminId: item.adminId, key: item.key, value: item.value }));
  memory.admins = admins.map((item: any) => ({ ...item, createdAt: new Date(item.createdAt).toISOString(), approvedAt: item.approvedAt ? new Date(item.approvedAt).toISOString() : null }));
  memory.subscriptions = subscriptions.map((item: any) => ({ ...item, createdAt: new Date(item.createdAt).toISOString(), expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString() : null }));
  memory.ids = {
    project: nextId(memory.projects),
    caller: nextId(memory.callers),
    contact: nextId(memory.contacts),
    callLog: nextId(memory.callLogs),
    admin: nextId(memory.admins),
    subscription: nextId(memory.subscriptions),
  };
}

let prismaSaveQueue = Promise.resolve();

function projectDbData(item: Project) {
  return { id: item.id, adminId: item.adminId, name: item.name, sourceFileName: item.sourceFileName || null, sourceHeaders: item.sourceHeaders || [], createdAt: new Date(item.createdAt) };
}

function callerDbData(item: Caller) {
  return { id: item.id, adminId: item.adminId, name: item.name || "", phone: cleanPhone(item.phone), whatsappTemplate: item.whatsappTemplate || null, createdAt: new Date(item.createdAt) };
}

function contactDbData(item: Contact) {
  return { id: item.id, projectId: item.projectId, name: item.name, phone: cleanPhone(item.phone), city: item.city || null, sector: item.sector || null, familySize: item.familySize ?? null, notes: item.notes || null, callNotes: item.callNotes || null, sourceData: item.sourceData || {}, status: item.status || "PENDING", lastCalledAt: item.lastCalledAt ? new Date(item.lastCalledAt) : null, callerId: item.callerId || null };
}

function callLogDbData(item: CallLog) {
  return { id: item.id, projectId: item.projectId, callerId: item.callerId, contactId: item.contactId, status: item.status, timestamp: new Date(item.timestamp) };
}

async function persistSetting(adminId: number, key: string, value: string) {
  if (!prisma) return saveMemoryStore();
  settingsCache.set(`${adminId}_${key}`, value);
  await prisma.setting.upsert({
    where: { adminId_key: { adminId, key } },
    update: { value },
    create: { adminId, key, value }
  });
}

async function persistSettingsOnly() {
  if (!prisma) return saveMemoryStore();
  await Promise.all(memory.settings.map((item) => persistSetting(item.adminId, item.key, item.value)));
}

async function persistCaller(caller: Caller) {
  if (!prisma) return saveMemoryStore();
  const data = callerDbData(caller);
  await prisma.caller.upsert({ where: { id: caller.id }, update: data, create: data });
}

async function persistProject(project: Project) {
  if (!prisma) return saveMemoryStore();
  const data = projectDbData(project);
  await prisma.project.upsert({ where: { id: project.id }, update: data, create: data });
}

async function persistContact(contact: Contact) {
  if (!prisma) return saveMemoryStore();
  const data = contactDbData(contact);
  await prisma.contact.upsert({ where: { id: contact.id }, update: data, create: data });
}

async function persistCallLog(log: CallLog) {
  if (!prisma) return saveMemoryStore();
  const data = callLogDbData(log);
  await prisma.callLog.upsert({ where: { id: log.id }, update: data, create: data });
}

async function persistCallerProject(callerId: number, projectId: number) {
  if (!prisma) return saveMemoryStore();
  await prisma.callerProject.upsert({ where: { callerId_projectId: { callerId, projectId } }, update: {}, create: { callerId, projectId } });
}

async function deleteCallerProject(callerId: number, projectId: number) {
  if (!prisma) return saveMemoryStore();
  await prisma.callerProject.deleteMany({ where: { callerId, projectId } });
}

async function persistAdminRecord(admin: any) {
  if (!prisma) return saveMemoryStore();
  const data = { id: Number(admin.id), fullName: admin.fullName || "", email: admin.email || "", phone: cleanPhone(admin.phone), organization: admin.organization || "", passcode: admin.passcode || generatePasscode(), status: admin.status || "PENDING", createdAt: new Date(admin.createdAt || Date.now()), approvedAt: admin.approvedAt ? new Date(admin.approvedAt) : null };
  await prisma.admin.upsert({ where: { id: data.id }, update: data, create: data });
}

async function persistSubscriptionRecord(subscription: any) {
  if (!prisma) return saveMemoryStore();
  const data = { 
    id: Number(subscription.id), 
    adminId: Number(subscription.adminId), 
    planId: subscription.planId || "monthly", 
    status: subscription.status || "PENDING", 
    provider: subscription.provider || "bank_transfer", 
    amount: Number(subscription.amount) || 0, 
    currency: subscription.currency || "ILS", 
    createdAt: new Date(subscription.createdAt || Date.now()),
    expiresAt: subscription.expiresAt ? new Date(subscription.expiresAt) : null
  };
  await prisma.subscription.upsert({ where: { id: data.id }, update: data, create: data });
}

async function persistProjectUpload(project: Project, previousContactCount: number) {
  if (!prisma) return saveMemoryStore();
  await persistProject(project);
  const projectContacts = memory.contacts.filter((contact) => contact.projectId === project.id).slice(previousContactCount);
  if (projectContacts.length > 0) {
    const dataList = projectContacts.map(contactDbData);
    await prisma.contact.createMany({
      data: dataList,
      skipDuplicates: true
    });
  }
}

async function persistPrismaStore() {
  if (!prisma) return;
  for (const project of memory.projects) await persistProject(project);
  for (const caller of memory.callers) await persistCaller(caller);
  for (const admin of memory.admins) await persistAdminRecord(admin);
  for (const setting of memory.settings) await persistSetting(setting.adminId, setting.key, setting.value);
  for (const contact of memory.contacts) await persistContact(contact);
  for (const link of memory.callerProjects) await persistCallerProject(link.callerId, link.projectId);
  for (const subscription of memory.subscriptions) await persistSubscriptionRecord(subscription);
  for (const log of memory.callLogs) await persistCallLog(log);
}

function savePrismaStore() {
  prismaSaveQueue = prismaSaveQueue.then(() => persistPrismaStore()).catch((error) => console.error("Error saving Prisma data:", error));
  return prismaSaveQueue;
}

async function loadMemoryStore() {
  if (process.env.USE_MEMORY_DB !== "true") return;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    memory.projects = (parsed.projects || []).map((item: any) => ({ ...item, createdAt: new Date(item.createdAt) }));
    memory.callers = (parsed.callers || []).map((item: any) => ({ ...item, phone: cleanPhone(item.phone || item.name || item.id), whatsappTemplate: item.whatsappTemplate || null, createdAt: new Date(item.createdAt) }));
    memory.contacts = (parsed.contacts || []).map((item: any) => ({ ...item, lastCalledAt: item.lastCalledAt ? new Date(item.lastCalledAt) : null }));
    memory.callerProjects = parsed.callerProjects || [];
    memory.callLogs = (parsed.callLogs || []).map((item: any) => ({ ...item, timestamp: new Date(item.timestamp) }));
    memory.settings = parsed.settings || [];
    memory.admins = parsed.admins || [];
    memory.subscriptions = (parsed.subscriptions || []).map((item: any) => ({ ...item, expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString() : null }));
    memory.ids = { ...memory.ids, ...(parsed.ids || {}) };
  } catch (error: any) {
    if (error?.code !== "ENOENT") console.error("Error loading local data:", error);
  }
}

async function saveMemoryStore() {
  if (process.env.USE_MEMORY_DB !== "true") return;
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(memory, null, 2), "utf8");
}

async function initSettings() {
  if (prisma) {
    for (const item of defaultSettings) {
      await prisma.setting.upsert({
        where: { adminId_key: { adminId: 1, key: item.key } },
        update: {},
        create: { adminId: 1, key: item.key, value: item.value }
      });
    }
    const allSettings = await prisma.setting.findMany();
    for (const s of allSettings) {
      settingsCache.set(`${s.adminId}_${s.key}`, s.value);
    }
    settingsCacheLastSync = new Date();
    return;
  }
  for (const item of defaultSettings) {
    if (!memory.settings.some((setting) => setting.adminId === 1 && setting.key === item.key)) {
      memory.settings.push({ adminId: 1, key: item.key, value: item.value });
    }
  }
}

async function broadcastStatsUpdate(adminId: number = 1) { invalidateStatsCache(adminId); io.emit("stats-update", await tvStats(adminId)); }

function ensureCaller(name: string | undefined, phone: string, adminId: number) {
  const trimmed = String(name || "").trim();
  const normalizedPhone = cleanPhone(phone);
  let caller = memory.callers.find((item) => item.adminId === adminId && item.phone === normalizedPhone);
  if (!caller) {
    caller = { id: memory.ids.caller++, adminId, name: trimmed, phone: normalizedPhone, whatsappTemplate: null, createdAt: new Date() };
    memory.callers.push(caller);
  } else if (trimmed && caller.name !== trimmed) {
    caller.name = trimmed;
  }
  return caller;
}

function linkCallerToProject(callerId: number, projectId: number) {
  if (!memory.callerProjects.some((link) => link.callerId === callerId && link.projectId === projectId)) memory.callerProjects.push({ callerId, projectId });
}

function insertContacts(projectId: number, contacts: any[]) {
  let inserted = 0;
  let skipped = 0;
  for (const contact of contacts) {
    const phone = cleanPhone(contact.phone);
    if (!contact.name || phone.length < 9) { skipped++; continue; }
    const existing = memory.contacts.find((item) => item.projectId === projectId && item.phone === phone);
    const data = { name: String(contact.name).trim(), phone, city: contact.city || null, sector: contact.sector || null, familySize: contact.familySize ? Number.parseInt(String(contact.familySize), 10) || null : null, notes: contact.notes || null, sourceData: contact.sourceData || null };
    if (existing) Object.assign(existing, data);
    else memory.contacts.push({ id: memory.ids.contact++, projectId, status: "PENDING", callNotes: null, lastCalledAt: null, callerId: null, ...data });
    inserted++;
  }
  return { inserted, skipped };
}

function normalizeDbContact(row: any): Contact {
  return {
    id: Number(row.id),
    projectId: Number(row.projectId),
    name: row.name,
    phone: cleanPhone(row.phone),
    city: row.city || null,
    sector: row.sector || null,
    familySize: row.familySize ?? null,
    notes: row.notes || null,
    callNotes: row.callNotes || null,
    sourceData: row.sourceData || null,
    status: row.status || "PENDING",
    lastCalledAt: row.lastCalledAt ? new Date(row.lastCalledAt) : null,
    callerId: row.callerId == null ? null : Number(row.callerId),
  };
}

function syncMemoryContact(contact: Contact | null) {
  if (!contact) return null;
  if (prisma) return contact;
  const existing = memory.contacts.find((item) => item.id === contact.id);
  if (existing) Object.assign(existing, contact);
  else memory.contacts.push(contact);
  return contact;
}

async function allocateNextContact(callerId: number, projectId: number) {
  const retryAfter = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const reservedAt = new Date();

  if (prisma) {
    const rows = await prisma.$transaction((tx) => tx.$queryRaw<any[]>`
      WITH next_contact AS (
        SELECT id
        FROM "Contact"
        WHERE "projectId" = ${projectId}
          AND (
            (
              status = 'PENDING'
              AND ("lastCalledAt" IS NULL OR "lastCalledAt" < ${retryAfter})
              AND ("callerId" IS NULL OR "callerId" = ${callerId} OR "lastCalledAt" < ${retryAfter})
            )
            OR (
              status = 'NO_ANSWER'
              AND "lastCalledAt" IS NOT NULL
              AND "lastCalledAt" < ${retryAfter}
              AND ("callerId" IS NULL OR "callerId" = ${callerId} OR "lastCalledAt" < ${retryAfter})
            )
          )
        ORDER BY
          CASE
            WHEN status = 'PENDING' AND "lastCalledAt" IS NULL THEN 0
            WHEN status = 'PENDING' THEN 1
            ELSE 2
          END,
          "lastCalledAt" ASC NULLS FIRST,
          id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "Contact"
      SET "callerId" = ${callerId}, "lastCalledAt" = ${reservedAt}
      WHERE id IN (SELECT id FROM next_contact)
      RETURNING id, "projectId", name, phone, city, sector, "familySize", notes, "callNotes", "sourceData", status, "lastCalledAt", "callerId"
    `);
    return syncMemoryContact(rows[0] ? normalizeDbContact(rows[0]) : null);
  }

  return enqueueContactAllocation(async () => {
    const isAvailable = (item: Contact) => item.callerId == null || item.callerId === callerId || Boolean(item.lastCalledAt && item.lastCalledAt < retryAfter);
    const untouchedContact = memory.contacts
      .filter((item) => item.projectId === projectId && item.status === "PENDING" && item.lastCalledAt == null && isAvailable(item))
      .sort((a, b) => a.id - b.id)[0] || null;
    const stalePendingContact = memory.contacts
      .filter((item) => item.projectId === projectId && item.status === "PENDING" && isAvailable(item) && item.lastCalledAt && item.lastCalledAt < retryAfter)
      .sort((a, b) => Number(a.lastCalledAt) - Number(b.lastCalledAt))[0] || null;
    const retryContact = memory.contacts
      .filter((item) => item.projectId === projectId && item.status === "NO_ANSWER" && isAvailable(item) && item.lastCalledAt && item.lastCalledAt < retryAfter)
      .sort((a, b) => Number(a.lastCalledAt) - Number(b.lastCalledAt))[0] || null;
    const nextContact = untouchedContact || stalePendingContact || retryContact;
    if (nextContact) {
      nextContact.callerId = callerId;
      nextContact.lastCalledAt = reservedAt;
      await persistContact(nextContact);
    }
    return nextContact;
  });
}

function generatePasscode() {
  return "admin-" + Math.random().toString(36).slice(2, 8);
}

function publicAdmin(admin: any) {
  if (!admin) return null;
  const { passcode, ...safe } = admin;
  return safe;
}

function ownerAdminRegistration(admin: any) {
  const subscription = [...memory.subscriptions].reverse().find((item) => item.adminId === admin.id);
  return {
    ...admin,
    subscriptions: memory.subscriptions.filter((item) => item.adminId === admin.id),
    latestSubscription: subscription || null,
  };
}

async function ownerAdminRegistrations() {
  if (prisma) {
    const admins = await prisma.admin.findMany({ orderBy: { createdAt: "desc" }, include: { subscriptions: true }, take: 100 });
    return admins.map((admin: any) => {
      const subscriptions = [...(admin.subscriptions || [])].sort((a, b) => Number(new Date(a.createdAt || 0)) - Number(new Date(b.createdAt || 0)));
      return {
        ...admin,
        createdAt: admin.createdAt ? new Date(admin.createdAt).toISOString() : null,
        approvedAt: admin.approvedAt ? new Date(admin.approvedAt).toISOString() : null,
        subscriptions,
        latestSubscription: subscriptions[subscriptions.length - 1] || null,
      };
    });
  }
  return memory.admins
    .map((admin) => ownerAdminRegistration(admin))
    .sort((a, b) => Number(new Date(b.createdAt || 0)) - Number(new Date(a.createdAt || 0)));
}

function planLabel(planId: string) {
  return 'חודשי - 990 ש"ח (עד 50 טלפנים)';
}

function formatWhatsAppPhone(phone: string) {
  const normalized = cleanPhone(phone);
  if (!normalized) return "";
  return normalized.startsWith("0") ? "972" + normalized.slice(1) : normalized;
}

function buildPaymentRequestMessage(admin: any, subscription: any) {
  return [
    "שלום, נרשמתי למערכת מטה טלפנים דיגיטלי ואני רוצה להסדיר תשלום בהעברה בנקאית.",
    "שם: " + admin.fullName,
    "ארגון: " + admin.organization,
    "טלפון: " + admin.phone,
    "אימייל: " + admin.email,
    "מסלול: " + planLabel(subscription.planId),
    "מספר בקשה: " + admin.id,
    "לאחר ביצוע ההעברה אשמח לקבל קוד גישה בוואטסאפ."
  ].join("\n");
}

function buildPaymentWhatsAppUrl(admin: any, subscription: any) {
  const ownerPhone = formatWhatsAppPhone(process.env.PAYMENT_WHATSAPP_PHONE || "");
  const message = buildPaymentRequestMessage(admin, subscription);
  return "https://wa.me/" + ownerPhone + "?text=" + encodeURIComponent(message);
}

function buildPasscodeWhatsAppUrl(admin: any) {
  const adminPhone = formatWhatsAppPhone(admin.phone || "");
  const message = "שלום " + admin.fullName + ", המנוי שלך אושר. קוד הגישה למערכת הניהול: " + admin.passcode;
  return "https://wa.me/" + adminPhone + "?text=" + encodeURIComponent(message);
}

io.on("connection", (socket) => { console.log("Client connected:", socket.id); socket.on("disconnect", () => console.log("Client disconnected:", socket.id)); });

app.post("/api/login", rateLimiter(20, 60000), async (req, res) => {
  try {
    const { name, phone } = req.body;
    const joinProjectId = Number(req.body.projectId || 0);
    const normalizedPhone = cleanPhone(phone);
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
    if (normalizedPhone.length < 9) return res.status(400).json({ error: "Valid phone is required" });
    
    let adminId = 1;
    if (joinProjectId) {
      const project = prisma
        ? await prisma.project.findUnique({ where: { id: joinProjectId } })
        : memory.projects.find((item) => item.id === joinProjectId);
      if (!project || isProjectArchived(joinProjectId)) return res.status(404).json({ error: "Project not found" });
      adminId = project.adminId;
    } else {
      const existing = prisma
        ? await prisma.caller.findFirst({ where: { phone: normalizedPhone } })
        : memory.callers.find((c) => c.phone === normalizedPhone);
      if (existing) adminId = existing.adminId;
    }

    if (isExpiredAdmin(adminId)) {
      return res.status(402).json({ 
        error: "license_expired", 
        message: "רישיון המערכת פג. לא ניתן להתחבר." 
      });
    }

    const caller = ensureCaller(String(name), normalizedPhone, adminId);
    await persistCaller(caller);
    if (joinProjectId) {
      linkCallerToProject(caller.id, joinProjectId);
      await persistCallerProject(caller.id, joinProjectId);
    }
    broadcastStatsUpdate(adminId);
    res.json({ ...caller, projects: getCallerProjects(caller.id) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/admins/validate", rateLimiter(20, 60000), async (req, res) => {
  try {
    const passcode = String(req.body.passcode || "");
    if (passcode === "halevi2026") return res.json({ success: true, admin: { id: 0, fullName: "מנהל ראשי", planId: "legacy" } });
    const admin = prisma
      ? await prisma.admin.findFirst({ where: { passcode, status: "ACTIVE" } })
      : memory.admins.find((item) => item.passcode === passcode && item.status === "ACTIVE");
    if (!admin) return res.status(401).json({ success: false, error: "Invalid passcode" });
    res.json({ success: true, admin: publicAdmin(admin), isExpired: isExpiredAdmin(admin.id) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/subscriptions/plans", (_req, res) => {
  res.json([
    { id: "monthly", name: "מנוי חודשי (עד 50 טלפנים)", price: 990, currency: "ILS", interval: "month" }
  ]);
});

app.post("/api/admins/register", rateLimiter(5, 60000), async (req, res) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = cleanPhone(req.body.phone);
    const organization = String(req.body.organization || "").trim();
    const planId = String(req.body.planId || "monthly");
    if (!fullName || !email || phone.length < 9 || !organization) return res.status(400).json({ error: "Missing admin registration details" });

    let admin = memory.admins.find((item) => item.email === email || cleanPhone(item.phone) === phone);
    if (!admin) {
      admin = { id: memory.ids.admin++, fullName, email, phone, organization, passcode: generatePasscode(), status: "PENDING", createdAt: new Date().toISOString() };
      memory.admins.push(admin);
    } else {
      Object.assign(admin, { fullName, email, phone, organization, status: admin.status === "ACTIVE" ? "ACTIVE" : "PENDING" });
    }

    const subscription = { id: memory.ids.subscription++, adminId: admin.id, planId: "monthly", status: admin.status === "ACTIVE" ? "ACTIVE" : "PENDING", provider: "bank_transfer", amount: 990, currency: "ILS", createdAt: new Date().toISOString() };
    memory.subscriptions.push(subscription);

    await persistAdminRecord(admin);
    await persistSubscriptionRecord(subscription);

    const registrationRequest = {
      id: admin.id,
      fullName,
      email,
      phone,
      organization,
      planId,
      createdAt: admin.createdAt,
    };

    sendRegistrationNotification(registrationRequest, planId).catch(console.error);

    res.json({
      success: true,
      mode: "owner_private_review",
      requestId: admin.id,
      message: "בקשת ההצטרפות נשלחה לבדיקה. נחזור אליך באופן אישי עם המשך התהליך וקוד גישה לאחר אישור.",
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/admins/registration-requests", authenticateOwner, async (_req, res) => {
  try {
    res.json(await ownerAdminRegistrations());
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/admins/registration-requests.csv", authenticateOwner, async (_req, res) => {
  try {
    const headers = ["מספר בקשה", "שם מלא", "ארגון", "טלפון", "אימייל", "סטטוס", "מסלול", "תאריך הרשמה", "תאריך אישור", "קוד גישה"];
    const rows = (await ownerAdminRegistrations()).map((admin) => {
      const subscription = admin.latestSubscription || [...(admin.subscriptions || [])].reverse()[0];
      return [admin.id, admin.fullName, admin.organization, admin.phone, admin.email, admin.status, planLabel(subscription?.planId || "monthly"), admin.createdAt, admin.approvedAt || "", admin.passcode || ""];
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=admin-registration-requests.csv");
    res.send("\ufeff" + [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n"));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/admins/:adminId/approve", authenticateOwner, async (req, res) => {
  try {
    const admin = memory.admins.find((item) => item.id === Number(req.params.adminId));
    if (!admin) return res.status(404).json({ error: "Admin request not found" });
    
    let expiresAtStr = req.body.expiresAt;
    if (!expiresAtStr) {
      const oneMonth = new Date();
      oneMonth.setMonth(oneMonth.getMonth() + 1);
      expiresAtStr = oneMonth.toISOString();
    } else {
      expiresAtStr = new Date(expiresAtStr).toISOString();
    }
    
    admin.status = "ACTIVE";
    if (!admin.passcode) admin.passcode = generatePasscode();
    admin.approvedAt = admin.approvedAt || new Date().toISOString();
    const subscription = [...memory.subscriptions].reverse().find((item) => item.adminId === admin.id);
    if (subscription) {
      subscription.status = "ACTIVE";
      subscription.provider = "bank_transfer";
      subscription.paidAt = new Date().toISOString();
      subscription.expiresAt = expiresAtStr;
    }
    
    // Initialize default settings, setting campaign_name to organization
    const settingsToInit = [
      { key: "campaign_name", value: admin.organization },
      { key: "whatsapp_template", value: "שלום {name}, תודה על שיחתנו. נשמח לתמיכתך במועמד/ת." },
      { key: "target_calls", value: "5000" },
      { key: "call_status_options", value: JSON.stringify(defaultCallStatusOptions) },
      { key: "archived_project_ids", value: "[]" }
    ];
    
    if (prisma) {
      for (const item of settingsToInit) {
        await prisma.setting.upsert({
          where: { adminId_key: { adminId: admin.id, key: item.key } },
          update: item.key === "campaign_name" ? { value: item.value } : {},
          create: { adminId: admin.id, key: item.key, value: item.value }
        });
        settingsCache.set(`${admin.id}_${item.key}`, item.key === "campaign_name" ? item.value : settingsCache.get(`${admin.id}_${item.key}`) || item.value);
      }
    } else {
      for (const item of settingsToInit) {
        let setting = memory.settings.find(s => s.adminId === admin.id && s.key === item.key);
        if (setting) {
          if (item.key === "campaign_name") setting.value = item.value;
        } else {
          memory.settings.push({ adminId: admin.id, key: item.key, value: item.value });
        }
      }
    }
    
    await persistAdminRecord(admin);
    if (subscription) await persistSubscriptionRecord(subscription);
    res.json({ success: true, admin: publicAdmin(admin), passcode: admin.passcode, whatsappUrl: buildPasscodeWhatsAppUrl(admin) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/admins/:adminId/update-expiry", authenticateOwner, async (req, res) => {
  try {
    const adminId = Number(req.params.adminId);
    const { expiresAt } = req.body;
    if (!expiresAt) {
      return res.status(400).json({ error: "Missing expiresAt date" });
    }
    const expiresAtStr = new Date(expiresAt).toISOString();
    
    // Find admin
    const admin = memory.admins.find((item) => item.id === adminId);
    if (!admin) return res.status(404).json({ error: "Admin request not found" });

    let sub = memory.subscriptions.find((item) => item.adminId === adminId && item.status === "ACTIVE");
    if (sub) {
      sub.expiresAt = expiresAtStr;
    } else {
      sub = {
        id: memory.ids.subscription++,
        adminId,
        planId: "monthly",
        status: "ACTIVE",
        provider: "bank_transfer",
        amount: 990,
        currency: "ILS",
        createdAt: new Date().toISOString(),
        expiresAt: expiresAtStr
      };
      memory.subscriptions.push(sub);
    }

    await persistSubscriptionRecord(sub);
    res.json({ success: true, expiresAt: expiresAtStr });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/callers", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    if (prisma) {
      const callers = await prisma.caller.findMany({ where: { adminId }, take: 200 });
      const result = await Promise.all(callers.map(async (caller) => {
        const links = await prisma!.callerProject.findMany({ where: { callerId: caller.id } });
        const projectIds = links.map((l) => l.projectId);
        const projects = projectIds.length ? await prisma!.project.findMany({ where: { id: { in: projectIds } } }) : [];
        const activeCallerProjects = projects.filter((p) => !archivedProjectIds(adminId).includes(p.id));
        const serialized = await Promise.all(activeCallerProjects.map((p) => serializeProjectAsync(p)));
        return { ...caller, projects: serialized };
      }));
      return res.json(result);
    }
    const callers = memory.callers.filter((caller) => caller.adminId === adminId);
    res.json(callers.map((caller) => ({ ...caller, projects: getCallerProjects(caller.id) })));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});
app.get("/api/callers/:callerId/projects", authenticateCaller, async (req, res) => {
  try {
    const callerId = Number(req.params.callerId);
    if (prisma) {
      const links = await prisma.callerProject.findMany({ where: { callerId } });
      const projectIds = links.map((l) => l.projectId);
      const projects = projectIds.length ? await prisma.project.findMany({ where: { id: { in: projectIds } } }) : [];
      const activeCallerProjects = projects.filter((p) => !isProjectArchived(p.id));
      const serialized = await Promise.all(activeCallerProjects.map((p) => serializeProjectAsync(p)));
      return res.json(serialized);
    }
    res.json(getCallerProjects(callerId));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/callers/:callerId/settings", authenticateCaller, async (req, res) => {
  try {
    const callerId = Number(req.params.callerId);
    const caller = memory.callers.find((item) => item.id === callerId);
    if (!caller) return res.status(404).json({ error: "Caller not found" });
    caller.whatsappTemplate = String(req.body.whatsappTemplate || "").trim() || null;
    await persistCaller(caller);
    res.json({ success: true, caller });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/projects", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    if (prisma) {
      const projects = await prisma.project.findMany({ where: { adminId }, take: 100 });
      const serialized = await Promise.all(projects.map((p) => serializeProjectAsync(p)));
      return res.json(serialized);
    }
    res.json(memory.projects.filter((project) => project.adminId === adminId).map(serializeProject));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/projects/upload", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    const projectName = String(req.body.projectName || "").trim();
    if (!projectName) return res.status(400).json({ error: "Project name is required" });
    const contacts = parseUploadedContacts(req.body);
    const project = { id: memory.ids.project++, adminId, name: projectName, sourceFileName: req.body.fileName || null, sourceHeaders: Array.isArray(contacts[0]?.sourceHeaders) ? contacts[0].sourceHeaders : [], createdAt: new Date() };
    memory.projects.push(project);
    const previousContactCount = memory.contacts.filter((contact) => contact.projectId === project.id).length;
    const result = insertContacts(project.id, contacts);
    await persistProjectUpload(project, previousContactCount);
    if (prisma) {
      memory.contacts = memory.contacts.filter((c) => c.projectId !== project.id);
    }
    broadcastStatsUpdate(adminId);
    res.json({ success: true, project: await serializeProjectAsync(project), ...result });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/projects/:projectId/export.csv", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    const projectId = Number(req.params.projectId);
    const project = prisma
      ? await prisma.project.findFirst({ where: { id: projectId, adminId } })
      : memory.projects.find((item) => item.id === projectId && item.adminId === adminId);
    if (!project) return res.status(404).send("Project not found");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "inline; filename=project-" + projectId + ".csv");
    res.send("\uFEFF" + await projectExportCsv(projectId));
  } catch (error: any) { res.status(500).send(error.message); }
});

app.get("/api/projects/:projectId/export.xlsx", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    const projectId = Number(req.params.projectId);
    const project = prisma
      ? await prisma.project.findFirst({ where: { id: projectId, adminId } })
      : memory.projects.find((item) => item.id === projectId && item.adminId === adminId);
    if (!project) return res.status(404).send("Project not found");
    const workbook = await projectExportXlsx(projectId);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=project-" + projectId + ".xlsx");
    res.send(workbook);
  } catch (error: any) { res.status(500).send(error.message); }
});

app.delete("/api/projects/:projectId", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    const projectId = Number(req.params.projectId);
    const project = prisma
      ? await prisma.project.findFirst({ where: { id: projectId, adminId } })
      : memory.projects.find((item) => item.id === projectId && item.adminId === adminId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    await setProjectArchived(adminId, projectId, true);
    if (!prisma) await persistSettingsOnly();
    broadcastStatsUpdate(adminId);
    res.json({ success: true, archived: true, project: await serializeProjectAsync(project) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/projects/:projectId/restore", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    const projectId = Number(req.params.projectId);
    const project = prisma
      ? await prisma.project.findFirst({ where: { id: projectId, adminId } })
      : memory.projects.find((item) => item.id === projectId && item.adminId === adminId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    await setProjectArchived(adminId, projectId, false);
    if (!prisma) await persistSettingsOnly();
    broadcastStatsUpdate(adminId);
    res.json({ success: true, archived: false, project: await serializeProjectAsync(project) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.delete("/api/projects/:projectId/permanent", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    const projectId = Number(req.params.projectId);
    const project = prisma
      ? await prisma.project.findFirst({ where: { id: projectId, adminId } })
      : memory.projects.find((item) => item.id === projectId && item.adminId === adminId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (prisma) {
      await prisma.project.delete({ where: { id: projectId } });
      const ids = new Set(archivedProjectIds(adminId));
      ids.delete(projectId);
      await persistSetting(adminId, "archived_project_ids", JSON.stringify([...ids]));
    } else {
      memory.projects = memory.projects.filter((p) => p.id !== projectId);
      memory.contacts = memory.contacts.filter((c) => c.projectId !== projectId);
      memory.callerProjects = memory.callerProjects.filter((l) => l.projectId !== projectId);
      memory.callLogs = memory.callLogs.filter((l) => l.projectId !== projectId);

      const ids = new Set(archivedProjectIds(adminId));
      ids.delete(projectId);
      const value = JSON.stringify([...ids]);
      let existing = memory.settings.find((item) => item.adminId === adminId && item.key === "archived_project_ids");
      if (existing) {
        existing.value = value;
      } else {
        memory.settings.push({ adminId, key: "archived_project_ids", value });
      }
      await persistSettingsOnly();
    }

    broadcastStatsUpdate(adminId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/projects/:projectId/callers", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    const projectId = Number(req.params.projectId);
    const project = prisma
      ? await prisma.project.findFirst({ where: { id: projectId, adminId } })
      : memory.projects.find((item) => item.id === projectId && item.adminId === adminId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const phone = cleanPhone(req.body.phone);
    if (phone.length < 9) return res.status(400).json({ error: "Valid caller phone is required" });
    const caller = ensureCaller(undefined, phone, adminId);
    linkCallerToProject(caller.id, projectId);
    await persistCaller(caller);
    await persistCallerProject(caller.id, projectId);
    broadcastStatsUpdate(adminId);
    res.json({ success: true, project: await serializeProjectAsync(project), caller });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.delete("/api/projects/:projectId/callers/:callerId", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    const projectId = Number(req.params.projectId);
    const callerId = Number(req.params.callerId);
    const project = prisma
      ? await prisma.project.findFirst({ where: { id: projectId, adminId } })
      : memory.projects.find((item) => item.id === projectId && item.adminId === adminId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (prisma) {
      await prisma.callerProject.deleteMany({ where: { callerId, projectId } });
    } else {
      memory.callerProjects = memory.callerProjects.filter((link) => !(link.projectId === projectId && link.callerId === callerId));
      await deleteCallerProject(callerId, projectId);
    }
    broadcastStatsUpdate(adminId);
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/contacts/next", authenticateCaller, async (req, res) => {
  try {
    const callerId = Number(req.query.callerId);
    const projectId = Number(req.query.projectId);
    if (!callerId || !projectId) return res.status(400).json({ error: "callerId and projectId are required" });
    if (isProjectArchived(projectId)) return res.status(403).json({ error: "Project is archived" });
    const allowed = prisma
      ? await prisma.callerProject.findFirst({ where: { callerId, projectId } })
      : memory.callerProjects.some((link) => link.callerId === callerId && link.projectId === projectId);
    if (!allowed) return res.status(403).json({ error: "Caller is not assigned to this project" });

    const contact = await allocateNextContact(callerId, projectId);
    res.json(contact);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/contacts/skip", authenticateCaller, async (req, res) => {
  try {
    const caller = (req as any).caller as Caller | undefined;
    const contactId = Number(req.body.contactId);
    if (prisma) {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (contact && caller && contact.callerId !== caller.id) return res.status(403).json({ error: "Contact is not assigned to this caller" });
      if (contact) {
        await prisma.contact.update({ where: { id: contactId }, data: { callerId: null, lastCalledAt: null } });
      }
    } else {
      const contact = memory.contacts.find((item) => item.id === contactId);
      if (contact && caller && contact.callerId !== caller.id) return res.status(403).json({ error: "Contact is not assigned to this caller" });
      if (contact) { contact.callerId = null; contact.lastCalledAt = null; await persistContact(contact); }
    }
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/calls", authenticateCaller, async (req, res) => {
  try {
    const callerId = Number(req.body.callerId);
    const contactId = Number(req.body.contactId);
    const status = String(req.body.status || "");
    const callNotes = String(req.body.callNotes || "").trim().slice(0, 500);
    
    const contact = prisma
      ? await prisma.contact.findUnique({ where: { id: contactId } })
      : memory.contacts.find((item) => item.id === contactId);
    if (!contact) return res.status(404).json({ error: "Contact not found" });

    const project = prisma
      ? await prisma.project.findUnique({ where: { id: contact.projectId } })
      : memory.projects.find((p) => p.id === contact.projectId);
    const adminId = project ? project.adminId : 1;

    const validStatuses = getCallStatusOptions(adminId).filter((item) => item.active).map((item) => item.id);
    if (!callerId || !contactId || !validStatuses.includes(status)) return res.status(400).json({ error: "Invalid call payload" });
    
    const allowed = prisma
      ? await prisma.callerProject.findFirst({ where: { callerId, projectId: contact.projectId } })
      : memory.callerProjects.some((link) => link.callerId === callerId && link.projectId === contact.projectId);
    if (!allowed) return res.status(403).json({ error: "Caller is not assigned to this project" });
    if (contact.callerId !== callerId) return res.status(409).json({ error: "Contact is not assigned to this caller" });
    
    if (prisma) {
      await prisma.contact.update({ where: { id: contactId }, data: { status, callNotes: callNotes || null, lastCalledAt: new Date(), callerId } });
      const logId = memory.ids.callLog++;
      const log = await prisma.callLog.create({ data: { id: logId, projectId: contact.projectId, callerId, contactId, status, timestamp: new Date() } });
      const callerRecord = await prisma.caller.findUnique({ where: { id: callerId } });
      const updatedContact = await prisma.contact.findUnique({ where: { id: contactId } });
      broadcastStatsUpdate(adminId);
      res.json({ ...log, caller: callerRecord, contact: updatedContact });
    } else {
      contact.status = status; contact.callNotes = callNotes || null; contact.lastCalledAt = new Date(); (contact as any).callerId = callerId;
      const log = { id: memory.ids.callLog++, projectId: contact.projectId, callerId, contactId, status, timestamp: new Date() };
      memory.callLogs.push(log);
      await persistContact(contact as any);
      await persistCallLog(log);
      broadcastStatsUpdate(adminId);
      res.json({ ...log, caller: memory.callers.find((caller) => caller.id === callerId), contact });
    }
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

async function resolveAdminId(req: express.Request): Promise<number> {
  if ((req as any).adminId !== undefined) {
    return (req as any).adminId;
  }
  const customHeader = req.headers["x-admin-passcode"];
  const passcode = typeof customHeader === "string" ? customHeader : String(req.query.passcode || "");
  if (passcode === "halevi2026") return 1;
  const admin = prisma
    ? await prisma.admin.findFirst({ where: { passcode, status: "ACTIVE" } })
    : memory.admins.find((item) => item.passcode === passcode && item.status === "ACTIVE");
  if (admin) return admin.id;

  const authHeader = req.headers.authorization;
  const callerId = Number(authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined);
  if (callerId) {
    const caller = prisma
      ? await prisma.caller.findUnique({ where: { id: callerId } })
      : memory.callers.find((c) => c.id === callerId);
    if (caller) return caller.adminId;
  }

  const projectId = Number(req.query.projectId || req.body.projectId || 0);
  if (projectId) {
    const project = prisma
      ? await prisma.project.findUnique({ where: { id: projectId } })
      : memory.projects.find((p) => p.id === projectId);
    if (project) return project.adminId;
  }

  return 1;
}

app.get("/api/stats/admin", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    const cacheKey = `admin_${adminId}`;
    const cached = getCachedStats(cacheKey);
    if (cached) return res.json(cached);

    let callers: any[];
    let projects: any[];

    if (prisma) {
      const dbCallers = await prisma.caller.findMany({ where: { adminId } });
      callers = await Promise.all(dbCallers.map(async (caller) => {
        const [totalCalls, successCalls, lastLog] = await Promise.all([
          prisma!.callLog.count({ where: { callerId: caller.id } }),
          prisma!.callLog.count({ where: { callerId: caller.id, status: "SUCCESS" } }),
          prisma!.callLog.findFirst({ where: { callerId: caller.id }, orderBy: { timestamp: "desc" } }),
        ]);
        const callerProjects = await prisma!.callerProject.findMany({ where: { callerId: caller.id } });
        const projectIds = callerProjects.map((l) => l.projectId);
        const callerProjectRecords = projectIds.length ? await prisma!.project.findMany({ where: { id: { in: projectIds } } }) : [];
        const activeCallerProjects = callerProjectRecords.filter((p) => !archivedProjectIds(adminId).includes(p.id));
        return {
          id: caller.id, name: caller.name, phone: caller.phone,
          totalCalls, successCalls,
          successRate: totalCalls ? Math.round((successCalls / totalCalls) * 100) : 0,
          lastCallTime: lastLog?.timestamp || null,
          projects: await Promise.all(activeCallerProjects.map((p) => serializeProjectAsync(p))),
        };
      }));
      const dbProjects = await prisma.project.findMany({ where: { adminId } });
      projects = await Promise.all(dbProjects.map((p) => serializeProjectAsync(p)));
    } else {
      callers = memory.callers
        .filter((caller) => caller.adminId === adminId)
        .map((caller) => {
          const logs = memory.callLogs.filter((log) => log.callerId === caller.id);
          const successLogs = logs.filter((log) => log.status === "SUCCESS");
          const lastLog = [...logs].sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0];
          return { id: caller.id, name: caller.name, phone: caller.phone, totalCalls: logs.length, successCalls: successLogs.length, successRate: logs.length ? Math.round((successLogs.length / logs.length) * 100) : 0, lastCallTime: lastLog?.timestamp || null, projects: getCallerProjects(caller.id) };
        });
      projects = memory.projects.filter((p) => p.adminId === adminId).map(serializeProject);
    }

    const summary = await allStatsFromDb(adminId);
    const result = { summary, callers, projects, isExpired: isExpiredAdmin(adminId) };
    setCachedStats(cacheKey, result);
    res.json(result);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/stats/tv", async (req, res) => {
  try {
    const adminId = await resolveAdminId(req);
    const cacheKey = `tv_${adminId}`;
    const cached = getCachedStats(cacheKey);
    if (cached) return res.json(cached);
    const result = await tvStats(adminId);
    setCachedStats(cacheKey, result);
    res.json(result);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/settings", async (req, res) => {
  const adminId = await resolveAdminId(req);
  if (prisma) {
    const result: Record<string, string> = {};
    for (const item of defaultSettings) {
      result[item.key] = item.key === "call_status_options" ? JSON.stringify(getCallStatusOptions(adminId)) : item.value;
    }
    for (const [cacheKey, cacheValue] of settingsCache) {
      if (cacheKey.startsWith(`${adminId}_`)) {
        const key = cacheKey.substring(`${adminId}_`.length);
        result[key] = key === "call_status_options" ? JSON.stringify(getCallStatusOptions(adminId)) : cacheValue;
      }
    }
    return res.json(result);
  }
  const adminSettings = memory.settings.filter((item) => item.adminId === adminId);
  const result: Record<string, string> = {
    ...Object.fromEntries(adminSettings.map((item) => [item.key, item.value])),
    call_status_options: JSON.stringify(getCallStatusOptions(adminId)),
  };
  for (const item of defaultSettings) {
    if (result[item.key] === undefined) {
      result[item.key] = item.key === "call_status_options" ? JSON.stringify(getCallStatusOptions(adminId)) : item.value;
    }
  }
  res.json(result);
});

app.post("/api/settings", authenticateAdmin, async (req, res) => {
  const adminId = (req as any).adminId;
  const settings = req.body.settings;
  if (!settings || typeof settings !== "object") return res.status(400).json({ error: "Invalid settings payload" });
  if (prisma) {
    for (const [key, value] of Object.entries(settings)) {
      await persistSetting(adminId, key, String(value));
    }
  } else {
    for (const [key, value] of Object.entries(settings)) {
      let existing = memory.settings.find((item) => item.adminId === adminId && item.key === key);
      if (existing) existing.value = String(value); else memory.settings.push({ adminId, key, value: String(value) });
    }
    await persistSettingsOnly();
  }
  broadcastStatsUpdate(adminId);
  res.json({ success: true });
});

app.post("/api/contacts/upload", authenticateAdmin, async (req, res) => {
  try {
    const adminId = (req as any).adminId;
    let project = memory.projects.find((p) => p.adminId === adminId);
    let isNewProject = false;
    if (!project) {
      project = { id: memory.ids.project++, adminId, name: "פרויקט ראשי", sourceFileName: null, createdAt: new Date() };
      memory.projects.push(project);
      isNewProject = true;
    }
    const previousContactCount = memory.contacts.filter((contact) => contact.projectId === project.id).length;
    const result = insertContacts(project.id, req.body.contacts || []);
    if (isNewProject) await persistProject(project);
    await persistProjectUpload(project, previousContactCount);
    broadcastStatsUpdate(adminId);
    res.json({ success: true, ...result, project: serializeProject(project) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/contacts/seed", authenticateAdmin, async (req, res) => {
  const adminId = (req as any).adminId;
  let project = memory.projects.find((item) => item.name === "פרויקט דוגמה" && item.adminId === adminId);
  if (!project) { project = { id: memory.ids.project++, adminId, name: "פרויקט דוגמה", sourceFileName: "seed", createdAt: new Date() }; memory.projects.push(project); }
  const contacts = [
    { name: "משה כהן", phone: "0501234567", city: "ירושלים", sector: "דתי לאומי", familySize: 5, notes: "תומך ותיק של המועמד/ת" },
    { name: "שרה לוי", phone: "0529876543", city: "תל אביב", sector: "כללי", familySize: 3, notes: "מתלבטת בין כמה מועמדים" },
    { name: "דוד מזרחי", phone: "0541112222", city: "פתח תקווה", sector: "מסורתי", familySize: 6, notes: "צריך לדבר איתו על הנושא החינוכי" },
    { name: "רחל גולדברג", phone: "0534445555", city: "חיפה", sector: "אקדמאים", familySize: 2, notes: "לא בטוחה בתמיכה כרגע" },
  ];
  const previousContactCount = memory.contacts.filter((contact) => contact.projectId === project.id).length;
  const result = insertContacts(project.id, contacts);
  const firstCaller = memory.callers.find((c) => c.adminId === adminId);
  if (firstCaller) linkCallerToProject(firstCaller.id, project.id);
  await persistProject(project);
  await persistProjectUpload(project, previousContactCount);
  if (firstCaller) await persistCallerProject(firstCaller.id, project.id);
  broadcastStatsUpdate(adminId);
  res.json({ success: true, seededCount: result.inserted, project: serializeProject(project) });
});

app.post("/api/contacts/reset", authenticateOwner, async (_req, res) => {
  res.status(403).json({ error: "Reset is disabled to protect caller work and uploaded Excel data" });
});

app.post("/api/callers/reset", authenticateOwner, async (_req, res) => {
  res.status(403).json({ error: "Reset is disabled to protect caller work and uploaded Excel data" });
});

export async function cleanupExpiredData() {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const expiredAdminIds: number[] = [];

    if (prisma) {
      const subscriptions = await prisma.subscription.findMany({
        where: {
          status: "ACTIVE",
          expiresAt: {
            lt: oneYearAgo
          }
        }
      });
      for (const sub of subscriptions) {
        expiredAdminIds.push(sub.adminId);
      }
    } else {
      for (const sub of memory.subscriptions) {
        if (sub.status === "ACTIVE" && sub.expiresAt) {
          const expiryDate = new Date(sub.expiresAt);
          if (expiryDate < oneYearAgo) {
            expiredAdminIds.push(sub.adminId);
          }
        }
      }
    }

    if (expiredAdminIds.length === 0) return;
    console.log(`[Cleanup] Found ${expiredAdminIds.length} admins expired for more than 1 year. Cleaning up data...`);

    for (const adminId of expiredAdminIds) {
      if (prisma) {
        const projectIds = (await prisma.project.findMany({
          where: { adminId },
          select: { id: true }
        })).map((p) => p.id);

        if (projectIds.length > 0) {
          await prisma.callLog.deleteMany({
            where: {
              projectId: { in: projectIds }
            }
          });
          await prisma.callerProject.deleteMany({
            where: {
              projectId: { in: projectIds }
            }
          });
          await prisma.contact.deleteMany({
            where: {
              projectId: { in: projectIds }
            }
          });
          await prisma.project.deleteMany({
            where: { adminId }
          });
        }
        await prisma.caller.deleteMany({
          where: { adminId }
        });
        await prisma.subscription.deleteMany({
          where: { adminId }
        });
        await prisma.admin.delete({
          where: { id: adminId }
        });
      }

      // Cleanup memory lists
      const adminProjects = memory.projects.filter((p) => p.adminId === adminId);
      const adminProjIds = adminProjects.map((p) => p.id);

      memory.callLogs = memory.callLogs.filter((c) => !adminProjIds.includes(c.projectId));
      memory.callerProjects = memory.callerProjects.filter((l) => !adminProjIds.includes(l.projectId));
      memory.contacts = memory.contacts.filter((c) => !adminProjIds.includes(c.projectId));
      memory.callers = memory.callers.filter((c) => c.adminId !== adminId);
      memory.projects = memory.projects.filter((p) => p.adminId !== adminId);
      memory.subscriptions = memory.subscriptions.filter((s) => s.adminId !== adminId);
      memory.admins = memory.admins.filter((a) => a.id !== adminId);
    }
    
    if (process.env.USE_MEMORY_DB === "true") {
      await saveMemoryStore();
    }
  } catch (error) {
    console.error("[Cleanup] Error during daily expired data cleanup:", error);
  }
}

const PORT = process.env.PORT || 5001;

export async function startServer(port: string | number = PORT) {
  return new Promise<http.Server>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, async () => {
      try {
        if (process.env.RENDER && process.env.USE_MEMORY_DB === "true") {
          throw new Error("Production on Render must use PostgreSQL. Refusing to start with in-memory storage to protect caller work.");
        }
        if (process.env.USE_MEMORY_DB === "true") {
          await loadMemoryStore();
        } else {
          await initIdsFromDb();
        }
        await initSettings();
        startSettingsCacheSync();
        
        // Run daily cleanup for expired subscriptions
        cleanupExpiredData();
        setInterval(cleanupExpiredData, 24 * 60 * 60 * 1000);

        if (process.env.USE_MEMORY_DB === "true") await saveMemoryStore();
        server.off("error", onError);
        console.log("Server running on port " + port);
        console.log(process.env.USE_MEMORY_DB === "true" ? "Using local memory database" : "Using Prisma database");
        resolve(server);
      } catch (error) {
        server.off("error", onError);
        reject(error);
      }
    });
  });
}

export { app, server };

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
