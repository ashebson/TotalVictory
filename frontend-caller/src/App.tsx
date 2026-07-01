import React, { useState, useEffect } from "react";
import "./App.css";

const API_URL = window.location.protocol + "//" + window.location.hostname + ":5001";

interface Caller {
  id: number;
  name: string;
}

interface Contact {
  id: number;
  name: string;
  phone: string;
  city?: string;
  sector?: string;
  familySize?: number;
  notes?: string;
  status: string;
}

export default function App() {
  const [caller, setCaller] = useState<Caller | null>(null);
  const [callerNameInput, setCallerNameInput] = useState("");
  const [currentContact, setCurrentContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSwipedRight, setIsSwipedRight] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [statusSelection, setStatusSelection] = useState<string | null>(null);
  const [whatsappTemplate, setWhatsappTemplate] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load caller from localStorage
  useEffect(() => {
    const savedCaller = localStorage.getItem("total_victory_caller");
    if (savedCaller) {
      try {
        const parsed = JSON.parse(savedCaller);
        setCaller(parsed);
      } catch (e) {
        localStorage.removeItem("total_victory_caller");
      }
    }
  }, []);

  // Fetch next contact when caller changes
  useEffect(() => {
    if (caller) {
      fetchNextContact();
      fetchSettings();
    }
  }, [caller]);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings`);
      if (res.ok) {
        const settings = await res.json();
        setWhatsappTemplate(settings.whatsapp_template || "");
      }
    } catch (err) {
      console.error("Error fetching settings:", err);
    }
  };

  const fetchNextContact = async () => {
    if (!caller) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/contacts/next?callerId=${caller.id}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentContact(data);
      } else {
        setErrorMsg("שגיאה בטעינת איש קשר. נסה שנית.");
      }
    } catch (err) {
      setErrorMsg("חיבור לשרת נכשל. ודא שהשרת פעיל.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callerNameInput.trim()) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: callerNameInput.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        setCaller(data);
        localStorage.setItem("total_victory_caller", JSON.stringify(data));
      } else {
        setErrorMsg("התחברות נכשלה. נסה שם אחר.");
      }
    } catch (err) {
      setErrorMsg("שגיאה בחיבור לשרת.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("total_victory_caller");
    setCaller(null);
    setCurrentContact(null);
    setIsSwipedRight(false);
    setSessionCount(0);
  };

  const triggerSwipe = (direction: "left" | "right") => {
    if (isAnimating || !currentContact) return;

    setIsAnimating(true);
    setSwipeDirection(direction);

    setTimeout(async () => {
      if (direction === "right") {
        // Swiped Right: Show details and actions
        setIsSwipedRight(true);
        setIsAnimating(false);
        setSwipeDirection(null);
      } else {
        // Swiped Left: Skip
        try {
          await fetch(`${API_URL}/api/contacts/skip`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contactId: currentContact.id,
              callerId: caller?.id,
            }),
          });
        } catch (e) {
          console.error("Error skipping contact:", e);
        }

        // Fetch next contact
        fetchNextContact();
        setIsAnimating(false);
        setSwipeDirection(null);
      }
    }, 400); // matches animation length
  };

  const handleSubmitStatus = async () => {
    if (!currentContact || !caller || !statusSelection) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerId: caller.id,
          contactId: currentContact.id,
          status: statusSelection,
        }),
      });

      if (res.ok) {
        setSessionCount((prev) => prev + 1);
        // Reset state for next card
        setIsSwipedRight(false);
        setStatusSelection(null);
        fetchNextContact();
      } else {
        alert("שגיאה בשמירת הסטטוס. נסה שנית.");
      }
    } catch (err) {
      alert("שגיאה בחיבור לשרת בעת שמירת סטטוס.");
    } finally {
      setLoading(false);
    }
  };

  const getWhatsAppLink = () => {
    if (!currentContact) return "#";
    // Replace {name} inside the template with the contact's name
    const text = whatsappTemplate.replace(/{name}/g, currentContact.name);
    // Format phone: must be in international format without leading zero
    let formattedPhone = currentContact.phone.replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "972" + formattedPhone.substring(1);
    }
    return `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(text)}`;
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
            <label htmlFor="callerName">הכנס שם טלפן להתחברות:</label>
            <input
              type="text"
              id="callerName"
              placeholder="שם מלא..."
              value={callerNameInput}
              onChange={(e) => setCallerNameInput(e.target.value)}
              disabled={loading}
              required
            />
          </div>
          
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "מתחבר..." : "כניסה למערכת"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="user-profile">
          <div className="user-avatar">{caller.name[0]}</div>
          <div>
            <h3>{caller.name}</h3>
            <span className="session-stats">שיחות שבוצעו: {sessionCount}</span>
          </div>
        </div>
        <button onClick={handleLogout} className="btn-logout" title="התנתק">
          יציאה
        </button>
      </header>

      {/* Main Content */}
      <main className="app-main">
        {errorMsg && <div className="error-banner">{errorMsg}</div>}

        {loading && !currentContact ? (
          <div className="loader-container">
            <div className="spinner"></div>
            <p>טוען את המצביע הבא...</p>
          </div>
        ) : !currentContact ? (
          <div className="no-contacts card-enter-anim">
            <div className="success-icon">🎉</div>
            <h2>סיימנו!</h2>
            <p>אין אנשים נוספים ברשימה להתקשר אליהם כרגע.</p>
            <p>תודה רבה על העזרה במערכה!</p>
            <button onClick={fetchNextContact} className="btn-refresh">
              רענן רשימה
            </button>
          </div>
        ) : (
          <div className="swiper-viewport">
            {!isSwipedRight ? (
              /* TINDER MODE: Swipe card */
              <div className="card-outer-container">
                <div
                  className={`tinder-card card-enter-anim ${
                    swipeDirection === "left"
                      ? "swipe-left-anim"
                      : swipeDirection === "right"
                      ? "swipe-right-anim"
                      : ""
                  }`}
                >
                  <div className="card-header-badge">מצביע פוטנציאלי</div>
                  <div className="voter-avatar">{currentContact.name[0]}</div>
                  <h2 className="voter-name">{currentContact.name}</h2>
                  
                  <div className="voter-quick-info">
                    {currentContact.city && (
                      <div className="info-tag">
                        <span className="tag-icon">📍</span>
                        <span className="tag-text">{currentContact.city}</span>
                      </div>
                    )}
                    {currentContact.sector && (
                      <div className="info-tag">
                        <span className="tag-icon">👥</span>
                        <span className="tag-text">{currentContact.sector}</span>
                      </div>
                    )}
                  </div>

                  <p className="swipe-instruction">החלק ימינה להתקשרות, שמאלה לדילוג</p>
                </div>

                {/* Tinder Action Buttons */}
                <div className="action-buttons">
                  <button
                    onClick={() => triggerSwipe("left")}
                    className="btn-swipe btn-swipe-left"
                    disabled={isAnimating}
                    aria-label="דלג"
                  >
                    ✕
                  </button>
                  <button
                    onClick={() => triggerSwipe("right")}
                    className="btn-swipe btn-swipe-right"
                    disabled={isAnimating}
                    aria-label="חייג"
                  >
                    ♥
                  </button>
                </div>
              </div>
            ) : (
              /* DETAIL & CALL MODE */
              <div className="details-card card-enter-anim">
                <div className="details-header">
                  <button onClick={() => setIsSwipedRight(false)} className="btn-back">
                    ➔ חזור לכרטיס
                  </button>
                  <h2>פרטי המצביע</h2>
                </div>

                <div className="details-body">
                  <div className="detail-section">
                    <span className="detail-label">שם:</span>
                    <span className="detail-value">{currentContact.name}</span>
                  </div>

                  <div className="detail-row">
                    {currentContact.city && (
                      <div className="detail-section half">
                        <span className="detail-label">עיר:</span>
                        <span className="detail-value">{currentContact.city}</span>
                      </div>
                    )}
                    {currentContact.sector && (
                      <div className="detail-section half">
                        <span className="detail-label">מגזר:</span>
                        <span className="detail-value">{currentContact.sector}</span>
                      </div>
                    )}
                  </div>

                  {currentContact.familySize && (
                    <div className="detail-section">
                      <span className="detail-label">נפשות בבית:</span>
                      <span className="detail-value">{currentContact.familySize}</span>
                    </div>
                  )}

                  {currentContact.notes && (
                    <div className="detail-section">
                      <span className="detail-label">הערות:</span>
                      <div className="detail-notes">{currentContact.notes}</div>
                    </div>
                  )}

                  <hr className="divider" />

                  {/* CALL BUTTON */}
                  <a
                    href={`tel:${currentContact.phone}`}
                    className="btn-call-trigger"
                    onClick={() => {
                      // Optionally pre-select something or just help track
                    }}
                  >
                    <span className="phone-icon">📞</span>
                    חייג ל-{currentContact.name}
                    <span className="phone-number">{currentContact.phone}</span>
                  </a>

                  {/* STATUS SELECTOR */}
                  <div className="status-selector-section">
                    <h3>עדכן תוצאת שיחה:</h3>
                    <div className="status-grid">
                      <button
                        type="button"
                        onClick={() => setStatusSelection("SUCCESS")}
                        className={`status-btn success ${
                          statusSelection === "SUCCESS" ? "active" : ""
                        }`}
                      >
                        שיחה מוצלחת ✅
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusSelection("NOT_INTERESTED")}
                        className={`status-btn no-interest ${
                          statusSelection === "NOT_INTERESTED" ? "active" : ""
                        }`}
                      >
                        לא מעוניין ❌
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusSelection("NO_ANSWER")}
                        className={`status-btn no-answer ${
                          statusSelection === "NO_ANSWER" ? "active" : ""
                        }`}
                      >
                        אין מענה ⏳
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusSelection("INVALID_NUMBER")}
                        className={`status-btn invalid ${
                          statusSelection === "INVALID_NUMBER" ? "active" : ""
                        }`}
                      >
                        מספר שגוי ⚠️
                      </button>
                    </div>
                  </div>

                  {/* WHATSAPP FOLLOW-UP FOR SUCCESSFUL CALLS */}
                  {statusSelection === "SUCCESS" && (
                    <a
                      href={getWhatsAppLink()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-whatsapp"
                    >
                      <span className="whatsapp-icon">💬</span>
                      שלח הודעת וואטסאפ
                    </a>
                  )}

                  <button
                    onClick={handleSubmitStatus}
                    className="btn-submit-call"
                    disabled={!statusSelection || loading}
                  >
                    {loading ? "שומר סטטוס..." : "שמור והמשך לשיחה הבאה"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
