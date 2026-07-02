import React, { useEffect, useState } from "react";
import "./App.css";

const PUBLIC_API_URL = "https://total-victory.onrender.com";
const LOCAL_API_URL = window.location.protocol + "//" + window.location.hostname + ":5001";
const API_URL = (import.meta.env.VITE_API_URL || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? LOCAL_API_URL : PUBLIC_API_URL)).replace(/\/$/, "");

type Tab = "dashboard" | "projects" | "settings";
type Summary = { total: number; pending: number; success: number; notInterested: number; noAnswer: number; invalidNumber: number; totalCalled: number };
type Caller = { id: number; name: string; phone?: string; totalCalls?: number; successCalls?: number; successRate?: number; lastCallTime?: string | null; projects?: Project[] };
type Project = { id: number; name: string; sourceFileName?: string | null; createdAt: string; stats: Summary; callers: Caller[] };
type PendingAdmin = { id: number; fullName: string; email: string; phone: string; organization: string; status: string; createdAt: string };

const emptySummary: Summary = { total: 0, pending: 0, success: 0, notInterested: 0, noAnswer: 0, invalidNumber: 0, totalCalled: 0 };

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState(() => sessionStorage.getItem("admin_passcode") || "");
  const [passcodeError, setPasscodeError] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [registerForm, setRegisterForm] = useState({ fullName: "", email: "", phone: "", organization: "", planId: "monthly" });
  const [registrationRequest, setRegistrationRequest] = useState<{ message: string; whatsappUrl: string } | null>(null);
  const [approvedAdminPasscode, setApprovedAdminPasscode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [callers, setCallers] = useState<Caller[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pendingAdmins, setPendingAdmins] = useState<PendingAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [callerPhoneInputs, setCallerPhoneInputs] = useState<Record<number, string>>({});
  const [settings, setSettings] = useState({ win_percentage: "74.8", target_calls: "5000", polymarket_url: "https://polymarket.com", whatsapp_template: "" });
  const [settingsSaved, setSettingsSaved] = useState(false);

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
    setPendingAdmins(data.pendingAdmins || []);
  };

  const fetchSettings = async () => {
    const res = await fetch(API_URL + "/api/settings", { headers: getAdminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setSettings({ win_percentage: data.win_percentage || "74.8", target_calls: data.target_calls || "5000", polymarket_url: data.polymarket_url || "https://polymarket.com", whatsapp_template: data.whatsapp_template || "" });
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
      setRegistrationRequest({ message: data.message || "בקשת ההרשמה נקלטה.", whatsappUrl: data.whatsappUrl || "" });
      if (data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
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

  const approveAdmin = async (adminId: number) => {
    setLoading(true);
    setApprovedAdminPasscode(null);
    try {
      const res = await fetch(API_URL + "/api/admins/" + adminId + "/approve", { method: "POST", headers: getAdminHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "approval failed");
      setApprovedAdminPasscode(data.passcode);
      if (data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
      fetchData();
    } catch {
      alert("לא ניתן לאשר את הבקשה כרגע.");
    } finally {
      setLoading(false);
    }
  };


  const deleteProject = async (project: Project) => {
    if (!window.confirm("למחוק את הפרויקט \"" + project.name + "\" וכל נתוני השיחות שלו?")) return;
    setLoading(true);
    try {
      await fetch(API_URL + "/api/projects/" + project.id, { method: "DELETE", headers: getAdminHeaders() });
      fetchData();
    } finally {
      setLoading(false);
    }
  };

  const seedDemo = async () => { setLoading(true); try { await fetch(API_URL + "/api/contacts/seed", { method: "POST", headers: getAdminHeaders() }); fetchData(); } finally { setLoading(false); } };

  const csvExportUrl = (project: Project) => API_URL + "/api/projects/" + project.id + "/export.csv?passcode=" + encodeURIComponent(sessionStorage.getItem("admin_passcode") || passcode);
  const xlsxExportUrl = (project: Project) => API_URL + "/api/projects/" + project.id + "/export.xlsx?passcode=" + encodeURIComponent(sessionStorage.getItem("admin_passcode") || passcode);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(API_URL + "/api/settings", { method: "POST", headers: getAdminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ settings }) });
      if (res.ok) { setSettingsSaved(true); window.setTimeout(() => setSettingsSaved(false), 2500); }
    } finally { setLoading(false); }
  };

  if (!isAuthenticated) return (
    <div className="auth-page auth-page-clean">
      <section className="auth-shell auth-shell-compact card-enter-anim" dir="rtl">
        <header className="auth-brand">
          <span className="auth-eyebrow">מטה דיגיטלי</span>
          <h1>פורום הניצחון בליכוד בראשות ח״כ עמית הלוי</h1>
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
              <div className="payment-note">בסיום ההרשמה תיפתח הודעת וואטסאפ אל מנהל המערכת. לאחר העברה בנקאית יישלח אליך קוד גישה בוואטסאפ.</div>
              {registrationRequest && <div className="result-banner success"><strong>{registrationRequest.message}</strong>{registrationRequest.whatsappUrl && <a className="btn-secondary-auth" href={registrationRequest.whatsappUrl} target="_blank" rel="noreferrer">שליחת וואטסאפ</a>}</div>}
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
        <div className="sidebar-header"><h2>מטה עמית הלוי</h2><span>מערכת טלפנים</span></div>
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
            <div className="stats-grid">
              <div className="stat-card"><span className="stat-label">סה"כ רשומות</span><span className="stat-number">{summary.total}</span></div>
              <div className="stat-card success-glow"><span className="stat-label">שיחות מוצלחות</span><span className="stat-number">{summary.success}</span></div>
              <div className="stat-card"><span className="stat-label">ממתינים</span><span className="stat-number">{summary.pending}</span></div>
              <div className="stat-card progress-glow"><span className="stat-label">התקדמות</span><span className="stat-number">{summary.total ? Math.round((summary.totalCalled / summary.total) * 100) : 0}%</span><span className="stat-sub">{summary.totalCalled} מתוך {summary.total}</span></div>
            </div>
            {pendingAdmins.length > 0 && (
              <div className="table-card"><div className="table-card-header"><h2>בקשות מנהלים לאישור</h2></div>
                {approvedAdminPasscode && <div className="result-banner success">הבקשה אושרה. קוד הגישה: <strong>{approvedAdminPasscode}</strong></div>}
                <div className="table-responsive"><table className="admin-table"><thead><tr><th>שם</th><th>ארגון</th><th>טלפון</th><th>אימייל</th><th>פעולה</th></tr></thead><tbody>{pendingAdmins.map((admin) => <tr key={admin.id}><td>{admin.fullName}</td><td>{admin.organization}</td><td>{admin.phone}</td><td>{admin.email}</td><td><button type="button" className="table-action-btn" onClick={() => approveAdmin(admin.id)} disabled={loading}>אשר ושלח קוד</button></td></tr>)}</tbody></table></div>
              </div>
            )}
            <div className="table-card"><div className="table-card-header"><h2>טלפנים פעילים</h2></div>
              {callers.length === 0 ? <div className="empty-state">אין טלפנים פעילים כרגע.</div> : <div className="table-responsive"><table className="admin-table"><thead><tr><th>טלפן</th><th>טלפון</th><th>שיחות</th><th>הצלחות</th><th>פרויקטים</th><th>שיחה אחרונה</th></tr></thead><tbody>{callers.map((caller) => <tr key={caller.id}><td className="caller-name-cell"><span className="avatar-small">{caller.name[0]}</span>{caller.name}</td><td>{caller.phone || "-"}</td><td>{caller.totalCalls || 0}</td><td className="success-cell">{caller.successCalls || 0}</td><td>{caller.projects?.map((project) => project.name).join(", ") || "-"}</td><td className="time-cell">{caller.lastCallTime ? new Date(caller.lastCallTime).toLocaleString("he-IL") : "-"}</td></tr>)}</tbody></table></div>}
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
              {projects.length === 0 ? <div className="empty-state">עדיין אין פרויקטים. העלה קובץ כדי להתחיל.</div> : projects.map((project) => (
                <section className="project-card" key={project.id}>
                  <div className="project-card-header"><div><h2>{project.name}</h2><span>{project.sourceFileName || "קובץ מקומי"}</span></div><div className="project-card-actions"><strong>{project.stats.total} רשומות</strong><button type="button" onClick={() => deleteProject(project)}>מחק</button></div></div>
                  <div className="project-stats-row"><span>ממתינים: {project.stats.pending}</span><span>בוצעו: {project.stats.totalCalled}</span><span>הצלחות: {project.stats.success}</span></div>
                  <div className="sheet-link-box"><div className="sheet-actions"><a href={csvExportUrl(project)} target="_blank" rel="noreferrer">פתח CSV מתעדכן</a><a href={xlsxExportUrl(project)} target="_blank" rel="noreferrer">הורד XLSX מתעדכן</a></div><small>שתי האפשרויות כוללות את כל עמודות האקסל המקורי, ובסוף סטטוס, הערות ותאריך שיחה אחרונה.</small></div>
                  <div className="assign-box"><label>שיוך טלפן לפרויקט לפי מספר טלפון בלבד</label><div className="assign-row assign-row-wide"><input value={callerPhoneInputs[project.id] || ""} onChange={(e) => setCallerPhoneInputs((prev) => ({ ...prev, [project.id]: e.target.value }))} placeholder="מספר טלפון של הטלפן" /><button type="button" onClick={() => assignCaller(project.id)} disabled={loading || !callerPhoneInputs[project.id]?.trim()}>שייך</button></div></div>
                  <div className="caller-chip-list">{project.callers.length === 0 ? <span className="muted-text">אין טלפנים משויכים</span> : project.callers.map((caller) => <button key={caller.id} type="button" className="caller-chip" onClick={() => unassignCaller(project.id, caller.id)} title="הסר שיוך">{caller.name || "טרם הזדהה"} · {caller.phone} ×</button>)}</div>
                </section>
              ))}
            </div>
          </div>
        )}
        {activeTab === "settings" && (
          <div className="tab-pane card-enter-anim"><div className="pane-header"><h1>הגדרות</h1><p>הגדרות כלליות של הודעות ותצוגת הקמפיין.</p></div><form onSubmit={handleSaveSettings} className="settings-form"><div className="settings-section"><h3>תבנית הודעת וואטסאפ</h3><textarea rows={4} value={settings.whatsapp_template} onChange={(e) => setSettings({ ...settings, whatsapp_template: e.target.value })} placeholder="שלום {name}..." /></div><div className="settings-section-row"><div className="settings-field"><label>אחוז זכייה התחלתי</label><input type="number" value={settings.win_percentage} onChange={(e) => setSettings({ ...settings, win_percentage: e.target.value })} /></div><div className="settings-field"><label>יעד שיחות</label><input type="number" value={settings.target_calls} onChange={(e) => setSettings({ ...settings, target_calls: e.target.value })} /></div></div><div className="settings-section"><label>כתובת Polymarket</label><input value={settings.polymarket_url} onChange={(e) => setSettings({ ...settings, polymarket_url: e.target.value })} /></div>{settingsSaved && <div className="result-banner success">ההגדרות נשמרו.</div>}<button type="submit" className="btn-primary" disabled={loading}>שמור הגדרות</button></form></div>
        )}
      </main>
    </div>
  );
}
