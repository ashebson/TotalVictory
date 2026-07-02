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

const app = express();
const server = http.createServer(app);
const prisma = process.env.USE_MEMORY_DB === "true" ? null : new PrismaClient();

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "DELETE"] },
});

app.use(cors());

app.use(express.json({ limit: "50mb" }));

type Project = { id: number; name: string; sourceFileName?: string | null; sourceHeaders?: string[]; createdAt: Date };
type Caller = { id: number; name: string; phone: string; whatsappTemplate?: string | null; createdAt: Date };
type Contact = { id: number; projectId: number; name: string; phone: string; city?: string | null; sector?: string | null; familySize?: number | null; notes?: string | null; status: string; callNotes?: string | null; sourceData?: Record<string, string>; lastCalledAt?: Date | null; callerId?: number | null };
type CallLog = { id: number; projectId: number; callerId: number; contactId: number; status: string; timestamp: Date };
type Store = { projects: Project[]; callers: Caller[]; contacts: Contact[]; callerProjects: { callerId: number; projectId: number }[]; callLogs: CallLog[]; settings: { key: string; value: string }[]; admins: any[]; subscriptions: any[]; ids: { project: number; caller: number; contact: number; callLog: number; admin: number; subscription: number } };

const memory: Store = { projects: [], callers: [], contacts: [], callerProjects: [], callLogs: [], settings: [], admins: [], subscriptions: [], ids: { project: 1, caller: 1, contact: 1, callLog: 1, admin: 1, subscription: 1 } };

const defaultSettings = [
  { key: "whatsapp_template", value: "שלום {name}, שמחתי לשוחח איתך! נשמח לתמיכתך בחבר הכנסת עמית הלוי בפריימריז הקרובים בליכוד. ביחד ננצח! למידע נוסף: https://amithalevi.org.il" },
  { key: "polymarket_url", value: "https://embed.polymarket.com/market?market=will-likud-win-fewer-than-20-seats-in-the-2026-israeli-legislative-election&theme=dark&border=true&height=300" },
  { key: "win_percentage", value: "74.8" },
  { key: "target_calls", value: "5000" },
];

function cleanPhone(phone: unknown) { return String(phone || "").replace(/\D/g, ""); }
function normalizeHeader(value: string) { return value.trim().replace(/^"|"$/g, "").toLowerCase(); }

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

  const messageText = `הרשמת מנהל חדש במערכת Total Victory:
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
  const notifyEmail = process.env.NOTIFY_EMAIL;

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
        subject: `Total Victory - הרשמת מנהל חדש: ${admin.fullName}`,
        text: messageText,
        html: `<div dir="rtl" style="font-family: sans-serif;">
          <h2>הרשמת מנהל חדש במערכת Total Victory</h2>
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

function authenticateAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const customHeader = req.headers["x-admin-passcode"];
  const queryPasscode = req.query.passcode;
  
  const passcode = (authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : authHeader) 
    || (typeof customHeader === "string" ? customHeader : undefined)
    || (typeof queryPasscode === "string" ? queryPasscode : undefined);

  if (!passcode) {
    // Legacy fallback: allow request if passcode is missing (since old frontend doesn't send passcode headers)
    return next();
  }
  
  if (passcode === "halevi2026") {
    return next();
  }
  
  const admin = memory.admins.find((item) => item.passcode === passcode && item.status === "ACTIVE");
  if (!admin) {
    return res.status(401).json({ error: "Invalid or inactive admin passcode" });
  }
  
  next();
}

function authenticateCaller(req: express.Request, res: express.Response, next: express.NextFunction) {
  const phoneHeader = req.headers["x-caller-phone"];
  const callerIdQuery = req.query.callerId || req.body.callerId;
  
  if (!phoneHeader) {
    // Legacy fallback: allow request if phone header is missing, but check caller parameters if provided
    if (callerIdQuery) {
      const caller = memory.callers.find((item) => item.id === Number(callerIdQuery));
      if (!caller) {
        return res.status(401).json({ error: "Caller not found" });
      }
    } else {
      const callerIdParam = req.params.callerId;
      if (callerIdParam) {
        const caller = memory.callers.find((item) => item.id === Number(callerIdParam));
        if (!caller) {
          return res.status(401).json({ error: "Caller not found" });
        }
      }
    }
    return next();
  }
  
  const normalizedPhone = cleanPhone(phoneHeader);
  const caller = memory.callers.find((item) => item.phone === normalizedPhone);
  if (!caller) {
    return res.status(401).json({ error: "Caller phone not registered" });
  }
  
  if (callerIdQuery && Number(callerIdQuery) !== caller.id) {
    return res.status(403).json({ error: "Caller ID mismatch" });
  }
  
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

function exportStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: "ממתין לשיחה",
    SUCCESS: "תומך",
    NOT_INTERESTED: "לא מעוניין",
    NO_ANSWER: "לא ענה",
    INVALID_NUMBER: "מספר שגוי",
  };
  return labels[status] || status;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function projectExportRows(projectId: number) {
  const project = memory.projects.find((item) => item.id === projectId);
  const projectContacts = memory.contacts.filter((contact) => contact.projectId === projectId).sort((a, b) => a.id - b.id);
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
      exportStatusLabel(contact.status),
      contact.callNotes || "",
      contact.lastCalledAt ? contact.lastCalledAt.toLocaleDateString("he-IL") : "",
    ];
  });
  return { headers, rows };
}

function projectExportCsv(projectId: number) {
  const { headers, rows } = projectExportRows(projectId);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function projectExportXlsx(projectId: number) {
  const { headers, rows } = projectExportRows(projectId);
  const workbook = XLSX.utils.book_new();
  const table = [headers, ...rows].map((row) => row.map((value) => String(value ?? "")));
  const worksheet = XLSX.utils.aoa_to_sheet(table);
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(45, Math.max(12, String(header || "").length + 4)) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, "נתונים");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function parseUploadedContacts(payload: any) {
  if (Array.isArray(payload.contacts)) return payload.contacts;
  if (payload.fileContentBase64 && String(payload.fileName || "").toLowerCase().endsWith(".xlsx")) return parseXlsx(payload.fileContentBase64);
  if (payload.fileText) return parseCsv(String(payload.fileText));
  throw new Error("לא התקבל קובץ נתונים תקין");
}

function projectStats(projectId: number) {
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

function allStats() {
  return {
    total: memory.contacts.length,
    pending: memory.contacts.filter((contact) => contact.status === "PENDING").length,
    success: memory.contacts.filter((contact) => contact.status === "SUCCESS").length,
    notInterested: memory.contacts.filter((contact) => contact.status === "NOT_INTERESTED").length,
    noAnswer: memory.contacts.filter((contact) => contact.status === "NO_ANSWER").length,
    invalidNumber: memory.contacts.filter((contact) => contact.status === "INVALID_NUMBER").length,
    totalCalled: memory.contacts.filter((contact) => contact.status !== "PENDING").length,
  };
}

function tvStats() {
  const stats = allStats();
  const settingValue = (key: string, fallback: string) => memory.settings.find((item) => item.key === key)?.value || fallback;
  const leaderboard = memory.callers.map((caller) => {
    const logs = memory.callLogs.filter((log) => log.callerId === caller.id);
    const successLogs = logs.filter((log) => log.status === "SUCCESS");
    return {
      id: caller.id,
      name: caller.name,
      totalCalls: logs.length,
      successCalls: successLogs.length,
      successRate: logs.length ? Math.round((successLogs.length / logs.length) * 100) : 0,
    };
  }).filter((caller) => caller.totalCalls > 0).sort((a, b) => b.successCalls - a.successCalls || b.totalCalls - a.totalCalls).slice(0, 10);
  const recentCalls = [...memory.callLogs].sort((a, b) => Number(b.timestamp) - Number(a.timestamp)).slice(0, 10).map((log) => {
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
  return {
    ...stats,
    totalContacts: stats.total,
    calledContacts: stats.totalCalled,
    successCalls: stats.success,
    leaderboard,
    recentCalls,
    winPercentage: Number.parseFloat(settingValue("win_percentage", "74.8")),
    targetCalls: Number.parseInt(settingValue("target_calls", "5000"), 10) || 5000,
    polymarketUrl: settingValue("polymarket_url", defaultSettings.find((item) => item.key === "polymarket_url")!.value),
    projects: memory.projects.map(serializeProject),
  };
}

function serializeProject(project: Project) {
  const callerIds = memory.callerProjects.filter((link) => link.projectId === project.id).map((link) => link.callerId);
  return { ...project, stats: projectStats(project.id), callers: memory.callers.filter((caller) => callerIds.includes(caller.id)) };
}

function getCallerProjects(callerId: number) {
  const projectIds = memory.callerProjects.filter((link) => link.callerId === callerId).map((link) => link.projectId);
  return memory.projects.filter((project) => projectIds.includes(project.id)).map(serializeProject);
}

function nextId(items: { id: number }[]) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
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
  memory.projects = projects.map((item: any) => ({ ...item, sourceHeaders: Array.isArray(item.sourceHeaders) ? item.sourceHeaders : [], createdAt: new Date(item.createdAt) }));
  memory.callers = callers.map((item: any) => ({ ...item, phone: cleanPhone(item.phone), whatsappTemplate: item.whatsappTemplate || null, createdAt: new Date(item.createdAt) }));
  memory.contacts = contacts.map((item: any) => ({ ...item, sourceData: item.sourceData || null, lastCalledAt: item.lastCalledAt ? new Date(item.lastCalledAt) : null }));
  memory.callerProjects = callerProjects.map((item: any) => ({ callerId: item.callerId, projectId: item.projectId }));
  memory.callLogs = callLogs.map((item: any) => ({ ...item, timestamp: new Date(item.timestamp) }));
  memory.settings = settings.map((item: any) => ({ key: item.key, value: item.value }));
  memory.admins = admins.map((item: any) => ({ ...item, createdAt: new Date(item.createdAt).toISOString() }));
  memory.subscriptions = subscriptions.map((item: any) => ({ ...item, createdAt: new Date(item.createdAt).toISOString() }));
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

async function persistPrismaStore() {
  if (!prisma) return;
  const projects = memory.projects.map((item) => ({ id: item.id, name: item.name, sourceFileName: item.sourceFileName || null, sourceHeaders: item.sourceHeaders || [], createdAt: new Date(item.createdAt) }));
  const callers = memory.callers.map((item) => ({ id: item.id, name: item.name || "", phone: cleanPhone(item.phone), whatsappTemplate: item.whatsappTemplate || null, createdAt: new Date(item.createdAt) }));
  const admins = memory.admins.map((item) => ({ id: item.id, fullName: item.fullName || "", email: item.email || "", phone: cleanPhone(item.phone), organization: item.organization || "", passcode: item.passcode || generatePasscode(), status: item.status || "ACTIVE", createdAt: new Date(item.createdAt || Date.now()) }));
  const settings = memory.settings.map((item) => ({ key: item.key, value: item.value }));
  const contacts = memory.contacts.map((item) => ({ id: item.id, projectId: item.projectId, name: item.name, phone: cleanPhone(item.phone), city: item.city || null, sector: item.sector || null, familySize: item.familySize ?? null, notes: item.notes || null, callNotes: item.callNotes || null, sourceData: item.sourceData || {}, status: item.status || "PENDING", lastCalledAt: item.lastCalledAt ? new Date(item.lastCalledAt) : null, callerId: item.callerId || null }));
  const callerProjects = memory.callerProjects.map((item) => ({ callerId: item.callerId, projectId: item.projectId }));
  const subscriptions = memory.subscriptions.map((item) => ({ id: item.id, adminId: item.adminId, planId: item.planId || "monthly", status: item.status || "ACTIVE", provider: item.provider || "bank_transfer", amount: Number(item.amount) || 0, currency: item.currency || "ILS", createdAt: new Date(item.createdAt || Date.now()) }));
  const callLogs = memory.callLogs.map((item) => ({ id: item.id, projectId: item.projectId, callerId: item.callerId, contactId: item.contactId, status: item.status, timestamp: new Date(item.timestamp) }));

  await prisma.$transaction(async (tx) => {
    await tx.callLog.deleteMany();
    await tx.callerProject.deleteMany();
    await tx.contact.deleteMany();
    await tx.subscription.deleteMany();
    await tx.admin.deleteMany();
    await tx.caller.deleteMany();
    await tx.project.deleteMany();
    await tx.setting.deleteMany();
    if (projects.length) await tx.project.createMany({ data: projects });
    if (callers.length) await tx.caller.createMany({ data: callers });
    if (admins.length) await tx.admin.createMany({ data: admins });
    if (settings.length) await tx.setting.createMany({ data: settings });
    if (contacts.length) await tx.contact.createMany({ data: contacts });
    if (callerProjects.length) await tx.callerProject.createMany({ data: callerProjects });
    if (subscriptions.length) await tx.subscription.createMany({ data: subscriptions });
    if (callLogs.length) await tx.callLog.createMany({ data: callLogs });
  }, { timeout: 30000 });
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
    memory.subscriptions = parsed.subscriptions || [];
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
    for (const item of defaultSettings) await prisma.setting.upsert({ where: { key: item.key }, update: {}, create: item });
    return;
  }
  for (const item of defaultSettings) if (!memory.settings.some((setting) => setting.key === item.key)) memory.settings.push({ ...item });
}

async function broadcastStatsUpdate() { io.emit("stats-update", tvStats()); }

function ensureCaller(name: string | undefined, phone: string) {
  const trimmed = String(name || "").trim();
  const normalizedPhone = cleanPhone(phone);
  let caller = memory.callers.find((item) => item.phone === normalizedPhone);
  if (!caller) {
    caller = { id: memory.ids.caller++, name: trimmed, phone: normalizedPhone, whatsappTemplate: null, createdAt: new Date() };
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

function generatePasscode() {
  return "admin-" + Math.random().toString(36).slice(2, 8);
}

function publicAdmin(admin: any) {
  if (!admin) return null;
  const { passcode, ...safe } = admin;
  return safe;
}

function planLabel(planId: string) {
  return planId === "annual" ? 'שנתי - 1,990 ש"ח' : 'חודשי - 199 ש"ח';
}

function formatWhatsAppPhone(phone: string) {
  const normalized = cleanPhone(phone);
  if (!normalized) return "";
  return normalized.startsWith("0") ? "972" + normalized.slice(1) : normalized;
}

function buildPaymentRequestMessage(admin: any, subscription: any) {
  return [
    "שלום, נרשמתי למערכת מטה דיגיטלי ואני רוצה להסדיר תשלום בהעברה בנקאית.",
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

app.post("/api/login", async (req, res) => {
  try {
    const { name, phone } = req.body;
    const normalizedPhone = cleanPhone(phone);
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
    if (normalizedPhone.length < 9) return res.status(400).json({ error: "Valid phone is required" });
    const caller = ensureCaller(String(name), normalizedPhone);
    res.json({ ...caller, projects: getCallerProjects(caller.id) });
    await saveStore();
    broadcastStatsUpdate();
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/admins/validate", (req, res) => {
  const passcode = String(req.body.passcode || "");
  if (passcode === "halevi2026") return res.json({ success: true, admin: { id: 0, fullName: "מנהל ראשי", planId: "legacy" } });
  const admin = memory.admins.find((item) => item.passcode === passcode && item.status === "ACTIVE");
  if (!admin) return res.status(401).json({ success: false, error: "Invalid passcode" });
  res.json({ success: true, admin: publicAdmin(admin) });
});

app.get("/api/subscriptions/plans", (_req, res) => {
  res.json([
    { id: "monthly", name: "מנוי מנהל חודשי", price: 199, currency: "ILS", interval: "month" },
    { id: "annual", name: "מנוי מנהל שנתי", price: 1990, currency: "ILS", interval: "year" }
  ]);
});

app.post("/api/admins/register", async (req, res) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = cleanPhone(req.body.phone);
    const organization = String(req.body.organization || "").trim();
    const planId = String(req.body.planId || "monthly");
    if (!fullName || !email || phone.length < 9 || !organization) return res.status(400).json({ error: "Missing admin registration details" });
    let admin = memory.admins.find((item) => item.email === email || item.phone === phone);
    if (!admin) {
      admin = { id: memory.ids.admin++, fullName, email, phone, organization, passcode: generatePasscode(), status: "PENDING_PAYMENT", createdAt: new Date().toISOString() };
      memory.admins.push(admin);
    } else {
      Object.assign(admin, { fullName, email, phone, organization, status: admin.status === "ACTIVE" ? "ACTIVE" : "PENDING_PAYMENT" });
      if (!admin.passcode) admin.passcode = generatePasscode();
    }
    const subscription = { id: memory.ids.subscription++, adminId: admin.id, planId, status: admin.status === "ACTIVE" ? "ACTIVE" : "PENDING_PAYMENT", provider: "bank_transfer", amount: planId === "annual" ? 1990 : 199, currency: "ILS", createdAt: new Date().toISOString() };
    memory.subscriptions.push(subscription);
    await saveStore();
    res.json({ success: true, mode: "manual_payment", admin: publicAdmin(admin), subscription, whatsappUrl: buildPaymentWhatsAppUrl(admin, subscription), message: "בקשת ההרשמה נקלטה. שלח וואטסאפ להסדרת העברה בנקאית וקבלת קוד גישה." });
    
    // Trigger notification
    sendRegistrationNotification(admin, planId).catch(console.error);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/admins/:adminId/approve", authenticateAdmin, async (req, res) => {
  try {
    const admin = memory.admins.find((item) => item.id === Number(req.params.adminId));
    if (!admin) return res.status(404).json({ error: "Admin request not found" });
    admin.status = "ACTIVE";
    if (!admin.passcode) admin.passcode = generatePasscode();
    const subscription = [...memory.subscriptions].reverse().find((item) => item.adminId === admin.id);
    if (subscription) {
      subscription.status = "ACTIVE";
      subscription.provider = "bank_transfer";
      subscription.paidAt = new Date().toISOString();
    }
    await saveStore();
    res.json({ success: true, admin: publicAdmin(admin), passcode: admin.passcode, whatsappUrl: buildPasscodeWhatsAppUrl(admin) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/callers", authenticateAdmin, (_req, res) => res.json(memory.callers.map((caller) => ({ ...caller, projects: getCallerProjects(caller.id) }))));
app.get("/api/callers/:callerId/projects", authenticateCaller, (req, res) => res.json(getCallerProjects(Number(req.params.callerId))));

app.post("/api/callers/:callerId/settings", authenticateCaller, async (req, res) => {
  try {
    const callerId = Number(req.params.callerId);
    const caller = memory.callers.find((item) => item.id === callerId);
    if (!caller) return res.status(404).json({ error: "Caller not found" });
    caller.whatsappTemplate = String(req.body.whatsappTemplate || "").trim() || null;
    await saveStore();
    res.json({ success: true, caller });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/projects", authenticateAdmin, (_req, res) => res.json(memory.projects.map(serializeProject)));

app.post("/api/projects/upload", authenticateAdmin, async (req, res) => {
  try {
    const projectName = String(req.body.projectName || "").trim();
    if (!projectName) return res.status(400).json({ error: "Project name is required" });
    const contacts = parseUploadedContacts(req.body);
    const project = { id: memory.ids.project++, name: projectName, sourceFileName: req.body.fileName || null, sourceHeaders: Array.isArray(contacts[0]?.sourceHeaders) ? contacts[0].sourceHeaders : [], createdAt: new Date() };
    memory.projects.push(project);
    const result = insertContacts(project.id, contacts);
    res.json({ success: true, project: serializeProject(project), ...result });
    await saveStore();
    broadcastStatsUpdate();
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/projects/:projectId/export.csv", authenticateAdmin, (req, res) => {
  const projectId = Number(req.params.projectId);
  const project = memory.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).send("Project not found");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "inline; filename=project-" + projectId + ".csv");
  res.send("\uFEFF" + projectExportCsv(projectId));
});

app.get("/api/projects/:projectId/export.xlsx", authenticateAdmin, (req, res) => {
  const projectId = Number(req.params.projectId);
  const project = memory.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).send("Project not found");
  const workbook = projectExportXlsx(projectId);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=project-" + projectId + ".xlsx");
  res.send(workbook);
});

app.delete("/api/projects/:projectId", authenticateAdmin, async (req, res) => {
  const projectId = Number(req.params.projectId);
  memory.projects = memory.projects.filter((item) => item.id !== projectId);
  memory.contacts = memory.contacts.filter((item) => item.projectId !== projectId);
  memory.callLogs = memory.callLogs.filter((item) => item.projectId !== projectId);
  memory.callerProjects = memory.callerProjects.filter((item) => item.projectId !== projectId);
  res.json({ success: true });
  await saveStore();
  broadcastStatsUpdate();
});

app.post("/api/projects/:projectId/callers", authenticateAdmin, async (req, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const project = memory.projects.find((item) => item.id === projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const phone = cleanPhone(req.body.phone);
    if (phone.length < 9) return res.status(400).json({ error: "Valid caller phone is required" });
    const caller = ensureCaller(undefined, phone);
    linkCallerToProject(caller.id, projectId);
    res.json({ success: true, project: serializeProject(project), caller });
    await saveStore();
    broadcastStatsUpdate();
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.delete("/api/projects/:projectId/callers/:callerId", authenticateAdmin, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const callerId = Number(req.params.callerId);
  memory.callerProjects = memory.callerProjects.filter((link) => !(link.projectId === projectId && link.callerId === callerId));
  res.json({ success: true });
  await saveStore();
  broadcastStatsUpdate();
});

app.get("/api/contacts/next", authenticateCaller, async (req, res) => {
  try {
    const callerId = Number(req.query.callerId);
    const projectId = Number(req.query.projectId);
    if (!callerId || !projectId) return res.status(400).json({ error: "callerId and projectId are required" });
    const allowed = memory.callerProjects.some((link) => link.callerId === callerId && link.projectId === projectId);
    if (!allowed) return res.status(403).json({ error: "Caller is not assigned to this project" });
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const contact = memory.contacts.filter((item) => item.projectId === projectId && item.status === "PENDING").filter((item) => item.callerId == null || item.callerId === callerId || (item.lastCalledAt && item.lastCalledAt < fiveMinutesAgo)).sort((a, b) => a.id - b.id)[0] || null;
    if (contact) { contact.callerId = callerId; contact.lastCalledAt = new Date(); await saveStore(); }
    res.json(contact);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/contacts/skip", authenticateCaller, async (req, res) => {
  const contact = memory.contacts.find((item) => item.id === Number(req.body.contactId));
  if (contact) { contact.callerId = null; contact.lastCalledAt = null; await saveStore(); }
  res.json({ success: true });
});

app.post("/api/calls", authenticateCaller, async (req, res) => {
  try {
    const callerId = Number(req.body.callerId);
    const contactId = Number(req.body.contactId);
    const status = String(req.body.status || "");
    const callNotes = String(req.body.callNotes || "").trim().slice(0, 500);
    const validStatuses = ["SUCCESS", "NOT_INTERESTED", "NO_ANSWER", "INVALID_NUMBER"];
    if (!callerId || !contactId || !validStatuses.includes(status)) return res.status(400).json({ error: "Invalid call payload" });
    const contact = memory.contacts.find((item) => item.id === contactId);
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    contact.status = status; contact.callNotes = callNotes || null; contact.lastCalledAt = new Date(); contact.callerId = callerId;
    const log = { id: memory.ids.callLog++, projectId: contact.projectId, callerId, contactId, status, timestamp: new Date() };
    memory.callLogs.push(log);
    const setting = memory.settings.find((item) => item.key === "win_percentage");
    if (setting && (status === "SUCCESS" || status === "NOT_INTERESTED")) {
      const value = Number.parseFloat(setting.value || "74.8");
      setting.value = (status === "SUCCESS" ? Math.min(99.9, value + 0.15) : Math.max(50, value - 0.08)).toFixed(2);
    }
    res.json({ ...log, caller: memory.callers.find((caller) => caller.id === callerId), contact });
    await saveStore();
    broadcastStatsUpdate();
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/stats/admin", authenticateAdmin, (_req, res) => {
  const callers = memory.callers.map((caller) => {
    const logs = memory.callLogs.filter((log) => log.callerId === caller.id);
    const successLogs = logs.filter((log) => log.status === "SUCCESS");
    const lastLog = [...logs].sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0];
    return { id: caller.id, name: caller.name, phone: caller.phone, totalCalls: logs.length, successCalls: successLogs.length, successRate: logs.length ? Math.round((successLogs.length / logs.length) * 100) : 0, lastCallTime: lastLog?.timestamp || null, projects: getCallerProjects(caller.id) };
  });
  const pendingAdmins = memory.admins.filter((admin) => admin.status === "PENDING_PAYMENT").map(publicAdmin);
  res.json({ summary: allStats(), callers, projects: memory.projects.map(serializeProject), pendingAdmins });
});

app.get("/api/stats/tv", (_req, res) => res.json(tvStats()));
app.get("/api/settings", (_req, res) => res.json(Object.fromEntries(memory.settings.map((item) => [item.key, item.value]))));

app.post("/api/settings", authenticateAdmin, async (req, res) => {
  const settings = req.body.settings;
  if (!settings || typeof settings !== "object") return res.status(400).json({ error: "Invalid settings payload" });
  for (const [key, value] of Object.entries(settings)) {
    const existing = memory.settings.find((item) => item.key === key);
    if (existing) existing.value = String(value); else memory.settings.push({ key, value: String(value) });
  }
  res.json({ success: true });
  await saveStore();
  broadcastStatsUpdate();
});

app.post("/api/contacts/upload", authenticateAdmin, async (req, res) => {
  try {
    let project = memory.projects[0];
    if (!project) { project = { id: memory.ids.project++, name: "פרויקט ראשי", sourceFileName: null, createdAt: new Date() }; memory.projects.push(project); }
    const result = insertContacts(project.id, req.body.contacts || []);
    res.json({ success: true, ...result, project: serializeProject(project) });
    await saveStore();
    broadcastStatsUpdate();
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/contacts/seed", authenticateAdmin, async (_req, res) => {
  let project = memory.projects.find((item) => item.name === "פרויקט דוגמה");
  if (!project) { project = { id: memory.ids.project++, name: "פרויקט דוגמה", sourceFileName: "seed", createdAt: new Date() }; memory.projects.push(project); }
  const contacts = [
    { name: "משה כהן", phone: "0501234567", city: "ירושלים", sector: "דתי לאומי", familySize: 5, notes: "תומך ותיק של עמית הלוי" },
    { name: "שרה לוי", phone: "0529876543", city: "תל אביב", sector: "כללי", familySize: 3, notes: "מתלבטת בין עמית לשר אחר" },
    { name: "דוד מזרחי", phone: "0541112222", city: "פתח תקווה", sector: "מסורתי", familySize: 6, notes: "צריך לדבר איתו על הנושא החינוכי" },
    { name: "רחל גולדברג", phone: "0534445555", city: "חיפה", sector: "אקדמאים", familySize: 2, notes: "לא תומכת ליכוד בדרך כלל" },
  ];
  const result = insertContacts(project.id, contacts);
  if (memory.callers.length) linkCallerToProject(memory.callers[0].id, project.id);
  res.json({ success: true, seededCount: result.inserted, project: serializeProject(project) });
  await saveStore();
  broadcastStatsUpdate();
});

app.post("/api/contacts/reset", authenticateAdmin, async (_req, res) => {
  memory.callLogs = [];
  memory.contacts.forEach((contact) => { contact.status = "PENDING"; contact.callerId = null; contact.lastCalledAt = null; });
  res.json({ success: true });
  await saveStore();
  broadcastStatsUpdate();
});

app.post("/api/callers/reset", authenticateAdmin, async (_req, res) => {
  memory.callLogs = []; memory.callers = []; memory.callerProjects = [];
  memory.contacts.forEach((contact) => { contact.status = "PENDING"; contact.callerId = null; contact.lastCalledAt = null; });
  res.json({ success: true });
  await saveStore();
  broadcastStatsUpdate();
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, async () => {
  if (process.env.USE_MEMORY_DB === "true") {
    await loadMemoryStore();
  } else {
    await loadPrismaStore();
  }
  await initSettings();
  await saveStore();
  console.log("Server running on port " + PORT);
  console.log(process.env.USE_MEMORY_DB === "true" ? "Using local memory database" : "Using Prisma database");
});
