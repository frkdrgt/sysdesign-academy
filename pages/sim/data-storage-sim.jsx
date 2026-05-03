import { useState, useEffect, useRef, useCallback } from "react";
import Nav from '../../components/Nav'

// ─────────────────────────────────────────────────────────────
// SHARDING DATA
// ─────────────────────────────────────────────────────────────
const SHARD_PATTERNS = [
  {
    id: "range",
    name: "Range Sharding",
    accent: "#38bdf8",
    problem: "Veriyi nasıl böleceğiz? En basit yol: key aralıklarına göre.",
    solution: "userId 1–1000 → Shard-A, 1001–2000 → Shard-B gibi. Monoton artan key'lerde (timestamp, auto-increment) tüm yazma tek bir shard'a yığılır — hotspot!",
    whenToUse: ["Zaman serisi verisinde tarih aralığına göre bölme (TimescaleDB chunks)", "Coğrafi bölge bazlı sharding (Türkiye → TR-shard)", "Lexikografik key'lerde range scan hızlı yapılacaksa"],
    pitfalls: ["Auto-increment ID ile monoton yazma → son shard her zaman hot", "Shard boyutları dengesiz büyüyebilir → manual rebalancing gerekir", "Range boundary'yi değiştirmek veri migrasyonu demek"],
    shards: [
      { id: "A", label: "Shard A", range: "1 – 1000",    color: "#38bdf8", load: 20 },
      { id: "B", label: "Shard B", range: "1001 – 2000", color: "#38bdf8", load: 35 },
      { id: "C", label: "Shard C", range: "2001 – 3000", color: "#f97316", load: 90 },
    ],
    hotspot: "C",
    hotspotReason: "Auto-increment ID → yeni kayıtlar hep Shard-C'ye gidiyor",
    demo: {
      keys: [42, 1540, 2800, 2999, 3001],
      resolve: (k) => k <= 1000 ? "A" : k <= 2000 ? "B" : "C",
    },
  },
  {
    id: "hash",
    name: "Hash Sharding",
    accent: "#a78bfa",
    problem: "Range sharding hotspot yaratıyor. Yazmaları eşit dağıtmak istiyoruz.",
    solution: "hash(key) % N ile shard belirlenir. Dağılım uniform olur. Ama N değişirse (yeni shard ekle/çıkar) neredeyse tüm key'lerin yeni shard'a taşınması gerekir.",
    whenToUse: ["Uniform dağılım şart, sıralı okuma gerekmiyorsa", "Write-heavy workload'larda hotspot önlemek için", "Shard sayısı sabit kalacaksa (değişim pahalı)"],
    pitfalls: ["N değişince rehashing: %60-80 veri taşınır — consistent hashing bu sorunu çözer", "Range query mümkün değil: 'userId 1000-2000 arası' sorgusu tüm shardlara gider", "Shard count değişimi için downtime veya dual-write migrasyonu gerekir"],
    shards: [
      { id: "0", label: "Shard 0", range: "hash % 3 = 0", color: "#a78bfa", load: 33 },
      { id: "1", label: "Shard 1", range: "hash % 3 = 1", color: "#a78bfa", load: 34 },
      { id: "2", label: "Shard 2", range: "hash % 3 = 2", color: "#a78bfa", load: 33 },
    ],
    hotspot: null,
    demo: {
      keys: [42, 1540, 2800, 2999, 101],
      resolve: (k) => String(k % 3),
    },
  },
  {
    id: "consistent",
    name: "Consistent Hashing",
    accent: "#34d399",
    problem: "Hash sharding'de shard sayısı değişince çok büyük veri taşınması gerekiyor.",
    solution: "Shard'lar ve key'ler 0–2³² arası bir ring üzerine yerleştirilir. Her key, ring'de kendisinden sonra gelen ilk shard'a aittir. Yeni shard eklenince sadece komşu aralıktaki key'ler taşınır (~1/N oranında).",
    whenToUse: ["Dinamik shard ekle/çıkar yapılacaksa (DynamoDB, Cassandra, Redis Cluster)", "CDN edge node routing", "Distributed cache (Memcached cluster)"],
    pitfalls: ["Virtual node (vnod) olmadan dağılım bozulur: az node'da büyük boşluklar oluşur", "Vnod sayısı çok yüksekse ring yönetimi maliyetlenir", "Hotspot: belirli key'ler çok popülerse node yine dolar — consistent hashing bunu çözmez"],
    shards: [
      { id: "N0", label: "Node 0", range: "ring: 0°",   color: "#34d399", load: 28, angle: 0 },
      { id: "N1", label: "Node 1", range: "ring: 120°",  color: "#34d399", load: 36, angle: 120 },
      { id: "N2", label: "Node 2", range: "ring: 240°",  color: "#34d399", load: 36, angle: 240 },
    ],
    hotspot: null,
    isRing: true,
    demo: {
      keys: [42, 1540, 2800, 2999, 101],
      resolve: (k) => { const h = k % 360; return h < 120 ? "N0" : h < 240 ? "N1" : "N2"; },
    },
  },
];

// ─────────────────────────────────────────────────────────────
// REPLICATION DATA
// ─────────────────────────────────────────────────────────────
const REPL_PATTERNS = [
  {
    id: "leader_follower",
    name: "Leader–Follower",
    accent: "#f472b6",
    problem: "Tek node yeterli değil. Okuma trafiği çok yüksek ya da node çökünce sistem durmasın istiyoruz.",
    solution: "Bir leader (primary) tüm yazmaları alır, WAL (Write-Ahead Log) veya binlog ile follower'lara replike eder. Okumalar follower'lardan yapılabilir. Leader çökünce follower promote edilir.",
    whenToUse: ["Read-heavy workload: okuma trafiğini follower'lara dağıt", "PostgreSQL streaming replication, MySQL binlog replication", "Disaster recovery: farklı datacenter'da hot standby"],
    pitfalls: ["Replication lag: follower hâlâ eski veriyi döndürebilir — monotonic read consistency bozulur", "Follower promote sırasında split-brain riski: iki node kendini leader sanabilir", "Yazma tek node'a gider → write bottleneck çözülmez, sadece okuma ölçeklenir"],
    nodes: [
      { id: "L",  label: "Leader",     role: "leader",   color: "#f472b6", x: 300, y: 80  },
      { id: "F1", label: "Follower 1", role: "follower", color: "#94a3b8", x: 120, y: 250 },
      { id: "F2", label: "Follower 2", role: "follower", color: "#94a3b8", x: 300, y: 250 },
      { id: "F3", label: "Follower 3", role: "follower", color: "#94a3b8", x: 480, y: 250 },
    ],
    steps: [
      { from: "client", to: "L",  label: "WRITE: INSERT user",    color: "#f472b6", delay: 0,    note: "Sadece leader yazar" },
      { from: "L",  to: "F1",     label: "WAL stream →",          color: "#64748b", delay: 800  },
      { from: "L",  to: "F2",     label: "WAL stream →",          color: "#64748b", delay: 900  },
      { from: "L",  to: "F3",     label: "WAL stream →",          color: "#64748b", delay: 1000 },
      { from: "client", to: "F2", label: "READ: SELECT user",     color: "#94a3b8", delay: 2000, note: "Okuma follower'dan" },
      { from: "F2", to: "client", label: "← row data",            color: "#34d399", delay: 2700 },
    ],
  },
  {
    id: "multi_leader",
    name: "Multi-Leader",
    accent: "#fb923c",
    problem: "Tek datacenter'da leader varsa diğer bölgeden yazma latency yüksek. Her region'ın kendi leader'ı olsa?",
    solution: "Her datacenter'da bağımsız leader vardır. Local yazma ultra-düşük latency sağlar. Leader'lar async olarak birbirini replike eder. Conflict resolution zorunlu olur (last-write-wins, CRDT, custom merge).",
    whenToUse: ["Multi-region aktif-aktif deployment (AWS us-east + eu-west)", "Offline-capable uygulamalar: cihaz local'e yazar, sync olur (Google Docs, CouchDB)", "Collaborative editing: conflict-free merge gerekiyorsa"],
    pitfalls: ["Write conflict kaçınılmaz: iki region aynı kaydı aynı anda değiştirirse conflict resolver devreye girer", "Last-write-wins (LWW): kazanan yazar diğerini ezer — veri kaybı", "Circular replication loop: A→B→C→A sonsuz döngüye girebilir, origin tracking şart"],
    nodes: [
      { id: "L1", label: "Leader\nEU", role: "leader", color: "#fb923c", x: 150, y: 160 },
      { id: "L2", label: "Leader\nUS", role: "leader", color: "#fb923c", x: 460, y: 160 },
    ],
    steps: [
      { from: "client", to: "L1",     label: "WRITE EU: name=Faruk",  color: "#fb923c", delay: 0,    note: "EU'ya yaz — düşük latency" },
      { from: "client2", to: "L2",    label: "WRITE US: name=John",   color: "#fb923c", delay: 400,  note: "US'ye yaz — aynı key!" },
      { from: "L1",  to: "L2",        label: "async replicate →",     color: "#64748b", delay: 1400 },
      { from: "L2",  to: "L1",        label: "← async replicate",     color: "#64748b", delay: 1600 },
      { from: "L1",  to: "L1",        label: "⚡ CONFLICT: LWW → John wins", color: "#ef4444", delay: 2600, self: true },
    ],
  },
  {
    id: "quorum",
    name: "Quorum Replication",
    accent: "#818cf8",
    problem: "Leader-follower'da follower'lar geride kalabilir. Okuduğumuz verinin fresh olduğundan nasıl emin oluruz?",
    solution: "W + R > N kuralı: N replica'nın en az W'sine yaz, en az R'inden oku. W=2, R=2, N=3 → her zaman fresh veri garantisi. Cassandra, DynamoDB bu modeli kullanır.",
    whenToUse: ["Tunable consistency: yazma/okuma latency ile tutarlılık arasında denge kur", "Cassandra: per-query consistency level (ONE, QUORUM, ALL)", "DynamoDB strongly consistent read: R=N, en pahalı ama garanti"],
    pitfalls: ["W+R > N sağlanmazsa stale read olabilir: W=1, R=1, N=3 → at-most-once consistency", "ALL consistency (R=N veya W=N): tek node down olsa bile işlem başarısız — availability düşer", "Sloppy quorum: network partition'da farklı node'a yaz, hinted handoff ile sonradan sync et — DynamoDB varsayılanı"],
    nodes: [
      { id: "N1", label: "Node 1", role: "replica", color: "#818cf8", x: 300, y: 70  },
      { id: "N2", label: "Node 2", role: "replica", color: "#818cf8", x: 120, y: 250 },
      { id: "N3", label: "Node 3", role: "replica", color: "#818cf8", x: 480, y: 250 },
    ],
    steps: [
      { from: "client", to: "N1",     label: "WRITE (W=2)",         color: "#818cf8", delay: 0    },
      { from: "client", to: "N2",     label: "WRITE (W=2)",         color: "#818cf8", delay: 100  },
      { from: "N1",  to: "client",    label: "ACK ✓",               color: "#34d399", delay: 800  },
      { from: "N2",  to: "client",    label: "ACK ✓",               color: "#34d399", delay: 900,  note: "W=2 tamamlandı → commit" },
      { from: "client", to: "N1",     label: "READ (R=2)",          color: "#818cf8", delay: 1800 },
      { from: "client", to: "N2",     label: "READ (R=2)",          color: "#818cf8", delay: 1900 },
      { from: "N1",  to: "client",    label: "v=5 ←",               color: "#34d399", delay: 2600 },
      { from: "N2",  to: "client",    label: "v=5 ←",               color: "#34d399", delay: 2700, note: "W+R>N → fresh veri garantisi" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// CACHE DATA
// ─────────────────────────────────────────────────────────────
const CACHE_PATTERNS = [
  {
    id: "cache_aside",
    name: "Cache-Aside",
    accent: "#facc15",
    problem: "DB her okumada darboğaz oluyor. Ama cache'i kim dolduracak, kim güncelleyecek?",
    solution: "Uygulama önce cache'e bakar (cache miss → DB'den yükle + cache'e yaz). Yazmalarda sadece DB güncellenir, cache'teki stale kayıt TTL ile expire olur veya explicit invalidate edilir. Lazy loading olarak da bilinir.",
    whenToUse: ["Read-heavy workload: okuma >> yazma (ürün katalogu, profil sayfası)", "Cache her zaman dolu olması şart değilse (cold start kabul edilebilir)", "Redis + PostgreSQL/MySQL kombinasyonu — en yaygın pattern"],
    pitfalls: ["Cache stampede: TTL expire olunca binlerce istek aynı anda DB'ye gider — mutex lock veya probabilistic early expiration ile önle", "Stale data: yazma sonrası cache invalidate edilmezse eski veri döner — TTL doğru ayarlanmalı", "Cache bypass: her cache miss DB'ye gider, cold start'ta yük artar"],
    stages: [
      {
        id: "miss",
        label: "Cache Miss",
        desc: "Cache'te yok → DB'den çek → cache'e yaz",
        nodes: [
          { id: "app",   label: "App",   x: 80,  y: 160, color: "#facc15" },
          { id: "cache", label: "Cache\n(Redis)", x: 300, y: 80,  color: "#f97316" },
          { id: "db",    label: "DB",    x: 300, y: 260, color: "#22d3ee" },
        ],
        steps: [
          { from: "app", to: "cache", label: "GET user:42",        color: "#facc15", delay: 0 },
          { from: "cache", to: "app", label: "nil (MISS)",         color: "#ef4444", delay: 700,  note: "Cache boş" },
          { from: "app", to: "db",    label: "SELECT * WHERE id=42", color: "#22d3ee", delay: 1400 },
          { from: "db",  to: "app",   label: "← row data",         color: "#22d3ee", delay: 2200 },
          { from: "app", to: "cache", label: "SET user:42 TTL=5m", color: "#facc15", delay: 3000, note: "Cache'e yaz" },
          { from: "app", to: "app",   label: "← response döndür",  color: "#34d399", delay: 3800, self: true },
        ],
      },
      {
        id: "hit",
        label: "Cache Hit",
        desc: "Cache'te var → direkt döner, DB'ye gitmez",
        nodes: [
          { id: "app",   label: "App",         x: 80,  y: 160, color: "#facc15" },
          { id: "cache", label: "Cache\n(Redis)", x: 300, y: 80,  color: "#34d399" },
          { id: "db",    label: "DB",           x: 300, y: 260, color: "#475569" },
        ],
        steps: [
          { from: "app",   to: "cache", label: "GET user:42",      color: "#facc15", delay: 0 },
          { from: "cache", to: "app",   label: "← {id:42,name:Faruk}", color: "#34d399", delay: 700, note: "HIT — DB'ye gidilmedi" },
        ],
      },
      {
        id: "invalidate",
        label: "Write + Invalidate",
        desc: "Güncelleme gelince cache silinir, bir sonraki okuma DB'den çeker",
        nodes: [
          { id: "app",   label: "App",         x: 80,  y: 160, color: "#facc15" },
          { id: "cache", label: "Cache\n(Redis)", x: 300, y: 80,  color: "#f97316" },
          { id: "db",    label: "DB",           x: 300, y: 260, color: "#22d3ee" },
        ],
        steps: [
          { from: "app",   to: "db",    label: "UPDATE user:42 name=Ali", color: "#22d3ee", delay: 0 },
          { from: "db",    to: "app",   label: "OK ✓",                    color: "#22d3ee", delay: 700 },
          { from: "app",   to: "cache", label: "DEL user:42",             color: "#ef4444", delay: 1400, note: "Stale cache silindi" },
        ],
      },
    ],
  },
  {
    id: "write_through",
    name: "Write-Through",
    accent: "#34d399",
    problem: "Cache-aside'da yazma sırasında cache güncellenmediğinden stale data kalıyor.",
    solution: "Her yazma işlemi senkron olarak hem cache'e hem DB'ye gider. Cache her zaman fresh. Ama her yazma iki hop atar, write latency artar.",
    whenToUse: ["Okuma çok sık, yazma az: write penalty tolere edilebilir", "Cache tutarlılığı kritikse (finansal bakiye, stok sayısı)", "Redis + DB pipeline ile write latency minimize edilebilir"],
    pitfalls: ["Write amplification: her yazma 2 hop — yüksek write throughput'ta bottleneck olabilir", "Cache'e yazılır ama hiç okunmayan hot key'ler cache'i şişirir — TTL ile çöz", "Cache node çöker ve yeniden başlarsa cold cache sorunu — DB'den warm-up gerekir"],
    stages: [
      {
        id: "write",
        label: "Write-Through Akışı",
        desc: "Cache + DB senkron güncellenir — her zaman tutarlı",
        nodes: [
          { id: "app",   label: "App",         x: 80,  y: 160, color: "#34d399" },
          { id: "cache", label: "Cache\n(Redis)", x: 300, y: 80,  color: "#34d399" },
          { id: "db",    label: "DB",           x: 300, y: 260, color: "#22d3ee" },
        ],
        steps: [
          { from: "app",   to: "cache", label: "SET user:42 = {name:Ali}",  color: "#34d399", delay: 0,    note: "Önce cache" },
          { from: "cache", to: "app",   label: "OK",                         color: "#34d399", delay: 700  },
          { from: "app",   to: "db",    label: "UPDATE users SET name=Ali",  color: "#22d3ee", delay: 1400, note: "Sonra DB" },
          { from: "db",    to: "app",   label: "OK ✓",                       color: "#22d3ee", delay: 2100, note: "Her ikisi de güncel" },
        ],
      },
    ],
  },
  {
    id: "write_behind",
    name: "Write-Behind (Write-Back)",
    accent: "#f472b6",
    problem: "Write-through her yazma için DB'ye senkron gitmek zorunda. Write throughput darboğaz.",
    solution: "Yazma sadece cache'e gider, hemen döner. Cache dirty kayıtları bir buffer'da biriktirir ve async olarak DB'ye flush eder. Ultra düşük write latency. Ama flush olmadan cache çökerse veri kaybolur.",
    whenToUse: ["Write-heavy, yüksek throughput: oyun leaderboard, IoT sensör verisi, sayaç (view count)", "DB yazma maliyeti yüksekse batch halinde yazmak avantajlı", "Eventual persistence yeterliyse — anlık DB tutarlılığı şart değilse"],
    pitfalls: ["Veri kaybı riski: cache flush olmadan çökerse buffer'daki veriler kaybolur — AOF (append-only file) veya persistence layer şart", "Dirty tracking kompleks: hangi key'ler flush edilmedi? Partial flush sonrası crash?", "DB'nin stale olduğunu bilen consumer'lar varsa yanlış veri okuyabilir"],
    stages: [
      {
        id: "write_back",
        label: "Write-Behind Akışı",
        desc: "Cache'e yaz → hemen dön → async DB flush",
        nodes: [
          { id: "app",    label: "App",          x: 60,  y: 160, color: "#f472b6" },
          { id: "cache",  label: "Cache\n(dirty)", x: 280, y: 160, color: "#f472b6" },
          { id: "buffer", label: "Write\nBuffer", x: 460, y: 80,  color: "#fb923c" },
          { id: "db",     label: "DB",            x: 460, y: 260, color: "#22d3ee" },
        ],
        steps: [
          { from: "app",    to: "cache",  label: "SET key=val",          color: "#f472b6", delay: 0    },
          { from: "cache",  to: "app",    label: "OK ✓ (instant)",       color: "#34d399", delay: 600,  note: "Hemen döner" },
          { from: "cache",  to: "buffer", label: "dirty: key=val",       color: "#fb923c", delay: 1400 },
          { from: "cache",  to: "buffer", label: "dirty: key2=val2",     color: "#fb923c", delay: 1800 },
          { from: "cache",  to: "buffer", label: "dirty: key3=val3",     color: "#fb923c", delay: 2200 },
          { from: "buffer", to: "db",     label: "BATCH flush → 3 rows", color: "#22d3ee", delay: 3200, note: "Async batch write" },
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// TABS CONFIG
// ─────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: "sharding",     label: "Sharding",     emoji: "🗂", accent: "#38bdf8" },
  { id: "replication",  label: "Replication",  emoji: "🔄", accent: "#f472b6" },
  { id: "cache",        label: "Cache",        emoji: "⚡", accent: "#facc15" },
];

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
function DataStorageSimInner() {
  const [section, setSection] = useState("sharding");
  const [subIdx, setSubIdx] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [demoKey, setDemoKey] = useState(null);
  const [animStep, setAnimStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const switchSection = (s) => { clearTimers(); setSection(s); setSubIdx(0); setStageIdx(0); setDemoKey(null); setAnimStep(-1); setRunning(false); setDone(false); };
  const switchSub = (i) => { clearTimers(); setSubIdx(i); setStageIdx(0); setDemoKey(null); setAnimStep(-1); setRunning(false); setDone(false); };
  const switchStage = (i) => { clearTimers(); setStageIdx(i); setAnimStep(-1); setRunning(false); setDone(false); };

  const currentData = section === "sharding" ? SHARD_PATTERNS[subIdx]
    : section === "replication" ? REPL_PATTERNS[subIdx]
    : CACHE_PATTERNS[subIdx];

  const currentSteps = section === "replication"
    ? currentData.steps
    : section === "cache"
    ? currentData.stages[stageIdx].steps
    : null;

  const run = useCallback(() => {
    if (!currentSteps) return;
    clearTimers(); setAnimStep(-1); setRunning(true); setDone(false);
    currentSteps.forEach((s, i) => {
      const t = setTimeout(() => {
        setAnimStep(i);
        if (i === currentSteps.length - 1) setTimeout(() => { setRunning(false); setDone(true); }, 700);
      }, s.delay);
      timers.current.push(t);
    });
  }, [currentSteps]);

  useEffect(() => () => clearTimers(), []);

  const sectionData = SECTIONS.find(s => s.id === section);
  const accent = currentData.accent;

  return (
    <div style={T.root}>
      <div style={T.noiseBg} />

      {/* HEADER */}
      <header style={T.header}>
        <div style={T.hLeft}>
          <div style={{ ...T.hIcon, background: accent + "22", borderColor: accent + "55", color: accent }}>
            {sectionData.emoji}
          </div>
          <div>
            <div style={T.hTitle}>Veri Depolama Desenleri</div>
            <div style={T.hSub}>Data Storage · Sharding · Replication · Cache</div>
          </div>
        </div>
        <div style={{ ...T.hBadge, color: accent, borderColor: accent + "44", background: accent + "11" }}>
          {currentData.name}
        </div>
      </header>

      {/* SECTION TABS */}
      <div style={T.sectionTabs}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => switchSection(s.id)} style={{
            ...T.secBtn,
            ...(section === s.id ? { borderColor: s.accent, color: s.accent, background: s.accent + "11", boxShadow: `0 0 16px ${s.accent}33` } : {}),
          }}>
            <span>{s.emoji}</span><span style={T.secLabel}>{s.label}</span>
          </button>
        ))}
      </div>

      {/* BODY */}
      <div style={T.body}>

        {/* LEFT */}
        <aside style={T.left}>
          {/* Sub-pattern selector */}
          <div style={T.subList}>
            {(section === "sharding" ? SHARD_PATTERNS : section === "replication" ? REPL_PATTERNS : CACHE_PATTERNS).map((p, i) => (
              <button key={p.id} onClick={() => switchSub(i)} style={{
                ...T.subBtn,
                ...(i === subIdx ? { borderColor: p.accent, color: p.accent, background: p.accent + "11" } : {}),
              }}>
                {p.name}
              </button>
            ))}
          </div>

          <div style={{ ...T.card, borderColor: accent + "44" }}>
            <div style={{ ...T.label, color: accent }}>⚠ Problem</div>
            <p style={T.cardText}>{currentData.problem}</p>
          </div>
          <div style={{ ...T.card, borderColor: "#1e3a5f" }}>
            <div style={T.label}>✦ Çözüm</div>
            <p style={T.cardText}>{currentData.solution}</p>
          </div>
          <div style={T.listCard}>
            <div style={T.label}>✓ Ne Zaman</div>
            {currentData.whenToUse.map((w, i) => (
              <div key={i} style={T.listRow}><span style={{ color: "#34d399", flexShrink: 0 }}>›</span><span style={T.listTxt}>{w}</span></div>
            ))}
          </div>
          <div style={T.listCard}>
            <div style={T.label}>⚡ Dikkat Et</div>
            {currentData.pitfalls.map((p, i) => (
              <div key={i} style={T.listRow}><span style={{ color: "#f97316", flexShrink: 0 }}>›</span><span style={T.listTxt}>{p}</span></div>
            ))}
          </div>
        </aside>

        {/* CENTER */}
        <main style={T.center}>
          {section === "sharding" && (
            <ShardingViz data={currentData} accent={accent} demoKey={demoKey} setDemoKey={setDemoKey} />
          )}
          {section === "replication" && (
            <>
              <ReplicationViz data={currentData} accent={accent} animStep={animStep} />
              <button onClick={run} disabled={running} style={{
                ...T.runBtn,
                background: running ? "transparent" : accent,
                color: running ? accent : "#060c18",
                borderColor: accent,
                boxShadow: running ? "none" : `0 0 24px ${accent}66`,
              }}>{running ? "⟳ Çalışıyor..." : done ? "↺ Tekrar" : "▶ Simüle Et"}</button>
              <ReplicationLog steps={currentData.steps} animStep={animStep} done={done} accent={accent} />
            </>
          )}
          {section === "cache" && (
            <>
              <div style={T.stageTabs}>
                {currentData.stages.map((st, i) => (
                  <button key={st.id} onClick={() => switchStage(i)} style={{
                    ...T.stageBtn,
                    ...(i === stageIdx ? { borderColor: accent, color: "#f1f5f9", background: accent + "18" } : {}),
                  }}>{st.label}</button>
                ))}
              </div>
              <p style={T.stageDesc}>{currentData.stages[stageIdx].desc}</p>
              <CacheViz stage={currentData.stages[stageIdx]} accent={accent} animStep={animStep} />
              <button onClick={run} disabled={running} style={{
                ...T.runBtn,
                background: running ? "transparent" : accent,
                color: running ? accent : "#060c18",
                borderColor: accent,
                boxShadow: running ? "none" : `0 0 24px ${accent}66`,
              }}>{running ? "⟳ Çalışıyor..." : done ? "↺ Tekrar" : "▶ Simüle Et"}</button>
              <ReplicationLog steps={currentData.stages[stageIdx].steps} animStep={animStep} done={done} accent={accent} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SHARDING VIZ
// ─────────────────────────────────────────────────────────────
function ShardingViz({ data, accent, demoKey, setDemoKey }) {
  const [inputVal, setInputVal] = useState("");
  const [result, setResult] = useState(null);

  const tryKey = (k) => {
    const n = parseInt(k);
    if (isNaN(n)) return;
    const shard = data.demo.resolve(n);
    setResult({ key: n, shard });
    setDemoKey(shard);
  };

  if (data.isRing) return (
    <div style={T.shardBox}>
      <ConsistentHashRing data={data} accent={accent} highlight={demoKey} />
      <KeyTester accent={accent} inputVal={inputVal} setInputVal={setInputVal} onTest={tryKey} result={result} data={data} demoKey={demoKey} />
    </div>
  );

  return (
    <div style={T.shardBox}>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
        {data.shards.map(s => {
          const isHot = s.id === data.hotspot;
          const isHighlighted = demoKey === s.id;
          return (
            <div key={s.id} style={{
              ...T.shardCard,
              borderColor: isHighlighted ? accent : isHot ? "#ef4444" : "#1e3a5f",
              boxShadow: isHighlighted ? `0 0 20px ${accent}55` : isHot ? "0 0 20px #ef444444" : "none",
            }}>
              <div style={{ color: isHighlighted ? accent : isHot ? "#ef4444" : "#94a3b8", fontWeight: 800, fontSize: 13 }}>
                {s.label}
              </div>
              <div style={{ color: "#475569", fontSize: 10, marginBottom: 8 }}>{s.range}</div>
              <LoadBar load={s.load} hot={isHot} accent={accent} />
              {isHot && <div style={T.hotBadge}>🔥 HOTSPOT</div>}
              {isHighlighted && <div style={{ ...T.hotBadge, background: accent + "22", color: accent, borderColor: accent }}>← Key burada</div>}
            </div>
          );
        })}
      </div>
      {data.hotspot && (
        <div style={T.hotspotNote}>⚠ {data.hotspotReason}</div>
      )}
      <KeyTester accent={accent} inputVal={inputVal} setInputVal={setInputVal} onTest={tryKey} result={result} data={data} demoKey={demoKey} />
    </div>
  );
}

function LoadBar({ load, hot, accent }) {
  return (
    <div style={{ width: "100%", background: "#0d1e35", borderRadius: 4, height: 8, overflow: "hidden", marginBottom: 4 }}>
      <div style={{ width: `${load}%`, height: "100%", background: hot ? "#ef4444" : accent, borderRadius: 4, transition: "width 0.5s" }} />
    </div>
  );
}

function KeyTester({ accent, inputVal, setInputVal, onTest, result, data, demoKey }) {
  return (
    <div style={T.keyTester}>
      <div style={T.label}>🔑 Key Dene</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="number" placeholder="userId gir (1-3500)"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onTest(inputVal)}
          style={T.keyInput}
        />
        <button onClick={() => onTest(inputVal)} style={{ ...T.keyBtn, borderColor: accent, color: accent }}>→</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {data.demo.keys.map(k => (
          <button key={k} onClick={() => { setInputVal(String(k)); onTest(k); }}
            style={{ ...T.sampleBtn, borderColor: accent + "55", color: "#64748b" }}>
            {k}
          </button>
        ))}
      </div>
      {result && (
        <div style={{ ...T.resultBox, borderColor: accent + "55", color: accent }}>
          key <strong>{result.key}</strong> → <strong>Shard {result.shard}</strong>
          &nbsp;&nbsp;<span style={{ color: "#64748b", fontSize: 10 }}>
            ({data.id === "hash" ? `${result.key} % 3 = ${result.key % 3}` : data.id === "consistent" ? `hash(${result.key}) % 360 = ${result.key % 360}°` : `range lookup`})
          </span>
        </div>
      )}
    </div>
  );
}

function ConsistentHashRing({ data, accent, highlight }) {
  const cx = 220, cy = 160, r = 110;
  const nodes = data.shards;
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <svg viewBox="0 0 440 320" style={{ width: 360, height: 260 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e3a5f" strokeWidth="2" strokeDasharray="6 4" />
        {nodes.map(n => {
          const ang = (n.angle - 90) * Math.PI / 180;
          const x = cx + r * Math.cos(ang);
          const y = cy + r * Math.sin(ang);
          const isHL = highlight === n.id;
          return (
            <g key={n.id}>
              <circle cx={x} cy={y} r={22} fill="#060c18" stroke={isHL ? accent : n.color + "66"} strokeWidth={isHL ? 2.5 : 1.5} />
              <text x={x} y={y + 4} textAnchor="middle" fill={isHL ? accent : n.color + "aa"} fontSize="9" fontWeight="700" fontFamily="monospace">{n.label}</text>
            </g>
          );
        })}
        <text x={cx} y={cy - 8} textAnchor="middle" fill="#334155" fontSize="10" fontFamily="monospace">Hash Ring</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#1e3a5f" fontSize="9" fontFamily="monospace">0 – 2³²</text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// REPLICATION VIZ
// ─────────────────────────────────────────────────────────────
function ReplicationViz({ data, accent, animStep }) {
  const W = 620, H = 320;
  const nodes = data.nodes;
  const steps = data.steps;
  const activeSteps = animStep >= 0 ? steps.slice(0, animStep + 1) : [];
  const current = animStep >= 0 ? steps[animStep] : null;

  const posMap = {};
  nodes.forEach(n => { posMap[n.id] = { x: n.x, y: n.y }; });
  posMap["client"]  = { x: 60,  y: 160 };
  posMap["client2"] = { x: 60,  y: 260 };

  function arrowLine(from, to) {
    const a = posMap[from], b = posMap[to];
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const pad = 28;
    return { x1: a.x + dx/len*pad, y1: a.y + dy/len*pad, x2: b.x - dx/len*pad, y2: b.y - dy/len*pad };
  }

  return (
    <div style={T.svgBox}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }}>
        <defs>
          <filter id="glow2"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          {["a","e","g","d"].map(t => {
            const c = t==="a"?accent:t==="e"?"#ef4444":t==="g"?"#34d399":"#334155";
            return <marker key={t} id={`ma-${t}`} markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill={c}/></marker>;
          })}
        </defs>

        {/* Background lines */}
        {steps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map((s, i) => {
          const ln = arrowLine(s.from, s.to);
          return ln ? <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke="#0d1e35" strokeWidth="1" strokeDasharray="3 5"/> : null;
        })}

        {/* Active lines */}
        {activeSteps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map((s, i) => {
          const ln = arrowLine(s.from, s.to);
          if (!ln) return null;
          const isLast = i === animStep;
          const c = s.color || accent;
          const mx = (ln.x1+ln.x2)/2, my = (ln.y1+ln.y2)/2;
          return (
            <g key={`al-${i}`}>
              <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                stroke={c} strokeWidth={isLast?2.5:1.2} opacity={isLast?1:0.4}
                markerEnd={`url(#ma-${isLast?"a":"d"})`}
                filter={isLast?"url(#glow2)":undefined}
              />
              {isLast && <text x={mx} y={my-9} textAnchor="middle" fill={c} fontSize="9" fontWeight="700" fontFamily="monospace">{s.label.split("\n")[0]}</text>}
            </g>
          );
        })}

        {/* Self labels */}
        {activeSteps.filter(s => s.self).map((s, i) => {
          const n = posMap[s.from]; if (!n) return null;
          const isLast = steps.indexOf(s) === animStep;
          return <text key={`sl-${i}`} x={n.x} y={n.y-40} textAnchor="middle" fill={s.color} fontSize="9" fontWeight="800" fontFamily="monospace" filter={isLast?"url(#glow2)":undefined}>{s.label}</text>;
        })}

        {/* Client node */}
        {["client","client2"].filter(id => steps.some(s => s.from===id||s.to===id)).map(id => {
          const pos = posMap[id];
          const isActive = current && (current.from===id||current.to===id);
          return (
            <g key={id}>
              <rect x={pos.x-22} y={pos.y-14} width={44} height={28} rx={5} fill="#060c18" stroke={isActive?"#94a3b8":"#1e3a5f"} strokeWidth={isActive?2:1} filter={isActive?"url(#glow2)":undefined}/>
              <text x={pos.x} y={pos.y+4} textAnchor="middle" fill={isActive?"#e2e8f0":"#475569"} fontSize="9" fontWeight="700" fontFamily="monospace">CLIENT</text>
            </g>
          );
        })}

        {/* DB Nodes */}
        {nodes.map(n => {
          const isActive = current && (current.from===n.id||current.to===n.id);
          return (
            <g key={n.id}>
              {isActive && <circle cx={n.x} cy={n.y} r={36} fill={n.color+"11"}/>}
              <circle cx={n.x} cy={n.y} r={26} fill="#060c18" stroke={isActive?n.color:n.color+"44"} strokeWidth={isActive?2.5:1.5} filter={isActive?"url(#glow2)":undefined}/>
              {n.label.split("\n").map((ln, li, arr) => (
                <text key={li} x={n.x} y={n.y+(arr.length===1?4:li*11-3)} textAnchor="middle" fill={isActive?n.color:n.color+"88"} fontSize="9" fontWeight="700" fontFamily="monospace">{ln}</text>
              ))}
              <text x={n.x} y={n.y+42} textAnchor="middle" fill="#1e3a5f" fontSize="8" fontFamily="monospace">{n.role}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CACHE VIZ (reuses replication viz structure)
// ─────────────────────────────────────────────────────────────
function CacheViz({ stage, accent, animStep }) {
  const W = 620, H = 320;
  const nodes = stage.nodes;
  const steps = stage.steps;
  const activeSteps = animStep >= 0 ? steps.slice(0, animStep + 1) : [];
  const current = animStep >= 0 ? steps[animStep] : null;

  const posMap = {};
  nodes.forEach(n => { posMap[n.id] = { x: n.x, y: n.y }; });

  function arrowLine(from, to) {
    const a = posMap[from], b = posMap[to];
    if (!a || !b) return null;
    const dx = b.x-a.x, dy = b.y-a.y, len = Math.sqrt(dx*dx+dy*dy)||1, pad=28;
    return { x1:a.x+dx/len*pad, y1:a.y+dy/len*pad, x2:b.x-dx/len*pad, y2:b.y-dy/len*pad };
  }

  return (
    <div style={T.svgBox}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"100%" }}>
        <defs>
          <filter id="glow3"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          {["a","d"].map(t => <marker key={t} id={`mc-${t}`} markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill={t==="a"?accent:"#334155"}/></marker>)}
        </defs>

        {steps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map((s, i) => {
          const ln = arrowLine(s.from, s.to); return ln ? <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke="#0d1e35" strokeWidth="1" strokeDasharray="3 5"/> : null;
        })}

        {activeSteps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map((s, i) => {
          const ln = arrowLine(s.from, s.to); if (!ln) return null;
          const isLast = i === animStep;
          const c = s.color || accent;
          const mx=(ln.x1+ln.x2)/2, my=(ln.y1+ln.y2)/2;
          return (
            <g key={`cl-${i}`}>
              <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke={c} strokeWidth={isLast?2.5:1.2} opacity={isLast?1:0.4} markerEnd={`url(#mc-${isLast?"a":"d"})`} filter={isLast?"url(#glow3)":undefined}/>
              {isLast && <text x={mx} y={my-9} textAnchor="middle" fill={c} fontSize="9" fontWeight="700" fontFamily="monospace">{s.label.split("\n")[0]}</text>}
              {isLast && s.note && <text x={mx} y={my+18} textAnchor="middle" fill={c+"aa"} fontSize="8" fontFamily="monospace">{s.note}</text>}
            </g>
          );
        })}

        {activeSteps.filter(s => s.self).map((s, i) => {
          const n = posMap[s.from]; if (!n) return null;
          return <text key={i} x={n.x} y={n.y-40} textAnchor="middle" fill={s.color} fontSize="9" fontWeight="800" fontFamily="monospace">{s.label}</text>;
        })}

        {nodes.map(n => {
          const isActive = current && (current.from===n.id||current.to===n.id);
          return (
            <g key={n.id}>
              {isActive && <circle cx={n.x} cy={n.y} r={36} fill={n.color+"11"}/>}
              <circle cx={n.x} cy={n.y} r={26} fill="#060c18" stroke={isActive?n.color:n.color+"44"} strokeWidth={isActive?2.5:1.5} filter={isActive?"url(#glow3)":undefined}/>
              {n.label.split("\n").map((ln, li, arr) => (
                <text key={li} x={n.x} y={n.y+(arr.length===1?4:li*11-3)} textAnchor="middle" fill={isActive?n.color:n.color+"88"} fontSize="9" fontWeight="700" fontFamily="monospace">{ln}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LOG
// ─────────────────────────────────────────────────────────────
function ReplicationLog({ steps, animStep, done, accent }) {
  const activeSteps = animStep >= 0 ? steps.slice(0, animStep + 1) : [];
  return (
    <div style={T.logWrap}>
      {activeSteps.length === 0 && <div style={T.logEmpty}>▶ simülasyonu başlat</div>}
      {activeSteps.map((s, i) => {
        const isLast = i === animStep;
        return (
          <div key={i} style={{ ...T.logRow, borderLeftColor: s.color, background: isLast ? s.color+"0d" : "transparent", opacity: isLast ? 1 : 0.6 }}>
            <span style={{ color: s.color, fontWeight: 700, fontSize: 9 }}>{s.from?.toUpperCase()}</span>
            <span style={{ color: "#334155", fontSize: 9 }}>→</span>
            <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: 9 }}>{s.to?.toUpperCase()}</span>
            <span style={{ color: "#475569", fontSize: 9, marginLeft: 4 }}>{s.label.split("\n")[0]}</span>
            {s.note && <span style={{ color: s.color, fontSize: 9, marginLeft: 6, fontWeight: 700 }}>{s.note}</span>}
          </div>
        );
      })}
      {done && <div style={{ ...T.logRow, borderLeftColor: accent, color: accent, fontWeight: 800, fontSize: 9 }}>✓ Tamamlandı</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────
const T = {
  root: { minHeight:"100vh", background:"#060c18", color:"#e2e8f0", fontFamily:"'IBM Plex Mono','JetBrains Mono','Courier New',monospace", display:"flex", flexDirection:"column", position:"relative" },
  noiseBg: { position:"fixed", inset:0, pointerEvents:"none", zIndex:0, backgroundImage:"radial-gradient(ellipse at 20% 50%, #0d1e3522 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #1a0a2e22 0%, transparent 60%)" },
  header: { position:"relative", zIndex:1, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 28px", borderBottom:"1px solid #0d1e35", background:"#060c18" },
  hLeft: { display:"flex", alignItems:"center", gap:12 },
  hIcon: { width:36, height:36, borderRadius:8, border:"1px solid", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 },
  hTitle: { fontSize:16, fontWeight:800, color:"#f1f5f9" },
  hSub: { fontSize:9, color:"#334155", letterSpacing:2, textTransform:"uppercase" },
  hBadge: { fontSize:10, fontWeight:700, padding:"4px 12px", borderRadius:20, border:"1px solid", letterSpacing:1 },
  sectionTabs: { position:"relative", zIndex:1, display:"flex", gap:4, padding:"10px 28px", borderBottom:"1px solid #0d1e35", background:"#060c18" },
  secBtn: { display:"flex", alignItems:"center", gap:6, padding:"7px 16px", borderRadius:6, border:"1px solid #1e3a5f", background:"transparent", cursor:"pointer", color:"#334155", fontFamily:"inherit", fontSize:11, fontWeight:700, transition:"all 0.2s" },
  secLabel: { fontSize:11 },
  body: { position:"relative", zIndex:1, display:"flex", flex:1 },
  left: { width:240, flexShrink:0, padding:"14px", borderRight:"1px solid #0d1e35", display:"flex", flexDirection:"column", gap:8, overflowY:"auto" },
  subList: { display:"flex", flexDirection:"column", gap:4, marginBottom:4 },
  subBtn: { padding:"7px 10px", borderRadius:5, border:"1px solid #0d1e35", background:"transparent", cursor:"pointer", color:"#334155", fontFamily:"inherit", fontSize:10, fontWeight:700, textAlign:"left", transition:"all 0.15s" },
  card: { background:"#0a1220", borderRadius:7, padding:"9px 11px", border:"1px solid" },
  label: { fontSize:8, fontWeight:800, letterSpacing:2, color:"#334155", marginBottom:5, textTransform:"uppercase" },
  cardText: { fontSize:10, color:"#64748b", lineHeight:1.8, margin:0 },
  listCard: { background:"#0a1220", borderRadius:7, padding:"9px 11px", border:"1px solid #0d1e35", display:"flex", flexDirection:"column", gap:5 },
  listRow: { display:"flex", gap:5, alignItems:"flex-start" },
  listTxt: { fontSize:10, color:"#475569", lineHeight:1.6 },
  center: { flex:1, padding:"16px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:12 },
  shardBox: { width:"100%", display:"flex", flexDirection:"column", gap:16 },
  shardCard: { flex:1, minWidth:140, maxWidth:180, padding:"14px", background:"#0a1220", borderRadius:10, border:"1px solid", textAlign:"center", transition:"all 0.3s" },
  hotBadge: { marginTop:6, fontSize:9, fontWeight:800, color:"#ef4444", background:"#ef444411", border:"1px solid #ef444444", borderRadius:4, padding:"2px 8px" },
  hotspotNote: { textAlign:"center", color:"#f97316", fontSize:10, background:"#1a0a0522", border:"1px solid #f9731633", borderRadius:6, padding:"8px 16px" },
  keyTester: { background:"#0a1220", borderRadius:8, padding:"12px", border:"1px solid #0d1e35", display:"flex", flexDirection:"column", gap:8 },
  keyInput: { flex:1, background:"#060c18", border:"1px solid #1e3a5f", borderRadius:5, padding:"6px 10px", color:"#e2e8f0", fontFamily:"inherit", fontSize:11, outline:"none" },
  keyBtn: { padding:"6px 14px", background:"transparent", border:"1px solid", borderRadius:5, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:800 },
  sampleBtn: { padding:"3px 10px", background:"transparent", border:"1px solid", borderRadius:4, cursor:"pointer", fontFamily:"inherit", fontSize:10 },
  resultBox: { padding:"8px 12px", borderRadius:5, border:"1px solid", fontSize:11, fontWeight:600 },
  svgBox: { width:"100%", maxWidth:640, background:"#060c18", borderRadius:10, border:"1px solid #0d1e35", aspectRatio:"620/320", overflow:"hidden" },
  runBtn: { padding:"9px 28px", borderRadius:6, border:"1px solid", fontFamily:"inherit", fontSize:11, fontWeight:800, letterSpacing:1.5, cursor:"pointer", transition:"all 0.2s", textTransform:"uppercase" },
  stageTabs: { display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center" },
  stageBtn: { padding:"6px 14px", borderRadius:5, border:"1px solid #1e3a5f", background:"transparent", cursor:"pointer", color:"#475569", fontSize:10, fontWeight:700, fontFamily:"inherit", transition:"all 0.2s" },
  stageDesc: { fontSize:10, color:"#475569", margin:0, textAlign:"center", maxWidth:500 },
  logWrap: { width:"100%", maxWidth:640, display:"flex", gap:4, flexWrap:"wrap", background:"#060c18", borderRadius:8, border:"1px solid #0d1e35", padding:"10px 12px", minHeight:40 },
  logEmpty: { fontSize:9, color:"#1e3a5f", fontStyle:"italic" },
  logRow: { display:"flex", gap:5, alignItems:"center", padding:"3px 6px 3px 6px", borderLeft:"2px solid", borderRadius:"0 3px 3px 0", transition:"all 0.25s", flexWrap:"wrap" },
};

export default function DataStorageSim() {
  return (
    <>
      <Nav />
      <div style={{ paddingTop: 48 }}>
        <DataStorageSimInner />
      </div>
    </>
  )
}
