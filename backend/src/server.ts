import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);

// Configure Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json({ limit: "50mb" })); // Increase limit for CSV upload

// Socket connection
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Helper to broadcast stats update
async function broadcastStatsUpdate() {
  try {
    const stats = await getTVStats();
    io.emit("stats-update", stats);
  } catch (error) {
    console.error("Error broadcasting stats:", error);
  }
}

// Default settings initialization helper
async function initSettings() {
  const defaults = [
    { key: "whatsapp_template", value: "שלום {name}, שמחתי לשוחח איתך! נשמח לתמיכתך בחבר הכנסת עמית הלוי בפריימריז הקרובים בליכוד. ביחד ננצח! למידע נוסף: https://amithalevi.org.il" },
    { key: "polymarket_url", value: "https://embed.polymarket.com/market?market=will-likud-win-fewer-than-20-seats-in-the-2026-israeli-legislative-election&theme=dark&border=true&height=300" },
    { key: "win_percentage", value: "74.8" },
    { key: "target_calls", value: "5000" }
  ];

  for (const item of defaults) {
    const exists = await prisma.setting.findUnique({ where: { key: item.key } });
    if (!exists) {
      await prisma.setting.create({ data: item });
    }
  }
}

// TV statistics calculation helper
async function getTVStats() {
  const totalContacts = await prisma.contact.count();
  const calledContacts = await prisma.contact.count({
    where: { status: { not: "PENDING" } }
  });
  
  const successCalls = await prisma.contact.count({
    where: { status: "SUCCESS" }
  });
  
  const notInterested = await prisma.contact.count({
    where: { status: "NOT_INTERESTED" }
  });
  
  const noAnswer = await prisma.contact.count({
    where: { status: "NO_ANSWER" }
  });
  
  const invalidNumber = await prisma.contact.count({
    where: { status: "INVALID_NUMBER" }
  });

  // Call logs
  const logs = await prisma.callLog.findMany({
    take: 10,
    orderBy: { timestamp: "desc" },
    include: {
      caller: true,
      contact: true
    }
  });

  // Leaderboard of callers
  const callers = await prisma.caller.findMany({
    include: {
      _count: {
        select: { callLogs: true }
      },
      callLogs: {
        where: { status: "SUCCESS" }
      }
    }
  });

  const leaderboard = callers
    .map(c => ({
      id: c.id,
      name: c.name,
      totalCalls: c._count.callLogs,
      successCalls: c.callLogs.length,
      successRate: c._count.callLogs > 0 ? Math.round((c.callLogs.length / c._count.callLogs) * 100) : 0
    }))
    .sort((a, b) => b.successCalls - a.successCalls || b.totalCalls - a.totalCalls)
    .slice(0, 10);

  // Settings
  const settingsList = await prisma.setting.findMany();
  const settings: Record<string, string> = {};
  settingsList.forEach(s => {
    settings[s.key] = s.value;
  });

  return {
    totalContacts,
    calledContacts,
    successCalls,
    notInterested,
    noAnswer,
    invalidNumber,
    leaderboard,
    recentCalls: logs.map(l => ({
      id: l.id,
      callerName: l.caller.name,
      contactName: l.contact.name,
      status: l.status,
      timestamp: l.timestamp
    })),
    winPercentage: parseFloat(settings.win_percentage || "74.8"),
    targetCalls: parseInt(settings.target_calls || "5000"),
    polymarketUrl: settings.polymarket_url || "https://polymarket.com",
    whatsappTemplate: settings.whatsapp_template || ""
  };
}

// API Routes

// Login/Register Caller
app.post("/api/login", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    
    let caller = await prisma.caller.findUnique({
      where: { name: name.trim() }
    });

    if (!caller) {
      caller = await prisma.caller.create({
        data: { name: name.trim() }
      });
    }

    res.json(caller);
    broadcastStatsUpdate();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get next contact for a caller
app.get("/api/contacts/next", async (req, res) => {
  try {
    const { callerId } = req.query;
    if (!callerId) {
      return res.status(400).json({ error: "callerId is required" });
    }

    const cId = parseInt(callerId as string);

    // Find a PENDING contact that is either not assigned, or assigned to this caller
    // or has been lock-assigned for more than 5 minutes but not completed (to avoid starvation)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    let contact = await prisma.contact.findFirst({
      where: {
        status: "PENDING",
        OR: [
          { callerId: null },
          { callerId: cId },
          { 
            lastCalledAt: { lt: fiveMinutesAgo },
            status: "PENDING"
          }
        ]
      },
      orderBy: { id: "asc" }
    });

    if (contact) {
      // Temporarily lock/assign it to the caller
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          callerId: cId,
          lastCalledAt: new Date()
        }
      });
    }

    res.json(contact || null);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Skip contact (temporary swipe left)
app.post("/api/contacts/skip", async (req, res) => {
  try {
    const { contactId, callerId } = req.body;
    if (!contactId || !callerId) {
      return res.status(400).json({ error: "contactId and callerId are required" });
    }

    // Unassign the contact so someone else can call them, and reset lastCalledAt
    await prisma.contact.update({
      where: { id: parseInt(contactId) },
      data: {
        callerId: null,
        lastCalledAt: null
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Log call status (swipe right & press status)
app.post("/api/calls", async (req, res) => {
  try {
    const { callerId, contactId, status } = req.body;
    
    if (!callerId || !contactId || !status) {
      return res.status(400).json({ error: "callerId, contactId, and status are required" });
    }

    const cId = parseInt(callerId);
    const conId = parseInt(contactId);

    // Validate status
    const validStatuses = ["SUCCESS", "NOT_INTERESTED", "NO_ANSWER", "INVALID_NUMBER"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid call status" });
    }

    // Update Contact
    await prisma.contact.update({
      where: { id: conId },
      data: {
        status,
        lastCalledAt: new Date(),
        callerId: cId
      }
    });

    // Create CallLog
    const log = await prisma.callLog.create({
      data: {
        callerId: cId,
        contactId: conId,
        status
      },
      include: {
        caller: true,
        contact: true
      }
    });

    // Adjust the simulated win percentage settings.
    // Every SUCCESS adds a tiny increment, and every NOT_INTERESTED slightly drops it.
    // This makes the Polymarket display interactive and alive!
    if (status === "SUCCESS" || status === "NOT_INTERESTED") {
      const winPctSetting = await prisma.setting.findUnique({ where: { key: "win_percentage" } });
      let winPct = parseFloat(winPctSetting?.value || "74.8");
      
      if (status === "SUCCESS") {
        winPct = Math.min(99.9, winPct + 0.15); // Successful calls increase probability
      } else {
        winPct = Math.max(50.0, winPct - 0.08); // Not interested decreases it slightly
      }
      
      await prisma.setting.update({
        where: { key: "win_percentage" },
        data: { value: winPct.toFixed(2) }
      });
    }

    res.json(log);
    
    // Broadcast the update live to the TV
    broadcastStatsUpdate();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// TV statistics endpoint (fallback if socket connection drops)
app.get("/api/stats/tv", async (req, res) => {
  try {
    const stats = await getTVStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin stats overview
app.get("/api/stats/admin", async (req, res) => {
  try {
    const totalContacts = await prisma.contact.count();
    const pendingContacts = await prisma.contact.count({ where: { status: "PENDING" } });
    const successContacts = await prisma.contact.count({ where: { status: "SUCCESS" } });
    const notInterestedContacts = await prisma.contact.count({ where: { status: "NOT_INTERESTED" } });
    const noAnswerContacts = await prisma.contact.count({ where: { status: "NO_ANSWER" } });
    const invalidContacts = await prisma.contact.count({ where: { status: "INVALID_NUMBER" } });

    // Callers list
    const callers = await prisma.caller.findMany({
      include: {
        _count: {
          select: { callLogs: true }
        },
        callLogs: {
          include: {
            contact: true
          }
        }
      }
    });

    const callersDetails = callers.map(c => {
      const successLogs = c.callLogs.filter(l => l.status === "SUCCESS");
      const lastLog = c.callLogs.length > 0 
        ? c.callLogs.reduce((latest, current) => current.timestamp > latest.timestamp ? current : latest, c.callLogs[0])
        : null;

      return {
        id: c.id,
        name: c.name,
        totalCalls: c._count.callLogs,
        successCalls: successLogs.length,
        successRate: c._count.callLogs > 0 ? Math.round((successLogs.length / c._count.callLogs) * 100) : 0,
        lastCallTime: lastLog ? lastLog.timestamp : null
      };
    });

    res.json({
      summary: {
        total: totalContacts,
        pending: pendingContacts,
        success: successContacts,
        notInterested: notInterestedContacts,
        noAnswer: noAnswerContacts,
        invalidNumber: invalidContacts,
        totalCalled: totalContacts - pendingContacts
      },
      callers: callersDetails
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Settings
app.get("/api/settings", async (req, res) => {
  try {
    const settingsList = await prisma.setting.findMany();
    const settings: Record<string, string> = {};
    settingsList.forEach(s => {
      settings[s.key] = s.value;
    });
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Save Settings
app.post("/api/settings", async (req, res) => {
  try {
    const { settings } = req.body; // e.g. { win_percentage: "76.5", whatsapp_template: "..." }
    
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ error: "Invalid settings payload" });
    }

    for (const [key, value] of Object.entries(settings)) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) }
      });
    }

    res.json({ success: true });
    broadcastStatsUpdate();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upload CSV contacts
app.post("/api/contacts/upload", async (req, res) => {
  try {
    const { contacts } = req.body; // Array of contacts
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ error: "Contacts must be an array" });
    }

    let inserted = 0;
    let skipped = 0;

    for (const c of contacts) {
      if (!c.name || !c.phone) {
        skipped++;
        continue;
      }

      // Clean phone number (keep only digits)
      const cleanPhone = String(c.phone).replace(/\D/g, "");
      if (cleanPhone.length < 9) {
        skipped++;
        continue;
      }

      try {
        await prisma.contact.upsert({
          where: { phone: cleanPhone },
          update: {
            name: c.name,
            city: c.city || null,
            sector: c.sector || null,
            familySize: c.familySize ? parseInt(c.familySize) : null,
            notes: c.notes || null,
            // Keep existing status if already in database
          },
          create: {
            name: c.name,
            phone: cleanPhone,
            city: c.city || null,
            sector: c.sector || null,
            familySize: c.familySize ? parseInt(c.familySize) : null,
            notes: c.notes || null,
            status: "PENDING"
          }
        });
        inserted++;
      } catch (err) {
        console.error(`Error inserting contact ${c.phone}:`, err);
        skipped++;
      }
    }

    res.json({ success: true, inserted, skipped });
    broadcastStatsUpdate();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reset Campaign (delete call logs, set all contacts to PENDING)
app.post("/api/contacts/reset", async (req, res) => {
  try {
    await prisma.callLog.deleteMany({});
    await prisma.contact.updateMany({
      data: {
        status: "PENDING",
        callerId: null,
        lastCalledAt: null
      }
    });

    res.json({ success: true });
    broadcastStatsUpdate();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reset Callers (delete all callers and logs)
app.post("/api/callers/reset", async (req, res) => {
  try {
    await prisma.callLog.deleteMany({});
    await prisma.contact.updateMany({
      data: {
        status: "PENDING",
        callerId: null,
        lastCalledAt: null
      }
    });
    await prisma.caller.deleteMany({});
    
    res.json({ success: true });
    broadcastStatsUpdate();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Seed mock contacts for testing
app.post("/api/contacts/seed", async (req, res) => {
  try {
    const mockContacts = [
      { name: "משה כהן", phone: "0501234567", city: "ירושלים", sector: "דתי לאומי", familySize: 5, notes: "תומך ותיק של עמית הלוי" },
      { name: "שרה לוי", phone: "0529876543", city: "תל אביב", sector: "כללי", familySize: 3, notes: "מתלבטת בין עמית לשר אחר" },
      { name: "דוד מזרחי", phone: "0541112222", city: "פתח תקווה", sector: "מסורתי", familySize: 6, notes: "צריך לדבר איתו על הנושא החינוכי" },
      { name: "רחל גולדברג", phone: "0534445555", city: "חיפה", sector: "אקדמאים", familySize: 2, notes: "לא תומכת ליכוד בדרך כלל" },
      { name: "איתי פרץ", phone: "0556667777", city: "באר שבע", sector: "צעירים", familySize: 1, notes: "סטודנט, מתעניין ביוזמות הכלכליות" },
      { name: "מיכל אהרוני", phone: "0588889999", city: "נתניה", sector: "גמלאים", familySize: 4, notes: "הבטיחה שתשכנע את המשפחה שלה" },
      { name: "חיים ביטון", phone: "0503339900", city: "אשדוד", sector: "חרדי עובד", familySize: 8, notes: "תומך חזק, רוצה לקבל פלאיירים לחלוקה" },
      { name: "לימור אלבז", phone: "0524455667", city: "חולון", sector: "כללי", familySize: 4, notes: "הייתה מנהלת קלפי בעבר" },
      { name: "אמיר שלום", phone: "0543322119", city: "רמת גן", sector: "עצמאים", familySize: 3, notes: "מתעניין בקידום חוקי מיסוי" },
      { name: "עדי מלכה", phone: "0507766554", city: "ראשון לציון", sector: "נשים בליכוד", familySize: 5, notes: "פעילה חברתית שכונתית" }
    ];

    let seededCount = 0;
    for (const c of mockContacts) {
      const exists = await prisma.contact.findUnique({ where: { phone: c.phone } });
      if (!exists) {
        await prisma.contact.create({ data: c });
        seededCount++;
      }
    }

    res.json({ success: true, seededCount });
    broadcastStatsUpdate();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start Server
const PORT = process.env.PORT || 5001;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initSettings();
  console.log("Settings initialized");
});
