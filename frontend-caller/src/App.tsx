import React, { useEffect, useState } from "react";
import "./App.css";

// Vercel build trigger - 2026-07-02 17:41
const PUBLIC_API_URL = "https://total-victory.onrender.com";
const LOCAL_API_URL = window.location.protocol + "//" + window.location.hostname + ":5001";
const API_URL = (import.meta.env.VITE_API_URL || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? LOCAL_API_URL : PUBLIC_API_URL)).replace(/\/$/, "");
const DEFAULT_WHATSAPP_TEMPLATE = "שלום {שם פרטי}, דיברנו עכשיו בטלפון. נשמח לתמיכתך במועמד/ת במסגרת מערכת הבחירות. ביחד נצליח!";

type Project = {
  id: number;
  name: string;
  stats?: { total: number; pending: number; totalCalled: number; success: number };
};

type Caller = {
  id: number;
  name: string;
  phone: string;
  whatsappTemplate?: string | null;
  projects?: Project[];
};

type Contact = {
  id: number;
  name: string;
  phone: string;
  city?: string;
  sector?: string;
  familySize?: number;
  notes?: string;
  status: string;
};

type CallStatusOption = { id: string; label: string; active: boolean; className: string };

const defaultCallStatusOptions: CallStatusOption[] = [
  { id: "SUCCESS", label: "שיחה מוצלחת", active: true, className: "success" },
  { id: "NOT_INTERESTED", label: "לא מעוניין", active: true, className: "no-interest" },
  { id: "NO_ANSWER", label: "אין מענה", active: true, className: "no-answer" },
  { id: "INVALID_NUMBER", label: "מספר שגוי", active: true, className: "invalid" },
];

export default function App() {
  const [caller, setCaller] = useState<Caller | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [callerNameInput, setCallerNameInput] = useState("");
  const [callerPhoneInput, setCallerPhoneInput] = useState("");
  const [currentContact, setCurrentContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSwipedRight, setIsSwipedRight] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [feedTransition, setFeedTransition] = useState<"idle" | "exit" | "enter">("idle");
  const [statusSelection, setStatusSelection] = useState<string | null>(null);
  const [callNotes, setCallNotes] = useState("");
  const [globalWhatsappTemplate, setGlobalWhatsappTemplate] = useState(DEFAULT_WHATSAPP_TEMPLATE);
  const [campaignName, setCampaignName] = useState("מטה טלפנים דיגיטלי");
  const [callStatusOptions, setCallStatusOptions] = useState<CallStatusOption[]>(defaultCallStatusOptions);
  const [personalWhatsappTemplate, setPersonalWhatsappTemplate] = useState("");
  const [showTemplateSettings, setShowTemplateSettings] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const getCallerHeaders = (extraHeaders: Record<string, string> = {}) => {
    const saved = localStorage.getItem("total_victory_caller");
    if (!saved) return extraHeaders;
    try {
      const parsed = JSON.parse(saved);
      return parsed.phone ? { ...extraHeaders, "x-caller-phone": parsed.phone } : extraHeaders;
    } catch (e) {
      return extraHeaders;
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("total_victory_caller");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (parsed?.name && parsed?.phone) restoreSession(parsed.name, parsed.phone);
    } catch {
      localStorage.removeItem("total_victory_caller");
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    const interval = window.setInterval(fetchSettings, 30000);
    window.addEventListener("focus", fetchSettings);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", fetchSettings);
    };
  }, []);

  useEffect(() => {
    if (caller && selectedProject) fetchNextContact();
  }, [caller, selectedProject]);

  const fetchSettings = async () => {
    try {
      const res = await fetch(API_URL + "/api/settings");
      if (res.ok) {
        const settings = await res.json();
        setGlobalWhatsappTemplate(settings.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE);
        setCampaignName(settings.campaign_name || "מטה טלפנים דיגיטלי");
        try {
          const parsed = JSON.parse(settings.call_status_options || "[]");
          const byId = new Map(parsed.map((item: CallStatusOption) => [item.id, item]));
          const merged = defaultCallStatusOptions.map((option) => ({ ...option, ...(byId.get(option.id) || {}) }));
          const active = merged.filter((option) => option.active !== false);
          setCallStatusOptions(active.length ? active : defaultCallStatusOptions);
        } catch {
          setCallStatusOptions(defaultCallStatusOptions);
        }
      }
    } catch {
      // UI can still work without remote settings.
    }
  };

  const refreshProjects = async (callerId: number) => {
    try {
      const res = await fetch(API_URL + "/api/callers/" + callerId + "/projects", { headers: getCallerHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data || []);
      const savedProjectId = Number(localStorage.getItem("total_victory_project_id"));
      const savedProject = data.find((project: Project) => project.id === savedProjectId);
      if (savedProject) setSelectedProject(savedProject);
      else if (data.length === 1) chooseProject(data[0]);
    } catch {
      setErrorMsg("לא ניתן לטעון את הפרויקטים המשויכים אליך.");
    }
  };

  const chooseProject = (project: Project) => {
    setSelectedProject(project);
    localStorage.setItem("total_victory_project_id", String(project.id));
    setCurrentContact(null);
    setIsSwipedRight(false);
    setStatusSelection(null);
    setSessionCount(0);
  };

  const fetchNextContact = async (showLoader = true) => {
    if (!caller || !selectedProject) return;
    if (showLoader) setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(API_URL + "/api/contacts/next?callerId=" + caller.id + "&projectId=" + selectedProject.id, { headers: getCallerHeaders() });
      if (res.ok) setCurrentContact(await res.json());
      else if (res.status === 403) setErrorMsg("הפרויקט הזה לא משויך אליך. פנה למנהל לשיוך.");
      else setErrorMsg("שגיאה בטעינת איש קשר. נסה שוב.");
    } catch {
      setErrorMsg("חיבור לשרת נכשל. ודא שהשרת פעיל.");
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  const restoreSession = async (name: string, phone: string) => {
    setLoading(true);
    try {
      const res = await fetch(API_URL + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      if (!res.ok) throw new Error("restore failed");
      const data = await res.json();
      setCaller(data);
      setPersonalWhatsappTemplate(data.whatsappTemplate || "");
      setProjects(data.projects || []);
      localStorage.setItem("total_victory_caller", JSON.stringify({ id: data.id, name: data.name, phone: data.phone }));
      const savedProjectId = Number(localStorage.getItem("total_victory_project_id"));
      const savedProject = (data.projects || []).find((project: Project) => project.id === savedProjectId);
      if (savedProject) setSelectedProject(savedProject);
      else if ((data.projects || []).length === 1) chooseProject(data.projects[0]);
      else setSelectedProject(null);
    } catch {
      localStorage.removeItem("total_victory_caller");
      localStorage.removeItem("total_victory_project_id");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callerNameInput.trim() || !callerPhoneInput.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(API_URL + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: callerNameInput.trim(), phone: callerPhoneInput.trim() }),
      });
      if (!res.ok) throw new Error("login failed");
      const data = await res.json();
      setCaller(data);
      setPersonalWhatsappTemplate(data.whatsappTemplate || "");
      setProjects(data.projects || []);
      localStorage.setItem("total_victory_caller", JSON.stringify({ id: data.id, name: data.name, phone: data.phone }));
      if ((data.projects || []).length === 1) chooseProject(data.projects[0]);
    } catch {
      setErrorMsg("שגיאה בחיבור למערכת.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("total_victory_caller");
    localStorage.removeItem("total_victory_project_id");
    setCaller(null);
    setProjects([]);
    setSelectedProject(null);
    setCurrentContact(null);
    setIsSwipedRight(false);
    setSessionCount(0);
    setShowTemplateSettings(false);
  };

  const saveTemplateSettings = async () => {
    if (!caller) return;
    setLoading(true);
    setTemplateSaved(false);
    try {
      const res = await fetch(API_URL + "/api/callers/" + caller.id + "/settings", {
        method: "POST",
        headers: getCallerHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ whatsappTemplate: personalWhatsappTemplate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setCaller(data.caller);
      setPersonalWhatsappTemplate(data.caller?.whatsappTemplate || "");
      setTemplateSaved(true);
      window.setTimeout(() => setTemplateSaved(false), 2500);
    } catch {
      alert("שגיאה בשמירת הודעת הוואטסאפ האישית.");
    } finally {
      setLoading(false);
    }
  };

  const triggerSwipe = (_direction: "right") => {
    if (isAnimating || !currentContact) return;
    fetchSettings();
    setIsAnimating(true);
    setSwipeDirection("right");
    window.setTimeout(() => {
      setIsSwipedRight(true);
      setIsAnimating(false);
      setSwipeDirection(null);
    }, 250);
  };

  const handleSubmitStatus = async () => {
    if (!currentContact || !caller || !statusSelection || feedTransition !== "idle") return;
    setLoading(true);
    try {
      const res = await fetch(API_URL + "/api/calls", {
        method: "POST",
        headers: getCallerHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ callerId: caller.id, contactId: currentContact.id, status: statusSelection, callNotes }),
      });
      if (!res.ok) throw new Error("save failed");
      setSessionCount((prev) => prev + 1);
      setFeedTransition("exit");
      window.setTimeout(async () => {
        setIsSwipedRight(false);
        setStatusSelection(null);
        setCallNotes("");
        await fetchNextContact(false);
        setFeedTransition("enter");
        window.setTimeout(() => setFeedTransition("idle"), 260);
        setLoading(false);
      }, 230);
    } catch {
      alert("שגיאה בשמירת סטטוס השיחה.");
      setFeedTransition("idle");
      setLoading(false);
    }
  };

  const getFirstName = (fullName: string) => fullName.trim().split(/\s+/)[0] || fullName.trim();

  const buildWhatsAppText = () => {
    if (!currentContact) return "";
    const fullName = currentContact.name;
    const firstName = getFirstName(fullName);
    const template = (personalWhatsappTemplate.trim() || globalWhatsappTemplate || DEFAULT_WHATSAPP_TEMPLATE);
    return template
      .replace(/\{name\}/g, fullName)
      .replace(/\{fullName\}/g, fullName)
      .replace(/\{שם מלא\}/g, fullName)
      .replace(/\{שם\}/g, fullName)
      .replace(/\{firstName\}/g, firstName)
      .replace(/\{שם פרטי\}/g, firstName);
  };

  const getWhatsAppLink = () => {
    if (!currentContact) return "#";
    const text = buildWhatsAppText();
    let phone = currentContact.phone.replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "972" + phone.substring(1);
    return "https://api.whatsapp.com/send?phone=" + phone + "&text=" + encodeURIComponent(text);
  };

  if (!caller) {
    return (
      <div className="login-container">
        <form className="login-card card-enter-anim" onSubmit={handleLogin}>
          <div className="logo-section">
            <span className="logo-badge">מערכת בחירות</span>
            <h1>{campaignName}</h1>
            <h2>מערכת טלפנים חכמה</h2>
          </div>
          {errorMsg && <div className="error-banner">{errorMsg}</div>}
          <div className="input-group">
            <label htmlFor="callerName">שם מלא:</label>
            <input id="callerName" type="text" placeholder="שם מלא..." value={callerNameInput} onChange={(e) => setCallerNameInput(e.target.value)} disabled={loading} required />
          </div>
          <div className="input-group">
            <label htmlFor="callerPhone">מספר טלפון:</label>
            <input id="callerPhone" type="tel" placeholder="0501234567" value={callerPhoneInput} onChange={(e) => setCallerPhoneInput(e.target.value)} disabled={loading} required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading || !callerNameInput.trim() || !callerPhoneInput.trim()}>{loading ? "מתחבר..." : "כניסה למערכת"}</button>
        </form>
      </div>
    );
  }

  if (!selectedProject) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="user-profile"><div className="user-avatar">{caller.name[0]}</div><div><h3>{caller.name}</h3><span className="session-stats">{caller.phone} · בחירת פרויקט</span></div></div>
          <button onClick={handleLogout} className="btn-logout">יציאה</button>
        </header>
        <main className="app-main">
          <div className="project-picker card-enter-anim">
            <h2>בחר פרויקט לעבודה</h2>
            <p>ניתן לעבוד רק על פרויקטים שמנהל המערכת שייך אליך.</p>
            {projects.length === 0 ? (
              <div className="empty-projects">
                <strong>אין פרויקטים משויכים לשם הזה.</strong>
                <span>בקש מהמנהל לשייך אותך לפרויקט במסך הניהול.</span>
                <button onClick={() => refreshProjects(caller.id)} className="btn-refresh">רענן שיוכים</button>
              </div>
            ) : (
              <div className="project-list">
                {projects.map((project) => (
                  <button key={project.id} className="project-option" onClick={() => chooseProject(project)}>
                    <strong>{project.name}</strong>
                    <span>{project.stats?.pending ?? 0} ממתינים מתוך {project.stats?.total ?? 0}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="user-profile">
          <div className="user-avatar">{caller.name[0]}</div>
          <div><h3>{caller.name}</h3><span className="session-stats">{selectedProject.name} · {caller.phone} · שיחות: {sessionCount}</span></div>
        </div>
        <div className="caller-header-actions"><button onClick={() => setShowTemplateSettings((value) => !value)} className="btn-logout">הודעה</button><button onClick={() => setSelectedProject(null)} className="btn-logout">פרויקט</button></div>
      </header>
      <main className="app-main">
        {errorMsg && <div className="error-banner">{errorMsg}</div>}
        {showTemplateSettings && (
          <section className="template-settings card-enter-anim">
            <div><h3>הודעת וואטסאפ אישית</h3><p>התבנית נשמרת לפי מספר הטלפון שלך ומשמשת אחרי שיחה מוצלחת.</p></div>
            <textarea rows={4} maxLength={1000} value={personalWhatsappTemplate} onChange={(e) => setPersonalWhatsappTemplate(e.target.value)} placeholder={DEFAULT_WHATSAPP_TEMPLATE} />
            <small>משתנים זמינים: {"{שם פרטי}"}, {"{שם מלא}"}, {"{name}"}</small>
            {templateSaved && <span className="template-saved">נשמר.</span>}
            <button type="button" onClick={saveTemplateSettings} className="btn-save-template" disabled={loading}>שמור הודעה אישית</button>
          </section>
        )}
        {loading && !currentContact ? (
          <div className="loader-container"><div className="spinner"></div><p>טוען את איש הקשר הבא...</p></div>
        ) : !currentContact ? (
          <div className="no-contacts card-enter-anim"><div className="success-icon">✓</div><h2>סיימנו בפרויקט הזה</h2><p>אין כרגע אנשי קשר נוספים שממתינים לשיחה.</p><button onClick={() => fetchNextContact()} className="btn-refresh">רענן רשימה</button></div>
        ) : (
          <div className={"swiper-viewport feed-transition-" + feedTransition}>
            {!isSwipedRight ? (
              <div className="card-outer-container">
                <div className={"tinder-card feed-panel " + (feedTransition === "enter" ? "feed-enter-down" : "card-enter-anim") + " " + (swipeDirection === "left" ? "swipe-left-anim" : swipeDirection === "right" ? "swipe-right-anim" : "")}>
                  <div className="card-header-badge">{selectedProject.name}</div>
                  <div className="voter-avatar">{currentContact.name[0]}</div>
                  <h2 className="voter-name">{currentContact.name}</h2>
                  <div className="voter-quick-info">
                    {currentContact.city && <div className="info-tag"><span>{currentContact.city}</span></div>}
                    {currentContact.sector && <div className="info-tag"><span>{currentContact.sector}</span></div>}
                  </div>
                  <p className="swipe-instruction">פתח שיחה, סמן תוצאה והמערכת תעבור לבא בתור</p>
                </div>
                <div className="action-buttons"><button onClick={() => triggerSwipe("right")} className="btn-open-call" disabled={isAnimating}>פתח שיחה</button></div>
              </div>
            ) : (
              <div className={"details-card feed-panel " + (feedTransition === "exit" ? "feed-exit-down" : feedTransition === "enter" ? "feed-enter-down" : "card-enter-anim")}>
                <div className="details-header"><button onClick={() => setIsSwipedRight(false)} className="btn-back">חזור</button><h2>פרטי איש קשר</h2></div>
                <div className="details-body">
                  <div className="detail-section"><span className="detail-label">שם:</span><span className="detail-value">{currentContact.name}</span></div>
                  <div className="detail-row">{currentContact.city && <div className="detail-section half"><span className="detail-label">עיר:</span><span className="detail-value">{currentContact.city}</span></div>}{currentContact.sector && <div className="detail-section half"><span className="detail-label">מגזר:</span><span className="detail-value">{currentContact.sector}</span></div>}</div>
                  {currentContact.familySize && <div className="detail-section"><span className="detail-label">נפשות בבית:</span><span className="detail-value">{currentContact.familySize}</span></div>}
                  {currentContact.notes && <div className="detail-section"><span className="detail-label">הערות:</span><div className="detail-notes">{currentContact.notes}</div></div>}
                  <hr className="divider" />
                  <a href={"tel:" + currentContact.phone} className="btn-call-trigger"><span className="phone-icon">☎</span>חייג אל {currentContact.name}<span className="phone-number">{currentContact.phone}</span></a>
                  <div className="status-selector-section"><h3>עדכן תוצאת שיחה:</h3><div className="status-grid">
                    {callStatusOptions.map((option) => <button key={option.id} type="button" onClick={() => setStatusSelection(option.id)} className={"status-btn " + option.className + " " + (statusSelection === option.id ? "active" : "")}>{option.label}</button>)}
                  </div></div>
                  <div className="call-notes-section">
                    <label htmlFor="callNotes">הערת טלפן קצרה <span>(אופציונלי)</span>:</label>
                    <textarea id="callNotes" rows={3} maxLength={500} value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="אפשר להשאיר ריק. לדוגמה: ביקש לחזור בערב, תומך אך רוצה תזכורת..." />
                    <span>{callNotes.length}/500</span>
                  </div>
                  {statusSelection === "SUCCESS" && <><div className="whatsapp-preview"><span>תצוגה מקדימה:</span><p>{buildWhatsAppText()}</p></div><a href={getWhatsAppLink()} target="_blank" rel="noopener noreferrer" className="btn-whatsapp">שלח הודעת וואטסאפ</a></>}
                  <button onClick={handleSubmitStatus} className="btn-submit-call" disabled={!statusSelection || loading || feedTransition !== "idle"}>{loading ? "מעביר לבא בתור..." : "שמור והמשך לשיחה הבאה"}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
