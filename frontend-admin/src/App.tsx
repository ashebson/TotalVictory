import React, { useState, useEffect } from "react";
import "./App.css";

const API_URL = window.location.protocol + "//" + window.location.hostname + ":5001";
const ADMIN_PASSCODE = "halevi2026";

interface Summary {
  total: number;
  pending: number;
  success: number;
  notInterested: number;
  noAnswer: number;
  invalidNumber: number;
  totalCalled: number;
}

interface CallerDetail {
  id: number;
  name: string;
  totalCalls: number;
  successCalls: number;
  successRate: number;
  lastCallTime: string | null;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "upload" | "settings">("dashboard");
  
  // Dashboard state
  const [summary, setSummary] = useState<Summary | null>(null);
  const [callers, setCallers] = useState<CallerDetail[]>([]);
  const [loading, setLoading] = useState(false);

  // Upload state
  const [csvText, setCsvText] = useState("");
  const [uploadResult, setUploadResult] = useState<{ success: boolean; inserted?: number; skipped?: number; msg?: string } | null>(null);

  // Settings state
  const [settings, setSettings] = useState({
    win_percentage: "74.8",
    target_calls: "5000",
    polymarket_url: "https://polymarket.com",
    whatsapp_template: "",
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    // Check if authenticated in session
    const auth = sessionStorage.getItem("admin_authenticated");
    if (auth === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
      fetchSettings();
      // Poll stats every 10 seconds for admin dashboard
      const interval = setInterval(fetchData, 10000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_URL}/api/stats/admin`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setCallers(data.callers);
      }
    } catch (err) {
      console.error("Error fetching admin stats:", err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings({
          win_percentage: data.win_percentage || "74.8",
          target_calls: data.target_calls || "5000",
          polymarket_url: data.polymarket_url || "https://polymarket.com",
          whatsapp_template: data.whatsapp_template || "",
        });
      }
    } catch (err) {
      console.error("Error fetching settings:", err);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode === ADMIN_PASSCODE) {
      setIsAuthenticated(true);
      sessionStorage.setItem("admin_authenticated", "true");
      setPasscodeError(false);
    } else {
      setPasscodeError(true);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem("admin_authenticated");
    setPasscode("");
  };

  // Smart CSV parser and mapper
  const handleCSVUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) return;

    setLoading(true);
    setUploadResult(null);

    try {
      // Split by lines
      const lines = csvText.split(/\r?\n/);
      if (lines.length < 2) {
        setUploadResult({ success: false, msg: "הקובץ ריק או מכיל שורה אחת בלבד" });
        setLoading(false);
        return;
      }

      // Detect delimiter: comma or semicolon
      const firstLine = lines[0];
      const delimiter = firstLine.includes(";") ? ";" : ",";
      
      const rawHeaders = firstLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));
      
      // Map headers to standard fields
      const headerMap: Record<string, string> = {};
      rawHeaders.forEach((h, idx) => {
        const lower = h.toLowerCase();
        if (lower.includes("שם") || lower.includes("name")) {
          headerMap["name"] = idx.toString();
        } else if (lower.includes("טלפון") || lower.includes("נייד") || lower.includes("phone") || lower.includes("cell")) {
          headerMap["phone"] = idx.toString();
        } else if (lower.includes("עיר") || lower.includes("ישוב") || lower.includes("city") || lower.includes("address")) {
          headerMap["city"] = idx.toString();
        } else if (lower.includes("מגזר") || lower.includes("sector")) {
          headerMap["sector"] = idx.toString();
        } else if (lower.includes("נפשות") || lower.includes("משפחה") || lower.includes("size")) {
          headerMap["familySize"] = idx.toString();
        } else if (lower.includes("הערות") || lower.includes("notes")) {
          headerMap["notes"] = idx.toString();
        }
      });

      if (headerMap["name"] === undefined || headerMap["phone"] === undefined) {
        setUploadResult({ 
          success: false, 
          msg: "לא נמצאו עמודות חובה: 'שם' ו'טלפון'. ודא ששורת הכותרת מכילה עמודות אלו." 
        });
        setLoading(false);
        return;
      }

      const parsedContacts = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Split by delimiter considering quotes (basic quotes support)
        const matches = line.match(/(".*?"|[^";,]+)(?=\s*[;,]|\s*$)/g) || line.split(delimiter);
        const cells = matches.map(c => c.trim().replace(/^"|"$/g, ""));

        const contact: any = {
          name: cells[parseInt(headerMap["name"])],
          phone: cells[parseInt(headerMap["phone"])],
        };

        if (headerMap["city"] !== undefined) contact.city = cells[parseInt(headerMap["city"])];
        if (headerMap["sector"] !== undefined) contact.sector = cells[parseInt(headerMap["sector"])];
        if (headerMap["familySize"] !== undefined) contact.familySize = cells[parseInt(headerMap["familySize"])];
        if (headerMap["notes"] !== undefined) contact.notes = cells[parseInt(headerMap["notes"])];

        if (contact.name && contact.phone) {
          parsedContacts.push(contact);
        }
      }

      // Send to API
      const res = await fetch(`${API_URL}/api/contacts/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: parsedContacts }),
      });

      if (res.ok) {
        const data = await res.json();
        setUploadResult({
          success: true,
          inserted: data.inserted,
          skipped: data.skipped
        });
        setCsvText("");
        fetchData();
      } else {
        setUploadResult({ success: false, msg: "שגיאה בהעלאה לשרת" });
      }
    } catch (err) {
      setUploadResult({ success: false, msg: "שגיאה בניתוח קובץ ה-CSV" });
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
    };
    reader.readAsText(file);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });

      if (res.ok) {
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 3000);
      }
    } catch (err) {
      alert("שגיאה בשמירת הגדרות");
    } finally {
      setLoading(false);
    }
  };

  const handleResetCampaign = async (type: "contacts" | "callers") => {
    const msg = type === "contacts" 
      ? "האם אתה בטוח שברצונך לאפס את הסטטוס של כל אנשי הקשר ל'ממתין' ולמחוק את היסטוריית השיחות?" 
      : "אזהרה חמורה! האם ברצונך למחוק את כל הטלפנים והיסטוריית השיחות מהמערכת?";
      
    if (!window.confirm(msg)) return;

    setLoading(true);
    try {
      const endpoint = type === "contacts" ? "/api/contacts/reset" : "/api/callers/reset";
      const res = await fetch(`${API_URL}${endpoint}`, { method: "POST" });
      if (res.ok) {
        alert("האיפוס בוצע בהצלחה!");
        fetchData();
      } else {
        alert("שגיאה בביצוע האיפוס");
      }
    } catch (err) {
      alert("שגיאה בתקשורת עם השרת");
    } finally {
      setLoading(false);
    }
  };

  const handleSeedMockData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/contacts/seed`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(`נוספו בהצלחה ${data.seededCount} אנשי קשר לדוגמה!`);
        fetchData();
      }
    } catch (err) {
      alert("שגיאה בטעינת אנשי קשר לדוגמה");
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <form className="login-card card-enter-anim" onSubmit={handleLogin}>
          <div className="logo-section">
            <span className="logo-badge">פאנל מנהל</span>
            <h1>מטה עמית הלוי</h1>
            <h2>כניסה למערכת הניהול</h2>
          </div>

          {passcodeError && <div className="error-banner">קוד גישה שגוי, נסה שנית.</div>}

          <div className="input-group">
            <label htmlFor="passcode">קוד גישה מנהל:</label>
            <input
              type="password"
              id="passcode"
              placeholder="הכנס קוד גישה..."
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary">
            כניסה לניהול
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-container">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="sidebar-header">
          <h2>מטה עמית הלוי</h2>
          <span>מערכת טלפנים</span>
        </div>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            📊 לוח בקרה
          </button>
          <button
            className={`nav-item ${activeTab === "upload" ? "active" : ""}`}
            onClick={() => setActiveTab("upload")}
          >
            👥 העלאת אנשי קשר
          </button>
          <button
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            ⚙️ הגדרות קמפיין
          </button>
        </nav>
        <button onClick={handleLogout} className="btn-sidebar-logout">
          🚪 יציאה
        </button>
      </aside>

      {/* Main Content Area */}
      <main className="admin-content">
        {activeTab === "dashboard" && summary && (
          <div className="tab-pane card-enter-anim">
            <div className="pane-header">
              <h1>לוח בקרה וסטטיסטיקה</h1>
              <p>נתונים בזמן אמת של פעילות הטלפנים בקמפיין</p>
            </div>

            {/* Stats Cards Grid */}
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">סך הכל ברשימה</span>
                <span className="stat-number">{summary.total}</span>
              </div>
              <div className="stat-card success-glow">
                <span className="stat-label">שיחות מוצלחות ✅</span>
                <span className="stat-number">{summary.success}</span>
                <span className="stat-sub">
                  {summary.totalCalled > 0 
                    ? `${Math.round((summary.success / summary.totalCalled) * 100)}% משיחות שנענו` 
                    : "0%"}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">לא מעוניינים ❌</span>
                <span className="stat-number">{summary.notInterested}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">אין מענה ⏳</span>
                <span className="stat-number">{summary.noAnswer}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">מספר שגוי ⚠️</span>
                <span className="stat-number">{summary.invalidNumber}</span>
              </div>
              <div className="stat-card progress-glow">
                <span className="stat-label">הספק קמפיין</span>
                <span className="stat-number">
                  {summary.total > 0 ? `${Math.round((summary.totalCalled / summary.total) * 100)}%` : "0%"}
                </span>
                <span className="stat-sub">
                  התקשרנו ל-{summary.totalCalled} מתוך {summary.total}
                </span>
              </div>
            </div>

            {/* Callers Statistics Table */}
            <div className="table-card">
              <div className="table-card-header">
                <h2>דירוג ופעילות טלפנים</h2>
              </div>
              {callers.length === 0 ? (
                <div className="empty-state">אין טלפנים פעילים כרגע.</div>
              ) : (
                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>שם הטלפן</th>
                        <th>סה"כ שיחות</th>
                        <th>שיחות מוצלחות</th>
                        <th>אחוז הצלחה</th>
                        <th>שיחה אחרונה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {callers.map((c) => (
                        <tr key={c.id}>
                          <td className="caller-name-cell">
                            <span className="avatar-small">{c.name[0]}</span>
                            {c.name}
                          </td>
                          <td>{c.totalCalls}</td>
                          <td className="success-cell">{c.successCalls}</td>
                          <td>
                            <div className="progress-bar-container">
                              <span className="progress-value">{c.successRate}%</span>
                              <div className="progress-bar-bg">
                                <div 
                                  className="progress-bar-fill" 
                                  style={{ width: `${c.successRate}%` }}
                                ></div>
                              </div>
                            </div>
                          </td>
                          <td className="time-cell">
                            {c.lastCallTime 
                              ? new Date(c.lastCallTime).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "upload" && (
          <div className="tab-pane card-enter-anim">
            <div className="pane-header">
              <h1>העלאת רשימת תומכים</h1>
              <p>טען קובץ CSV או הדבק נתונים ישירות מהאקסל. המערכת תזהה את העמודות אוטומטית.</p>
            </div>

            <div className="upload-container">
              <div className="upload-info-box">
                <h3>💡 הנחיות לפורמט:</h3>
                <ul>
                  <li>חובה לכלול עמודות בשם: <strong>שם</strong> (שם המצביע) ו-<strong>טלפון</strong> (נייד להתקשרות).</li>
                  <li>עמודות מומלצות נוספות: <strong>עיר</strong>, <strong>מגזר</strong>, <strong>נפשות</strong>, <strong>הערות</strong>.</li>
                  <li>אם טוענים מספר קיים, הפרטים שלו יעודכנו (שם, עיר וכו') אך מצב השיחה שלו יישמר.</li>
                </ul>
                <button type="button" onClick={handleSeedMockData} className="btn-seed" disabled={loading}>
                  🌱 טען 10 אנשי קשר לדוגמה לבדיקה
                </button>
              </div>

              <form onSubmit={handleCSVUpload} className="upload-form">
                <div className="file-picker-group">
                  <label htmlFor="csvFile">בחר קובץ CSV במחשב:</label>
                  <input
                    type="file"
                    id="csvFile"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="file-input"
                  />
                </div>

                <div className="textarea-group">
                  <label htmlFor="csvText">או הדבק שורות CSV כאן (כולל שורת כותרת):</label>
                  <textarea
                    id="csvText"
                    rows={10}
                    placeholder={`שם,טלפון,עיר,מגזר,הערות\nמשה כהן,0501234567,ירושלים,דתי לאומי,תומך ותיק\nשרה לוי,0529876543,תל אביב,כללי,מתלבטת`}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                  ></textarea>
                </div>

                {uploadResult && (
                  <div className={`result-banner ${uploadResult.success ? "success" : "error"}`}>
                    {uploadResult.success ? (
                      <div>
                        🎉 העלאה הושלמה בהצלחה! 
                        <br />
                        נוספו/עודכנו <strong>{uploadResult.inserted}</strong> אנשי קשר. 
                        דלגנו על <strong>{uploadResult.skipped}</strong> שורות לא תקינות.
                      </div>
                    ) : (
                      <div>⚠️ {uploadResult.msg}</div>
                    )}
                  </div>
                )}

                <button type="submit" className="btn-primary" disabled={loading || !csvText.trim()}>
                  {loading ? "מעלה ומנתח..." : "טען אנשי קשר למערכת"}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="tab-pane card-enter-anim">
            <div className="pane-header">
              <h1>הגדרות קמפיין והודעות</h1>
              <p>שלוט בפרמטרים הכלליים של מערכת הטלפנים והתצוגות</p>
            </div>

            <form onSubmit={handleSaveSettings} className="settings-form">
              <div className="settings-section">
                <h3>💬 תבנית הודעת וואטסאפ לשיחה מוצלחת</h3>
                <p className="field-desc">
                  הודעה זו תיפתח אוטומטית לטלפנים בלחיצת כפתור לאחר סימון "שיחה מוצלחת".
                  השתמש ב-<strong>{"{name}"}</strong> היכן שברצונך לשתול את שם המצביע.
                </p>
                <textarea
                  rows={4}
                  value={settings.whatsapp_template}
                  onChange={(e) => setSettings({ ...settings, whatsapp_template: e.target.value })}
                  placeholder="היי {name}, שמחתי לשוחח איתך..."
                  required
                ></textarea>
              </div>

              <div className="settings-section-row">
                <div className="settings-field">
                  <label>📈 אחוז סיכוי זכייה התחלתי (Polymarket):</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="100"
                    value={settings.win_percentage}
                    onChange={(e) => setSettings({ ...settings, win_percentage: e.target.value })}
                    required
                  />
                  <span className="field-desc">אחוז הסיכוי שיוצג בגרף הטלוויזיה. מושפע משיחות מוצלחות בזמן אמת.</span>
                </div>

                <div className="settings-field">
                  <label>📞 יעד שיחות כולל לקמפיין:</label>
                  <input
                    type="number"
                    min="100"
                    value={settings.target_calls}
                    onChange={(e) => setSettings({ ...settings, target_calls: e.target.value })}
                    required
                  />
                  <span className="field-desc">מספר השיחות הכולל להצגת קו המטרה.</span>
                </div>
              </div>

              <div className="settings-section">
                <label>🔗 כתובת הטמעת Polymarket (Iframe URL):</label>
                <input
                  type="url"
                  value={settings.polymarket_url}
                  onChange={(e) => setSettings({ ...settings, polymarket_url: e.target.value })}
                  placeholder="https://polymarket.com/..."
                  required
                />
                <span className="field-desc">הכתובת שתוטמע בפריים בטלוויזיה. במידה וייחסם יוצג ווידג'ט חיזוי מעוצב.</span>
              </div>

              {settingsSaved && <div className="result-banner success">ההגדרות נשמרו בהצלחה! ✅</div>}

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "שומר..." : "שמור הגדרות קמפיין"}
              </button>
            </form>

            <hr className="settings-divider" />

            <div className="danger-zone">
              <h2>⚠️ אזור סכנה (איפוס נתונים)</h2>
              <p>פעולות אלו הן סופיות ולא ניתן לבטלן. השתמש בזהירות.</p>
              
              <div className="danger-buttons">
                <button
                  type="button"
                  onClick={() => handleResetCampaign("contacts")}
                  className="btn-danger-outline"
                  disabled={loading}
                >
                  🔄 אפס סטטוס שיחות (אנשי קשר יחזרו לממתין)
                </button>
                <button
                  type="button"
                  onClick={() => handleResetCampaign("callers")}
                  className="btn-danger"
                  disabled={loading}
                >
                  🚨 מחק את כל הטלפנים והיסטוריית השיחות
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
