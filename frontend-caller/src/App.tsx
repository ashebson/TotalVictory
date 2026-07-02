import React, { useEffect, useState } from "react";
import "./App.css";

const PUBLIC_API_URL = "https://total-victory.onrender.com";
const LOCAL_API_URL = window.location.protocol + "//" + window.location.hostname + ":5001";
const API_URL = (import.meta.env.VITE_API_URL || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? LOCAL_API_URL : PUBLIC_API_URL)).replace(/\/$/, "");

type Project = {
  id: number;
  name: string;
  stats?: { total: number; pending: number; totalCalled: number; success: number };
};

type Caller = {
  id: number;
  name: string;
  phone: string;
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
  const [whatsappTemplate, setWhatsappTemplate] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    if (caller && selectedProject) fetchNextContact();
  }, [caller, selectedProject]);

  const fetchSettings = async () => {
    try {
      const res = await fetch(API_URL + "/api/settings");
      if (res.ok) {
        const settings = await res.json();
        setWhatsappTemplate(settings.whatsapp_template || "");
      }
    } catch {
      // UI can still work without a WhatsApp template.
    }
  };

  const refreshProjects = async (callerId: number) => {
    try {
      const res = await fetch(API_URL + "/api/callers/" + callerId + "/projects");
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
      const res = await fetch(API_URL + "/api/contacts/next?callerId=" + caller.id + "&projectId=" + selectedProject.id);
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
  };

  const triggerSwipe = (_direction: "right") => {
    if (isAnimating || !currentContact) return;
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
        headers: { "Content-Type": "application/json" },
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

  const getWhatsAppLink = () => {
    if (!currentContact) return "#";
    const text = whatsappTemplate.replace(/{name}/g, currentContact.name);
    let phone = currentContact.phone.replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "972" + phone.substring(1);
    return "https://api.whatsapp.com/send?phone=" + phone + "&text=" + encodeURIComponent(text);
  };

  if (!caller) {
    return (
      <div className="login-container">
        <form className="login-card card-enter-anim" onSubmit={handleLogin}>
          <div className="logo-section">
            <span className="logo-badge">פריימריז 2026</span>
            <h1>מטה עמית הלוי</h1>
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
        <button onClick={() => setSelectedProject(null)} className="btn-logout">פרויקט</button>
      </header>
      <main className="app-main">
        {errorMsg && <div className="error-banner">{errorMsg}</div>}
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
                    <button type="button" onClick={() => setStatusSelection("SUCCESS")} className={"status-btn success " + (statusSelection === "SUCCESS" ? "active" : "")}>שיחה מוצלחת</button>
                    <button type="button" onClick={() => setStatusSelection("NOT_INTERESTED")} className={"status-btn no-interest " + (statusSelection === "NOT_INTERESTED" ? "active" : "")}>לא מעוניין</button>
                    <button type="button" onClick={() => setStatusSelection("NO_ANSWER")} className={"status-btn no-answer " + (statusSelection === "NO_ANSWER" ? "active" : "")}>אין מענה</button>
                    <button type="button" onClick={() => setStatusSelection("INVALID_NUMBER")} className={"status-btn invalid " + (statusSelection === "INVALID_NUMBER" ? "active" : "")}>מספר שגוי</button>
                  </div></div>
                  <div className="call-notes-section">
                    <label htmlFor="callNotes">הערת טלפן קצרה:</label>
                    <textarea id="callNotes" rows={3} maxLength={500} value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="לדוגמה: ביקש לחזור בערב, תומך אך רוצה תזכורת..." />
                    <span>{callNotes.length}/500</span>
                  </div>
                  {statusSelection === "SUCCESS" && <a href={getWhatsAppLink()} target="_blank" rel="noopener noreferrer" className="btn-whatsapp">שלח הודעת וואטסאפ</a>}
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
