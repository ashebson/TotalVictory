import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const PUBLIC_API_URL = "https://total-victory.onrender.com";
const LOCAL_API_URL = window.location.protocol + "//" + window.location.hostname + ":5001";
const API_URL = (import.meta.env.VITE_API_URL || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? LOCAL_API_URL : PUBLIC_API_URL)).replace(/\/$/, "");

interface LeaderboardEntry {
  id: number;
  name: string;
  totalCalls: number;
  successCalls: number;
  successRate: number;
}

interface RecentCall {
  id: number;
  callerName: string;
  contactName: string;
  status: string;
  timestamp: string;
}

interface Stats {
  totalContacts: number;
  calledContacts: number;
  successCalls: number;
  notInterested: number;
  noAnswer: number;
  invalidNumber: number;
  leaderboard: LeaderboardEntry[];
  recentCalls: RecentCall[];
  winPercentage: number;
  targetCalls: number;
  polymarketUrl: string;
}

export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [useIframe, setUseIframe] = useState(false);
  const [chartHistory, setChartHistory] = useState<number[]>([72.1, 72.3, 72.0, 72.5, 73.1, 73.0, 73.4, 73.2, 73.8]);
  const [flashSuccess, setFlashSuccess] = useState(false);
  
  const lastSuccessCount = useRef<number>(0);

  // Time updater
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch initial stats and setup WebSockets
  useEffect(() => {
    // Initial fetch
    fetch(`${API_URL}/api/stats/tv`)
      .then((res) => res.json())
      .then((data) => {
        setStats(data);
        lastSuccessCount.current = data.successCalls;
        // Seed historical chart points leading up to current winPercentage
        generateChartHistory(data.winPercentage);
      })
      .catch((err) => console.error("Initial load failed:", err));

    // Connect Socket.io
    const socket = io(API_URL);

    socket.on("stats-update", (updatedStats: Stats) => {
      setStats(updatedStats);

      // Check if success count increased to trigger screen flash / alert
      if (updatedStats.successCalls > lastSuccessCount.current) {
        triggerSuccessFlash();
        lastSuccessCount.current = updatedStats.successCalls;
      }

      // Add new point to chart
      setChartHistory((prev) => {
        const next = [...prev, updatedStats.winPercentage];
        if (next.length > 20) next.shift(); // limit to 20 history points
        return next;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const generateChartHistory = (currentVal: number) => {
    const points = [];
    let temp = currentVal - 2.5;
    for (let i = 0; i < 12; i++) {
      temp += (Math.random() - 0.4) * 0.6;
      points.push(parseFloat(temp.toFixed(2)));
    }
    points.push(currentVal);
    setChartHistory(points);
  };

  const triggerSuccessFlash = () => {
    setFlashSuccess(true);
    setTimeout(() => setFlashSuccess(false), 1500);
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "SUCCESS": return "שיחה מוצלחת ✅";
      case "NOT_INTERESTED": return "לא מעוניין ❌";
      case "NO_ANSWER": return "אין מענה ⏳";
      case "INVALID_NUMBER": return "מספר שגוי ⚠️";
      default: return status;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case "SUCCESS": return "status-success";
      case "NOT_INTERESTED": return "status-no-interest";
      case "NO_ANSWER": return "status-no-answer";
      case "INVALID_NUMBER": return "status-invalid";
      default: return "";
    }
  };

  // Render SVG Path for Polymarket Line Graph
  const renderSVGChart = () => {
    if (chartHistory.length < 2) return null;
    const width = 600;
    const height = 180;
    const padding = 20;

    const minVal = Math.min(...chartHistory) - 0.5;
    const maxVal = Math.max(...chartHistory) + 0.5;
    const valRange = maxVal - minVal;

    const points = chartHistory.map((val, idx) => {
      const x = padding + (idx / (chartHistory.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - minVal) / valRange) * (height - padding * 2);
      return { x, y };
    });

    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${points[i].x} ${points[i].y}`;
    }

    // Gradient fill path
    const fillPathD = `${pathD} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="svg-chart">
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        
        {/* Grid lines */}
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.05)" strokeDasharray="5,5" />
        
        {/* Fill Area */}
        <path d={fillPathD} fill="url(#chartGrad)" />
        
        {/* Line Path */}
        <path d={pathD} fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" />
        
        {/* Dots */}
        {points.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={idx === points.length - 1 ? 6 : 2.5}
            fill={idx === points.length - 1 ? "#10b981" : "rgba(16, 185, 129, 0.6)"}
            className={idx === points.length - 1 ? "latest-dot" : ""}
          />
        ))}
      </svg>
    );
  };

  if (!stats) {
    return (
      <div className="tv-loading">
        <div className="tv-spinner"></div>
        <h2>מתחבר למטה הפעילות...</h2>
        <p>טוען נתוני שידור חי עבור עמית הלוי</p>
      </div>
    );
  }

  return (
    <div className={`tv-viewport ${flashSuccess ? "flash-success-screen" : ""}`}>
      {/* SUCCESS POPUP OVERLAY */}
      {flashSuccess && (
        <div className="success-overlay">
          <div className="success-overlay-card">
            <span className="celebrate-emoji">⚡ SUCCESS! ⚡</span>
            <h2>נוספה שיחה מוצלחת!</h2>
            <p className="flash-voter-note">מצביע נוסף הבטיח את תמיכתו בעמית הלוי</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="tv-header">
        <div className="header-right">
          <div className="candidate-badge">מטה הבחירות</div>
          <h1>עמית הלוי <span>לראשות הליכוד / פריימריז 2026</span></h1>
        </div>
        <div className="header-left">
          <div className="live-pill">שדור חי • LIVE</div>
          <div className="clock">
            {currentTime.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="tv-grid">
        {/* RIGHT BAR: Statistics & Progress */}
        <aside className="tv-stats-sidebar">
          {/* Win Percentage Gauge */}
          <div className="tv-card gauge-card">
            <h2>סיכוי זכייה משוער</h2>
            <div className="gauge-outer">
              <svg className="gauge-svg">
                <circle cx="80" cy="80" r="70" className="gauge-track" />
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  className="gauge-progress"
                  style={{
                    strokeDasharray: 440,
                    strokeDashoffset: 440 - (440 * stats.winPercentage) / 100,
                  }}
                />
              </svg>
              <div className="gauge-center">
                <span className="gauge-percent-num">{stats.winPercentage}%</span>
                <span className="gauge-label">סיכוי לניצחון</span>
              </div>
            </div>
            <div className="gauge-trend">
              <span className="trend-arrow">▲</span> 24ש: +1.4%
            </div>
          </div>

          {/* General Call Counts Card */}
          <div className="tv-card counter-card">
            <h2>הספק שיחות קמפיין</h2>
            
            <div className="counter-row">
              <div className="counter-item">
                <span className="count-title">שיחות מוצלחות</span>
                <span className="count-value success-color">{stats.successCalls}</span>
              </div>
              <div className="counter-item">
                <span className="count-title">סה"כ שיחות שנענו</span>
                <span className="count-value">{stats.calledContacts}</span>
              </div>
            </div>

            <div className="tv-progress-box">
              <div className="progress-text">
                <span>התקדמות יעד ({stats.calledContacts} / {stats.targetCalls})</span>
                <span>{Math.round((stats.calledContacts / stats.targetCalls) * 100)}%</span>
              </div>
              <div className="tv-progress-bg">
                <div 
                  className="tv-progress-fill" 
                  style={{ width: `${Math.min(100, (stats.calledContacts / stats.targetCalls) * 100)}%` }}
                ></div>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER CONTENT: Polymarket Widget & Leaderboards */}
        <main className="tv-center-content">
          {/* Polymarket Widget */}
          <div className="tv-card polymarket-card">
            <div className="polymarket-header">
              <div className="pm-brand">
                <span className="pm-logo">P</span>
                <h3>polymarket</h3>
                <span className="pm-verified">✓</span>
              </div>
              <div className="pm-toggle">
                <button 
                  className={`pm-btn ${!useIframe ? "active" : ""}`}
                  onClick={() => setUseIframe(false)}
                >
                  גרף מובנה
                </button>
                <button 
                  className={`pm-btn ${useIframe ? "active" : ""}`}
                  onClick={() => setUseIframe(true)}
                >
                  Iframe
                </button>
              </div>
              <span className="pm-title">מניות עמית הלוי - זכייה בפריימריז</span>
            </div>

            <div className="polymarket-body">
              {!useIframe ? (
                /* Built-in high fidelity graph */
                <div className="custom-graph-container">
                  <div className="graph-stats">
                    <div className="graph-price">
                      <span className="dollar-sign">¢</span>
                      <span className="price-num">{Math.round(stats.winPercentage)}</span>
                      <span className="price-unit">מחיר מניה</span>
                    </div>
                    <div className="graph-metrics">
                      <div className="metric">
                        <span className="metric-label">נפח מסחר 24ש</span>
                        <span className="metric-val">$184.2K</span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">סך הכל מהמרים</span>
                        <span className="metric-val">1,842</span>
                      </div>
                    </div>
                  </div>
                  {renderSVGChart()}
                </div>
              ) : (
                /* Iframe display */
                <iframe
                  src={stats.polymarketUrl}
                  title="Likud Polymarket"
                  className="polymarket-iframe"
                  sandbox="allow-scripts allow-same-origin"
                ></iframe>
              )}
            </div>
          </div>

          {/* Bottom Split: Leaderboard & Feed */}
          <div className="tv-bottom-split">
            {/* Caller Leaderboard */}
            <div className="tv-card tv-leaderboard-card">
              <div className="card-title-bar">
                <span className="trophy-icon">🏆</span>
                <h2>טבלת מובילים - דירוג טלפנים</h2>
              </div>
              {stats.leaderboard.length === 0 ? (
                <div className="tv-empty">ממתין לשיחות ראשונות...</div>
              ) : (
                <div className="tv-leaderboard-list">
                  {stats.leaderboard.map((item, idx) => (
                    <div key={item.id} className="leaderboard-item">
                      <div className="leader-rank">
                        {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`}
                      </div>
                      <div className="leader-avatar">{item.name[0]}</div>
                      <div className="leader-name">{item.name}</div>
                      <div className="leader-stats">
                        <span className="leader-success">{item.successCalls} הצלחות</span>
                        <span className="leader-total">/ {item.totalCalls} שיחות</span>
                        <span className="leader-pct">({item.successRate}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live Feed Ticker */}
            <div className="tv-card tv-feed-card">
              <div className="card-title-bar">
                <span className="live-icon">📡</span>
                <h2>דיווחים חיים מהשטח</h2>
              </div>
              {stats.recentCalls.length === 0 ? (
                <div className="tv-empty">ממתין לפעילות טלפנים...</div>
              ) : (
                <div className="tv-feed-list">
                  {stats.recentCalls.map((call) => (
                    <div key={call.id} className="feed-item card-enter-anim">
                      <div className="feed-time">
                        {new Date(call.timestamp).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </div>
                      <div className="feed-content">
                        <strong>{call.callerName}</strong> התקשר ל-<strong>{call.contactName}</strong> 
                      </div>
                      <div className={`feed-status ${getStatusClass(call.status)}`}>
                        {getStatusText(call.status)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
