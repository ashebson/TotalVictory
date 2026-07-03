import React, { useEffect, useState } from "react";
import "./App.css";

// Vercel build trigger - 2026-07-02 17:41
const PUBLIC_API_URL = "https://total-victory.onrender.com";
const LOCAL_API_URL = window.location.protocol + "//" + window.location.hostname + ":5001";
const API_URL = (import.meta.env.VITE_API_URL || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? LOCAL_API_URL : PUBLIC_API_URL)).replace(/\/$/, "");

type Tab = "dashboard" | "projects" | "settings";
type Summary = { total: number; pending: number; success: number; notInterested: number; noAnswer: number; invalidNumber: number; totalCalled: number };
type Caller = { id: number; name: string; phone?: string; totalCalls?: number; successCalls?: number; successRate?: number; lastCallTime?: string | null; projects?: Project[] };
type Project = { id: number; name: string; sourceFileName?: string | null; createdAt: string; stats: Summary; callers: Caller[]; archived?: boolean };
type CallStatusOption = { id: string; label: string; active: boolean; className: string };
type AdminRequest = { id: number; fullName: string; email: string; phone: string; organization: string; status: string; createdAt: string; approvedAt?: string | null; passcode?: string; subscriptions?: { planId?: string; status?: string }[] };

const defaultCallStatusOptions: CallStatusOption[] = [
  { id: "SUCCESS", label: "שיחה מוצלחת", active: true, className: "success" },
  { id: "NOT_INTERESTED", label: "לא מעוניין", active: true, className: "no-interest" },
  { id: "NO_ANSWER", label: "אין מענה", active: true, className: "no-answer" },
  { id: "INVALID_NUMBER", label: "מספר שגוי", active: true, className: "invalid" },
];


const emptySummary: Summary = { total: 0, pending: 0, success: 0, notInterested: 0, noAnswer: 0, invalidNumber: 0, totalCalled: 0 };

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState(() => sessionStorage.getItem("admin_passcode") || "");
  const [passcodeError, setPasscodeError] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [registerForm, setRegisterForm] = useState({ fullName: "", email: "", phone: "", organization: "", planId: "monthly" });
  const [registrationRequest, setRegistrationRequest] = useState<{ message: string } | null>(null);
  const [adminRequests, setAdminRequests] = useState<AdminRequest[]>([]);
  const [approvedAdmin, setApprovedAdmin] = useState<{ name: string; passcode: string; whatsappUrl?: string } | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [callers, setCallers] = useState<Caller[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [callerPhoneInputs, setCallerPhoneInputs] = useState<Record<number, string>>({});
  const [settings, setSettings] = useState({ campaign_name: "מטה טלפנים דיגיטלי", target_calls: "5000", whatsapp_template: "" });
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
    return () => window.clearInterval(interval);
  }, [isAuthenticated]);

  const fetchData = async () => {
    const res = await fetch(API_URL + "/api/stats/admin", { headers: getAdminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setSummary(data.summary || emptySummary);
    setCallers(data.callers || []);
    setProjects(data.projects || []);

  };

  const fetchAdminRequests = async () => {
    if (!isOwner) return;
    const res = await fetch(API_URL + "/api/admins/registration-requests", { headers: getAdminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setAdminRequests(Array.isArray(data) ? data : []);
  };

  const fetchSettings = async () => {
    const res = await fetch(API_URL + "/api/settings", { headers: getAdminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setSettings({ campaign_name: data.campaign_name || "מטה טלפנים דיגיטלי", target_calls: data.target_calls || "5000", whatsapp_template: data.whatsapp_template || "" });
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
    try {
      const res = await fetch(API_URL + "/api/admins/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) throw new Error("invalid");
      setIsAuthenticated(true);
      sessionStorage.setItem("admin_authenticated", "true");
      sessionStorage.setItem("admin_passcode", passcode);
    } catch {
      setPasscodeError(true);
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

  const seedDemo = async () => { setLoading(true); try { await fetch(API_URL + "/api/contacts/seed", { method: "POST", headers: getAdminHeaders() }); fetchData(); } finally { setLoading(false); } };

  const csvExportUrl = (project: Project) => API_URL + "/api/projects/" + project.id + "/export.csv?passcode=" + encodeURIComponent(sessionStorage.getItem("admin_passcode") || passcode);
  const xlsxExportUrl = (project: Project) => API_URL + "/api/projects/" + project.id + "/export.xlsx?passcode=" + encodeURIComponent(sessionStorage.getItem("admin_passcode") || passcode);

  const approveAdminRequest = async (request: AdminRequest) => {
    const approved = window.confirm("לאשר את " + request.fullName + " כמנהל פעיל וליצור לו קוד גישה?");
    if (!approved) return;
    setLoading(true);
    setApprovedAdmin(null);
    try {
      const res = await fetch(API_URL + "/api/admins/" + request.id + "/approve", { method: "POST", headers: getAdminHeaders() });
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

  if (!isAuthenticated) return (
    <div className="auth-page auth-page-clean">
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
              <button type="submit" className="btn-primary">כניסה לניהול</button>
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
              <div className="input-group"><label>מסלול</label><select value={registerForm.planId} onChange={(e) => setRegisterForm({ ...registerForm, planId: e.target.value })}><option value="monthly">חודשי - 199 ש"ח</option><option value="annual">שנתי - 1,990 ש"ח</option></select></div>
              <div className="payment-note">בסיום ההרשמה הבקשה נשלחת לבדיקה פרטית של בעל המערכת. לאחר אישור התשלום יישלח אליך קוד גישה בצורה מסודרת.</div>
              {registrationRequest && <div className="result-banner success"><strong>{registrationRequest.message}</strong></div>}
              <button type="submit" className="btn-primary" disabled={loading}>{loading ? "שולח בקשה..." : "שליחת בקשת הצטרפות"}</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );

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

            <section className="insight-card project-progress-card">
              <div className="insight-header"><h2>התקדמות פרויקטים</h2><span>{activeProjects.length} פרויקטים</span></div>
              {topProjects.length === 0 ? <div className="empty-state">אין עדיין פרויקטים להצגה.</div> : <div className="project-progress-list">{topProjects.map((project) => { const done = percent(project.stats.totalCalled, project.stats.total); return <div className="project-progress-row" key={project.id}><div><strong>{project.name}</strong><span>{project.stats.totalCalled} מתוך {project.stats.total}</span></div><div className="wide-progress"><span style={{ width: done + "%" }}></span></div><b>{done}%</b></div>; })}</div>}
            </section>

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
                  <div className="sheet-link-box"><div className="sheet-actions"><a href={csvExportUrl(project)} target="_blank" rel="noreferrer">פתח CSV מתעדכן</a><a href={xlsxExportUrl(project)} target="_blank" rel="noreferrer">הורד XLSX מתעדכן</a></div><small>קישור הייצוא נשמר גם אחרי העברה לארכיון, כולל כל הסטטוסים והערות הטלפנים.</small></div>
                  <div className="assign-box"><label>שיוך טלפן לפרויקט לפי מספר טלפון בלבד</label><div className="assign-row assign-row-wide"><input value={callerPhoneInputs[project.id] || ""} onChange={(e) => setCallerPhoneInputs((prev) => ({ ...prev, [project.id]: e.target.value }))} placeholder="מספר טלפון של הטלפן" /><button type="button" onClick={() => assignCaller(project.id)} disabled={loading || !callerPhoneInputs[project.id]?.trim()}>שייך</button></div></div>
                  <div className="caller-chip-list">{project.callers.length === 0 ? <span className="muted-text">אין טלפנים משויכים</span> : project.callers.map((caller) => <button key={caller.id} type="button" className="caller-chip" onClick={() => unassignCaller(project.id, caller.id)} title="הסר שיוך">{caller.name || "טרם הזדהה"} · {caller.phone} ×</button>)}</div>
                </section>
              ))}
            </div>
            {archivedProjects.length > 0 && <section className="archived-projects-card"><div className="table-card-header"><h2>ארכיון פרויקטים</h2><span>הנתונים נשמרים ואפשר לשחזר בכל רגע</span></div>{archivedProjects.map((project) => <div className="archived-project-row" key={project.id}><div><strong>{project.name}</strong><span>{project.stats.total} רשומות · {project.stats.totalCalled} שיחות שבוצעו</span></div><div className="sheet-actions"><a href={xlsxExportUrl(project)} target="_blank" rel="noreferrer">הורד גיבוי XLSX</a><button type="button" onClick={() => restoreProject(project)} disabled={loading}>שחזר</button></div></div>)}</section>}
          </div>
        )}
        {activeTab === "settings" && (
          <div className="tab-pane card-enter-anim">
            <div className="pane-header"><h1>הגדרות</h1><p>הגדרות כלליות של שם המטה, הודעות, תצוגה וסימוני שיחה.</p></div>
            <form onSubmit={handleSaveSettings} className="settings-form">
              <div className="settings-section"><label>שם המטה / הפרויקט</label><input value={settings.campaign_name} onChange={(e) => setSettings({ ...settings, campaign_name: e.target.value })} placeholder="מטה טלפנים דיגיטלי" /></div>
              <div className="settings-section"><h3>תבנית הודעת וואטסאפ</h3><textarea rows={4} value={settings.whatsapp_template} onChange={(e) => setSettings({ ...settings, whatsapp_template: e.target.value })} placeholder="שלום {name}..." /></div>
              <div className="settings-section"><label>יעד שיחות</label><input type="number" value={settings.target_calls} onChange={(e) => setSettings({ ...settings, target_calls: e.target.value })} /></div>

              {isOwner && <div className="settings-section admin-requests-panel"><div className="settings-section-title"><h3>רישום מנהלים</h3><button type="button" onClick={fetchAdminRequests}>רענן</button></div><p>כאן נשמר יומן מלא של כל מי שנרשם: ממתינים, מאושרים, תאריך הרשמה, תאריך אישור וקוד הגישה.</p>{approvedAdmin && <div className="result-banner success"><strong>{approvedAdmin.name} אושר.</strong><div>קוד גישה: <b>{approvedAdmin.passcode}</b></div>{approvedAdmin.whatsappUrl && <a href={approvedAdmin.whatsappUrl} target="_blank" rel="noreferrer">פתח הודעת וואטסאפ מוכנה</a>}</div>}{adminRequests.length === 0 ? <div className="empty-state compact-empty">אין עדיין נרשמים במערכת.</div> : <div className="admin-request-list">{adminRequests.map((request) => { const subscription = request.subscriptions?.[request.subscriptions.length - 1]; const isApproved = request.status === "ACTIVE"; return <div className={"admin-request-row " + (isApproved ? "approved" : "pending")} key={request.id}><div><strong>{request.fullName}</strong><span>{request.organization} · {request.phone} · {request.email}</span><small>סטטוס: {isApproved ? "אושר" : "ממתין"} · מסלול: {subscription?.planId || "monthly"} · הרשמה: {request.createdAt ? new Date(request.createdAt).toLocaleString("he-IL") : "-"}</small><small>אישור: {request.approvedAt ? new Date(request.approvedAt).toLocaleString("he-IL") : "-"} · קוד גישה: {request.passcode || "-"}</small></div>{isApproved ? <span className="approved-badge">אושר</span> : <button type="button" onClick={() => approveAdminRequest(request)} disabled={loading}>אשר מנהל</button>}</div>; })}</div>}<div className="sheet-actions"><a href={API_URL + "/api/admins/registration-requests.csv?passcode=" + encodeURIComponent(sessionStorage.getItem("admin_passcode") || passcode)} target="_blank" rel="noreferrer">הורד רשימת נרשמים CSV</a></div></div>}
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
