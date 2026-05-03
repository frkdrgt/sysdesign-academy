import { useState, useEffect, useRef, useCallback } from "react";
import Nav from '../../components/Nav'

// ─────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────
const RATE_ALGORITHMS = [
  {
    id: "fixed_window",
    name: "Fixed Window",
    accent: "#f87171",
    problem: "Saniyede 10 istek limiti var. İkinci pencerenin sonunda 10 + yeni pencerenin başında 10 istek = 20 istek geçer. Boundary exploit!",
    solution: "Zaman, sabit boyutlu dilimlere bölünür (örn. her 1 saniye). Her pencerede istek sayacı sıfırlanır. Limit aşılınca 429 döner. Basit ama pencere sınırında burst açığı var.",
    whenToUse: ["Basit API key rate limit (GitHub, Stripe sandbox)", "Redis INCR + EXPIRE ile tek komutla uygulanır", "Kesin sınır şart değil, genel abuse önleme yeterliyse"],
    pitfalls: ["Boundary burst: 00:59.9 → 10 req + 01:00.0 → 10 req = 20 req/s efektif rate — 2x limit aşımı", "Saydaç sıfırlanırken tüm engellenen client'lar aynı anda retry yapar — thundering herd", "Distributed ortamda her node kendi sayacını tutarsa toplam limit N kat aşılabilir — merkezi Redis zorunlu"],
    simulate: (rps) => {
      const W = 10, limit = 10;
      const events = [];
      for (let t = 0; t < W; t++) {
        const count = rps[t] || 0;
        for (let i = 0; i < count; i++) {
          const inWindow = t < 1 ? events.filter(e => e.window === t).length : events.filter(e => e.window === t).length;
          events.push({ t, i, allowed: inWindow < limit, window: Math.floor(t) });
        }
      }
      return events;
    },
  },
  {
    id: "sliding_window",
    name: "Sliding Window",
    accent: "#fb923c",
    problem: "Fixed window'un boundary exploit sorununu nasıl çözeriz? Geçen 1 saniyedeki toplam isteği sayabilsek?",
    solution: "Her istek geldiğinde son N saniyedeki istek sayısı hesaplanır. Eski istek timestamp'leri Redis sorted set'te tutulur. Gerçek sliding: O(count) pahalı. Log-based veya counter+weight yaklaşımıyla optimize edilir.",
    whenToUse: ["Boundary burst'ü tolere edemezseniz (ödeme API, kritik endpoint)", "Redis Sorted Set: ZADD + ZCOUNT ile implementasyon", "Stripe, Shopify production'da bu yaklaşımı kullanır"],
    pitfalls: ["Her timestamp saklanırsa memory O(count) artar — high-traffic'te pahalı", "Sliding window counter (approximate): önceki penceredeki istek sayısını interpolasyon ile tahmin eder — %1-2 hata payı var", "Distributed sliding window: clock skew farklı node'larda boundary hesaplamasını bozabilir"],
    simulate: null,
  },
  {
    id: "token_bucket",
    name: "Token Bucket",
    accent: "#facc15",
    problem: "Fixed/sliding window ani burst'leri bloke ediyor. Kısa süreli yoğun trafik normalse nasıl izin veririz?",
    solution: "Bucket'ta N token var. Her istek 1 token tüketir. Token'lar sabit hızda (rate/s) eklenir, max kapasiteye ulaşınca dolar. Token varsa geçer, yoksa 429. Burst capacity = bucket size.",
    whenToUse: ["API gateway (AWS API GW, Kong): burst izin ver ama sustained rate'i sınırla", "Dosya indirme: anlık 5 MB/s burst, uzun vadede 1 MB/s", "Her user için ayrı bucket — Redis hash ile verimli saklanır"],
    pitfalls: ["Bucket boyutu = max burst: çok büyük tutarsan downstream'i bunaltır", "Token ekleme hassasiyeti: çok sık eklersen overhead, çok seyrek eklersen rate accuracy bozulur", "Distributed: birden fazla node aynı bucket'ı okursa race condition — Redis Lua script ile atomik yap"],
    simulate: null,
  },
  {
    id: "leaky_bucket",
    name: "Leaky Bucket",
    accent: "#34d399",
    problem: "Token bucket hâlâ burst yapılmasına izin veriyor. Downstream'e uniform, sabit hızda istek göndermek istiyoruz.",
    solution: "İstekler bucket'a girer (FIFO queue). Bucket sabit hızda 'sızar' (downstream'e iletir). Bucket doluysa yeni istek düşer. Çıkış hızı her zaman sabit — downstream hiç burst görmez.",
    whenToUse: ["Downstream servis sabit hız istiyor: SMS gateway, e-posta relay, ödeme provider", "Traffic shaping: network paketlerini uniform hıza normalize et", "Bant genişliği sınırlama (ISP, CDN egress kontrolü)"],
    pitfalls: ["Sıradaki istekler bekler: latency artar, timeout riski var — bucket boyutu dikkatli seçilmeli", "Burst absorbe edilemez: aniden gelen 100 isteğin 90'ı düşebilir — token bucket bu konuda daha esnek", "Queue doluyken gelen istekler bilgi vermeden drop edilir — client backpressure mekanizması şart"],
    simulate: null,
  },
];

// ─────────────────────────────────────────────
// LOAD BALANCING
// ─────────────────────────────────────────────
const LB_ALGORITHMS = [
  {
    id: "round_robin",
    name: "Round Robin",
    accent: "#60a5fa",
    problem: "Birden fazla server var. İstekleri nasıl dağıtalım?",
    solution: "İstekler sırayla her server'a gönderilir: S1, S2, S3, S1, S2, S3... Basit ve deterministik. Server'ların eşit kapasitede olduğunu varsayar. Weighted Round Robin ile farklı kapasiteler desteklenir.",
    whenToUse: ["Stateless API'ler: her request bağımsız, hangi server'a gittiği önemli değil", "Eşit kapasiteli server'lar: CPU/memory yakın", "Nginx, HAProxy, AWS ALB varsayılan algoritması"],
    pitfalls: ["Server'lar farklı hızda işliyorsa yavaş server istik biriktirir — least connections daha iyi", "Long-lived connection'larda (WebSocket) bir server daha fazla bağlantı taşıyabilir", "Stateful session: aynı kullanıcı farklı server'a düşerse session kaybolur — sticky session veya dış session store şart"],
    servers: [
      { id: "s1", label: "Server 1", load: 0, capacity: 100 },
      { id: "s2", label: "Server 2", load: 0, capacity: 100 },
      { id: "s3", label: "Server 3", load: 0, capacity: 100 },
    ],
    distribute: (servers, reqIdx) => reqIdx % servers.length,
  },
  {
    id: "least_conn",
    name: "Least Connections",
    accent: "#a78bfa",
    problem: "Round robin'de bazı istekler uzun sürer, o server dolup taşar. En az bağlantısı olan server'ı seçsek?",
    solution: "Her yeni istek, o an en az aktif bağlantısı olan server'a gönderilir. Uzun süreli bağlantılar (database query, file upload) olan server'lar daha az yeni istek alır. Dynamic, gerçek yüke duyarlı.",
    whenToUse: ["Heterojen istek süreleri: bazı endpoint'ler hızlı (100ms), bazıları yavaş (5s)", "Database connection pool load balancing", "gRPC streaming, WebSocket bağlantı dağıtımı"],
    pitfalls: ["Connection sayısı her zaman gerçek load'u yansıtmaz: 1 ağır istek = 100 hafif istek gibi gözükür", "Yeni server ekleme: 0 connection'la başlar, tüm yeni istekler oraya yığılır — slow start ile yumuşat", "Bağlantı sayısı güncelliği: distributed LB'de her node kendi bilgisine dayanır — gossip protokolü veya merkezi state"],
    servers: [
      { id: "s1", label: "Server 1", load: 0, capacity: 100 },
      { id: "s2", label: "Server 2", load: 0, capacity: 100 },
      { id: "s3", label: "Server 3", load: 0, capacity: 100 },
    ],
    distribute: (servers) => servers.reduce((minIdx, s, i, arr) => s.load < arr[minIdx].load ? i : minIdx, 0),
  },
  {
    id: "consistent_hash_lb",
    name: "Consistent Hash (LB)",
    accent: "#f472b6",
    problem: "Cache sonuçlarını server'da tutuyoruz ama her istek farklı server'a giderse cache miss olur.",
    solution: "hash(client_ip veya user_id) ile hangi server'a gideceği belirlenir. Aynı client her zaman aynı server'a gider (sticky). Server eklenince/çıkınca sadece komşu key'ler taşınır.",
    whenToUse: ["Cache locality: aynı kullanıcının isteği aynı server'a — in-memory cache hit oranı yükselir", "Stateful session: session store olmadan session aynı server'da kalır", "Shard routing: consistent hash ile hangi DB shard'ına gideceğini belirle"],
    pitfalls: ["Server çökünce o server'ın tüm 'sticky' client'ları başka server'a geçer — cache flush", "Hotspot: bazı hash aralıkları çok popülerse tek server bunalır — virtual nodes ile dağıt", "IP tabanlı hash: NAT arkasındaki client'lar aynı IP'yi paylaşır — tüm oturumlar aynı server'a yığılır"],
    servers: [
      { id: "s1", label: "Server 1", load: 0, capacity: 100 },
      { id: "s2", label: "Server 2", load: 0, capacity: 100 },
      { id: "s3", label: "Server 3", load: 0, capacity: 100 },
    ],
    distribute: (servers, reqIdx, clientId) => Math.abs(clientId * 2654435761 | 0) % servers.length,
  },
];

// ─────────────────────────────────────────────
// AUTO-SCALING
// ─────────────────────────────────────────────
const AUTOSCALE_SCENARIOS = [
  {
    id: "cpu_scale_out",
    name: "CPU Tabanlı Scale-Out",
    accent: "#f97316",
    problem: "Trafik artınca CPU yükseldi ve istekler yavaşladı. Yeni instance ne zaman, nasıl eklenir?",
    solution: "CloudWatch/Datadog CPU metriği izler. %70 threshold'u aşınca scale-out politikası tetiklenir. Yeni instance başlar, load balancer'a eklenir. Cooldown period boyunca yeni scale-out tetiklenmez (büyük gap önlenir).",
    whenToUse: ["Stateless web/API servisleri: horizontal scale trivial", "Compute-heavy workload: ML inference, video encoding, batch işleme", "AWS Auto Scaling Group, Kubernetes HPA (Horizontal Pod Autoscaler)"],
    pitfalls: ["Scale-out gecikmesi: yeni instance boot + warm-up süresi 1-3 dakika olabilir — proactive scaling veya scheduled scaling ile öne al", "Thrashing: scale-out → cooldown bitmeden metrik düşer → scale-in → tekrar artar → ping-pong — cooldown süresini doğru ayarla", "Stateful uygulama: session data yeni instance'ta yok — dış session store (Redis) şart"],
    timeline: [
      { t: 0,  cpu: 20, instances: 2, event: null },
      { t: 1,  cpu: 35, instances: 2, event: null },
      { t: 2,  cpu: 55, instances: 2, event: null },
      { t: 3,  cpu: 72, instances: 2, event: "⚠ CPU %72 — threshold aşıldı!" },
      { t: 4,  cpu: 78, instances: 2, event: "🚀 Scale-out tetiklendi" },
      { t: 5,  cpu: 75, instances: 3, event: "✓ 3. instance eklendi" },
      { t: 6,  cpu: 58, instances: 3, event: null },
      { t: 7,  cpu: 42, instances: 3, event: null },
      { t: 8,  cpu: 30, instances: 3, event: "🔻 Scale-in değerlendiriliyor" },
      { t: 9,  cpu: 22, instances: 2, event: "↓ 3→2 instance (scale-in)" },
      { t: 10, cpu: 20, instances: 2, event: null },
    ],
  },
  {
    id: "queue_scale",
    name: "Queue Depth Tabanlı",
    accent: "#818cf8",
    problem: "CPU düşük ama işler birikim yapıyor. CPU'ya bakarak scale edemeyiz. Queue doluysa worker ekle.",
    solution: "SQS/RabbitMQ kuyruğundaki mesaj sayısı izlenir. Mesaj sayısı / worker başına hedef oran aşılınca yeni worker instance eklenir. Throughput-based scaling, CPU-agnostic.",
    whenToUse: ["Background job worker'ları: video transcode, e-posta gönderimi, rapor oluşturma", "Event-driven microservice: Kafka consumer group partition'a göre scale", "AWS SQS + Lambda: queue depth'e göre concurrency otomatik ayarlanır"],
    pitfalls: ["Queue drain spike: scale-out oldu, worker'lar hızla kuyruk tüketiyor, scale-in da tetiklenir — worker bitmeden kuyruğu bitirmek istersek min instance floor koy", "Poison pill: bir mesaj hiç işlenemiyorsa DLQ'ya gitmeden queue'da kalır, sürekli worker spawn tetikler — max receive count ayarla", "Visibility timeout: worker işlemi uzun sürerse mesaj tekrar görünür ve başka worker da alır — double processing"],
    timeline: [
      { t: 0,  queue: 5,   instances: 1, event: null },
      { t: 1,  queue: 120, instances: 1, event: "📥 Büyük batch geldi" },
      { t: 2,  queue: 280, instances: 1, event: "⚠ Queue depth: 280 — limit: 100" },
      { t: 3,  queue: 310, instances: 2, event: "🚀 +1 worker eklendi" },
      { t: 4,  queue: 320, instances: 3, event: "🚀 +1 worker daha eklendi" },
      { t: 5,  queue: 240, instances: 3, event: null },
      { t: 6,  queue: 150, instances: 3, event: null },
      { t: 7,  queue: 80,  instances: 3, event: null },
      { t: 8,  queue: 30,  instances: 2, event: "↓ 3→2 worker (scale-in)" },
      { t: 9,  queue: 8,   instances: 1, event: "↓ 2→1 worker (scale-in)" },
      { t: 10, queue: 2,   instances: 1, event: null },
    ],
  },
];

// ─────────────────────────────────────────────
// SECTIONS
// ─────────────────────────────────────────────
const SECTIONS = [
  { id: "ratelimit",  label: "Rate Limiting",   emoji: "🚦", accent: "#f87171" },
  { id: "lb",         label: "Load Balancing",  emoji: "⚖",  accent: "#60a5fa" },
  { id: "autoscale",  label: "Auto-Scaling",    emoji: "📈", accent: "#f97316" },
];

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
function ScalabilitySimInner() {
  const [section, setSection] = useState("ratelimit");
  const [subIdx, setSubIdx] = useState(0);
  const [animStep, setAnimStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [lbReqs, setLbReqs] = useState([]);
  const [lbServers, setLbServers] = useState(LB_ALGORITHMS[0].servers.map(s => ({ ...s })));
  const [lbReqCount, setLbReqCount] = useState(0);
  const timers = useRef([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const switchSection = (s) => { clearTimers(); setSection(s); setSubIdx(0); setAnimStep(-1); setRunning(false); setDone(false); resetLb(0, s); };
  const switchSub = (i) => { clearTimers(); setSubIdx(i); setAnimStep(-1); setRunning(false); setDone(false); resetLb(i, section); };

  const resetLb = (i, sec) => {
    if (sec === "lb") {
      setLbServers(LB_ALGORITHMS[i].servers.map(s => ({ ...s, load: 0 })));
      setLbReqs([]);
      setLbReqCount(0);
    }
  };

  const curSection = SECTIONS.find(s => s.id === section);
  const curData = section === "ratelimit" ? RATE_ALGORITHMS[subIdx]
    : section === "lb" ? LB_ALGORITHMS[subIdx]
    : AUTOSCALE_SCENARIOS[subIdx];

  const accent = curData.accent;

  // Auto-scale sim
  const runAutoScale = useCallback(() => {
    const data = section === "autoscale" ? AUTOSCALE_SCENARIOS[subIdx] : null;
    if (!data) return;
    clearTimers(); setAnimStep(-1); setRunning(true); setDone(false);
    data.timeline.forEach((_, i) => {
      const t = setTimeout(() => {
        setAnimStep(i);
        if (i === data.timeline.length - 1) setTimeout(() => { setRunning(false); setDone(true); }, 600);
      }, i * 700);
      timers.current.push(t);
    });
  }, [section, subIdx]);

  // LB: send request
  const sendRequest = useCallback(() => {
    const algo = LB_ALGORITHMS[subIdx];
    setLbServers(prev => {
      const newServers = prev.map(s => ({ ...s }));
      const clientId = lbReqCount;
      const targetIdx = algo.distribute(newServers, lbReqCount, clientId);
      newServers[targetIdx].load = Math.min(newServers[targetIdx].load + 12, 100);
      setLbReqs(r => [...r.slice(-8), { id: lbReqCount, target: newServers[targetIdx].id, algo: algo.id }]);
      setLbReqCount(c => c + 1);
      // Auto-decay after 1.5s
      const idx = targetIdx;
      const t = setTimeout(() => {
        setLbServers(p => p.map((s, i) => i === idx ? { ...s, load: Math.max(0, s.load - 12) } : s));
      }, 1500);
      timers.current.push(t);
      return newServers;
    });
  }, [subIdx, lbReqCount]);

  useEffect(() => () => clearTimers(), []);

  const subList = section === "ratelimit" ? RATE_ALGORITHMS : section === "lb" ? LB_ALGORITHMS : AUTOSCALE_SCENARIOS;

  return (
    <div style={S.root}>
      <div style={S.meshBg} />

      {/* HEADER */}
      <header style={S.header}>
        <div style={S.hLeft}>
          <div style={{ ...S.hIcon, background: accent + "22", borderColor: accent + "55", color: accent }}>{curSection.emoji}</div>
          <div>
            <div style={S.hTitle}>Ölçeklenebilirlik Desenleri</div>
            <div style={S.hSub}>Rate Limiting · Load Balancing · Auto-Scaling</div>
          </div>
        </div>
        <div style={{ ...S.hBadge, color: accent, borderColor: accent + "44", background: accent + "11" }}>{curData.name}</div>
      </header>

      {/* SECTION TABS */}
      <nav style={S.secNav}>
        {SECTIONS.map(sec => (
          <button key={sec.id} onClick={() => switchSection(sec.id)} style={{
            ...S.secBtn,
            ...(section === sec.id ? { borderColor: sec.accent, color: sec.accent, background: sec.accent + "11", boxShadow: `0 0 16px ${sec.accent}33` } : {}),
          }}>
            <span>{sec.emoji}</span><span>{sec.label}</span>
          </button>
        ))}
      </nav>

      <div style={S.body}>
        {/* LEFT */}
        <aside style={S.left}>
          <div style={S.subList}>
            {subList.map((p, i) => (
              <button key={p.id} onClick={() => switchSub(i)} style={{
                ...S.subBtn,
                ...(i === subIdx ? { borderColor: p.accent, color: p.accent, background: p.accent + "11" } : {}),
              }}>{p.name}</button>
            ))}
          </div>
          <div style={{ ...S.card, borderColor: accent + "44" }}>
            <div style={{ ...S.lbl, color: accent }}>⚠ Problem</div>
            <p style={S.cardTxt}>{curData.problem}</p>
          </div>
          <div style={{ ...S.card, borderColor: "#0d2040" }}>
            <div style={S.lbl}>✦ Çözüm</div>
            <p style={S.cardTxt}>{curData.solution}</p>
          </div>
          <div style={S.listCard}>
            <div style={S.lbl}>✓ Ne Zaman</div>
            {curData.whenToUse.map((w, i) => (
              <div key={i} style={S.listRow}><span style={{ color: "#34d399", flexShrink: 0 }}>›</span><span style={S.listTxt}>{w}</span></div>
            ))}
          </div>
          <div style={S.listCard}>
            <div style={S.lbl}>⚡ Dikkat Et</div>
            {curData.pitfalls.map((p, i) => (
              <div key={i} style={S.listRow}><span style={{ color: "#f97316", flexShrink: 0 }}>›</span><span style={S.listTxt}>{p}</span></div>
            ))}
          </div>
        </aside>

        {/* CENTER */}
        <main style={S.center}>
          {section === "ratelimit" && <RateLimitViz data={curData} accent={accent} />}
          {section === "lb" && <LBViz algo={LB_ALGORITHMS[subIdx]} servers={lbServers} reqs={lbReqs} onSend={sendRequest} accent={accent} />}
          {section === "autoscale" && (
            <>
              <AutoScaleViz data={curData} animStep={animStep} accent={accent} />
              <button onClick={runAutoScale} disabled={running} style={{
                ...S.runBtn,
                background: running ? "transparent" : accent,
                color: running ? accent : "#060c14",
                borderColor: accent,
                boxShadow: running ? "none" : `0 0 24px ${accent}66`,
              }}>{running ? "⟳ İzleniyor..." : done ? "↺ Tekrar" : "▶ Simüle Et"}</button>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RATE LIMIT VIZ
// ─────────────────────────────────────────────
function RateLimitViz({ data, accent }) {
  const [bucketTokens, setBucketTokens] = useState(10);
  const [bucketQueue, setBucketQueue] = useState([]);
  const [windowCount, setWindowCount] = useState(0);
  const [windowTime, setWindowTime] = useState(10);
  const [requests, setRequests] = useState([]);
  const intervalRef = useRef(null);
  const LIMIT = 10;

  // Window countdown
  useEffect(() => {
    if (data.id === "fixed_window" || data.id === "sliding_window") {
      intervalRef.current = setInterval(() => {
        setWindowTime(t => {
          if (t <= 1) { setWindowCount(0); return 10; }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(intervalRef.current);
    }
    if (data.id === "token_bucket") {
      intervalRef.current = setInterval(() => {
        setBucketTokens(t => Math.min(10, t + 1));
      }, 800);
      return () => clearInterval(intervalRef.current);
    }
  }, [data.id]);

  const sendReq = () => {
    const id = Date.now();
    let allowed = false;
    if (data.id === "fixed_window") {
      allowed = windowCount < LIMIT;
      if (allowed) setWindowCount(c => c + 1);
    } else if (data.id === "sliding_window") {
      const now = Date.now();
      setRequests(prev => {
        const recent = prev.filter(r => now - r.ts < 3000);
        allowed = recent.length < LIMIT;
        if (allowed) return [...recent, { ts: now, id, allowed: true }];
        return recent;
      });
    } else if (data.id === "token_bucket") {
      if (bucketTokens > 0) { setBucketTokens(t => t - 1); allowed = true; }
    } else if (data.id === "leaky_bucket") {
      allowed = bucketQueue.length < 8;
      if (allowed) {
        setBucketQueue(q => [...q, id]);
        setTimeout(() => setBucketQueue(q => q.filter(x => x !== id)), 1200);
      }
    }
    setRequests(prev => [...prev.slice(-14), { id, allowed, ts: Date.now() }]);
  };

  return (
    <div style={S.rlBox}>
      {/* Algorithm visual */}
      {(data.id === "fixed_window") && (
        <div style={S.rlVisual}>
          <div style={S.rlTitle}>Pencere: {windowTime}s kaldı</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
            {Array.from({ length: LIMIT }).map((_, i) => (
              <div key={i} style={{ ...S.rlSlot, background: i < windowCount ? accent : "#0d2040", borderColor: i < windowCount ? accent : "#1e3a5f" }} />
            ))}
          </div>
          <div style={{ color: "#64748b", fontSize: 10, marginTop: 6 }}>{windowCount} / {LIMIT} kullanıldı</div>
          <div style={{ ...S.progressBar }}>
            <div style={{ width: `${(windowTime / 10) * 100}%`, height: "100%", background: accent, transition: "width 1s linear" }} />
          </div>
        </div>
      )}
      {data.id === "sliding_window" && (
        <div style={S.rlVisual}>
          <div style={S.rlTitle}>Kayan Pencere (son 3s)</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
            {Array.from({ length: LIMIT }).map((_, i) => {
              const recent = requests.filter(r => Date.now() - r.ts < 3000 && r.allowed);
              return <div key={i} style={{ ...S.rlSlot, background: i < recent.length ? accent : "#0d2040", borderColor: i < recent.length ? accent : "#1e3a5f" }} />;
            })}
          </div>
          <div style={{ color: "#64748b", fontSize: 10, marginTop: 6 }}>Pencere sürekli kayar — sınır her zaman son 3s'yi kapsar</div>
        </div>
      )}
      {data.id === "token_bucket" && (
        <div style={S.rlVisual}>
          <div style={S.rlTitle}>Token Bucket (kapasite: 10)</div>
          <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ ...S.token, background: i < bucketTokens ? accent : "#0d2040", borderColor: i < bucketTokens ? accent + "aa" : "#1e3a5f", transform: i < bucketTokens ? "scale(1)" : "scale(0.8)", transition: "all 0.3s" }} />
            ))}
          </div>
          <div style={{ color: "#64748b", fontSize: 10, marginTop: 6 }}>{bucketTokens} token kaldı · +1 token/800ms doldu</div>
        </div>
      )}
      {data.id === "leaky_bucket" && (
        <div style={S.rlVisual}>
          <div style={S.rlTitle}>Leaky Bucket (kapasite: 8)</div>
          <div style={S.leakyBucket}>
            <div style={{ ...S.bucketBody, borderColor: accent + "66" }}>
              {bucketQueue.map((id, i) => (
                <div key={id} style={{ ...S.bucketItem, background: accent + "22", borderColor: accent + "44", color: accent }}>REQ</div>
              ))}
            </div>
            <div style={{ color: "#64748b", fontSize: 9, marginTop: 4 }}>↓ sabit hızda sızıyor</div>
            <div style={{ width: 2, height: 20, background: accent, margin: "0 auto" }} />
            <div style={{ ...S.bucketDrain, color: accent }}>→ downstream</div>
          </div>
          <div style={{ color: "#64748b", fontSize: 10 }}>{bucketQueue.length}/8 dolu</div>
        </div>
      )}

      {/* Send button */}
      <button onClick={sendReq} style={{ ...S.runBtn, background: accent, color: "#060c14", borderColor: accent, boxShadow: `0 0 20px ${accent}55` }}>
        ▶ İstek Gönder
      </button>

      {/* Request log */}
      <div style={S.rlLog}>
        {requests.slice().reverse().map((r, i) => (
          <div key={r.id} style={{ ...S.rlReq, borderLeftColor: r.allowed ? accent : "#ef4444", opacity: i > 6 ? 0.4 : 1 }}>
            <span style={{ color: r.allowed ? accent : "#ef4444", fontSize: 10, fontWeight: 800 }}>{r.allowed ? "✓ PASS" : "✗ 429"}</span>
            <span style={{ color: "#475569", fontSize: 9, marginLeft: 8 }}>req #{r.id.toString().slice(-4)}</span>
          </div>
        ))}
        {requests.length === 0 && <div style={{ color: "#1e3a5f", fontSize: 9, fontStyle: "italic" }}>Henüz istek gönderilmedi</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LOAD BALANCER VIZ
// ─────────────────────────────────────────────
function LBViz({ algo, servers, reqs, onSend, accent }) {
  return (
    <div style={S.lbBox}>
      <div style={S.lbDiagram}>
        {/* LB node */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ ...S.lbNode, borderColor: accent, color: accent, boxShadow: `0 0 16px ${accent}44` }}>LB</div>
          <div style={{ color: "#475569", fontSize: 8 }}>{algo.name}</div>
        </div>
        {/* Arrow */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, justifyContent: "center" }}>
          {servers.map((_, i) => <div key={i} style={{ color: "#1e3a5f", fontSize: 10 }}>→</div>)}
        </div>
        {/* Servers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {servers.map((s, i) => {
            const recentTarget = reqs[reqs.length - 1]?.target === s.id;
            return (
              <div key={s.id} style={{ ...S.serverCard, borderColor: recentTarget ? accent : "#0d2040", boxShadow: recentTarget ? `0 0 14px ${accent}44` : "none" }}>
                <div style={{ color: recentTarget ? accent : "#64748b", fontWeight: 700, fontSize: 10 }}>{s.label}</div>
                <div style={S.loadTrack}>
                  <div style={{ width: `${s.load}%`, height: "100%", background: s.load > 70 ? "#ef4444" : accent, borderRadius: 3, transition: "width 0.4s" }} />
                </div>
                <div style={{ color: "#475569", fontSize: 9 }}>{s.load}% yük</div>
              </div>
            );
          })}
        </div>
      </div>
      <button onClick={onSend} style={{ ...S.runBtn, background: accent, color: "#060c14", borderColor: accent, boxShadow: `0 0 20px ${accent}55` }}>
        ▶ İstek Gönder
      </button>
      <div style={S.rlLog}>
        {reqs.slice().reverse().map((r, i) => (
          <div key={r.id} style={{ ...S.rlReq, borderLeftColor: accent, opacity: i > 5 ? 0.4 : 1 }}>
            <span style={{ color: accent, fontWeight: 700, fontSize: 9 }}>→ {r.target}</span>
            <span style={{ color: "#475569", fontSize: 8, marginLeft: 6 }}>req #{r.id}</span>
          </div>
        ))}
        {reqs.length === 0 && <div style={{ color: "#1e3a5f", fontSize: 9, fontStyle: "italic" }}>İstek gönderilmedi</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// AUTO-SCALE VIZ
// ─────────────────────────────────────────────
function AutoScaleViz({ data, animStep, accent }) {
  const timeline = data.timeline;
  const current = animStep >= 0 ? timeline[animStep] : null;
  const isQueue = data.id === "queue_scale";

  return (
    <div style={S.asBox}>
      {/* Chart */}
      <div style={S.asChart}>
        <svg viewBox="0 0 600 200" style={{ width: "100%", height: "100%" }}>
          <defs>
            <filter id="glowas"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          {/* Threshold line */}
          <line x1="20" y1={isQueue ? 80 : 60} x2="580" y2={isQueue ? 80 : 60} stroke="#ef444444" strokeWidth="1" strokeDasharray="4 4"/>
          <text x="582" y={isQueue ? 84 : 64} fill="#ef444466" fontSize="8" fontFamily="monospace">{isQueue ? "100 msg" : "70%"}</text>

          {/* Bars */}
          {timeline.map((tp, i) => {
            const x = 20 + i * 52;
            const val = isQueue ? tp.queue : tp.cpu;
            const maxVal = isQueue ? 350 : 100;
            const barH = (val / maxVal) * 140;
            const isActive = animStep >= i;
            const isCurrent = i === animStep;
            return (
              <g key={i}>
                <rect x={x} y={170 - barH} width={30} height={barH}
                  fill={isActive ? (val > (isQueue ? 100 : 70) ? "#ef4444" : accent) : "#0d2040"}
                  opacity={isCurrent ? 1 : isActive ? 0.7 : 0.3}
                  filter={isCurrent ? "url(#glowas)" : undefined}
                  rx={2}
                />
                {/* Instance dots */}
                {Array.from({ length: tp.instances }).map((_, ii) => (
                  <circle key={ii} cx={x + 15 + (ii - (tp.instances - 1) / 2) * 12} cy={180 + ii * 0}
                    r={5} fill={isActive ? "#60a5fa" : "#0d2040"}
                    opacity={isActive ? 1 : 0.3}
                  />
                ))}
                <text x={x + 15} y={195} textAnchor="middle" fill="#334155" fontSize="8" fontFamily="monospace">{tp.t}s</text>
              </g>
            );
          })}

          {/* Legend */}
          <rect x={20} y={5} width={10} height={10} fill={accent} rx={2}/>
          <text x={34} y={14} fill="#64748b" fontSize="8" fontFamily="monospace">{isQueue ? "Queue depth" : "CPU %"}</text>
          <circle cx={130} cy={10} r={5} fill="#60a5fa"/>
          <text x={140} y={14} fill="#64748b" fontSize="8" fontFamily="monospace">Instance</text>
        </svg>
      </div>

      {/* Current state */}
      <div style={S.asState}>
        <div style={S.asMetric}>
          <div style={{ color: "#475569", fontSize: 9 }}>{isQueue ? "QUEUE DEPTH" : "CPU"}</div>
          <div style={{ color: current ? (isQueue ? current.queue > 100 : current.cpu > 70) ? "#ef4444" : accent : "#334155", fontSize: 28, fontWeight: 800 }}>
            {current ? (isQueue ? current.queue : current.cpu) : "—"}{isQueue ? "" : "%"}
          </div>
        </div>
        <div style={S.asMetric}>
          <div style={{ color: "#475569", fontSize: 9 }}>INSTANCE</div>
          <div style={{ color: "#60a5fa", fontSize: 28, fontWeight: 800 }}>×{current ? current.instances : "—"}</div>
        </div>
        <div style={{ flex: 1 }}>
          {current?.event && (
            <div style={{ ...S.asEvent, borderColor: accent + "55", color: accent, background: accent + "11" }}>{current.event}</div>
          )}
        </div>
      </div>

      {/* Instance visualization */}
      <div style={S.instanceRow}>
        {current && Array.from({ length: current.instances }).map((_, i) => (
          <div key={i} style={{ ...S.instanceBox, borderColor: "#60a5fa", boxShadow: "0 0 12px #60a5fa33" }}>
            <div style={{ color: "#60a5fa", fontSize: 9, fontWeight: 700 }}>SVC-{i + 1}</div>
            <div style={{ color: "#334155", fontSize: 8 }}>running</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const S = {
  root: { minHeight:"100vh", background:"#060c14", color:"#e2e8f0", fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace", display:"flex", flexDirection:"column", position:"relative" },
  meshBg: { position:"fixed", inset:0, pointerEvents:"none", zIndex:0, backgroundImage:"linear-gradient(rgba(96,165,250,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(96,165,250,0.03) 1px,transparent 1px)", backgroundSize:"32px 32px" },
  header: { position:"relative", zIndex:1, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 28px", borderBottom:"1px solid #0d2040", background:"#060c14" },
  hLeft: { display:"flex", alignItems:"center", gap:12 },
  hIcon: { width:36, height:36, borderRadius:8, border:"1px solid", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 },
  hTitle: { fontSize:16, fontWeight:800, color:"#f1f5f9" },
  hSub: { fontSize:9, color:"#1e3a5f", letterSpacing:2, textTransform:"uppercase" },
  hBadge: { fontSize:10, fontWeight:700, padding:"4px 12px", borderRadius:20, border:"1px solid", letterSpacing:1 },
  secNav: { position:"relative", zIndex:1, display:"flex", gap:4, padding:"10px 28px", borderBottom:"1px solid #0d2040" },
  secBtn: { display:"flex", alignItems:"center", gap:6, padding:"7px 16px", borderRadius:6, border:"1px solid #0d2040", background:"transparent", cursor:"pointer", color:"#1e3a5f", fontFamily:"inherit", fontSize:11, fontWeight:700, transition:"all 0.2s" },
  body: { position:"relative", zIndex:1, display:"flex", flex:1 },
  left: { width:240, flexShrink:0, padding:"14px", borderRight:"1px solid #0d2040", display:"flex", flexDirection:"column", gap:8, overflowY:"auto" },
  subList: { display:"flex", flexDirection:"column", gap:4, marginBottom:4 },
  subBtn: { padding:"7px 10px", borderRadius:5, border:"1px solid #0d2040", background:"transparent", cursor:"pointer", color:"#1e3a5f", fontFamily:"inherit", fontSize:10, fontWeight:700, textAlign:"left", transition:"all 0.15s" },
  card: { background:"#0a1020", borderRadius:7, padding:"9px 11px", border:"1px solid" },
  lbl: { fontSize:8, fontWeight:800, letterSpacing:2, color:"#1e3a5f", marginBottom:5, textTransform:"uppercase" },
  cardTxt: { fontSize:10, color:"#475569", lineHeight:1.8, margin:0 },
  listCard: { background:"#0a1020", borderRadius:7, padding:"9px 11px", border:"1px solid #0d2040", display:"flex", flexDirection:"column", gap:5 },
  listRow: { display:"flex", gap:5, alignItems:"flex-start" },
  listTxt: { fontSize:10, color:"#334155", lineHeight:1.6 },
  center: { flex:1, padding:"16px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:14 },
  runBtn: { padding:"9px 28px", borderRadius:6, border:"1px solid", fontFamily:"inherit", fontSize:11, fontWeight:800, letterSpacing:1.5, cursor:"pointer", transition:"all 0.2s", textTransform:"uppercase" },

  // Rate limit
  rlBox: { width:"100%", maxWidth:600, display:"flex", flexDirection:"column", gap:14, alignItems:"center" },
  rlVisual: { width:"100%", background:"#0a1020", borderRadius:10, border:"1px solid #0d2040", padding:"16px", textAlign:"center", display:"flex", flexDirection:"column", gap:8, alignItems:"center" },
  rlTitle: { fontSize:11, color:"#475569", fontWeight:700 },
  rlSlot: { width:24, height:24, borderRadius:4, border:"1px solid", transition:"all 0.3s" },
  progressBar: { width:"100%", height:4, background:"#0d2040", borderRadius:2, overflow:"hidden" },
  token: { width:26, height:26, borderRadius:"50%", border:"1px solid" },
  leakyBucket: { display:"flex", flexDirection:"column", alignItems:"center", gap:4 },
  bucketBody: { width:100, minHeight:60, border:"2px solid", borderRadius:"4px 4px 8px 8px", padding:6, display:"flex", flexWrap:"wrap", gap:3, justifyContent:"center" },
  bucketItem: { width:26, height:18, borderRadius:3, border:"1px solid", display:"flex", alignItems:"center", justifyContent:"center", fontSize:7, fontWeight:700 },
  bucketDrain: { fontSize:9, fontWeight:700 },
  rlLog: { width:"100%", background:"#0a1020", borderRadius:8, border:"1px solid #0d2040", padding:"10px", display:"flex", flexDirection:"column", gap:3, maxHeight:200, overflowY:"auto" },
  rlReq: { display:"flex", alignItems:"center", padding:"4px 6px", borderLeft:"2px solid", borderRadius:"0 3px 3px 0" },

  // LB
  lbBox: { width:"100%", maxWidth:600, display:"flex", flexDirection:"column", gap:14, alignItems:"center" },
  lbDiagram: { display:"flex", gap:20, alignItems:"center", width:"100%", justifyContent:"center" },
  lbNode: { width:56, height:56, borderRadius:10, border:"2px solid", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:900, background:"#0a1020" },
  serverCard: { width:140, padding:"10px 12px", background:"#0a1020", borderRadius:8, border:"1px solid", transition:"all 0.3s", display:"flex", flexDirection:"column", gap:4 },
  loadTrack: { width:"100%", height:6, background:"#0d2040", borderRadius:3, overflow:"hidden" },

  // Auto-scale
  asBox: { width:"100%", maxWidth:640, display:"flex", flexDirection:"column", gap:12 },
  asChart: { width:"100%", background:"#0a1020", borderRadius:10, border:"1px solid #0d2040", aspectRatio:"600/200", overflow:"hidden" },
  asState: { display:"flex", gap:12, alignItems:"center" },
  asMetric: { background:"#0a1020", borderRadius:8, border:"1px solid #0d2040", padding:"10px 16px", textAlign:"center", minWidth:80 },
  asEvent: { padding:"8px 14px", borderRadius:6, border:"1px solid", fontSize:10, fontWeight:700 },
  instanceRow: { display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center" },
  instanceBox: { padding:"8px 14px", background:"#0a1020", borderRadius:6, border:"1px solid", textAlign:"center" },
};

export default function ScalabilitySim() {
  return (
    <>
      <Nav />
      <div style={{ paddingTop: 48 }}>
        <ScalabilitySimInner />
      </div>
    </>
  )
}
