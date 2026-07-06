import React, { useEffect, useState } from "react";
import "./App.css";
import CallerApp from "./CallerApp";
import LandingPage from "./LandingPage";

// Vercel build trigger - 2026-07-02 17:41
const PUBLIC_API_URL = "https://total-victory.onrender.com";
const LOCAL_API_URL = window.location.protocol + "//" + window.location.hostname + ":5001";
const API_URL = (import.meta.env.VITE_API_URL || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? LOCAL_API_URL : PUBLIC_API_URL)).replace(/\/$/, "");
const CALLER_URL = window.location.origin.replace(/\/$/, "");

type Tab = "dashboard" | "projects" | "settings";
type Summary = { total: number; pending: number; success: number; notInterested: number; noAnswer: number; invalidNumber: number; totalCalled: number };
type Caller = { id: number; name: string; phone?: string; totalCalls?: number; successCalls?: number; successRate?: number; lastCallTime?: string | null; projects?: Project[] };
type Project = { id: number; name: string; sourceFileName?: string | null; createdAt: string; stats: Summary; callers: Caller[]; archived?: boolean; inviteToken?: string };
type CallStatusOption = { id: string; label: string; active: boolean; className: string };
type AdminRequest = { id: number; fullName: string; email: string; phone: string; organization: string; status: string; createdAt: string; approvedAt?: string | null; passcode?: string; subscriptions?: { planId?: string; status?: string; expiresAt?: string }[] };

const defaultCallStatusOptions: CallStatusOption[] = [
  { id: "SUCCESS", label: "שיחה מוצלחת", active: true, className: "success" },
  { id: "NOT_INTERESTED", label: "לא מעוניין", active: true, className: "no-interest" },
  { id: "NO_ANSWER", label: "אין מענה", active: true, className: "no-answer" },
  { id: "INVALID_NUMBER", label: "מספר שגוי", active: true, className: "invalid" },
];


function CampaignCountdown({ endDateStr }: { endDateStr: string }) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, ended: false });

  useEffect(() => {
    const calculateTime = () => {
      const difference = +new Date(endDateStr) - +new Date();
      if (difference <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, ended: true });
        return;
      }
      setTimeLeft({
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
        ended: false
      });
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [endDateStr]);

  const totalHoursLeft = timeLeft.days * 24 + timeLeft.hours;
  
  let cardClass = "timeline-normal";
  let title = "זמן נותר לסיום הקמפיין";
  let glowColor = "rgba(79, 110, 242, 0.2)";
  let borderColor = "rgba(79, 110, 242, 0.4)";
  
  if (timeLeft.ended) {
    cardClass = "timeline-ended";
    title = "הקמפיין הסתיים";
    glowColor = "rgba(255, 255, 255, 0.05)";
    borderColor = "rgba(255, 255, 255, 0.1)";
  } else if (totalHoursLeft < 1) {
    cardClass = "timeline-critical pulse-danger";
    title = "⏰ שעה אחרונה לקמפיין! כל קול קובע!";
    glowColor = "rgba(255, 77, 79, 0.4)";
    borderColor = "rgba(255, 77, 79, 0.8)";
  } else if (timeLeft.days < 1) {
    cardClass = "timeline-warning pulse-warn";
    title = "⚠️ היום האחרון לקמפיין! מגבירים קצב!";
    glowColor = "rgba(255, 193, 7, 0.3)";
    borderColor = "rgba(255, 193, 7, 0.6)";
  }

  return (
    <div className={`campaign-timeline-card ${cardClass}`} style={{
      background: "rgba(25, 25, 35, 0.65)",
      backdropFilter: "blur(12px)",
      border: `1px solid ${borderColor}`,
      borderRadius: "16px",
      padding: "20px",
      marginBottom: "25px",
      boxShadow: `0 8px 32px ${glowColor}`,
      textAlign: "right",
      direction: "rtl"
    }}>
      <h3 style={{ margin: "0 0 15px 0", fontSize: "16px", color: timeLeft.ended ? "#a0a0a0" : "#ffffff", fontWeight: "600", display: "flex", alignItems: "center", gap: "8px" }}>
        <span>📊</span> {title}
      </h3>
      {timeLeft.ended ? (
        <div style={{ fontSize: "24px", fontWeight: "bold", color: "#ff4d4f" }}>הקמפיין הגיע לסיומו הרשמי! 🏁</div>
      ) : (
        <div className="countdown-display" style={{ display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap" }}>
          <div className="countdown-item" style={{ background: "rgba(255,255,255,0.03)", padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", minWidth: "80px", textAlign: "center" }}>
            <span style={{ fontSize: "28px", fontWeight: "bold", display: "block", color: timeLeft.days === 0 ? "#ffc107" : "#4f6ef2" }}>{timeLeft.days}</span>
            <span style={{ fontSize: "12px", color: "#a0a0a0" }}>ימים</span>
          </div>
          <div className="countdown-item" style={{ background: "rgba(255,255,255,0.03)", padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", minWidth: "80px", textAlign: "center" }}>
            <span style={{ fontSize: "28px", fontWeight: "bold", display: "block", color: totalHoursLeft < 24 ? "#ffc107" : "#4f6ef2" }}>{timeLeft.hours}</span>
            <span style={{ fontSize: "12px", color: "#a0a0a0" }}>שעות</span>
          </div>
          <div className="countdown-item" style={{ background: "rgba(255,255,255,0.03)", padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", minWidth: "80px", textAlign: "center" }}>
            <span style={{ fontSize: "28px", fontWeight: "bold", display: "block", color: totalHoursLeft < 1 ? "#ff4d4f" : "#4f6ef2" }}>{timeLeft.minutes}</span>
            <span style={{ fontSize: "12px", color: "#a0a0a0" }}>דקות</span>
          </div>
          <div className="countdown-item" style={{ background: "rgba(255,255,255,0.03)", padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", minWidth: "80px", textAlign: "center" }}>
            <span style={{ fontSize: "28px", fontWeight: "bold", display: "block", color: totalHoursLeft < 1 ? "#ff4d4f" : "#4f6ef2" }}>{timeLeft.seconds}</span>
            <span style={{ fontSize: "12px", color: "#a0a0a0" }}>שניות</span>
          </div>
          <div style={{ flexGrow: 1, textAlign: "left", fontSize: "13px", color: "#808080" }}>
            מועד סיום: {new Date(endDateStr).toLocaleString("he-IL")}
          </div>
        </div>
      )}
    </div>
  );
}

const emptySummary: Summary = { total: 0, pending: 0, success: 0, notInterested: 0, noAnswer: 0, invalidNumber: 0, totalCalled: 0 };

function AdminApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [passcode, setPasscode] = useState(() => sessionStorage.getItem("admin_passcode") || "");
  const [passcodeError, setPasscodeError] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [registerForm, setRegisterForm] = useState({ fullName: "", email: "", phone: "", organization: "", planId: "monthly" });
  const [registrationRequest, setRegistrationRequest] = useState<{ message: string } | null>(null);
  const [adminRequests, setAdminRequests] = useState<AdminRequest[]>([]);
  const [adminRequestsError, setAdminRequestsError] = useState("");
  const [approvedAdmin, setApprovedAdmin] = useState<{ name: string; passcode: string; whatsappUrl?: string } | null>(null);
  const [resetModalData, setResetModalData] = useState<{ passcode: string; whatsappUrl: string; adminName: string } | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [callers, setCallers] = useState<Caller[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentCalls, setRecentCalls] = useState<any[]>([]);
  const [isExpired, setIsExpired] = useState(false);

  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [callerPhoneInputs, setCallerPhoneInputs] = useState<Record<number, string>>({});
  const [settings, setSettings] = useState({ campaign_name: "מטה טלפנים דיגיטלי", target_calls: "5000", whatsapp_template: "", campaign_timeline_active: "false", campaign_end_date: "" });
  const [callStatusOptions, setCallStatusOptions] = useState<CallStatusOption[]>(defaultCallStatusOptions);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const isOwner = (sessionStorage.getItem("admin_passcode") || passcode) === "halevi2026";

    const getAdminHeaders = (extraHeaders: Record<string, string> = {}) => {
    const savedPass = sessionStorage.getItem("admin_passcode") || passcode;
    return savedPass ? { ...extraHeaders, "x-admin-passcode": savedPass } : extraHeaders;
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem("admin_authenticated");
    sessionStorage.removeItem("admin_passcode");
    setPasscode("");
  };

  useEffect(() => {
    const isAuth = sessionStorage.getItem("admin_authenticated") === "true";
    const hasPass = sessionStorage.getItem("admin_passcode") !== null;
    if (isAuth && hasPass) {
      setIsAuthenticated(true);
    } else {
      handleLogout();
    }
  }, []);
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchData();
    fetchSettings();
    if (isOwner) fetchAdminRequests();
    const interval = window.setInterval(fetchData, 10000);
    const adminInterval = window.setInterval(() => { if (isOwner) fetchAdminRequests(); }, 10000);
    return () => { window.clearInterval(interval); window.clearInterval(adminInterval); };
  }, [isAuthenticated]);

  const fetchData = async () => {
    const res = await fetch(API_URL + "/api/stats/admin", { headers: getAdminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setSummary(data.summary || emptySummary);
    setCallers(data.callers || []);
    setProjects(data.projects || []);
    setRecentCalls(data.recentCalls || []);
    setIsExpired(!!data.isExpired);
  };

  const fetchAdminRequests = async () => {
    if (!isOwner) return;
    try {
      setAdminRequestsError("");
      const res = await fetch(API_URL + "/api/admins/registration-requests", { headers: getAdminHeaders() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "לא ניתן לטעון את רשימת הנרשמים כרגע.");
      setAdminRequests(Array.isArray(data) ? data : []);
    } catch (error) {
      setAdminRequestsError(error instanceof Error ? error.message : "לא ניתן לטעון את רשימת הנרשמים כרגע.");
    }
  };

  const fetchSettings = async () => {
    const res = await fetch(API_URL + "/api/settings", { headers: getAdminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setSettings({
      campaign_name: data.campaign_name || "מטה טלפנים דיגיטלי",
      target_calls: data.target_calls || "5000",
      whatsapp_template: data.whatsapp_template || "",
      campaign_timeline_active: data.campaign_timeline_active || "false",
      campaign_end_date: data.campaign_end_date || ""
    });
    try {
      const parsed = JSON.parse(data.call_status_options || "[]");
      const byId = new Map(parsed.map((item: CallStatusOption) => [item.id, item]));
      setCallStatusOptions(defaultCallStatusOptions.map((option) => ({ ...option, ...(byId.get(option.id) || {}) })));
    } catch {
      setCallStatusOptions(defaultCallStatusOptions);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasscodeError(false);
    setLoading(true);
    try {
      const res = await fetch(API_URL + "/api/admins/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) throw new Error("invalid");
      const data = await res.json();
      
      sessionStorage.setItem("admin_authenticated", "true");
      sessionStorage.setItem("admin_passcode", passcode);
      setIsExpired(!!data.isExpired);

      // Pre-fetch dashboard data
      const headers = { "x-admin-passcode": passcode };
      const statsRes = await fetch(API_URL + "/api/stats/admin", { headers });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setSummary(statsData.summary || emptySummary);
        setCallers(statsData.callers || []);
        setProjects(statsData.projects || []);
        setRecentCalls(statsData.recentCalls || []);
      }
      
      const settingsRes = await fetch(API_URL + "/api/settings", { headers });
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        setSettings({
          campaign_name: settingsData.campaign_name || "מטה טלפנים דיגיטלי",
          target_calls: settingsData.target_calls || "5000",
          whatsapp_template: settingsData.whatsapp_template || "",
          campaign_timeline_active: settingsData.campaign_timeline_active || "false",
          campaign_end_date: settingsData.campaign_end_date || ""
        });
      }

      setIsAuthenticated(true);
    } catch {
      setPasscodeError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setRegistrationRequest(null);
    try {
      const res = await fetch(API_URL + "/api/admins/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "registration failed");
      setRegistrationRequest({ message: data.message || "בקשת ההצטרפות נשלחה לבדיקה." });
    } catch {
      alert("לא ניתן לשלוח בקשת הרשמה כרגע.");
    } finally {
      setLoading(false);
    }
  };

  const readFilePayload = (file: File) => new Promise<{ fileText?: string; fileContentBase64?: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("לא ניתן לקרוא את הקובץ"));
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      reader.onload = () => resolve({ fileContentBase64: String(reader.result || "").split(",")[1] });
      reader.readAsDataURL(file);
    } else {
      reader.onload = () => resolve({ fileText: String(reader.result || "") });
      reader.readAsText(file, "utf-8");
    }
  });

  const handleProjectUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim() || !selectedFile) return;
    setLoading(true);
    setUploadResult(null);
    try {
      const payload = await readFilePayload(selectedFile);
      const res = await fetch(API_URL + "/api/projects/upload", { method: "POST", headers: getAdminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ projectName: projectName.trim(), fileName: selectedFile.name, ...payload }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "העלאה נכשלה");
      setUploadResult("הפרויקט נפתח בהצלחה. נטענו " + data.inserted + " רשומות, דולגו " + data.skipped + ".");
      setProjectName("");
      setSelectedFile(null);
      const input = document.getElementById("projectFile") as HTMLInputElement | null;
      if (input) input.value = "";
      fetchData();
    } catch (error: any) {
      setUploadResult(error.message || "שגיאה בהעלאת הקובץ");
    } finally {
      setLoading(false);
    }
  };

  const assignCaller = async (projectId: number) => {
    const phone = callerPhoneInputs[projectId]?.trim();
    if (!phone) return;
    setLoading(true);
    try {
      const res = await fetch(API_URL + "/api/projects/" + projectId + "/callers", { method: "POST", headers: getAdminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ phone }) });
      if (res.ok) {
        setCallerPhoneInputs((prev) => ({ ...prev, [projectId]: "" }));
        fetchData();
      } else {
        alert("צריך מספר טלפון תקין לשיוך טלפן.");
      }
    } finally { setLoading(false); }
  };

  const unassignCaller = async (projectId: number, callerId: number) => {
    await fetch(API_URL + "/api/projects/" + projectId + "/callers/" + callerId, { method: "DELETE", headers: getAdminHeaders() });
    fetchData();
  };

  const deleteProject = async (project: Project) => {
    const approved = window.confirm("להעביר את הפרויקט '" + project.name + "' לארכיון? הנתונים, האקסל, הסטטוסים והערות הטלפנים יישמרו וניתן יהיה לשחזר אותם.");
    if (!approved) return;
    setLoading(true);
    try {
      await fetch(API_URL + "/api/projects/" + project.id, { method: "DELETE", headers: getAdminHeaders() });
      fetchData();
    } finally {
      setLoading(false);
    }
  };

  const restoreProject = async (project: Project) => {
    setLoading(true);
    try {
      await fetch(API_URL + "/api/projects/" + project.id + "/restore", { method: "POST", headers: getAdminHeaders() });
      fetchData();
    } finally {
      setLoading(false);
    }
  };

  const permanentlyDeleteProject = async (project: Project) => {
    const approved = window.confirm("למחוק את הפרויקט '" + project.name + "' לצמיתות? כל אנשי הקשר, הסטטוסים, הערות הטלפנים והיסטוריית השיחות של פרויקט זה יימחקו ללא אפשרות שחזור!");
    if (!approved) return;
    setLoading(true);
    try {
      await fetch(API_URL + "/api/projects/" + project.id + "/permanent", { method: "DELETE", headers: getAdminHeaders() });
      fetchData();
    } finally {
      setLoading(false);
    }
  };

  const resetInviteToken = async (project: Project) => {
    const approved = window.confirm("לאפס את קישור ההצטרפות של הפרויקט '" + project.name + "'? קישורי ההצטרפות הקודמים יבוטלו מיידית!");
    if (!approved) return;
    setLoading(true);
    try {
      const res = await fetch(API_URL + "/api/projects/" + project.id + "/reset-invite-token", { method: "POST", headers: getAdminHeaders() });
      if (res.ok) {
        alert("קישור ההצטרפות אופס בהצלחה!");
        fetchData();
      } else {
        alert("שגיאה באיפוס קישור ההצטרפות.");
      }
    } catch {
      alert("שגיאה בתקשורת עם השרת.");
    } finally {
      setLoading(false);
    }
  };

  const seedDemo = async () => { setLoading(true); try { await fetch(API_URL + "/api/contacts/seed", { method: "POST", headers: getAdminHeaders() }); fetchData(); } finally { setLoading(false); } };

  const csvExportUrl = (project: Project) => API_URL + "/api/projects/" + project.id + "/export.csv?passcode=" + encodeURIComponent(sessionStorage.getItem("admin_passcode") || passcode);
  const xlsxExportUrl = (project: Project) => API_URL + "/api/projects/" + project.id + "/export.xlsx?passcode=" + encodeURIComponent(sessionStorage.getItem("admin_passcode") || passcode);
  const callerJoinUrl = (project: Project) => CALLER_URL + "?caller=1&invite=" + (project.inviteToken || "");

  const approveAdminRequest = async (request: AdminRequest, expiresAt?: string) => {
    const approved = window.confirm("לאשר את " + request.fullName + " כמנהל פעיל וליצור לו קוד גישה?");
    if (!approved) return;
    setLoading(true);
    setApprovedAdmin(null);
    try {
      const res = await fetch(API_URL + "/api/admins/" + request.id + "/approve", { 
        method: "POST", 
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expiresAt })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "approval failed");
      setApprovedAdmin({ name: request.fullName, passcode: data.passcode, whatsappUrl: data.whatsappUrl });
      fetchAdminRequests();
    } catch {
      alert("לא ניתן לאשר את המנהל כרגע.");
    } finally {
      setLoading(false);
    }
  };

  const updateAdminExpiry = async (adminId: number, expiresAt: string) => {
    if (!expiresAt) return;
    setLoading(true);
    try {
      const res = await fetch(API_URL + "/api/admins/" + adminId + "/update-expiry", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expiresAt })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "update failed");
      alert("תאריך התפוגה עודכן בהצלחה.");
      fetchAdminRequests();
    } catch (err: any) {
      alert("שגיאה בעדכון תאריך התפוגה: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetAdminPasscode = async (adminId: number, adminName: string) => {
    if (!window.confirm("האם אתה בטוח שברצונך לאפס את קוד הגישה עבור " + adminName + "?\nקוד הגישה הנוכחי יבוטל מיידית!")) return;
    setLoading(true);
    try {
      const res = await fetch(API_URL + "/api/admins/" + adminId + "/reset-passcode", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "reset failed");
      setResetModalData({ passcode: data.passcode, whatsappUrl: data.whatsappUrl, adminName });
      fetchAdminRequests();
    } catch (err: any) {
      alert("שגיאה באיפוס קוד הגישה: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const settingsPayload = { ...settings, call_status_options: JSON.stringify(callStatusOptions) };
      const res = await fetch(API_URL + "/api/settings", { method: "POST", headers: getAdminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ settings: settingsPayload }) });
      if (res.ok) { setSettingsSaved(true); window.setTimeout(() => setSettingsSaved(false), 2500); }
    } finally { setLoading(false); }
  };

  const updateCallStatusOption = (id: string, patch: Partial<CallStatusOption>) => {
    setCallStatusOptions((prev) => prev.map((option) => option.id === id ? { ...option, ...patch } : option));
  };

  const resetCallStatusOptions = () => setCallStatusOptions(defaultCallStatusOptions);

  const percent = (value: number, total: number) => total ? Math.round((value / total) * 100) : 0;
  const getStatusLabel = (status: string) => {
    return callStatusOptions.find((o) => o.id === status)?.label || status;
  };
  const getStatusClass = (status: string) => {
    return callStatusOptions.find((o) => o.id === status)?.className || "no-answer";
  };
  const completionRate = percent(summary.totalCalled, summary.total);
  const successRate = percent(summary.success, summary.totalCalled);
  const answerRate = percent(summary.success + summary.notInterested, summary.totalCalled);
  const activeCallers = callers.filter((caller) => (caller.totalCalls || 0) > 0).length;
  const averageCalls = activeCallers ? Math.round(summary.totalCalled / activeCallers) : 0;
  const statusBreakdown = [
    { label: "תומכים", value: summary.success, color: "#10b981" },
    { label: "לא מעוניינים", value: summary.notInterested, color: "#f59e0b" },
    { label: "לא ענו", value: summary.noAnswer, color: "#3b82f6" },
    { label: "מספר שגוי", value: summary.invalidNumber, color: "#ef4444" },
    { label: "ממתינים", value: summary.pending, color: "#64748b" },
  ];
  let gradientStart = 0;
  const statusGradient = summary.total
    ? statusBreakdown.map((item) => {
      const slice = (item.value / summary.total) * 100;
      const segment = item.color + " " + gradientStart + "% " + (gradientStart + slice) + "%";
      gradientStart += slice;
      return segment;
    }).join(", ")
    : "#334155 0% 100%";
  const activeProjects = projects.filter((project) => !project.archived);
  const archivedProjects = projects.filter((project) => project.archived);
  const topCallers = [...callers].sort((a, b) => (b.successCalls || 0) - (a.successCalls || 0) || (b.totalCalls || 0) - (a.totalCalls || 0)).slice(0, 8);
  const maxCallerCalls = Math.max(1, ...topCallers.map((caller) => caller.totalCalls || 0));
  const topProjects = [...activeProjects]
    .sort((a, b) => percent(b.stats.totalCalled, b.stats.total) - percent(a.stats.totalCalled, a.stats.total))
    .slice(0, 5);

  if (!isAuthenticated) {
    if (!showAuth) {
      return (
        <LandingPage 
          onLogin={() => { setShowAuth(true); setAuthMode("login"); }}
          onRegister={() => { setShowAuth(true); setAuthMode("register"); }}
        />
      );
    }

    return (
      <div className="auth-page auth-page-clean">
        <button 
          type="button" 
          className="btn-back-landing" 
          onClick={() => setShowAuth(false)}
          title="חזרה לדף הבית"
        >
          ← חזרה לדף הבית
        </button>
        <section className="auth-shell auth-shell-compact card-enter-anim" dir="rtl">
          <header className="auth-brand">
            <span className="auth-eyebrow">מערכת בחירות</span>
            <h1>מטה טלפנים דיגיטלי</h1>
          </header>

          <div className="auth-panel">
            <div className="auth-tabs" role="tablist" aria-label="בחירת פעולה">
              <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>כניסה למשתמש קיים</button>
              <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>הרשמה למנהל חדש</button>
            </div>

            {authMode === "login" ? (
              <form className="auth-form" onSubmit={handleLogin}>
                <div className="auth-form-header">
                  <h2>כניסה לניהול</h2>
                </div>
                {passcodeError && <div className="error-banner">קוד גישה שגוי, נסה שנית.</div>}
                <div className="input-group"><label htmlFor="passcode">קוד גישה מנהל</label><input id="passcode" type="password" placeholder="הכנס קוד גישה..." value={passcode} onChange={(e) => setPasscode(e.target.value)} required /></div>
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? "מתחבר..." : "כניסה לניהול"}</button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleRegisterAdmin}>
                <div className="auth-form-header">
                  <h2>הרשמה ורכישת מנוי</h2>
                </div>
                <div className="auth-form-grid">
                  <div className="input-group"><label>שם מלא</label><input value={registerForm.fullName} onChange={(e) => setRegisterForm({ ...registerForm, fullName: e.target.value })} required /></div>
                  <div className="input-group"><label>אימייל</label><input type="email" value={registerForm.email} onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })} required /></div>
                  <div className="input-group"><label>טלפון</label><input value={registerForm.phone} onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })} required /></div>
                  <div className="input-group"><label>שם מטה / ארגון</label><input value={registerForm.organization} onChange={(e) => setRegisterForm({ ...registerForm, organization: e.target.value })} required /></div>
                </div>
                <div className="input-group">
                  <label>מסלול מנוי</label>
                  <div className="plan-static-badge">
                    <strong>מסלול חודשי מלא</strong> - 990 ₪ / חודש (עד 50 טלפנים בו זמנית)
                  </div>
                </div>
                <div className="payment-note">בסיום ההרשמה הבקשה נשלחת לבדיקה פרטית של בעל המערכת. לאחר אישור התשלום יישלח אליך קוד גישה בצורה מסודרת.</div>
                {registrationRequest && <div className="result-banner success"><strong>{registrationRequest.message}</strong></div>}
                <button type="submit" className="btn-primary" disabled={loading}>{loading ? "שולח בקשה..." : "שליחת בקשת הצטרפות"}</button>
              </form>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (isExpired) {
    return (
      <div className="admin-container">
        <aside className="admin-sidebar">
          <div className="sidebar-header">
            <h2>{settings.campaign_name || "מטה טלפנים דיגיטלי"}</h2>
            <span className="expired-badge-sidebar" style={{ backgroundColor: "#ff4d4f", color: "white", fontSize: "11px", padding: "2px 6px", borderRadius: "4px", marginRight: "6px" }}>רישיון פג</span>
          </div>
          <nav className="sidebar-nav">
            <button className="nav-item active" style={{ color: "#ff4d4f", borderColor: "#ff4d4f" }}>⚠️ תוקף רישיון פג</button>
          </nav>
          <button onClick={() => { handleLogout(); }} className="btn-sidebar-logout">יציאה</button>
        </aside>
        <main className="admin-content">
          <div className="expired-overlay-panel card-enter-anim" dir="rtl" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "40px 20px" }}>
            <div className="expired-card" style={{ maxWidth: "600px", width: "100%", background: "rgba(25, 25, 35, 0.65)", backdropFilter: "blur(12px)", border: "1px solid rgba(255, 77, 79, 0.3)", borderRadius: "16px", padding: "30px", textAlign: "center", boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)" }}>
              <span className="expired-icon" style={{ fontSize: "48px", display: "block", marginBottom: "15px" }}>⚠️</span>
              <h2 style={{ fontSize: "24px", color: "#ff4d4f", marginBottom: "15px" }}>תוקף הרישיון פג</h2>
              <p style={{ color: "#e3e3e3", marginBottom: "10px", lineHeight: "1.6" }}>תוקף הרישיון עבור מטה זה פג. כל הנתונים, המתפקדים והערות הטלפנים שמורים ומאובטחים לחלוטין במערכת.</p>
              <p style={{ color: "#ff4d4f", fontSize: "14px", fontWeight: "bold", marginBottom: "15px", lineHeight: "1.6" }}>⚠️ שים לב: שנה לאחר פקיעת תוקף הרישיון, כל הקבצים, הפרויקטים והנתונים המקושרים למטה זה יימחקו לצמיתות מהשרת ללא אפשרות שחזור.</p>
              <p className="sub" style={{ color: "#a0a0a0", fontSize: "14px", marginBottom: "25px", lineHeight: "1.6" }}>לנוחיותך, תוכל להוריד כעת את קבצי ה-Excel (XLSX) וה-CSV המעודכנים המכילים את כל תוצאות השיחות, הערות הטלפנים והסטטוסים האחרונים:</p>
              
              <div className="expired-projects-list" style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "25px" }}>
                {projects.length === 0 ? (
                  <div className="empty-state" style={{ color: "#808080", padding: "20px" }}>לא נמצאו פרויקטים להורדה.</div>
                ) : (
                  projects.map((project) => (
                    <div className="expired-project-row" key={project.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(25, 25, 35, 0.4)", padding: "12px 16px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.05)" }}>
                      <div className="proj-info" style={{ textAlign: "right" }}>
                        <strong style={{ display: "block", color: "white", fontSize: "15px", marginBottom: "4px" }}>{project.name}</strong>
                        <span style={{ fontSize: "12px", color: "#a0a0a0" }}>{project.stats?.total || 0} רשומות · {project.stats?.totalCalled || 0} שיחות שבוצעו</span>
                      </div>
                      <div className="proj-downloads" style={{ display: "flex", gap: "8px" }}>
                        <a href={xlsxExportUrl(project)} className="btn-download-expired" style={{ background: "#217346", color: "white", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", textDecoration: "none", fontWeight: "500" }} target="_blank" rel="noreferrer">הורד XLSX מעודכן</a>
                        <a href={csvExportUrl(project)} className="btn-download-expired secondary" style={{ background: "rgba(255,255,255,0.08)", color: "white", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", textDecoration: "none", fontWeight: "500", border: "1px solid rgba(255,255,255,0.1)" }} target="_blank" rel="noreferrer">פתח CSV מעודכן</a>
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              <div className="contact-owner-note" style={{ fontSize: "13px", color: "#a0a0a0", paddingTop: "15px", borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
                להארכת המנוי וחידוש הרישיון, אנא פנה למנהל המערכת.
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <aside className="admin-sidebar">
        <div className="sidebar-header"><h2>{settings.campaign_name || "מטה טלפנים דיגיטלי"}</h2><span>מערכת טלפנים</span></div>
        <nav className="sidebar-nav">
          <button className={"nav-item " + (activeTab === "dashboard" ? "active" : "")} onClick={() => setActiveTab("dashboard")}>לוח בקרה</button>
          <button className={"nav-item " + (activeTab === "projects" ? "active" : "")} onClick={() => setActiveTab("projects")}>פרויקטים ואקסלים</button>
          <button className={"nav-item " + (activeTab === "settings" ? "active" : "")} onClick={() => setActiveTab("settings")}>הגדרות</button>
        </nav>
        <button onClick={() => { handleLogout(); }} className="btn-sidebar-logout">יציאה</button>
      </aside>
      <main className="admin-content">
        {activeTab === "dashboard" && (
          <div className="tab-pane card-enter-anim">
            <div className="pane-header"><h1>לוח בקרה</h1><p>סיכום כל הפרויקטים וכל פעילות הטלפנים.</p></div>
            {settings.campaign_timeline_active === "true" && settings.campaign_end_date && (
              <CampaignCountdown endDateStr={settings.campaign_end_date} />
            )}
            <div className="stats-grid stats-grid-rich">
              <div className="stat-card"><span className="stat-label">סה״כ רשומות</span><span className="stat-number">{summary.total}</span><span className="stat-sub">{summary.totalCalled} כבר טופלו</span></div>
              <div className="stat-card success-glow"><span className="stat-label">אחוז הצלחה</span><span className="stat-number">{successRate}%</span><span className="stat-sub">{summary.success} תומכים מתוך {summary.totalCalled || 0} שיחות</span></div>
              <div className="stat-card"><span className="stat-label">אחוז מענה</span><span className="stat-number">{answerRate}%</span><span className="stat-sub">תומכים + לא מעוניינים</span></div>
              <div className="stat-card progress-glow"><span className="stat-label">התקדמות כללית</span><span className="stat-number">{completionRate}%</span><span className="stat-sub">{summary.pending} עדיין ממתינים</span></div>
              <div className="stat-card"><span className="stat-label">טלפנים פעילים</span><span className="stat-number">{activeCallers}</span><span className="stat-sub">ממוצע {averageCalls} שיחות לטלפן</span></div>
              <div className="stat-card danger-glow"><span className="stat-label">לא ענו / שגויים</span><span className="stat-number">{summary.noAnswer + summary.invalidNumber}</span><span className="stat-sub">דורש סבב טיפול נוסף</span></div>
            </div>

            <div className="dashboard-grid">
              <section className="insight-card chart-card">
                <div className="insight-header"><h2>פילוח סטטוסים</h2><span>{completionRate}% הושלם</span></div>
                <div className="donut-wrap">
                  <div className="donut-chart" style={{ background: "conic-gradient(" + statusGradient + ")" }}><div><strong>{summary.totalCalled}</strong><span>טופלו</span></div></div>
                  <div className="status-legend">{statusBreakdown.map((item) => <div key={item.label} className="legend-row"><span className="legend-dot" style={{ backgroundColor: item.color }}></span><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
                </div>
              </section>

              <section className="insight-card leaderboard-card">
                <div className="insight-header"><h2>תחרות טלפנים</h2><span>מדורג לפי הצלחות</span></div>
                {topCallers.length === 0 ? <div className="empty-state">עדיין אין שיחות למדידה.</div> : <div className="leaderboard-list">{topCallers.map((caller, index) => <div className="leaderboard-row" key={caller.id}><div className="rank-badge">#{index + 1}</div><div className="leaderboard-main"><div><strong>{caller.name || "טלפן"}</strong><span>{caller.successCalls || 0} הצלחות · {caller.totalCalls || 0} שיחות</span></div><div className="mini-bar"><span style={{ width: ((caller.totalCalls || 0) / maxCallerCalls) * 100 + "%" }}></span></div></div><div className="score-pill">{caller.successRate || 0}%</div></div>)}</div>}
              </section>
            </div>

            <div className="dashboard-grid">
              <section className="insight-card project-progress-card" style={{ marginBottom: 0 }}>
                <div className="insight-header"><h2>התקדמות פרויקטים</h2><span>{activeProjects.length} פרויקטים</span></div>
                {topProjects.length === 0 ? <div className="empty-state">אין עדיין פרויקטים להצגה.</div> : <div className="project-progress-list">{topProjects.map((project) => { const done = percent(project.stats.totalCalled, project.stats.total); return <div className="project-progress-row" key={project.id}><div><strong>{project.name}</strong><span>{project.stats.totalCalled} מתוך {project.stats.total}</span></div><div className="wide-progress"><span style={{ width: done + "%" }}></span></div><b>{done}%</b></div>; })}</div>}
              </section>

              <section className="insight-card ticker-card" style={{ display: "flex", flexDirection: "column" }}>
                <div className="insight-header">
                  <h2>דיווחים חיים מהשטח</h2>
                  <span className="ticker-live-dot" style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#10b981", boxShadow: "0 0 8px #10b981", animation: "pulse 2s infinite" }}></span>
                </div>
                {recentCalls.length === 0 ? (
                  <div className="empty-state" style={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>אין עדיין שיחות לדיווח.</div>
                ) : (
                  <div className="feed-list" style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "250px", overflowY: "auto", paddingLeft: "8px" }}>
                    {recentCalls.map((call) => (
                      <div key={call.id} className="feed-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.02)", padding: "10px 14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <span className="time-cell" style={{ fontSize: "12px", color: "#a0a0a0", direction: "ltr" }}>{new Date(call.timestamp).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                        <span style={{ fontSize: "14px", color: "#e3e3e3", flexGrow: 1, marginRight: "12px", textAlign: "right" }}>
                          <strong>{call.callerName}</strong> התקשר ל-{call.contactName}
                        </span>
                        <span className={`status-preview ${getStatusClass(call.status)}`} style={{ fontSize: "11px", padding: "4px 8px", borderRadius: "999px", fontWeight: "800", border: "1px solid rgba(255, 255, 255, 0.12)", whiteSpace: "nowrap" }}>
                          {getStatusLabel(call.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="table-card"><div className="table-card-header"><h2>טלפנים פעילים</h2></div>
              {callers.length === 0 ? <div className="empty-state">אין טלפנים פעילים כרגע.</div> : <div className="table-responsive"><table className="admin-table"><thead><tr><th>דירוג</th><th>טלפן</th><th>טלפון</th><th>שיחות</th><th>הצלחות</th><th>אחוז הצלחה</th><th>פרויקטים</th><th>שיחה אחרונה</th></tr></thead><tbody>{[...callers].sort((a, b) => (b.successCalls || 0) - (a.successCalls || 0) || (b.totalCalls || 0) - (a.totalCalls || 0)).map((caller, index) => <tr key={caller.id}><td><span className="rank-badge table-rank">#{index + 1}</span></td><td className="caller-name-cell"><span className="avatar-small">{caller.name?.[0] || "?"}</span>{caller.name}</td><td>{caller.phone || "-"}</td><td>{caller.totalCalls || 0}</td><td className="success-cell">{caller.successCalls || 0}</td><td><span className="score-pill">{caller.successRate || 0}%</span></td><td>{caller.projects?.map((project) => project.name).join(", ") || "-"}</td><td className="time-cell">{caller.lastCallTime ? new Date(caller.lastCallTime).toLocaleString("he-IL") : "-"}</td></tr>)}</tbody></table></div>}
            </div>
          </div>
        )}
        {activeTab === "projects" && (
          <div className="tab-pane card-enter-anim">
            <div className="pane-header"><h1>פרויקטים ואקסלים</h1><p>כל קובץ Excel או CSV יוצר פרויקט נפרד. לאחר מכן משייכים אליו טלפנים.</p></div>
            <div className="upload-container project-upload-layout">
              <div className="upload-info-box"><h3>מבנה קובץ</h3><ul><li>תומך בקבצי ‎.xlsx‎ ו־CSV.</li><li>חובה לכלול עמודות בשם: שם וטלפון.</li><li>עמודות אופציונליות: עיר, מגזר, נפשות, הערות.</li><li>קישור הייצוא כולל את הקובץ המקורי עם סטטוס שיחה, הערות ותאריך שיחה אחרונה.</li></ul><button type="button" onClick={seedDemo} className="btn-seed" disabled={loading}>טען פרויקט דוגמה</button></div>
              <form className="upload-form" onSubmit={handleProjectUpload}>
                <div className="file-picker-group"><label htmlFor="projectName">שם הפרויקט:</label><input id="projectName" className="file-input" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="לדוגמה: ירושלים - מתפקדים" required /></div>
                <div className="file-picker-group"><label htmlFor="projectFile">קובץ Excel או CSV:</label><input id="projectFile" type="file" accept=".xlsx,.csv" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} className="file-input" required /></div>
                {uploadResult && <div className="result-banner success">{uploadResult}</div>}
                <button type="submit" className="btn-primary" disabled={loading || !projectName.trim() || !selectedFile}>{loading ? "מעלה..." : "פתח פרויקט מהקובץ"}</button>
              </form>
            </div>
            <div className="projects-grid">
              {activeProjects.length === 0 ? <div className="empty-state">עדיין אין פרויקטים פעילים. העלה קובץ כדי להתחיל.</div> : activeProjects.map((project) => (
                <section className="project-card" key={project.id}>
                  <div className="project-card-header"><div><h2>{project.name}</h2><span>{project.sourceFileName || "קובץ מקומי"}</span></div><div className="project-card-actions"><strong>{project.stats.total} רשומות</strong><button type="button" onClick={() => deleteProject(project)}>העבר לארכיון</button></div></div>
                  <div className="project-stats-row"><span>ממתינים: {project.stats.pending}</span><span>בוצעו: {project.stats.totalCalled}</span><span>הצלחות: {project.stats.success}</span></div>
                  <div className="sheet-link-box"><div className="sheet-actions"><a href={csvExportUrl(project)} target="_blank" rel="noreferrer">פתח CSV מתעדכן</a><a href={xlsxExportUrl(project)} target="_blank" rel="noreferrer">הורד XLSX מתעדכן</a><button type="button" onClick={() => navigator.clipboard.writeText(callerJoinUrl(project))}>העתק קישור הצטרפות לטלפנים</button><button type="button" className="danger-button" onClick={() => resetInviteToken(project)} style={{ display: "inline-flex", alignItems: "center", justifySelf: "flex-end", background: "rgba(255, 75, 75, 0.15)", color: "#ff4b4b", border: "1px solid rgba(255, 75, 75, 0.3)", borderRadius: "6px", cursor: "pointer", fontSize: "14px", padding: "6px 12px", transition: "all 0.2s" }}>אפס קישור</button></div><small>{callerJoinUrl(project)}</small></div>
                  <div className="assign-box"><label>שיוך טלפן לפרויקט לפי מספר טלפון בלבד</label><div className="assign-row assign-row-wide"><input value={callerPhoneInputs[project.id] || ""} onChange={(e) => setCallerPhoneInputs((prev) => ({ ...prev, [project.id]: e.target.value }))} placeholder="מספר טלפון של הטלפן" /><button type="button" onClick={() => assignCaller(project.id)} disabled={loading || !callerPhoneInputs[project.id]?.trim()}>שייך</button></div></div>
                  <div className="caller-chip-list">{project.callers.length === 0 ? <span className="muted-text">אין טלפנים משויכים</span> : project.callers.map((caller) => <button key={caller.id} type="button" className="caller-chip" onClick={() => unassignCaller(project.id, caller.id)} title="הסר שיוך">{caller.name || "טרם הזדהה"} · {caller.phone} ×</button>)}</div>
                </section>
              ))}
            </div>
            {archivedProjects.length > 0 && <section className="archived-projects-card"><div className="table-card-header"><h2>ארכיון פרויקטים</h2><span>הנתונים נשמרים ואפשר לשחזר בכל רגע</span></div>{archivedProjects.map((project) => <div className="archived-project-row" key={project.id}><div><strong>{project.name}</strong><span>{project.stats.total} רשומות · {project.stats.totalCalled} שיחות שבוצעו</span></div><div className="sheet-actions"><a href={xlsxExportUrl(project)} target="_blank" rel="noreferrer">הורד גיבוי XLSX</a><button type="button" onClick={() => restoreProject(project)} disabled={loading}>שחזר</button><button type="button" className="danger-button" onClick={() => permanentlyDeleteProject(project)} disabled={loading}>מחק לצמיתות</button></div></div>)}</section>}
          </div>
        )}
        {activeTab === "settings" && (
          <div className="tab-pane card-enter-anim">
            <div className="pane-header"><h1>הגדרות</h1><p>הגדרות כלליות של שם המטה, הודעות, תצוגה וסימוני שיחה.</p></div>
            <form onSubmit={handleSaveSettings} className="settings-form">
              <div className="settings-section"><label>שם המטה / הפרויקט</label><input value={settings.campaign_name} onChange={(e) => setSettings({ ...settings, campaign_name: e.target.value })} placeholder="מטה טלפנים דיגיטלי" /></div>
              <div className="settings-section"><h3>תבנית הודעת וואטסאפ</h3><textarea rows={4} value={settings.whatsapp_template} onChange={(e) => setSettings({ ...settings, whatsapp_template: e.target.value })} placeholder="שלום {name}..." /></div>
              <div className="settings-section"><label>יעד שיחות</label><input type="number" value={settings.target_calls} onChange={(e) => setSettings({ ...settings, target_calls: e.target.value })} /></div>
              <div className="settings-section" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h3>ציר זמן לקמפיין (ספירה לאחור)</h3>
                <label className="status-toggle" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input type="checkbox" checked={settings.campaign_timeline_active === "true"} onChange={(e) => setSettings({ ...settings, campaign_timeline_active: e.target.checked ? "true" : "false" })} />
                  <span>הפעל ספירה לאחור לציר זמן בלוח הבקרה</span>
                </label>
                <div style={{ marginTop: "8px" }}>
                  <label style={{ display: "block", fontSize: "14px", color: "#a0a0a0", marginBottom: "4px" }}>תאריך ושעת סיום הקמפיין:</label>
                  <input type="datetime-local" value={settings.campaign_end_date || ""} onChange={(e) => setSettings({ ...settings, campaign_end_date: e.target.value })} style={{ background: "#252535", color: "white", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "8px 12px", width: "100%", maxWidth: "300px" }} />
                </div>
              </div>

              {isOwner && (
                <div className="settings-section admin-requests-panel">
                  <div className="settings-section-title">
                    <h3>ניהול מנהלים ורישיונות (TVictory Owner)</h3>
                    <button type="button" onClick={fetchAdminRequests}>רענן רשימה</button>
                  </div>
                  
                  {approvedAdmin && (
                    <div className="result-banner success">
                      <strong>{approvedAdmin.name} אושר בהצלחה.</strong>
                      <div>קוד גישה למערכת: <b>{approvedAdmin.passcode}</b></div>
                      {approvedAdmin.whatsappUrl && (
                        <a href={approvedAdmin.whatsappUrl} target="_blank" rel="noreferrer">
                          שלח הודעת וואטסאפ עם קוד הגישה
                        </a>
                      )}
                    </div>
                  )}
                  
                  {resetModalData && (
                    <div className="result-banner success" style={{ background: "rgba(255, 193, 7, 0.15)", border: "1px solid rgba(255, 193, 7, 0.3)", position: "relative" }}>
                      <button type="button" onClick={() => setResetModalData(null)} style={{ position: "absolute", left: "10px", top: "10px", background: "none", border: "none", color: "white", cursor: "pointer", fontSize: "16px" }}>×</button>
                      <strong style={{ color: "#ffc107" }}>קוד גישה חדש עבור {resetModalData.adminName} נוצר בהצלחה!</strong>
                      <div style={{ marginTop: "8px" }}>קוד גישה חדש: <b style={{ fontSize: "16px", color: "white", background: "rgba(0,0,0,0.3)", padding: "4px 8px", borderRadius: "4px" }}>{resetModalData.passcode}</b></div>
                      {resetModalData.whatsappUrl && (
                        <div style={{ marginTop: "10px" }}>
                          <a href={resetModalData.whatsappUrl} target="_blank" rel="noreferrer" className="btn-whatsapp-share" style={{ display: "inline-block", backgroundColor: "#25d366", color: "white", padding: "6px 12px", borderRadius: "4px", textDecoration: "none", fontSize: "13px", fontWeight: "bold" }}>
                            💬 שלח קוד חדש למנהל בוואטסאפ
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {adminRequestsError && <div className="error-banner">{adminRequestsError}</div>}
                  
                  <div className="owner-management-tabs" style={{ marginTop: "15px" }}>
                    {/* 1. Pending Section */}
                    <div className="owner-section-card" style={{ marginBottom: "25px", background: "rgba(255,255,255,0.02)", padding: "18px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <h4 style={{ color: "#ffc107", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px", margin: "0 0 12px 0" }}>
                        <span>⏳</span> בקשות הרשמה ממתינות לאישור ({adminRequests.filter(r => r.status !== "ACTIVE").length})
                      </h4>
                      {adminRequests.filter(r => r.status !== "ACTIVE").length === 0 ? (
                        <div className="empty-state compact-empty" style={{ padding: "15px", textAlign: "center", color: "#a0a0a0" }}>אין בקשות ממתינות לאישור.</div>
                      ) : (
                        <div className="admin-request-list" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {adminRequests.filter(r => r.status !== "ACTIVE").map((request) => {
                            const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                            return (
                              <div className="admin-request-row pending" key={request.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.2)", padding: "12px 16px", borderRadius: "6px", borderRight: "4px solid #ffc107" }}>
                                <div style={{ textAlign: "right" }}>
                                  <strong style={{ color: "white", display: "block" }}>{request.fullName}</strong>
                                  <span style={{ fontSize: "13px", color: "#e3e3e3" }}>{request.organization} · {request.phone} · {request.email}</span>
                                  <small style={{ display: "block", color: "#a0a0a0", marginTop: "4px" }}>
                                    הרשמה: {request.createdAt ? new Date(request.createdAt).toLocaleString("he-IL") : "-"}
                                  </small>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <label style={{ fontSize: "12px", color: "#a0a0a0" }}>תפוגת רישיון:</label>
                                    <input type="date" id={`expiry-${request.id}`} defaultValue={defaultExpiry} style={{ background: "#252535", color: "white", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", padding: "4px 8px", fontSize: "12px" }} />
                                  </div>
                                  <button type="button" onClick={() => {
                                    const input = document.getElementById(`expiry-${request.id}`) as HTMLInputElement | null;
                                    approveAdminRequest(request, input?.value);
                                  }} disabled={loading}>אשר והנפק קוד</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    
                    {/* 2. Active Section */}
                    <div className="owner-section-card" style={{ background: "rgba(255,255,255,0.02)", padding: "18px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <h4 style={{ color: "#28a745", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px", margin: "0 0 12px 0" }}>
                        <span>✅</span> מנהלים פעילים במערכת ({adminRequests.filter(r => r.status === "ACTIVE").length})
                      </h4>
                      {adminRequests.filter(r => r.status === "ACTIVE").length === 0 ? (
                        <div className="empty-state compact-empty" style={{ padding: "15px", textAlign: "center", color: "#a0a0a0" }}>אין מנהלים פעילים במערכת.</div>
                      ) : (
                        <div className="admin-request-list" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {adminRequests.filter(r => r.status === "ACTIVE").map((request) => {
                            const subscription = request.subscriptions?.[request.subscriptions.length - 1];
                            const isExpired = subscription?.expiresAt ? new Date(subscription.expiresAt).getTime() < Date.now() : false;
                            const currentExpiry = subscription?.expiresAt ? new Date(subscription.expiresAt).toISOString().split('T')[0] : "";
                            
                            return (
                              <div className={"admin-request-row approved " + (isExpired ? "expired-row" : "")} key={request.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.2)", padding: "12px 16px", borderRadius: "6px", borderRight: isExpired ? "4px solid #ff4d4f" : "4px solid #28a745" }}>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <strong style={{ color: "white" }}>{request.fullName}</strong>
                                    {isExpired ? (
                                      <span style={{ fontSize: "10px", backgroundColor: "#ff4d4f", color: "white", padding: "1px 6px", borderRadius: "4px" }}>רישיון פג</span>
                                    ) : (
                                      <span style={{ fontSize: "10px", backgroundColor: "#28a745", color: "white", padding: "1px 6px", borderRadius: "4px" }}>פעיל</span>
                                    )}
                                  </div>
                                  <span style={{ fontSize: "13px", color: "#e3e3e3", display: "block", marginTop: "2px" }}>
                                    {request.organization} · {request.phone} · {request.email}
                                  </span>
                                  <small style={{ display: "block", color: "#a0a0a0", marginTop: "4px" }}>
                                    קוד גישה: {request.passcode ? (
                                      <b style={{ color: "#ffc107", cursor: "pointer" }} onClick={() => { navigator.clipboard.writeText(request.passcode || ""); alert("קוד הגישה הועתק!"); }} title="לחץ להעתקה">{request.passcode} (לחץ להעתקה)</b>
                                    ) : (
                                      <span style={{ color: "#888", fontStyle: "italic" }}>מוצפן ומאובטח (SHA-256)</span>
                                    )} · אישור: {request.approvedAt ? new Date(request.approvedAt).toLocaleDateString("he-IL") : "-"}
                                  </small>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <label style={{ fontSize: "12px", color: "#a0a0a0" }}>תאריך תפוגה:</label>
                                    <input type="date" id={`expiry-edit-${request.id}`} defaultValue={currentExpiry} style={{ background: "#252535", color: "white", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", padding: "4px 8px", fontSize: "12px" }} />
                                  </div>
                                  <div style={{ display: "flex", gap: "8px" }}>
                                    <button type="button" className="btn-secondary" style={{ padding: "6px 12px", fontSize: "12px", backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }} onClick={() => {
                                      const input = document.getElementById(`expiry-edit-${request.id}`) as HTMLInputElement | null;
                                      if (input?.value) {
                                        updateAdminExpiry(request.id, input.value);
                                      }
                                    }} disabled={loading}>עדכן תפוגה</button>
                                    <button type="button" className="btn-secondary" style={{ padding: "6px 12px", fontSize: "12px", backgroundColor: "rgba(255, 77, 79, 0.1)", border: "1px solid rgba(255, 77, 79, 0.2)", color: "#ff4d4f" }} onClick={() => resetAdminPasscode(request.id, request.fullName)} disabled={loading}>אפס סיסמה</button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="sheet-actions" style={{ marginTop: "15px" }}>
                    <a href={API_URL + "/api/admins/registration-requests.csv?passcode=" + encodeURIComponent(sessionStorage.getItem("admin_passcode") || passcode)} target="_blank" rel="noreferrer">
                      הורד רשימת נרשמים CSV
                    </a>
                  </div>
                </div>
              )}
              <div className="settings-section call-status-settings">
                <div className="settings-section-title"><h3>אפשרויות סימון לאחר שיחה</h3><button type="button" onClick={resetCallStatusOptions}>איפוס לברירת מחדל</button></div>
                <p>אפשר לשנות את שם הכפתורים ולהסתיר אפשרות שאינה בשימוש. המשמעות המערכתית נשארת קבועה כדי שהדוחות והסבבים החוזרים יישארו מסודרים.</p>
                <div className="status-settings-list">
                  {callStatusOptions.map((option) => <div className="status-setting-row" key={option.id}><label className="status-toggle"><input type="checkbox" checked={option.active} onChange={(e) => updateCallStatusOption(option.id, { active: e.target.checked })} /><span>פעיל</span></label><input value={option.label} maxLength={40} onChange={(e) => updateCallStatusOption(option.id, { label: e.target.value })} /><span className={"status-preview " + option.className}>{option.label || "ללא שם"}</span></div>)}
                </div>
              </div>
              {settingsSaved && <div className="result-banner success">ההגדרות נשמרו.</div>}
              <button type="submit" className="btn-primary" disabled={loading}>שמור הגדרות</button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("caller") === "1") return <CallerApp />;
  return <AdminApp />;
}
