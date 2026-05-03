import { useState, useEffect, useRef, useCallback } from "react";
import Nav from '../../components/Nav'

// ============================================================
// DATA — Patterns
// ============================================================
const PATTERNS = {
  api_gateway: {
    id: "api_gateway",
    title: "API Gateway",
    icon: "⬡",
    color: "#00d4ff",
    short: "Tek giriş noktası",
    desc: "Tüm istemci isteklerini doğru servise yönlendiren merkezi kapı. Auth, rate-limit, logging burada yapılır.",
    services: ["auth", "order", "product", "notification"],
    steps: [
      { from: "client", to: "gateway", label: "POST /order", delay: 0 },
      { from: "gateway", to: "auth", label: "Token doğrula", delay: 800 },
      { from: "auth", to: "gateway", label: "✓ Geçerli", delay: 1600 },
      { from: "gateway", to: "order", label: "Siparişi oluştur", delay: 2400 },
      { from: "order", to: "gateway", label: "orderId:42", delay: 3200 },
      { from: "gateway", to: "client", label: "200 OK", delay: 4000 },
    ],
  },
  circuit_breaker: {
    id: "circuit_breaker",
    title: "Circuit Breaker",
    icon: "⚡",
    color: "#ff6b35",
    short: "Hata izolasyonu",
    desc: "Bağlı servis defalarca hata verince devre açılır, fallback döner. Cascading failure önlenir.",
    services: ["order", "payment", "fallback"],
    steps: [
      { from: "order", to: "payment", label: "Ödeme isteği", delay: 0, status: "normal" },
      { from: "payment", to: "order", label: "❌ Timeout", delay: 800, status: "error" },
      { from: "order", to: "payment", label: "Yeniden dene", delay: 1600, status: "normal" },
      { from: "payment", to: "order", label: "❌ Timeout", delay: 2400, status: "error" },
      { from: "order", to: "payment", label: "3. deneme", delay: 3200, status: "normal" },
      { from: "payment", to: "order", label: "❌ Timeout", delay: 4000, status: "error" },
      { from: "order", to: "fallback", label: "⚡ Devre AÇIK → Fallback", delay: 4800, status: "circuit" },
      { from: "fallback", to: "order", label: "Cached response", delay: 5600, status: "success" },
    ],
  },
  saga: {
    id: "saga",
    title: "Saga Pattern",
    icon: "⟳",
    color: "#a78bfa",
    short: "Dağıtık transaction",
    desc: "Uzun süreli işlemler zinciri. Her adım başarısız olursa compensating transaction ile geri alınır.",
    services: ["order", "stock", "payment", "shipping"],
    steps: [
      { from: "order", to: "stock", label: "Stok rezerve et", delay: 0 },
      { from: "stock", to: "order", label: "✓ Rezerve", delay: 800 },
      { from: "order", to: "payment", label: "Ödeme al", delay: 1600 },
      { from: "payment", to: "order", label: "❌ Kart reddedildi", delay: 2400, status: "error" },
      { from: "order", to: "stock", label: "↩ Stok iptali (compensate)", delay: 3200, status: "compensate" },
      { from: "stock", to: "order", label: "✓ Rezerv iptal", delay: 4000 },
      { from: "order", to: "order", label: "Saga ROLLBACK tamamlandı", delay: 4800, status: "done" },
    ],
  },
  event_sourcing: {
    id: "event_sourcing",
    title: "Event Sourcing",
    icon: "📋",
    color: "#34d399",
    short: "Olay tabanlı state",
    desc: "State'i doğrudan saklamak yerine olayları sakla. State, olayları tekrar çalıştırarak elde edilir.",
    services: ["command", "eventstore", "projection", "query"],
    steps: [
      { from: "command", to: "eventstore", label: "OrderCreated event", delay: 0 },
      { from: "eventstore", to: "projection", label: "Event publish", delay: 800 },
      { from: "command", to: "eventstore", label: "ItemAdded event", delay: 1600 },
      { from: "eventstore", to: "projection", label: "Event publish", delay: 2400 },
      { from: "command", to: "eventstore", label: "OrderPaid event", delay: 3200 },
      { from: "eventstore", to: "projection", label: "Event publish", delay: 4000 },
      { from: "query", to: "projection", label: "Güncel state?", delay: 4800 },
      { from: "projection", to: "query", label: "Aggregate state", delay: 5600, status: "success" },
    ],
  },
  cqrs: {
    id: "cqrs",
    title: "CQRS",
    icon: "⇆",
    color: "#fbbf24",
    short: "Okuma/yazma ayrımı",
    desc: "Command (yazma) ve Query (okuma) modelleri ayrılır. Her biri için ayrı optimize edilmiş store kullanılır.",
    services: ["client", "write_db", "read_db", "sync"],
    steps: [
      { from: "client", to: "write_db", label: "Command: UpdatePrice", delay: 0 },
      { from: "write_db", to: "sync", label: "DomainEvent yayınla", delay: 800 },
      { from: "sync", to: "read_db", label: "Projection güncelle", delay: 1600 },
      { from: "client", to: "read_db", label: "Query: GetProducts", delay: 2400 },
      { from: "read_db", to: "client", label: "Optimize edilmiş data", delay: 3200, status: "success" },
    ],
  },
  sidecar: {
    id: "sidecar",
    title: "Sidecar Pattern",
    icon: "🏍",
    color: "#f472b6",
    short: "Yan süreç desteği",
    desc: "Her servise eşlik eden küçük yardımcı container. Logging, monitoring, service mesh proxy gibi cross-cutting concern'ler buraya taşınır.",
    services: ["service", "sidecar", "mesh", "log"],
    steps: [
      { from: "service", to: "sidecar", label: "Outbound request", delay: 0 },
      { from: "sidecar", to: "mesh", label: "mTLS + Route", delay: 800 },
      { from: "mesh", to: "sidecar", label: "Response", delay: 1600 },
      { from: "sidecar", to: "service", label: "Decoded response", delay: 2400 },
      { from: "sidecar", to: "log", label: "Metrics & Trace", delay: 3200 },
      { from: "log", to: "sidecar", label: "✓ Logged", delay: 4000, status: "success" },
    ],
  },
};

const SERVICE_COLORS = {
  client: "#94a3b8",
  gateway: "#00d4ff",
  auth: "#818cf8",
  order: "#fb923c",
  product: "#4ade80",
  notification: "#f472b6",
  payment: "#ef4444",
  fallback: "#facc15",
  stock: "#a78bfa",
  shipping: "#34d399",
  command: "#60a5fa",
  eventstore: "#34d399",
  projection: "#a78bfa",
  query: "#fbbf24",
  write_db: "#f87171",
  read_db: "#4ade80",
  sync: "#60a5fa",
  service: "#60a5fa",
  sidecar: "#f472b6",
  mesh: "#a78bfa",
  log: "#fbbf24",
};

const SERVICE_LABELS = {
  client: "Client",
  gateway: "API Gateway",
  auth: "Auth Service",
  order: "Order Service",
  product: "Product Service",
  notification: "Notification",
  payment: "Payment Service",
  fallback: "Fallback Cache",
  stock: "Stock Service",
  shipping: "Shipping Service",
  command: "Command Side",
  eventstore: "Event Store",
  projection: "Projection",
  query: "Query Side",
  write_db: "Write DB",
  read_db: "Read DB (Cache)",
  sync: "Event Bus",
  service: "Ana Servis",
  sidecar: "Sidecar Proxy",
  mesh: "Service Mesh",
  log: "Log Aggregator",
};

// ============================================================
// COMPONENT
// ============================================================
function MicroservicesSimInner() {
  const [activePattern, setActivePattern] = useState("api_gateway");
  const [animStep, setAnimStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const timerRefs = useRef([]);

  const pattern = PATTERNS[activePattern];

  const clearTimers = () => {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
  };

  const handleSelect = (id) => {
    clearTimers();
    setActivePattern(id);
    setAnimStep(-1);
    setRunning(false);
    setCompleted(false);
  };

  const runSimulation = useCallback(() => {
    clearTimers();
    setAnimStep(-1);
    setRunning(true);
    setCompleted(false);

    const steps = PATTERNS[activePattern].steps;
    steps.forEach((step, i) => {
      const t = setTimeout(() => {
        setAnimStep(i);
        if (i === steps.length - 1) {
          setTimeout(() => {
            setRunning(false);
            setCompleted(true);
          }, 600);
        }
      }, step.delay);
      timerRefs.current.push(t);
    });
  }, [activePattern]);

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const services = pattern.services;
  const steps = pattern.steps;
  const activeSteps = animStep >= 0 ? steps.slice(0, animStep + 1) : [];

  return (
    <div style={styles.root}>
      {/* BG grid */}
      <div style={styles.gridBg} />

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>μSvc</span>
          <span style={styles.logoSub}>Simulator</span>
        </div>
        <p style={styles.headerTagline}>Mikroservis Desenlerini İnteraktif Öğren</p>
      </header>

      {/* Pattern Tabs */}
      <nav style={styles.tabs}>
        {Object.values(PATTERNS).map((p) => (
          <button
            key={p.id}
            style={{
              ...styles.tab,
              ...(activePattern === p.id
                ? { ...styles.tabActive, borderColor: p.color, color: p.color, boxShadow: `0 0 16px ${p.color}44` }
                : {}),
            }}
            onClick={() => handleSelect(p.id)}
          >
            <span style={styles.tabIcon}>{p.icon}</span>
            <span style={styles.tabTitle}>{p.title}</span>
            <span style={styles.tabShort}>{p.short}</span>
          </button>
        ))}
      </nav>

      {/* Main area */}
      <main style={styles.main}>
        {/* Left: description */}
        <aside style={styles.sidebar}>
          <div style={{ ...styles.patternBadge, background: pattern.color + "22", borderColor: pattern.color }}>
            <span style={{ fontSize: 36 }}>{pattern.icon}</span>
            <div>
              <div style={{ ...styles.patternTitle, color: pattern.color }}>{pattern.title}</div>
              <div style={styles.patternShort}>{pattern.short}</div>
            </div>
          </div>
          <p style={styles.patternDesc}>{pattern.desc}</p>

          <button
            style={{
              ...styles.runBtn,
              background: running ? "#1e293b" : pattern.color,
              color: running ? pattern.color : "#0a0f1e",
              borderColor: pattern.color,
              boxShadow: running ? `0 0 20px ${pattern.color}33` : `0 0 32px ${pattern.color}88`,
              cursor: running ? "not-allowed" : "pointer",
            }}
            onClick={runSimulation}
            disabled={running}
          >
            {running ? "▶ Çalışıyor..." : completed ? "↺ Tekrar Çalıştır" : "▶ Simülasyonu Başlat"}
          </button>

          {/* Step log */}
          <div style={styles.logBox}>
            <div style={styles.logTitle}>📡 Mesaj Akışı</div>
            {activeSteps.length === 0 && (
              <div style={styles.logEmpty}>Simülasyon başlatılmayı bekliyor...</div>
            )}
            {activeSteps.map((s, i) => (
              <div
                key={i}
                style={{
                  ...styles.logRow,
                  ...(i === animStep ? styles.logRowActive : {}),
                  borderLeftColor:
                    s.status === "error"
                      ? "#ef4444"
                      : s.status === "compensate"
                      ? "#f59e0b"
                      : s.status === "circuit"
                      ? "#ff6b35"
                      : s.status === "success"
                      ? "#34d399"
                      : "#334155",
                }}
              >
                <span style={styles.logFrom}>{SERVICE_LABELS[s.from] || s.from}</span>
                <span style={styles.logArrow}>→</span>
                <span style={styles.logTo}>{SERVICE_LABELS[s.to] || s.to}</span>
                <span style={styles.logLabel}>{s.label}</span>
              </div>
            ))}
            {completed && (
              <div style={styles.logDone}>✓ Akış tamamlandı</div>
            )}
          </div>
        </aside>

        {/* Right: visual diagram */}
        <section style={styles.diagram}>
          <DiagramCanvas
            services={services}
            steps={steps}
            activeStep={animStep}
            patternColor={pattern.color}
          />
        </section>
      </main>

      {/* Bottom: all patterns quick ref */}
      <footer style={styles.footer}>
        <div style={styles.footerTitle}>Desen Referansı</div>
        <div style={styles.footerGrid}>
          {Object.values(PATTERNS).map((p) => (
            <div key={p.id} style={{ ...styles.footerCard, borderColor: p.color + "44" }}>
              <span style={{ color: p.color, fontSize: 18 }}>{p.icon}</span>
              <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 12 }}>{p.title}</span>
              <span style={{ color: "#64748b", fontSize: 11 }}>{p.short}</span>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// Diagram Canvas
// ============================================================
function DiagramCanvas({ services, steps, activeStep, patternColor }) {
  const canvasRef = useRef(null);

  // Layout services in a circle or line
  const getPositions = (svcs) => {
    const w = 560, h = 360;
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) * 0.38;
    if (svcs.length <= 2) {
      return svcs.map((s, i) => ({ id: s, x: 120 + i * 300, y: cy }));
    }
    return svcs.map((s, i) => {
      const angle = (i / svcs.length) * Math.PI * 2 - Math.PI / 2;
      return { id: s, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  };

  const positions = getPositions(services);
  const posMap = Object.fromEntries(positions.map((p) => [p.id, p]));

  const activeSteps = activeStep >= 0 ? steps.slice(0, activeStep + 1) : [];

  return (
    <div style={styles.svgWrapper}>
      <svg viewBox="0 0 560 380" style={{ width: "100%", height: "100%" }}>
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#475569" />
          </marker>
          <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={patternColor} />
          </marker>
          <marker id="arrowhead-error" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#ef4444" />
          </marker>
        </defs>

        {/* Connection lines (all) */}
        {steps.map((s, i) => {
          const from = posMap[s.from];
          const to = posMap[s.to];
          if (!from || !to || s.from === s.to) return null;
          return (
            <line
              key={i}
              x1={from.x} y1={from.y}
              x2={to.x} y2={to.y}
              stroke="#1e293b"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          );
        })}

        {/* Active message lines */}
        {activeSteps.map((s, i) => {
          const from = posMap[s.from];
          const to = posMap[s.to];
          if (!from || !to || s.from === s.to) return null;
          const isLatest = i === activeStep;
          const color =
            s.status === "error"
              ? "#ef4444"
              : s.status === "compensate"
              ? "#f59e0b"
              : s.status === "circuit"
              ? "#ff6b35"
              : s.status === "success"
              ? "#34d399"
              : isLatest
              ? patternColor
              : patternColor + "66";

          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const nx = dx / len, ny = dy / len;
          const pad = 28;
          const x1 = from.x + nx * pad;
          const y1 = from.y + ny * pad;
          const x2 = to.x - nx * pad;
          const y2 = to.y - ny * pad;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;

          return (
            <g key={`active-${i}`}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color}
                strokeWidth={isLatest ? 2.5 : 1.5}
                markerEnd={isLatest ? "url(#arrowhead-active)" : "url(#arrowhead)"}
                filter={isLatest ? "url(#glow)" : undefined}
              />
              {isLatest && (
                <text x={mx} y={my - 8} textAnchor="middle" fill={color} fontSize="9" fontWeight="600"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  {s.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Service nodes */}
        {positions.map((pos) => {
          const isActive =
            activeStep >= 0 &&
            (steps[activeStep]?.from === pos.id || steps[activeStep]?.to === pos.id);
          const color = SERVICE_COLORS[pos.id] || "#94a3b8";

          return (
            <g key={pos.id}>
              <circle
                cx={pos.x} cy={pos.y} r={26}
                fill="#0f172a"
                stroke={isActive ? color : color + "55"}
                strokeWidth={isActive ? 2.5 : 1.5}
                filter={isActive ? "url(#glow)" : undefined}
              />
              {isActive && (
                <circle
                  cx={pos.x} cy={pos.y} r={34}
                  fill="none"
                  stroke={color + "33"}
                  strokeWidth={8}
                />
              )}
              <text x={pos.x} y={pos.y + 4} textAnchor="middle" fill={isActive ? color : color + "aa"}
                fontSize="11" fontWeight="600"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {pos.id.slice(0, 4).toUpperCase()}
              </text>
              <text x={pos.x} y={pos.y + 44} textAnchor="middle" fill="#64748b" fontSize="9">
                {SERVICE_LABELS[pos.id] || pos.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================
const styles = {
  root: {
    minHeight: "100vh",
    background: "#070d1a",
    color: "#e2e8f0",
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
    position: "relative",
    overflow: "hidden",
  },
  gridBg: {
    position: "fixed",
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px)
    `,
    backgroundSize: "40px 40px",
    pointerEvents: "none",
    zIndex: 0,
  },
  header: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 32px 14px",
    borderBottom: "1px solid #0f2342",
  },
  headerLeft: { display: "flex", alignItems: "baseline", gap: 8 },
  logo: {
    fontSize: 28,
    fontWeight: 800,
    background: "linear-gradient(135deg, #00d4ff, #818cf8)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    letterSpacing: -1,
  },
  logoSub: { fontSize: 13, color: "#334155", letterSpacing: 3, textTransform: "uppercase" },
  headerTagline: { fontSize: 11, color: "#475569", letterSpacing: 1 },
  tabs: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    gap: 6,
    padding: "14px 32px",
    overflowX: "auto",
    borderBottom: "1px solid #0f2342",
  },
  tab: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "10px 16px",
    background: "#0a0f1e",
    border: "1px solid #1e293b",
    borderRadius: 8,
    cursor: "pointer",
    color: "#475569",
    transition: "all 0.2s",
    minWidth: 100,
  },
  tabActive: {
    background: "#0d1829",
  },
  tabIcon: { fontSize: 18 },
  tabTitle: { fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" },
  tabShort: { fontSize: 9, color: "#334155" },
  main: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    gap: 0,
    minHeight: 520,
  },
  sidebar: {
    width: 280,
    padding: "24px 20px",
    borderRight: "1px solid #0f2342",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    flexShrink: 0,
  },
  patternBadge: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid",
  },
  patternTitle: { fontSize: 16, fontWeight: 800 },
  patternShort: { fontSize: 10, color: "#64748b", marginTop: 2 },
  patternDesc: { fontSize: 11, color: "#94a3b8", lineHeight: 1.7, margin: 0 },
  runBtn: {
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
    transition: "all 0.2s",
  },
  logBox: {
    flex: 1,
    background: "#080d18",
    borderRadius: 8,
    border: "1px solid #0f2342",
    padding: "12px",
    overflowY: "auto",
    maxHeight: 280,
  },
  logTitle: { fontSize: 10, color: "#475569", marginBottom: 8, letterSpacing: 1 },
  logEmpty: { fontSize: 10, color: "#1e293b", fontStyle: "italic" },
  logRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    padding: "5px 0 5px 8px",
    borderLeft: "2px solid",
    marginBottom: 4,
    fontSize: 10,
    color: "#64748b",
    transition: "all 0.3s",
  },
  logRowActive: { color: "#e2e8f0" },
  logFrom: { color: "#818cf8", fontWeight: 600 },
  logArrow: { color: "#334155" },
  logTo: { color: "#34d399", fontWeight: 600 },
  logLabel: { color: "#94a3b8", marginLeft: 4 },
  logDone: {
    marginTop: 8,
    padding: "6px 10px",
    background: "#052e16",
    borderRadius: 4,
    color: "#34d399",
    fontSize: 10,
    fontWeight: 700,
  },
  diagram: {
    flex: 1,
    padding: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  svgWrapper: {
    width: "100%",
    maxWidth: 580,
    aspectRatio: "560/380",
    background: "#080d18",
    borderRadius: 12,
    border: "1px solid #0f2342",
    overflow: "hidden",
  },
  footer: {
    position: "relative",
    zIndex: 1,
    padding: "16px 32px 24px",
    borderTop: "1px solid #0f2342",
  },
  footerTitle: { fontSize: 9, color: "#334155", letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" },
  footerGrid: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  footerCard: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "8px 12px",
    background: "#0a0f1e",
    borderRadius: 6,
    border: "1px solid",
    minWidth: 110,
  },
};

export default function MicroservicesSim() {
  return (
    <>
      <Nav />
      <div style={{ paddingTop: 48 }}>
        <MicroservicesSimInner />
      </div>
    </>
  )
}
