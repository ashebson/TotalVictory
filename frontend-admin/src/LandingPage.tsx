import { useState, useEffect } from "react";
import "./LandingPage.css";

interface LandingPageProps {
  onLogin: () => void;
  onRegister: () => void;
}

interface MockCall {
  id: number;
  caller: string;
  contact: string;
  status: string;
  statusText: string;
  time: string;
}

const mockCallers = ["דוד כהן", "רחל לוי", "אלון מזרחי", "יעל אהרון", "רוני גבאי", "מיכל שלום"];
const mockContacts = ["אברהם פ.", "שרה מ.", "משה ל.", "רבקה כ.", "יעקב ב.", "לאה א.", "יוסף ש.", "חנה ד."];
const mockStatuses = [
  { status: "success", statusText: "שיחה מוצלחת ✅" },
  { status: "success", statusText: "שיחה מוצלחת ✅" },
  { status: "no-answer", statusText: "אין מענה ⏳" },
  { status: "no-interest", statusText: "לא מעוניין ❌" },
  { status: "invalid", statusText: "מספר שגוי ⚠️" }
];

export default function LandingPage({ onLogin, onRegister }: LandingPageProps) {
  const [mockCalls, setMockCalls] = useState<MockCall[]>([]);
  const [activeCallersCount, setActiveCallersCount] = useState(32);

  // Generate initial mock calls
  useEffect(() => {
    const initialCalls: MockCall[] = [];
    for (let i = 0; i < 3; i++) {
      const caller = mockCallers[Math.floor(Math.random() * mockCallers.length)];
      const contact = mockContacts[Math.floor(Math.random() * mockContacts.length)];
      const statObj = mockStatuses[Math.floor(Math.random() * mockStatuses.length)];
      const time = new Date(Date.now() - i * 60000).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      initialCalls.push({
        id: Math.random(),
        caller,
        contact,
        status: statObj.status,
        statusText: statObj.statusText,
        time
      });
    }
    setMockCalls(initialCalls);
  }, []);

  // Update mock calls and active callers dynamically to look "alive"
  useEffect(() => {
    const interval = setInterval(() => {
      const caller = mockCallers[Math.floor(Math.random() * mockCallers.length)];
      const contact = mockContacts[Math.floor(Math.random() * mockContacts.length)];
      const statObj = mockStatuses[Math.floor(Math.random() * mockStatuses.length)];
      const time = new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

      const newCall: MockCall = {
        id: Math.random(),
        caller,
        contact,
        status: statObj.status,
        statusText: statObj.statusText,
        time
      };

      setMockCalls((prev) => [newCall, ...prev.slice(0, 2)]);

      setActiveCallersCount((prev) => {
        const delta = Math.random() > 0.5 ? 1 : -1;
        return Math.max(15, Math.min(48, prev + delta));
      });
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="landing-viewport" dir="rtl">
      {/* Background Gradients */}
      <div className="bg-glow bg-glow-primary"></div>
      <div className="bg-glow bg-glow-secondary"></div>

      {/* Header */}
      <header className="landing-header reveal-fade">
        <div className="header-container">
          <div className="landing-logo">
            <span className="logo-icon">🏆</span>
            <span className="logo-text">DVictory</span>
          </div>
          <nav className="landing-nav">
            <a href="#features">תכונות המערכת</a>
            <a href="#demo">הדמיית לוח בקרה</a>
            <a href="#pricing">מחירון</a>
            <a href="#security">אבטחת מידע</a>
          </nav>
          <div className="landing-header-actions">
            <button className="btn-text" onClick={onLogin}>התחברות מנהל</button>
            <button className="btn-nav-primary" onClick={onRegister}>הרשמה עכשיו</button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-container">
          <div className="hero-content reveal-slide-up">
            <div className="candidate-pill">מערכת מטה טלפנים מתקדמת</div>
            <h1 className="hero-title">
              להפוך תומכים פוטנציאליים <br />
              <span className="gradient-text">לקולות בקלפי.</span>
            </h1>
            <p className="hero-desc">
              מערכת די ויקטורי (DVictory) מספקת מעטפת מושלמת לקמפיין בחירות מנצח: טעינת רשימות בוחרים מאקסל, חלוקת משימות לטלפנים, ניטור הספקים ושידורים חיים למסכי המטה בזמן אמת.
            </p>
            <div className="hero-actions">
              <button className="btn-hero-primary" onClick={onRegister}>התחל קמפיין עכשיו</button>
            </div>
            <div className="hero-trust">
              <span>✓ מסלול חודשי פשוט</span>
              <span>•</span>
              <span>✓ אבטחת מידע קפדנית</span>
            </div>
          </div>

          {/* Detailed and Accurate Simulated Admin Dashboard */}
          <div className="hero-visual reveal-scale-in" id="demo">
            <div className="sim-dashboard">
              {/* Window Header */}
              <div className="sim-header-bar">
                <div className="sim-dots">
                  <span className="dot red"></span>
                  <span className="dot yellow"></span>
                  <span className="dot green"></span>
                </div>
                <div className="sim-title">DVictory - לוח בקרה מנהל (הדמיה)</div>
                <div className="sim-live-badge">שידור חי • LIVE</div>
              </div>

              {/* Simulated App Layout */}
              <div className="sim-app-layout">
                {/* Simulated Sidebar */}
                <aside className="sim-sidebar">
                  <div className="sim-sidebar-header">
                    <h2>מטה טלפנים</h2>
                    <span>מערכת ניהול</span>
                  </div>
                  <nav className="sim-sidebar-nav">
                    <button className="sim-nav-item active">לוח בקרה</button>
                    <button className="sim-nav-item">פרויקטים ואקסלים</button>
                    <button className="sim-nav-item">הגדרות</button>
                  </nav>
                  <button className="sim-btn-logout">יציאה</button>
                </aside>

                {/* Simulated Main Content */}
                <main className="sim-content">
                  <div className="sim-pane-header">
                    <h3>לוח בקרה</h3>
                    <p>סיכום כל הפרויקטים וכל פעילות הטלפנים.</p>
                  </div>

                  {/* 6 Real Stat Cards */}
                  <div className="sim-stats-grid">
                    <div className="sim-stat-card">
                      <span className="sim-stat-label">סה״כ רשומות</span>
                      <span className="sim-stat-number">24,500</span>
                      <span className="sim-stat-sub">18,450 כבר טופלו</span>
                    </div>
                    <div className="sim-stat-card success-glow">
                      <span className="sim-stat-label">אחוז הצלחה</span>
                      <span className="sim-stat-number success-color">74%</span>
                      <span className="sim-stat-sub">13,653 תומכים מתוך 18,450 שיחות</span>
                    </div>
                    <div className="sim-stat-card">
                      <span className="sim-stat-label">אחוז מענה</span>
                      <span className="sim-stat-number">82%</span>
                      <span className="sim-stat-sub">תומכים + לא מעוניינים</span>
                    </div>
                    <div className="sim-stat-card progress-glow">
                      <span className="sim-stat-label">התקדמות כללית</span>
                      <span className="sim-stat-number primary-color">75%</span>
                      <span className="sim-stat-sub">6,050 עדיין ממתינים</span>
                    </div>
                    <div className="sim-stat-card">
                      <span className="sim-stat-label">טלפנים פעילים</span>
                      <span className="sim-stat-number">{activeCallersCount}</span>
                      <span className="sim-stat-sub">ממוצע 576 שיחות לטלפן</span>
                    </div>
                    <div className="sim-stat-card danger-glow">
                      <span className="sim-stat-label">לא ענו / שגויים</span>
                      <span className="sim-stat-number danger-color">4,797</span>
                      <span className="sim-stat-sub">דורש סבב טיפול נוסף</span>
                    </div>
                  </div>

                  {/* Split Section: Donut Chart & Leaderboard */}
                  <div className="sim-split-grid">
                    {/* Donut Chart Card */}
                    <div className="sim-insight-card">
                      <div className="sim-insight-header">
                        <h4>פילוח סטטוסים</h4>
                        <span>75% הושלם</span>
                      </div>
                      <div className="sim-donut-wrap">
                        <div className="sim-donut-chart">
                          <div>
                            <strong>18,450</strong>
                            <span>טופלו</span>
                          </div>
                        </div>
                        <div className="sim-status-legend">
                          <div className="sim-legend-row">
                            <span className="legend-dot green"></span>
                            <span>תומכים</span>
                            <strong>13,653</strong>
                          </div>
                          <div className="sim-legend-row">
                            <span className="legend-dot orange"></span>
                            <span>לא מעוניינים</span>
                            <strong>1,480</strong>
                          </div>
                          <div className="sim-legend-row">
                            <span className="legend-dot blue"></span>
                            <span>אין מענה</span>
                            <strong>2,810</strong>
                          </div>
                          <div className="sim-legend-row">
                            <span className="legend-dot red"></span>
                            <span>מספר שגוי</span>
                            <strong>507</strong>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Leaderboard Card */}
                    <div className="sim-insight-card">
                      <div className="sim-insight-header">
                        <h4>תחרות טלפנים</h4>
                        <span>מדורג לפי הצלחות</span>
                      </div>
                      <div className="sim-leaderboard-list">
                        <div className="sim-leaderboard-row">
                          <div className="sim-rank">🥇</div>
                          <div className="sim-leader-info">
                            <strong>רחל לוי</strong>
                            <span>342 הצלחות · 450 שיחות</span>
                            <div className="sim-mini-bar"><span style={{ width: "90%" }}></span></div>
                          </div>
                          <span className="sim-score">76%</span>
                        </div>
                        <div className="sim-leaderboard-row">
                          <div className="sim-rank">🥈</div>
                          <div className="sim-leader-info">
                            <strong>דוד כהן</strong>
                            <span>298 הצלחות · 410 שיחות</span>
                            <div className="sim-mini-bar"><span style={{ width: "75%" }}></span></div>
                          </div>
                          <span className="sim-score">72%</span>
                        </div>
                        <div className="sim-leaderboard-row">
                          <div className="sim-rank">🥉</div>
                          <div className="sim-leader-info">
                            <strong>יעל אהרון</strong>
                            <span>210 הצלחות · 300 שיחות</span>
                            <div className="sim-mini-bar"><span style={{ width: "55%" }}></span></div>
                          </div>
                          <span className="sim-score">70%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Realtime Call Ticker */}
                  <div className="sim-insight-card ticker-card">
                    <div className="sim-insight-header">
                      <h4>דיווחים חיים מהשטח (סימולציה)</h4>
                      <span className="ticker-live-dot"></span>
                    </div>
                    <div className="sim-feed-list">
                      {mockCalls.map((call) => (
                        <div key={call.id} className="sim-feed-item">
                          <span className="feed-time">{call.time}</span>
                          <span className="feed-text">
                            <strong>{call.caller}</strong> התקשר ל-{call.contact}
                          </span>
                          <span className={`feed-status-badge ${call.status}`}>
                            {call.statusText}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </main>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section className="features-section" id="features">
        <div className="section-header reveal-slide-up">
          <h2>כל מה שצריך כדי לנהל את המטה ולנצח</h2>
          <p>ריכזנו את הכלים המתקדמים ביותר למערכת פשוטה ואינטואיטיבית שכל אחד יכול לתפעל</p>
        </div>

        <div className="features-grid">
          <div className="feature-card reveal-slide-up">
            <div className="feature-icon">📂</div>
            <h3>ייבוא אקסלים מהיר וחכם</h3>
            <p>
              מעלים קבצי Excel או CSV עם רשימות בוחרים. המערכת תזהה ותמפה עמודות בעברית ובאנגלית באופן אוטומטי (שם, טלפון, עיר, מגזר, הערות ועוד).
            </p>
          </div>

          <div className="feature-card reveal-slide-up">
            <div className="feature-icon">📊</div>
            <h3>שידור חי למסכי מטה</h3>
            <p>
              אפשרות לפתוח דף ייעודי לשידור חי על גבי מסכים במטה הפעילות המציג לוח התקדמות, מדדי הספק בזמן אמת וטבלת מובילים של הטלפנים הכי חרוצים.
            </p>
          </div>

          <div className="feature-card reveal-slide-up">
            <div className="feature-icon">💬</div>
            <h3>קישור וואטסאפ מובנה</h3>
            <p>
              בסיום כל שיחה מוצלחת, הטלפן יכול לשלוח בלחיצת כפתור הודעת וואטסאפ מובנת ואישית שנוסחה מראש על ידי מנהל הקמפיין לחיזוק הקשר.
            </p>
          </div>

          <div className="feature-card reveal-slide-up">
            <div className="feature-icon">🔒</div>
            <h3>אבטחה ופרטיות מידע</h3>
            <p>
              המידע מאובטח ברמות הגבוהות ביותר ושייך לכם בלבד. מספר שבועות לאחר סיום מערכת הבחירות, כל הנתונים שהעליתם נמחקים לצמיתות באופן אוטומטי.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="pricing-section" id="pricing">
        <div className="section-header reveal-slide-up">
          <h2>מסלול פשוט ושקוף, ללא הפתעות</h2>
          <p>כל הפיצ'רים פתוחים בפניך מהרגע הראשון, ללא הגבלת רשימות או פרויקטים</p>
        </div>

        <div className="pricing-wrap reveal-scale-in">
          <div className="pricing-card premium">
            <div className="pricing-badge">הקמפיין המנצח</div>
            <h3>מנוי חודשי מלא</h3>
            <div className="price-box">
              <span className="currency">₪</span>
              <span className="price-num">990</span>
              <span className="interval">/ לחודש</span>
            </div>
            <p className="price-desc">ללא התחייבות, תשלום חודשי מאובטח והפעלה מיידית לאחר אישור בעל המערכת.</p>
            <ul className="price-features">
              <li>✓ עד <strong>50 טלפנים בו זמנית</strong></li>
              <li>✓ העלאת פרויקטים ורשימות ללא הגבלה</li>
              <li>✓ לוח שידורים חי למסכי טלוויזיה</li>
              <li>✓ דוחות ייצוא והערות טלפנים בזמן אמת</li>
              <li>✓ מערכת הודעות וואטסאפ מובנת</li>
              <li>✓ תמיכה ישירה במייל ובוואטסאפ</li>
            </ul>
            <button className="btn-pricing-primary" onClick={onRegister}>הירשם והתחל קמפיין</button>
          </div>
        </div>
      </section>

      {/* Security & Integrity Section */}
      <section className="security-section" id="security">
        <div className="security-container reveal-slide-up">
          <div className="security-icon">🛡️</div>
          <h2>המידע שלך מאובטח. מאוד.</h2>
          <p>
            אנחנו לוקחים את אבטחת המידע ופרטיות המועמד והבוחרים ברצינות המרבית. כל נתוני המטה מוצפנים ונשמרים בשרתים בטוחים המוגנים בחומת אש קשוחה. המידע אינו שיתופי, אינו מנוצל לצד ג' ושייך אך ורק ללקוח שרכש את המערכת.
          </p>
          <div className="security-stats">
            <div className="sec-stat">
              <strong>Cloud</strong>
              <span>שרתים מאובטחים</span>
            </div>
            <div className="sec-stat">
              <strong>100%</strong>
              <span>בעלות על המידע</span>
            </div>
            <div className="sec-stat">
              <strong>256-bit</strong>
              <span>הצפנת נתונים</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-container">
          <div className="footer-logo">
            <span>🏆</span>
            <span>DVictory</span>
          </div>
          <div className="footer-copyright">
            © {new Date().getFullYear()} DVictory. כל הזכויות שמורות.
          </div>
        </div>
      </footer>
    </div>
  );
}
