import { useState, useEffect, useRef, useCallback } from "react";
import Nav from '../../components/Nav'

// ══════════════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════════════

const SYSTEMS = {
  redis: {
    label: "Redis",
    emoji: "🔴",
    accent: "#ef4444",
    subsections: [
      {
        id: "data_structures",
        name: "Data Structures",
        problem: "Redis neden sadece key-value store değil? Hangi veri yapısı ne zaman?",
        solution: "Redis 8 temel veri yapısı sunar. Her biri farklı zaman karmaşıklığı ve kullanım senaryosuna sahip. Yanlış seçim hem memory hem CPU israfına yol açar.",
        whenToUse: [
          "String: session token, counter (INCR), distributed lock (SET NX EX)",
          "Hash: kullanıcı profili — her alan ayrı field; JSON stringify'dan %30-50 daha verimli",
          "List: recent activity feed, job queue (LPUSH/BRPOP), mesajlaşma inbox",
          "Set: unique visitor sayısı, tag sistemi, 'ortak takip edilen' (SINTER)",
          "Sorted Set: leaderboard (ZADD/ZRANGE), rate limiter (sliding window), scheduled job",
          "HyperLogLog: 12KB'da milyarlarca unique eleman sayısı — %0.81 hata payı",
          "Bitmap: günlük aktif kullanıcı (bit per user per day), feature flag per user",
          "Stream: append-only log, event sourcing, consumer group ile Kafka benzeri işleme",
        ],
        pitfalls: [
          "KEYS * production'da asla: O(N) — SCAN ile cursor-based iterate et",
          "Large key sorunu: 1MB+ value → serialization latency, network overhead — parçala",
          "TTL unutulursa memory sızıntısı — her SET'e varsayılan TTL politikası koy",
          "List yerine Stream: consumer group, ACK, consumer takibi gerekiyorsa Stream seç",
        ],
        visual: "data_structures",
      },
      {
        id: "pubsub_streams",
        name: "Pub/Sub vs Streams",
        problem: "Event'leri Redis üzerinden iletmek istiyoruz. Pub/Sub mi, Stream mi?",
        solution: "Pub/Sub: fire-and-forget, subscriber yoksa mesaj kaybolur, history yok. Stream: append-only log, consumer group, ACK, replay. Kafka'nın hafif versiyonu gibi düşün.",
        whenToUse: [
          "Pub/Sub: anlık bildirim (chat mesajı, canlı skor), subscriber mutlaka online",
          "Pub/Sub: broadcast: 1 event → N subscriber, kayıp tolere edilebilir",
          "Stream: güvenilir event log, işlenmesi garanti edilmesi gereken event'ler",
          "Stream: consumer group ile birden fazla worker arasında iş bölüşümü",
          "Stream: XREAD BLOCK ile long-polling consumer — batch processing",
        ],
        pitfalls: [
          "Pub/Sub subscriber offline iken mesaj kaybolur — stream'de XREADGROUP + ACK güvenli",
          "Stream belleği büyür: MAXLEN ile trim et veya XTRIM APPROX ~ hız için",
          "Consumer group'ta işlenmemiş (pending) mesajlar: XPENDING + XCLAIM ile recover et",
          "Pub/Sub cluster'da sadece aynı slot'taki node'a subscribe edilebilir — keyslot dikkat",
        ],
        visual: "pubsub_streams",
        steps: [
          { type: "pubsub", from: "publisher", to: "broker", label: "PUBLISH notifications 'user:login'", color: "#ef4444", delay: 0 },
          { type: "pubsub", from: "broker", to: "sub1", label: "→ 'user:login'", color: "#f87171", delay: 700 },
          { type: "pubsub", from: "broker", to: "sub2", label: "→ 'user:login'", color: "#f87171", delay: 800 },
          { type: "pubsub", from: "broker", to: "sub3", label: "→ OFFLINE (💀 kayıp)", color: "#475569", delay: 900 },
          { type: "stream", from: "producer", to: "stream", label: "XADD events * user_id=42", color: "#ef4444", delay: 1800 },
          { type: "stream", from: "stream", to: "worker1", label: "XREADGROUP grp w1 > COUNT 1", color: "#f87171", delay: 2600 },
          { type: "stream", from: "worker1", to: "stream", label: "XACK events grp <id>", color: "#34d399", delay: 3400 },
          { type: "stream", from: "stream", to: "worker2", label: "XREADGROUP grp w2 > COUNT 1", color: "#f87171", delay: 4200 },
        ],
      },
      {
        id: "cluster_sentinel",
        name: "Cluster & Sentinel",
        problem: "Tek Redis node: SPOF. Çözüm: Sentinel (HA) veya Cluster (HA + horizontal scale)?",
        solution: "Sentinel: 1 master + N replica izleme, failover koordinasyonu. Cluster: 16384 hash slot N master'a bölünür, her master kendi replica'sına sahip. 1TB+ veri veya yüksek throughput → Cluster.",
        whenToUse: [
          "Sentinel: veri tek node'a sığıyor ama HA lazım — session store, rate limiter",
          "Cluster: dataset 100GB+, yüksek write throughput (100k+ ops/s)",
          "Cluster: keyslot farkındalığı şart — MGET birden fazla slotta çalışmaz",
          "Read scaling: replica'dan okuma (READONLY) — stale tolere edilebiliyorsa",
        ],
        pitfalls: [
          "Cluster'da multi-key komutlar (MGET, transaction) aynı slot'ta olmalı — {hashtag} ile zorla",
          "Sentinel quorum: 2S+1 node şart — 2 sentinel yetmez, 3 veya 5 kullan",
          "Cluster resharding sırasında key taşınırken MOVED/ASK hatası gelir — client retry şart",
          "Failover süresi: Sentinel varsayılan 30s — down-after-milliseconds ayarla",
        ],
        visual: "cluster_sentinel",
        steps: [
          { from: "client", to: "sentinel1", label: "get-master-addr-by-name mymaster", color: "#ef4444", delay: 0 },
          { from: "sentinel1", to: "client", label: "127.0.0.1:6379 (master)", color: "#f87171", delay: 700 },
          { from: "client", to: "master", label: "SET key val", color: "#ef4444", delay: 1400 },
          { from: "master", to: "replica1", label: "async replicate", color: "#64748b", delay: 2000 },
          { from: "master", to: "replica2", label: "async replicate", color: "#64748b", delay: 2100 },
          { from: "master", to: "master", label: "💥 master down!", color: "#dc2626", delay: 3000, self: true },
          { from: "sentinel1", to: "sentinel2", label: "SDOWN → quorum vote", color: "#fbbf24", delay: 3800 },
          { from: "sentinel2", to: "sentinel3", label: "ODOWN confirmed", color: "#fbbf24", delay: 4400 },
          { from: "sentinel1", to: "replica1", label: "SLAVEOF NO ONE → promoted!", color: "#34d399", delay: 5200 },
          { from: "client", to: "replica1", label: "yeni master'a bağlan", color: "#34d399", delay: 6000 },
        ],
      },
    ],
  },

  kafka: {
    label: "Kafka",
    emoji: "🟠",
    accent: "#f97316",
    subsections: [
      {
        id: "partitioning",
        name: "Partition & Offset",
        problem: "Kafka neden bu kadar hızlı? Paralel okuma/yazma nasıl çalışır?",
        solution: "Topic, N partition'a bölünür. Her partition append-only log — sequential I/O (HDD'de bile GB/s). Producer key hash ile partition seçer. Consumer offset'i commit eder — nerede kaldığını bilir. Paralel: P partition = P consumer paralel okuyabilir.",
        whenToUse: [
          "Partition sayısı = max paralel consumer sayısı — önceden hesapla, sonradan artırmak key ordering'i bozar",
          "Key-based partitioning: aynı user_id hep aynı partition → ordering garantisi",
          "Round-robin (key=null): yük dengeli dağıtım, sıra önemsiz",
          "Custom partitioner: geo-based routing, tenant isolation",
        ],
        pitfalls: [
          "Partition sayısı sonradan artırılırsa: aynı key farklı partition'a düşer — ordering bozulur",
          "Hot partition: tek key çok trafikli (viral post) → o partition'ın consumer'ı bunalır — salting ile dağıt",
          "Offset commit zamanlaması: işlemden önce commit → at-most-once; sonra → at-least-once",
          "Too many partitions: her partition bir file handle, broker memory'si artar — rule of thumb: broker başına max 4000 partition",
        ],
        visual: "partitioning",
      },
      {
        id: "consumer_groups",
        name: "Consumer Groups",
        problem: "Aynı mesajı birden fazla servis işlemesi lazım (fan-out). Ayrıca işlemi paralel hızlandırmak istiyoruz. Bunlar çelişmiyor mu?",
        solution: "Consumer Group: grup içinde her partition tek consumer'a atanır — iş bölüşümü (paralel işleme). Farklı grup aynı partition'ı bağımsız tüketir — fan-out. İki ihtiyaç birbirini dışlamaz.",
        whenToUse: [
          "Aynı mesajı farklı servisler işliyorsa (Order → Billing, Order → Notification): ayrı group",
          "Yatay ölçekleme: consumer sayısını artır, partition sayısına kadar linear throughput artar",
          "Consumer > partition: fazla consumer idle kalır — partition artır veya consumer azalt",
          "Kafka Streams / ksqlDB: group coordinator üzerinde stateful stream processing",
        ],
        pitfalls: [
          "Rebalance: consumer eklenince/çıkınca tüm grup durur, partition yeniden atanır — incremental cooperative rebalance kullan",
          "Lag monitoring: consumer group lag = son offset - commit offset — Prometheus + Grafana ile izle",
          "Session timeout çok kısa: geç commit → consumer dead sayılır → rebalance — heartbeat.interval.ms ayarla",
          "Compacted topic'te consumer group: en son value per key garantisi var, aralarındaki değerler silinmiş olabilir",
        ],
        visual: "consumer_groups",
        steps: [
          { from: "producer", to: "p0", label: "key=userA → P0", color: "#f97316", delay: 0 },
          { from: "producer", to: "p1", label: "key=userB → P1", color: "#f97316", delay: 300 },
          { from: "producer", to: "p2", label: "key=userC → P2", color: "#f97316", delay: 600 },
          { from: "p0", to: "billing1", label: "billing-grp: C1 reads P0", color: "#fbbf24", delay: 1400 },
          { from: "p1", to: "billing2", label: "billing-grp: C2 reads P1", color: "#fbbf24", delay: 1600 },
          { from: "p2", to: "billing3", label: "billing-grp: C3 reads P2", color: "#fbbf24", delay: 1800 },
          { from: "p0", to: "notify1", label: "notify-grp: C1 reads P0", color: "#60a5fa", delay: 2600 },
          { from: "p1", to: "notify1", label: "notify-grp: C1 reads P1", color: "#60a5fa", delay: 2800 },
          { from: "p2", to: "notify2", label: "notify-grp: C2 reads P2", color: "#60a5fa", delay: 3000 },
        ],
      },
      {
        id: "replication_isr",
        name: "Replication & ISR",
        problem: "Broker çökünce mesaj kaybolmasın. Ama her yazma tüm replica'yı beklerse çok yavaş olur.",
        solution: "Replication factor RF=3: 1 leader + 2 follower. ISR (In-Sync Replicas): leader'ı yeterince takip eden replica'lar. acks=all → tüm ISR'den ACK beklenir. min.insync.replicas=2 → en az 2 replica sync olmalı, aksi hâlde write reject.",
        whenToUse: [
          "acks=0: fire-and-forget, max throughput, kayıp riski var — metrics, log",
          "acks=1: leader ACK, follower async — iyi denge, leader çökerse kayıp",
          "acks=all + min.insync.replicas=2: finansal, sipariş — veri kaybı yok, biraz yavaş",
          "RF=3 standart: 1 broker bakım + 1 beklenmedik crash toleransı",
        ],
        pitfalls: [
          "ISR shrink: follower gecikirse ISR'den çıkar, acks=all ile tek leader kalırsa write blocking",
          "Unclean leader election: ISR dışı replica leader seçilirse committed mesajlar kaybolabilir — unclean.leader.election.enable=false",
          "RF > broker sayısı: imkânsız — RF=3 için en az 3 broker şart",
          "Replica lag: network yavaşsa veya follower GC pause'daysa ISR'den düşer — replica.lag.time.max.ms ayarla",
        ],
        visual: "replication_isr",
        steps: [
          { from: "producer", to: "leader", label: "PRODUCE msg (acks=all)", color: "#f97316", delay: 0 },
          { from: "leader", to: "follower1", label: "replicate →", color: "#64748b", delay: 600 },
          { from: "leader", to: "follower2", label: "replicate →", color: "#64748b", delay: 700 },
          { from: "follower1", to: "leader", label: "ACK (ISR)", color: "#34d399", delay: 1400 },
          { from: "follower2", to: "leader", label: "ACK (ISR)", color: "#34d399", delay: 1500 },
          { from: "leader", to: "producer", label: "✓ committed (all ISR acked)", color: "#34d399", delay: 2200 },
          { from: "leader", to: "leader", label: "💥 leader crash", color: "#dc2626", delay: 3200, self: true },
          { from: "follower1", to: "follower1", label: "controller: follower1 → new leader", color: "#fbbf24", delay: 4000, self: true },
          { from: "producer", to: "follower1", label: "PRODUCE (new leader)", color: "#f97316", delay: 4800 },
        ],
      },
    ],
  },

  postgresql: {
    label: "PostgreSQL",
    emoji: "🐘",
    accent: "#60a5fa",
    subsections: [
      {
        id: "indexes",
        name: "Index Tipleri",
        problem: "Sorgu yavaş. Index ekleyeceğiz ama hangi tip? B-Tree, Hash, GIN, GiST, BRIN?",
        solution: "Her index tipi farklı veri tipi ve sorgu tipine göre optimize edilmiştir. Yanlış index tipi hem yavaş hem gereksiz disk kullanımı demek.",
        whenToUse: [
          "B-Tree (varsayılan): eşitlik + range (<, >, BETWEEN, LIKE 'abc%'), sıralama — evrensel seçim",
          "Hash: sadece eşitlik (=), range yok — B-Tree'den daha küçük ama nadiren tercih edilir",
          "GIN: tam metin arama (tsvector), JSONB @> operatörü, array @> içerir sorgusu",
          "GiST: geometrik veri (PostGIS), IP range (inet), full-text (tsquery) — overlap/kapsama sorguları",
          "BRIN: çok büyük tabloda fiziksel sıralı veri (timestamp, serial) — 10-100x daha küçük, approximate",
          "Partial index: WHERE koşullu — sadece aktif siparişleri indeksle: CREATE INDEX ON orders(id) WHERE status='active'",
          "Expression index: LOWER(email) — büyük-küçük harf bağımsız sorgular için",
        ],
        pitfalls: [
          "Index bloat: UPDATE/DELETE sonrası dead tuple'lar index'te kalır — VACUUM çözer, pg_repack zero-downtime için",
          "Too many indexes: yazma her index'i günceller — write-heavy tabloda 3-4'ten fazla index yavaşlatır",
          "Index not used: planner seq scan tercih ediyorsa tablo küçüktür ya da selectivity düşüktür — EXPLAIN ANALYZE ile kontrol et",
          "Covering index (INCLUDE): sorgudaki tüm kolonları index'e ekle → heap fetch yok → index-only scan",
        ],
        visual: "indexes",
      },
      {
        id: "mvcc_vacuum",
        name: "MVCC & VACUUM",
        problem: "Postgres nasıl aynı anda READ ve WRITE'a izin veriyor? Reader'lar writer'ı neden bloke etmiyor?",
        solution: "MVCC: her row'un birden fazla versiyonu vardır. Transaction kendi snapshot'ını görür — başlangıç zamanındaki veriyi. Eski versiyonlar (dead tuple) silinmez, VACUUM temizler. xmin/xmax ile hangi TX hangi versiyonu görür belirlenir.",
        whenToUse: [
          "REPEATABLE READ: snapshot isolation — aynı TX içinde aynı sorgu hep aynı sonuç",
          "SERIALIZABLE: tam isolation, en pahalı — finansal bakiye, envanter gibi kritik işlemler",
          "autovacuum: her zaman açık tutulmalı — yavaş çalışıyorsa cost_delay parametrelerini ayarla",
          "VACUUM ANALYZE: dead tuple temizle + istatistik güncelle → planner daha iyi plan seçer",
        ],
        pitfalls: [
          "Long-running transaction: eski snapshot'ı tuttuğu için VACUUM dead tuple'ları temizleyemez → table şişer (bloat)",
          "Transaction ID wraparound: 2³¹ TX sonrası tüm geçmiş data 'future' görünür — autovacuum FREEZE şart",
          "HOT update: aynı page'de index kolonu değişmediyse index güncellenmez — heap-only tuple, %10-20 hız",
          "Visibility map: VACUUM sonrası all-visible page'lerde index-only scan mümkün — büyük performans farkı",
        ],
        visual: "mvcc",
        steps: [
          { from: "tx1", to: "db", label: "BEGIN (txid=100)", color: "#60a5fa", delay: 0 },
          { from: "tx2", to: "db", label: "BEGIN (txid=101)", color: "#818cf8", delay: 300 },
          { from: "tx1", to: "db", label: "UPDATE user SET name='Ali' → xmax=100 (old), xmin=100 (new)", color: "#60a5fa", delay: 1000 },
          { from: "tx2", to: "db", label: "SELECT name → görür: 'Faruk' (snapshot: txid<101)", color: "#818cf8", delay: 1800, note: "Eski versiyonu görür!" },
          { from: "tx1", to: "db", label: "COMMIT txid=100", color: "#34d399", delay: 2700 },
          { from: "tx2", to: "db", label: "SELECT name → hâlâ: 'Faruk' (REPEATABLE READ)", color: "#818cf8", delay: 3500, note: "Snapshot değişmez" },
          { from: "tx2", to: "db", label: "COMMIT txid=101", color: "#34d399", delay: 4300 },
          { from: "vacuum", to: "db", label: "VACUUM → dead tuple temizle (xmax=100)", color: "#fbbf24", delay: 5100 },
        ],
      },
      {
        id: "connection_pooling",
        name: "Connection Pooling",
        problem: "Her HTTP request yeni DB connection açıyor. 1000 concurrent user = 1000 connection = Postgres çöküyor.",
        solution: "Her Postgres connection ~5-10MB RAM + process fork overhead. PgBouncer/Pgpool ile connection pooling: app'lar pool'a bağlanır, pool DB'ye az sayıda uzun ömürlü connection tutar. Transaction mode: her transaction sonrası connection pool'a döner.",
        whenToUse: [
          "Transaction mode (PgBouncer): en verimli — prepared statement geçersiz, advisory lock dikkat",
          "Session mode: prepared statement, SET, advisory lock gerekiyorsa — daha az verimli",
          "Pool size formülü: (core * 2) + effective_spindle_count — SSD için core sayısı yeterli",
          "max_connections Postgres: 100-400 önerilir; pgbouncer → postgres arasında bu sayı kalır",
        ],
        pitfalls: [
          "Transaction mode + prepared statement: her bağlantıda re-prepare gerekir — DISCARD ALL otomatik yapılır",
          "Pool exhaustion: tüm pool connections meşgulse yeni istek bekler — timeout → 500 — pool boyutunu ve query süresini optimize et",
          "Supabase/RDS: her zaten connection pooler kullanıyor, üstüne bir de app-side pool eklersen double-pool sorunu",
          "Long transaction + transaction mode: transaction bitmeden connection pool'a dönmez → pool tıkanır",
        ],
        visual: "connection_pool",
        steps: [
          { from: "app1", to: "pgbouncer", label: "connect + BEGIN", color: "#60a5fa", delay: 0 },
          { from: "app2", to: "pgbouncer", label: "connect + BEGIN", color: "#60a5fa", delay: 200 },
          { from: "app3", to: "pgbouncer", label: "connect + BEGIN", color: "#60a5fa", delay: 400 },
          { from: "pgbouncer", to: "pg1", label: "reuse conn #1", color: "#818cf8", delay: 1000 },
          { from: "pgbouncer", to: "pg1", label: "reuse conn #1 (app2)", color: "#818cf8", delay: 1200 },
          { from: "pgbouncer", to: "pg2", label: "reuse conn #2 (app3)", color: "#818cf8", delay: 1400 },
          { from: "app1", to: "pgbouncer", label: "COMMIT → conn pool'a döner", color: "#34d399", delay: 2400 },
          { from: "app4", to: "pgbouncer", label: "connect → serbest conn alır", color: "#60a5fa", delay: 3200 },
          { from: "pgbouncer", to: "pg1", label: "reuse conn #1 (app4)", color: "#818cf8", delay: 3800 },
        ],
      },
    ],
  },

  rabbitmq: {
    label: "RabbitMQ",
    emoji: "🐇",
    accent: "#a78bfa",
    subsections: [
      {
        id: "exchanges",
        name: "Exchange Tipleri",
        problem: "Mesajı nereye göndereceğimizi nasıl belirleriz? Producer queue adını bilmek zorunda mı?",
        solution: "Producer, mesajı Exchange'e gönderir. Exchange, routing rule'a göre queue'lara iletir. 4 tip: Direct (exact key), Topic (wildcard), Fanout (herkese), Headers (header match).",
        whenToUse: [
          "Direct: routing_key tam eşleşme — error.critical → only critical queue",
          "Topic: wildcard routing — 'order.#' → tüm order event'leri; '*.payment.*' → tüm servis payment'ları",
          "Fanout: broadcast — tüm bağlı queue'lara kopyala, routing_key yok sayılır",
          "Headers: header attribute match — content-type=pdf veya region=EU gibi metadata routing",
        ],
        pitfalls: [
          "Direct exchange default: routing_key = queue_name — implicit routing, karıştırma",
          "Fanout: queue bağlı değilse mesaj kaybolur — durable queue + persistent message şart",
          "Topic '#' ve '*' farkı: '*' tek kelime, '#' sıfır veya daha fazla — 'order.#' hem 'order.created' hem 'order.item.added' yakalar",
          "Exchange-to-exchange binding: bir exchange başka exchange'e route edebilir — karmaşık routing topologisi için",
        ],
        visual: "exchanges",
        steps: [
          { from: "producer", to: "direct_ex", label: "routing_key='error'", color: "#ef4444", delay: 0 },
          { from: "direct_ex", to: "error_q", label: "→ error queue (exact match)", color: "#ef4444", delay: 700 },
          { from: "producer2", to: "topic_ex", label: "routing_key='order.payment.failed'", color: "#a78bfa", delay: 1600 },
          { from: "topic_ex", to: "order_q", label: "→ order.# binding match", color: "#a78bfa", delay: 2300 },
          { from: "topic_ex", to: "payment_q", label: "→ *.payment.* binding match", color: "#a78bfa", delay: 2500 },
          { from: "producer3", to: "fanout_ex", label: "publish (any key)", color: "#34d399", delay: 3400 },
          { from: "fanout_ex", to: "all_q1", label: "→ tüm bağlı queue'lar", color: "#34d399", delay: 4100 },
          { from: "fanout_ex", to: "all_q2", label: "→ tüm bağlı queue'lar", color: "#34d399", delay: 4200 },
          { from: "fanout_ex", to: "all_q3", label: "→ tüm bağlı queue'lar", color: "#34d399", delay: 4300 },
        ],
      },
      {
        id: "dlq_priority",
        name: "DLQ & Priority Queue",
        problem: "İşlenemeyen mesajlar nereye gider? Acil mesajlar sıradan mesajlardan önce işlenebilir mi?",
        solution: "DLQ (Dead Letter Exchange): mesaj TTL sürerse, max retry aşılırsa veya queue doluysa DLX'e yönlendirilir. Priority Queue: x-max-priority ile 0-255 arası öncelik, yüksek öncelikli mesaj öne geçer.",
        whenToUse: [
          "DLQ: işlenemeyen mesajları kaybetmeden izole et — alarm + manuel requeue akışı kur",
          "DLX + TTL combo: delayed retry queue — mesaj N saniye sonra ana queue'ya geri gelir",
          "Priority: kritik alarm > normal işlem — max 5-10 priority seviyesi (fazlası memory israfı)",
          "Quorum queue: durable + replicated — mirror queue'nun yerini aldı, RF ile konfigure et",
        ],
        pitfalls: [
          "Priority queue memory: her priority level ayrı dahili queue — yüksek max-priority RAM maliyeti",
          "DLQ döngüsü: DLQ consumer hata verirse DLQ'nun DLQ'su gerekir — derinlik sınırla",
          "x-message-ttl sıfırlanmaz: queue'ya bağlı TTL policy sonradan değiştirilemez — yeni queue açmak gerekir",
          "Consumer prefetch (QoS): basic.qos prefetch_count — consumer buffer'ını sınırla, aksi hâlde 1 consumer tüm mesajları çeker, diğerleri idle",
        ],
        visual: "dlq_priority",
        steps: [
          { from: "producer", to: "main_q", label: "publish priority=5", color: "#a78bfa", delay: 0 },
          { from: "producer", to: "main_q", label: "publish priority=1", color: "#818cf8", delay: 300 },
          { from: "producer", to: "main_q", label: "publish priority=9 (urgent)", color: "#f472b6", delay: 600 },
          { from: "main_q", to: "consumer", label: "priority=9 önce çıkar!", color: "#f472b6", delay: 1400 },
          { from: "consumer", to: "consumer", label: "❌ işleme hatası", color: "#ef4444", delay: 2200, self: true },
          { from: "main_q", to: "dlx", label: "nack → DLX'e yönlendir", color: "#ef4444", delay: 3000 },
          { from: "dlx", to: "dlq", label: "dead-letter-queue'ya düştü", color: "#dc2626", delay: 3700 },
          { from: "dlq", to: "ops", label: "🔔 DLQ alert → ops inceleme", color: "#fbbf24", delay: 4500 },
        ],
      },
    ],
  },

  elasticsearch: {
    label: "Elasticsearch",
    emoji: "🔍",
    accent: "#fbbf24",
    subsections: [
      {
        id: "indexing",
        name: "Indexing & Mapping",
        problem: "ES'e veri yazıyoruz ama sorgular yavaş veya relevance düşük. Mapping neden kritik?",
        solution: "Index oluştururken field tip ve analyzer belirlenir. text vs keyword farkı: text → tokenize + analyze (full-text), keyword → exact match + aggregation. Mapping sonradan değiştirilemez — yeni index + reindex zorunlu.",
        whenToUse: [
          "text + analyzer: free-text arama — 'elasticsearch nedir' içindeki kelimeler ayrı token",
          "keyword: exact match, aggregation, sorting — email, user_id, status kodu",
          "nested: array of objects'te her elemana ayrı query — flat mapping'de cross-object match yanlış sonuç verir",
          "dense_vector: semantic search, kNN arama — sentence-transformer embedding'i sakla",
        ],
        pitfalls: [
          "Dynamic mapping: ES bilinmeyen field'ı otomatik map eder — production'da strict mapping zorunlu",
          "Mapping explosion: JSON key sayısı çok artarsa field sayısı patlar — index.mapping.total_fields.limit",
          "text field'a sort/aggregation: hata veya OOM — .keyword sub-field ekle",
          "Reindex maliyeti: büyük index'te mapping değişikliği saatlerce sürebilir — zero-downtime için alias + reindex + alias switch",
        ],
        visual: "indexing",
        steps: [
          { from: "app", to: "es", label: "PUT /products/_doc/1 {title:'Redis Guide'}", color: "#fbbf24", delay: 0 },
          { from: "es", to: "analyzer", label: "analyze: 'Redis Guide' → ['redis','guide']", color: "#fb923c", delay: 800 },
          { from: "analyzer", to: "inverted", label: "inverted index: redis→[1], guide→[1]", color: "#fbbf24", delay: 1600 },
          { from: "app", to: "es", label: "PUT /products/_doc/2 {title:'Redis Cookbook'}", color: "#fbbf24", delay: 2600 },
          { from: "es", to: "analyzer", label: "analyze: → ['redis','cookbook']", color: "#fb923c", delay: 3400 },
          { from: "analyzer", to: "inverted", label: "inverted index: redis→[1,2]", color: "#fbbf24", delay: 4200 },
          { from: "app", to: "es", label: "GET /_search {query:{match:{title:'redis'}}}", color: "#34d399", delay: 5200 },
          { from: "es", to: "app", label: "hits: [doc1(score:1.2), doc2(score:1.1)]", color: "#34d399", delay: 6000 },
        ],
      },
      {
        id: "sharding_routing",
        name: "Shard Routing & Query",
        problem: "ES index'i nasıl dağıtır? Arama tüm shard'lara gitmek zorunda mı?",
        solution: "Index N primary shard'a bölünür. Her shard'a replika eklenir. Yazma: routing = hash(doc_id) % N → hangi primary shard. Okuma: scatter-gather — tüm shard'lara git, sonuçları birleştir. Custom routing ile belirli shard'a yönlendir.",
        whenToUse: [
          "Shard sayısı sabit: baştan doğru seç — sonradan değiştirme yok (reindex gerekir)",
          "Kural: shard boyutu 10-50GB arası ideal — çok küçük shard overhead, çok büyük recovery yavaş",
          "Custom routing: tenant_id ile aynı müşteri datası aynı shard — scatter-gather azalır",
          "Search after API: deep pagination için (from+size O(N)), pit + search_after O(1)",
        ],
        pitfalls: [
          "Over-sharding: çok fazla shard → her query çok node'a gider → latency artar, heap tüketimi artar",
          "Uneven shard: büyük shard'a sahip node hotspot — custom routing veya shard allocation awareness",
          "Scatter-gather latency: 1000 shard × 1ms = 1000ms — shard sayısını minimize et",
          "_id değişirse routing değişir: document farklı shard'a gider → 404 — _routing parametresini belgele",
        ],
        visual: "shard_routing",
        steps: [
          { from: "client", to: "coord", label: "GET /products/_search {match:{brand:'Apple'}}", color: "#fbbf24", delay: 0 },
          { from: "coord", to: "shard0", label: "scatter →", color: "#fb923c", delay: 800 },
          { from: "coord", to: "shard1", label: "scatter →", color: "#fb923c", delay: 900 },
          { from: "coord", to: "shard2", label: "scatter →", color: "#fb923c", delay: 1000 },
          { from: "shard0", to: "coord", label: "hits: [doc1, doc5]", color: "#fbbf24", delay: 1800 },
          { from: "shard1", to: "coord", label: "hits: [doc3]", color: "#fbbf24", delay: 1900 },
          { from: "shard2", to: "coord", label: "hits: []", color: "#475569", delay: 2000 },
          { from: "coord", to: "client", label: "gather + rank → [doc1, doc3, doc5]", color: "#34d399", delay: 2800 },
        ],
      },
    ],
  },

  clickhouse: {
    label: "ClickHouse",
    emoji: "🏚",
    accent: "#34d399",
    subsections: [
      {
        id: "columnar",
        name: "Columnar Storage & MergeTree",
        problem: "OLTP DB'de analitik sorgu neden yavaş? SELECT COUNT(*) GROUP BY city 100M satırda dakikalar alıyor.",
        solution: "Row-store: SELECT city yaparken tüm row okunur (100 kolon × 100M satır). Columnar: sadece city kolonu okunur — 50-100x daha az I/O. MergeTree: verileri primary key'e göre sıralar, LSM-tree benzeri merge eder. Compression per-column: benzer değerler yanyana → %80-90 sıkıştırma.",
        whenToUse: [
          "OLAP workload: aggregate, GROUP BY, kolumnar scan — ClickHouse ideal",
          "Time-series analytics: IoT, log analizi, financial tick data — TimescaleDB ile de çözülür",
          "ReplacingMergeTree: deduplication — aynı key'e yazılan son versiyonu tutar (async)",
          "AggregatingMergeTree: pre-aggregated state — SummingMergeTree ile toplam otomatik birleşir",
        ],
        pitfalls: [
          "OLTP için uygun değil: single-row update/delete pahalı — mutasyon async, hemen görünmez",
          "Part merge: yeni data küçük partlar halinde gelir, merge arka planda — too many parts hatası (> 300 active parts) throttle",
          "JOIN performansı: ClickHouse JOIN memory-based, büyük tablolarda OOM — denormalize veri veya distributed join dikkat",
          "Eventual dedup: ReplacingMergeTree merge olana kadar duplicate görebilirsin — FINAL modifier ekle (yavaş) veya uygulama tarafında deduplicate et",
        ],
        visual: "columnar",
        steps: [
          { from: "app", to: "ch", label: "SELECT city, COUNT(*) FROM events WHERE ts > now()-7d GROUP BY city", color: "#34d399", delay: 0 },
          { from: "ch", to: "city_col", label: "read only 'city' column (2MB)", color: "#34d399", delay: 800, note: "Row-store: 200MB okurdu" },
          { from: "ch", to: "ts_col", label: "read 'ts' column for WHERE (8MB)", color: "#34d399", delay: 1200 },
          { from: "city_col", to: "ch", label: "decompressed: 100M city values", color: "#6ee7b7", delay: 2200 },
          { from: "ts_col", to: "ch", label: "decompressed + filtered: 12M rows", color: "#6ee7b7", delay: 2600 },
          { from: "ch", to: "app", label: "GROUP BY result: {Istanbul:4M, Ankara:2.1M...}", color: "#34d399", delay: 3600, note: "~120ms" },
        ],
      },
      {
        id: "materialized_views",
        name: "Materialized Views",
        problem: "Aynı aggregate sorgusu her seferinde tüm veriyi tarar. Önceden hesaplayabilsek?",
        solution: "Materialized View: INSERT tetiklenince otomatik aggregate state güncellenir. AggregatingMergeTree ile combine edilince gerçek zamanlı pre-aggregation. Sorgu hızı 100-1000x artar.",
        whenToUse: [
          "Gerçek zamanlı dashboard: saniyede güncellenen metrikler — COUNT, SUM, AVG, HLL (uniq)",
          "Rollup tabloları: 1s → 1m → 1h → 1d granülarite — her level MV ile otomatik güncellenir",
          "Kafka → CH pipeline: kafka engine table + MV ile stream'i aggregate ederek kaydet",
          "toStartOfHour/toStartOfDay: zaman bucketing — her event gelince bucketed aggregate güncellenir",
        ],
        pitfalls: [
          "MV sadece yeni insert'ı görür: mevcut datayı backfill etmek için manuel INSERT SELECT gerekir",
          "MV hata toleransı: insert başarısız olursa MV güncellenmez — source table ve MV arasında tutarsızlık",
          "Çok fazla MV: her insert N MV tetikler → write amplification → ingest yavaşlar",
          "AggregatingMergeTree + partial state: -Merge ve -State suffix fonksiyonları doğru kullanılmazsa yanlış sonuç",
        ],
        visual: "mv",
        steps: [
          { from: "kafka", to: "ch_raw", label: "INSERT INTO events (kafka engine)", color: "#f97316", delay: 0 },
          { from: "ch_raw", to: "mv1", label: "trigger MV: hourly_stats", color: "#34d399", delay: 700 },
          { from: "ch_raw", to: "mv2", label: "trigger MV: city_counts", color: "#34d399", delay: 800 },
          { from: "mv1", to: "agg_table1", label: "update AggregatingMergeTree", color: "#6ee7b7", delay: 1500 },
          { from: "mv2", to: "agg_table2", label: "update AggregatingMergeTree", color: "#6ee7b7", delay: 1600 },
          { from: "dashboard", to: "agg_table1", label: "SELECT countMerge(*) FROM hourly_stats", color: "#fbbf24", delay: 2600 },
          { from: "agg_table1", to: "dashboard", label: "result in 2ms (pre-agg'd)", color: "#fbbf24", delay: 3200, note: "Full scan: 2000ms olurdu" },
        ],
      },
    ],
  },
};

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

const SYSTEM_ORDER = ["redis", "kafka", "postgresql", "rabbitmq", "elasticsearch", "clickhouse"];

// ══════════════════════════════════════════════════════════════
// SVG NODE LAYOUTS
// ══════════════════════════════════════════════════════════════

const NODE_LAYOUTS = {
  pubsub_streams: {
    nodes: [
      { id: "publisher", label: "Publisher", x: 60,  y: 80,  color: "#ef4444" },
      { id: "broker",    label: "Redis\nBroker", x: 220, y: 80,  color: "#ef4444" },
      { id: "sub1",      label: "Sub-1\n(online)", x: 380, y: 40,  color: "#34d399" },
      { id: "sub2",      label: "Sub-2\n(online)", x: 380, y: 120, color: "#34d399" },
      { id: "sub3",      label: "Sub-3\n(offline)", x: 380, y: 200, color: "#475569" },
      { id: "producer",  label: "Producer", x: 60,  y: 240, color: "#f87171" },
      { id: "stream",    label: "Stream\n(log)", x: 220, y: 240, color: "#fbbf24" },
      { id: "worker1",   label: "Worker-1", x: 380, y: 210, color: "#818cf8" },
      { id: "worker2",   label: "Worker-2", x: 380, y: 270, color: "#818cf8" },
    ],
  },
  cluster_sentinel: {
    nodes: [
      { id: "client",    label: "Client",    x: 60,  y: 160, color: "#94a3b8" },
      { id: "sentinel1", label: "Sentinel1", x: 220, y: 60,  color: "#fbbf24" },
      { id: "sentinel2", label: "Sentinel2", x: 380, y: 60,  color: "#fbbf24" },
      { id: "sentinel3", label: "Sentinel3", x: 540, y: 60,  color: "#fbbf24" },
      { id: "master",    label: "Master",    x: 220, y: 200, color: "#ef4444" },
      { id: "replica1",  label: "Replica-1", x: 380, y: 200, color: "#64748b" },
      { id: "replica2",  label: "Replica-2", x: 540, y: 200, color: "#64748b" },
    ],
  },
  consumer_groups: {
    nodes: [
      { id: "producer",  label: "Producer",  x: 60,  y: 160, color: "#f97316" },
      { id: "p0",        label: "Partition\n0", x: 200, y: 80,  color: "#fb923c" },
      { id: "p1",        label: "Partition\n1", x: 200, y: 160, color: "#fb923c" },
      { id: "p2",        label: "Partition\n2", x: 200, y: 240, color: "#fb923c" },
      { id: "billing1",  label: "Billing\nC1", x: 360, y: 60,  color: "#fbbf24" },
      { id: "billing2",  label: "Billing\nC2", x: 360, y: 140, color: "#fbbf24" },
      { id: "billing3",  label: "Billing\nC3", x: 360, y: 220, color: "#fbbf24" },
      { id: "notify1",   label: "Notify\nC1", x: 520, y: 100, color: "#60a5fa" },
      { id: "notify2",   label: "Notify\nC2", x: 520, y: 220, color: "#60a5fa" },
    ],
  },
  replication_isr: {
    nodes: [
      { id: "producer",  label: "Producer",  x: 60,  y: 160, color: "#f97316" },
      { id: "leader",    label: "Leader\n(P0)", x: 250, y: 160, color: "#f97316" },
      { id: "follower1", label: "Follower-1\n(ISR)", x: 450, y: 80,  color: "#34d399" },
      { id: "follower2", label: "Follower-2\n(ISR)", x: 450, y: 240, color: "#34d399" },
    ],
  },
  mvcc: {
    nodes: [
      { id: "tx1",    label: "TX-100",   x: 80,  y: 120, color: "#60a5fa" },
      { id: "tx2",    label: "TX-101",   x: 80,  y: 240, color: "#818cf8" },
      { id: "db",     label: "DB\n(MVCC)", x: 350, y: 180, color: "#22d3ee" },
      { id: "vacuum", label: "VACUUM",   x: 560, y: 180, color: "#fbbf24" },
    ],
  },
  connection_pool: {
    nodes: [
      { id: "app1",      label: "App-1",    x: 60,  y: 80,  color: "#60a5fa" },
      { id: "app2",      label: "App-2",    x: 60,  y: 160, color: "#60a5fa" },
      { id: "app3",      label: "App-3",    x: 60,  y: 240, color: "#60a5fa" },
      { id: "app4",      label: "App-4",    x: 60,  y: 310, color: "#818cf8" },
      { id: "pgbouncer", label: "PgBouncer\n(pool)", x: 280, y: 190, color: "#a78bfa" },
      { id: "pg1",       label: "PG conn\n#1", x: 500, y: 130, color: "#22d3ee" },
      { id: "pg2",       label: "PG conn\n#2", x: 500, y: 250, color: "#22d3ee" },
    ],
  },
  exchanges: {
    nodes: [
      { id: "producer",  label: "Producer", x: 40,  y: 80,  color: "#a78bfa" },
      { id: "producer2", label: "Producer", x: 40,  y: 180, color: "#a78bfa" },
      { id: "producer3", label: "Producer", x: 40,  y: 280, color: "#a78bfa" },
      { id: "direct_ex", label: "Direct\nExchange", x: 200, y: 80,  color: "#818cf8" },
      { id: "topic_ex",  label: "Topic\nExchange",  x: 200, y: 180, color: "#818cf8" },
      { id: "fanout_ex", label: "Fanout\nExchange", x: 200, y: 280, color: "#818cf8" },
      { id: "error_q",   label: "error-q", x: 380, y: 80,  color: "#ef4444" },
      { id: "order_q",   label: "order-q", x: 380, y: 150, color: "#fbbf24" },
      { id: "payment_q", label: "payment-q",x: 380, y: 210, color: "#fbbf24" },
      { id: "all_q1",    label: "queue-1",  x: 380, y: 250, color: "#34d399" },
      { id: "all_q2",    label: "queue-2",  x: 380, y: 290, color: "#34d399" },
      { id: "all_q3",    label: "queue-3",  x: 550, y: 270, color: "#34d399" },
    ],
  },
  dlq_priority: {
    nodes: [
      { id: "producer", label: "Producer",   x: 60,  y: 160, color: "#a78bfa" },
      { id: "main_q",   label: "Priority\nQueue", x: 220, y: 160, color: "#f472b6" },
      { id: "consumer", label: "Consumer",   x: 380, y: 120, color: "#818cf8" },
      { id: "dlx",      label: "Dead Letter\nExchange", x: 380, y: 240, color: "#ef4444" },
      { id: "dlq",      label: "DLQ",        x: 540, y: 240, color: "#dc2626" },
      { id: "ops",      label: "Ops\nAlert", x: 540, y: 320, color: "#fbbf24" },
    ],
  },
  indexing: {
    nodes: [
      { id: "app",      label: "App",       x: 60,  y: 160, color: "#fbbf24" },
      { id: "es",       label: "ES Node",   x: 240, y: 160, color: "#fbbf24" },
      { id: "analyzer", label: "Analyzer",  x: 400, y: 80,  color: "#fb923c" },
      { id: "inverted", label: "Inverted\nIndex", x: 400, y: 240, color: "#f59e0b" },
    ],
  },
  shard_routing: {
    nodes: [
      { id: "client", label: "Client",    x: 40,  y: 160, color: "#fbbf24" },
      { id: "coord",  label: "Coordinating\nNode", x: 200, y: 160, color: "#fb923c" },
      { id: "shard0", label: "Shard-0",   x: 400, y: 80,  color: "#f59e0b" },
      { id: "shard1", label: "Shard-1",   x: 400, y: 160, color: "#f59e0b" },
      { id: "shard2", label: "Shard-2",   x: 400, y: 240, color: "#f59e0b" },
    ],
  },
  columnar: {
    nodes: [
      { id: "app",      label: "App",         x: 60,  y: 160, color: "#34d399" },
      { id: "ch",       label: "ClickHouse",  x: 250, y: 160, color: "#34d399" },
      { id: "city_col", label: "city\ncolumn", x: 440, y: 90,  color: "#6ee7b7" },
      { id: "ts_col",   label: "ts\ncolumn",   x: 440, y: 230, color: "#6ee7b7" },
    ],
  },
  mv: {
    nodes: [
      { id: "kafka",      label: "Kafka",       x: 40,  y: 160, color: "#f97316" },
      { id: "ch_raw",     label: "Raw\nEvents", x: 200, y: 160, color: "#34d399" },
      { id: "mv1",        label: "MV:\nhourly", x: 350, y: 80,  color: "#6ee7b7" },
      { id: "mv2",        label: "MV:\ncity",   x: 350, y: 240, color: "#6ee7b7" },
      { id: "agg_table1", label: "Agg\nTable-1", x: 490, y: 80,  color: "#059669" },
      { id: "agg_table2", label: "Agg\nTable-2", x: 490, y: 240, color: "#059669" },
      { id: "dashboard",  label: "Dashboard",  x: 580, y: 160, color: "#fbbf24" },
    ],
  },
};

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════

function InfraSimulatorInner() {
  const [sysId, setSysId] = useState("redis");
  const [subId, setSubId] = useState(null);
  const [animStep, setAnimStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef([]);

  const sys = SYSTEMS[sysId];
  const sub = subId ? sys.subsections.find(s => s.id === subId) : sys.subsections[0];
  const effectiveSub = sub || sys.subsections[0];

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const switchSys = (id) => { clearTimers(); setSysId(id); setSubId(null); setAnimStep(-1); setRunning(false); setDone(false); };
  const switchSub = (id) => { clearTimers(); setSubId(id); setAnimStep(-1); setRunning(false); setDone(false); };

  const steps = effectiveSub.steps || [];
  const hasAnim = steps.length > 0;

  const run = useCallback(() => {
    if (!steps.length) return;
    clearTimers(); setAnimStep(-1); setRunning(true); setDone(false);
    steps.forEach((s, i) => {
      const t = setTimeout(() => {
        setAnimStep(i);
        if (i === steps.length - 1) setTimeout(() => { setRunning(false); setDone(true); }, 600);
      }, s.delay);
      timers.current.push(t);
    });
  }, [steps]);

  useEffect(() => () => clearTimers(), []);

  const accent = sys.accent;

  return (
    <div style={R.root}>
      <div style={R.gridBg} />

      {/* TOP BAR */}
      <header style={R.header}>
        <div style={R.hBrand}>
          <span style={{ ...R.hDot, background: accent }} />
          <span style={R.hTitle}>Infrastructure Simulator</span>
          <span style={R.hSub}>Redis · Kafka · PostgreSQL · RabbitMQ · Elasticsearch · ClickHouse</span>
        </div>
        <div style={{ ...R.hPill, color: accent, borderColor: accent + "55", background: accent + "11" }}>
          {sys.emoji} {sys.label} · {effectiveSub.name}
        </div>
      </header>

      {/* SYSTEM TABS */}
      <nav style={R.sysNav}>
        {SYSTEM_ORDER.map(id => {
          const s = SYSTEMS[id];
          return (
            <button key={id} onClick={() => switchSys(id)} style={{
              ...R.sysBtn,
              ...(sysId === id ? { borderColor: s.accent, color: s.accent, background: s.accent + "15", boxShadow: `0 0 18px ${s.accent}44` } : {}),
            }}>
              <span style={R.sysBtnEmoji}>{s.emoji}</span>
              <span style={R.sysBtnLabel}>{s.label}</span>
            </button>
          );
        })}
      </nav>

      {/* SUBSECTION TABS */}
      <div style={R.subNav}>
        {sys.subsections.map(s => (
          <button key={s.id} onClick={() => switchSub(s.id)} style={{
            ...R.subBtn,
            ...((effectiveSub.id === s.id) ? { borderColor: accent, color: "#f1f5f9", background: accent + "18" } : {}),
          }}>{s.name}</button>
        ))}
      </div>

      {/* BODY */}
      <div style={R.body}>

        {/* LEFT */}
        <aside style={R.left}>
          <div style={{ ...R.card, borderColor: accent + "44" }}>
            <div style={{ ...R.lbl, color: accent }}>⚠ Problem</div>
            <p style={R.cardTxt}>{effectiveSub.problem}</p>
          </div>
          <div style={{ ...R.card, borderColor: "#0f2845" }}>
            <div style={R.lbl}>✦ Çözüm</div>
            <p style={R.cardTxt}>{effectiveSub.solution}</p>
          </div>
          <div style={R.listCard}>
            <div style={R.lbl}>✓ Ne Zaman / Nasıl</div>
            {effectiveSub.whenToUse.map((w, i) => (
              <div key={i} style={R.listRow}>
                <span style={{ color: "#34d399", flexShrink: 0, marginTop: 2 }}>›</span>
                <span style={R.listTxt}>{w}</span>
              </div>
            ))}
          </div>
          <div style={R.listCard}>
            <div style={R.lbl}>⚡ Dikkat Et</div>
            {effectiveSub.pitfalls.map((p, i) => (
              <div key={i} style={R.listRow}>
                <span style={{ color: "#f97316", flexShrink: 0, marginTop: 2 }}>›</span>
                <span style={R.listTxt}>{p}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* CENTER */}
        <main style={R.center}>
          {/* Special visuals */}
          {effectiveSub.visual === "data_structures" && <DataStructuresViz accent={accent} />}
          {effectiveSub.visual === "indexes" && <IndexTypesViz accent={accent} />}
          {effectiveSub.visual === "columnar" && !hasAnim && <ColumnarViz accent={accent} />}

          {/* SVG animation diagram */}
          {hasAnim && (
            <FlowDiagram
              layout={NODE_LAYOUTS[effectiveSub.visual] || { nodes: [] }}
              steps={steps}
              animStep={animStep}
              accent={accent}
            />
          )}

          {hasAnim && (
            <button onClick={run} disabled={running} style={{
              ...R.runBtn,
              background: running ? "transparent" : accent,
              color: running ? accent : "#060e1a",
              borderColor: accent,
              boxShadow: running ? "none" : `0 0 24px ${accent}66`,
            }}>{running ? "⟳ Çalışıyor..." : done ? "↺ Tekrar" : "▶ Simüle Et"}</button>
          )}

          {/* Step log */}
          {hasAnim && (
            <div style={R.logWrap}>
              {animStep < 0 && <span style={R.logEmpty}>▶ simülasyonu başlat</span>}
              {steps.slice(0, animStep + 1).map((s, i) => (
                <div key={i} style={{ ...R.logRow, borderLeftColor: s.color, opacity: i === animStep ? 1 : 0.5, background: i === animStep ? s.color + "0d" : "transparent" }}>
                  <span style={{ color: s.color, fontWeight: 700, fontSize: 9 }}>{s.from?.toUpperCase()}</span>
                  <span style={{ color: "#1e3a5f", fontSize: 9 }}> → </span>
                  <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: 9 }}>{s.to?.toUpperCase()}</span>
                  <span style={{ color: "#475569", fontSize: 9, marginLeft: 5 }}>{s.label.split("\n")[0].substring(0, 48)}</span>
                  {s.note && <span style={{ color: s.color, fontSize: 9, marginLeft: 6, fontWeight: 700 }}>— {s.note}</span>}
                </div>
              ))}
              {done && <div style={{ ...R.logRow, borderLeftColor: accent, color: accent, fontWeight: 800, fontSize: 9 }}>✓ Tamamlandı</div>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// FLOW DIAGRAM SVG
// ══════════════════════════════════════════════════════════════

function FlowDiagram({ layout, steps, animStep, accent }) {
  const W = 630, H = 360;
  const { nodes } = layout;
  const posMap = Object.fromEntries(nodes.map(n => [n.id, { x: n.x, y: n.y, color: n.color }]));
  const activeSteps = animStep >= 0 ? steps.slice(0, animStep + 1) : [];
  const current = animStep >= 0 ? steps[animStep] : null;

  function arrowLine(from, to) {
    const a = posMap[from], b = posMap[to];
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx*dx+dy*dy)||1, pad = 28;
    return { x1: a.x+dx/len*pad, y1: a.y+dy/len*pad, x2: b.x-dx/len*pad, y2: b.y-dy/len*pad };
  }

  return (
    <div style={R.svgBox}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }}>
        <defs>
          <filter id="glowf"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <marker id="ma" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill={accent}/></marker>
          <marker id="md" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill="#1e3a5f"/></marker>
        </defs>

        {/* Background edges */}
        {[...new Set(steps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map(s => `${s.from}→${s.to}`))].map((key, i) => {
          const [f, t] = key.split("→");
          const ln = arrowLine(f, t);
          return ln ? <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke="#0a1e35" strokeWidth="1" strokeDasharray="3 5"/> : null;
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
                stroke={c} strokeWidth={isLast ? 2.5 : 1.2} opacity={isLast ? 1 : 0.35}
                markerEnd={isLast ? "url(#ma)" : "url(#md)"}
                filter={isLast ? "url(#glowf)" : undefined}
              />
              {isLast && (
                <>
                  <rect x={mx-65} y={my-18} width={130} height={14} rx={3} fill="#060e1a" opacity="0.9"/>
                  <text x={mx} y={my-7} textAnchor="middle" fill={c} fontSize="8.5" fontWeight="700" fontFamily="monospace">{s.label.substring(0,32)}</text>
                </>
              )}
            </g>
          );
        })}

        {/* Self labels */}
        {activeSteps.filter(s => s.self && posMap[s.from]).map((s, i) => {
          const n = posMap[s.from];
          const isLast = steps.indexOf(s) === animStep;
          return (
            <text key={`sf-${i}`} x={n.x} y={n.y - 42} textAnchor="middle"
              fill={s.color} fontSize="9" fontWeight="800" fontFamily="monospace"
              filter={isLast ? "url(#glowf)" : undefined}>
              {s.label.substring(0, 36)}
            </text>
          );
        })}

        {/* Nodes */}
        {nodes.map(n => {
          const isActive = current && !current.self && (current.from === n.id || current.to === n.id);
          const lines = n.label.split("\n");
          return (
            <g key={n.id}>
              {isActive && <circle cx={n.x} cy={n.y} r={34} fill={n.color+"14"}/>}
              <circle cx={n.x} cy={n.y} r={24} fill="#07111e"
                stroke={isActive ? n.color : n.color + "44"}
                strokeWidth={isActive ? 2.5 : 1.5}
                filter={isActive ? "url(#glowf)" : undefined}
              />
              {lines.map((ln, li) => (
                <text key={li} x={n.x} y={n.y + (lines.length === 1 ? 4 : li * 10 - 2)}
                  textAnchor="middle" fill={isActive ? n.color : n.color + "88"}
                  fontSize="8.5" fontWeight="700" fontFamily="monospace">
                  {ln}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STATIC VISUALS
// ══════════════════════════════════════════════════════════════

function DataStructuresViz({ accent }) {
  const [selected, setSelected] = useState(null);
  const structs = [
    { type: "String", cmd: "SET key val EX 3600", usecase: "Session, counter, lock", complexity: "O(1)", color: "#ef4444" },
    { type: "Hash",   cmd: "HSET user:1 name Ali age 30", usecase: "User profile, config", complexity: "O(1) per field", color: "#f97316" },
    { type: "List",   cmd: "LPUSH queue task1 / BRPOP", usecase: "Job queue, activity feed", complexity: "O(1) head/tail", color: "#fbbf24" },
    { type: "Set",    cmd: "SADD tags python redis", usecase: "Unique items, SINTER", complexity: "O(1) add/check", color: "#34d399" },
    { type: "ZSet",   cmd: "ZADD lb 1500 userId", usecase: "Leaderboard, rate limiter", complexity: "O(log N) add", color: "#60a5fa" },
    { type: "HLL",    cmd: "PFADD visitors user42", usecase: "Unique count ~0.81% err", complexity: "O(1) / 12KB", color: "#a78bfa" },
    { type: "Bitmap", cmd: "SETBIT active:20240101 userId 1", usecase: "DAU, feature flag", complexity: "O(1) / bit/user", color: "#f472b6" },
    { type: "Stream", cmd: "XADD events * k=v", usecase: "Event log, consumer group", complexity: "O(1) append", color: "#fb923c" },
  ];
  return (
    <div style={R.dsGrid}>
      {structs.map(s => (
        <div key={s.type} onClick={() => setSelected(selected === s.type ? null : s.type)}
          style={{ ...R.dsCard, borderColor: selected === s.type ? s.color : s.color + "33", background: selected === s.type ? s.color + "14" : "#07111e", cursor: "pointer" }}>
          <div style={{ color: s.color, fontWeight: 800, fontSize: 11 }}>{s.type}</div>
          <div style={{ color: "#475569", fontSize: 9, marginTop: 2 }}>{s.complexity}</div>
          {selected === s.type && (
            <>
              <div style={{ color: "#64748b", fontSize: 9, marginTop: 6, fontFamily: "monospace", background: "#030810", padding: "4px 6px", borderRadius: 3, lineHeight: 1.5 }}>{s.cmd}</div>
              <div style={{ color: s.color + "bb", fontSize: 9, marginTop: 4 }}>{s.usecase}</div>
            </>
          )}
        </div>
      ))}
      <div style={{ gridColumn: "1/-1", color: "#1e3a5f", fontSize: 9, textAlign: "center" }}>Karta tıkla → detay</div>
    </div>
  );
}

function IndexTypesViz({ accent }) {
  const [sel, setSel] = useState(null);
  const indexes = [
    { type: "B-Tree",   ops: "=, <, >, BETWEEN, LIKE 'x%', ORDER BY", size: "Orta", color: "#60a5fa", when: "Varsayılan — her şey için iyi başlangıç" },
    { type: "Hash",     ops: "= (sadece eşitlik)", size: "Küçük", color: "#818cf8", when: "Çok nadir tercih — B-Tree genelde daha iyi" },
    { type: "GIN",      ops: "JSONB @>, array @>, tsvector @@", size: "Büyük", color: "#f97316", when: "Full-text search, JSONB sorgular, array içinde ara" },
    { type: "GiST",     ops: "Geometri &&, @>, PostGIS, range overlap", size: "Orta-Büyük", color: "#34d399", when: "Spatial (PostGIS), inet range, full-text (tsquery)" },
    { type: "BRIN",     ops: "Fiziksel sıralı data range", size: "Çok Küçük", color: "#fbbf24", when: "100M+ satır timestamp/serial kolonlar — log tablosu" },
    { type: "Partial",  ops: "WHERE koşullu — küçük alt küme", size: "Çok Küçük", color: "#f472b6", when: "WHERE status='active' olan siparişler — %5 oranı" },
  ];
  return (
    <div style={R.dsGrid}>
      {indexes.map(ix => (
        <div key={ix.type} onClick={() => setSel(sel === ix.type ? null : ix.type)}
          style={{ ...R.dsCard, borderColor: sel === ix.type ? ix.color : ix.color + "33", background: sel === ix.type ? ix.color + "12" : "#07111e", cursor: "pointer" }}>
          <div style={{ color: ix.color, fontWeight: 800, fontSize: 11 }}>{ix.type}</div>
          <div style={{ color: "#334155", fontSize: 9, marginTop: 2 }}>boyut: {ix.size}</div>
          {sel === ix.type && (
            <>
              <div style={{ color: "#64748b", fontSize: 9, marginTop: 6, background: "#030810", padding: "4px 6px", borderRadius: 3, lineHeight: 1.6, fontFamily: "monospace" }}>{ix.ops}</div>
              <div style={{ color: ix.color + "bb", fontSize: 9, marginTop: 4 }}>{ix.when}</div>
            </>
          )}
        </div>
      ))}
      <div style={{ gridColumn: "1/-1", color: "#1e3a5f", fontSize: 9, textAlign: "center" }}>Karta tıkla → operatörler ve kullanım</div>
    </div>
  );
}

function ColumnarViz({ accent }) {
  const rowData = [
    { id: 1, city: "Istanbul", device: "mobile", event: "click", ts: "2024-01-01" },
    { id: 2, city: "Ankara",   device: "desktop", event: "view", ts: "2024-01-01" },
    { id: 3, city: "Istanbul", device: "mobile", event: "purchase", ts: "2024-01-01" },
  ];
  const [highlight, setHighlight] = useState(null);
  const cols = ["id", "city", "device", "event", "ts"];
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
        <div>
          <div style={{ color: "#475569", fontSize: 9, marginBottom: 4, textAlign: "center" }}>ROW STORE</div>
          <table style={{ borderCollapse: "collapse", fontSize: 9, fontFamily: "monospace" }}>
            <thead>
              <tr>{cols.map(c => <th key={c} style={{ padding: "3px 8px", color: "#475569", borderBottom: "1px solid #1e3a5f" }}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rowData.map(row => (
                <tr key={row.id} style={{ background: highlight === "row" ? "#60a5fa14" : "transparent" }}>
                  {cols.map(c => <td key={c} style={{ padding: "3px 8px", color: highlight === "row" ? "#60a5fa" : "#334155", borderBottom: "1px solid #0a1e35" }}>{row[c]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ color: "#ef4444", fontSize: 8, marginTop: 4, textAlign: "center" }}>SELECT city → tüm row okunur</div>
        </div>
        <div>
          <div style={{ color: "#475569", fontSize: 9, marginBottom: 4, textAlign: "center" }}>COLUMNAR (ClickHouse)</div>
          <div style={{ display: "flex", gap: 4 }}>
            {cols.map(c => (
              <div key={c} style={{ ...R.colBlock, borderColor: highlight === c ? accent : "#1e3a5f", background: highlight === c ? accent + "18" : "#07111e" }}
                onMouseEnter={() => setHighlight(c)} onMouseLeave={() => setHighlight(null)}>
                <div style={{ color: highlight === c ? accent : "#334155", fontSize: 8, fontWeight: 700, marginBottom: 4 }}>{c}</div>
                {rowData.map(row => (
                  <div key={row.id} style={{ color: highlight === c ? accent + "cc" : "#1e3a5f", fontSize: 8, padding: "1px 0" }}>{row[c]}</div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ color: "#34d399", fontSize: 8, marginTop: 4, textAlign: "center" }}>Hover kolon → sadece o kolon okunur</div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════════

const R = {
  root: { minHeight: "100vh", background: "#060e1a", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", display: "flex", flexDirection: "column", position: "relative" },
  gridBg: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "radial-gradient(circle at 15% 25%, #0d1e3818 0%, transparent 50%), radial-gradient(circle at 85% 75%, #1a0d2818 0%, transparent 50%)" },
  header: { position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 28px", borderBottom: "1px solid #0f2540", background: "#060e1a" },
  hBrand: { display: "flex", alignItems: "center", gap: 10 },
  hDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  hTitle: { fontSize: 16, fontWeight: 800, color: "#f1f5f9" },
  hSub: { fontSize: 9, color: "#1e3a5f", letterSpacing: 2, textTransform: "uppercase", marginLeft: 8 },
  hPill: { fontSize: 10, fontWeight: 700, padding: "3px 12px", borderRadius: 20, border: "1px solid", letterSpacing: 0.5 },
  sysNav: { position: "relative", zIndex: 1, display: "flex", gap: 4, padding: "8px 28px", borderBottom: "1px solid #0f2540", background: "#060e1a", overflowX: "auto" },
  sysBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 6, border: "1px solid #0f2540", background: "transparent", cursor: "pointer", color: "#1e3a5f", fontFamily: "inherit", fontSize: 11, fontWeight: 700, transition: "all 0.2s", flexShrink: 0 },
  sysBtnEmoji: { fontSize: 14 },
  sysBtnLabel: {},
  subNav: { position: "relative", zIndex: 1, display: "flex", gap: 4, padding: "6px 28px", borderBottom: "1px solid #0f2540", flexWrap: "wrap" },
  subBtn: { padding: "5px 12px", borderRadius: 5, border: "1px solid #0f2540", background: "transparent", cursor: "pointer", color: "#334155", fontFamily: "inherit", fontSize: 10, fontWeight: 700, transition: "all 0.15s" },
  body: { position: "relative", zIndex: 1, display: "flex", flex: 1 },
  left: { width: 250, flexShrink: 0, padding: "14px", borderRight: "1px solid #0f2540", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" },
  card: { background: "#07111e", borderRadius: 7, padding: "9px 11px", border: "1px solid" },
  lbl: { fontSize: 8, fontWeight: 800, letterSpacing: 2, color: "#1e3a5f", marginBottom: 5, textTransform: "uppercase" },
  cardTxt: { fontSize: 10, color: "#475569", lineHeight: 1.85, margin: 0 },
  listCard: { background: "#07111e", borderRadius: 7, padding: "9px 11px", border: "1px solid #0f2540", display: "flex", flexDirection: "column", gap: 5 },
  listRow: { display: "flex", gap: 5, alignItems: "flex-start" },
  listTxt: { fontSize: 10, color: "#334155", lineHeight: 1.65 },
  center: { flex: 1, padding: "16px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflowY: "auto" },
  svgBox: { width: "100%", maxWidth: 650, background: "#07111e", borderRadius: 10, border: "1px solid #0f2540", aspectRatio: "630/360", overflow: "hidden" },
  runBtn: { padding: "9px 28px", borderRadius: 6, border: "1px solid", fontFamily: "inherit", fontSize: 11, fontWeight: 800, letterSpacing: 1.5, cursor: "pointer", transition: "all 0.2s", textTransform: "uppercase" },
  logWrap: { width: "100%", maxWidth: 650, background: "#07111e", borderRadius: 8, border: "1px solid #0f2540", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3, maxHeight: 180, overflowY: "auto" },
  logEmpty: { fontSize: 9, color: "#1e3a5f", fontStyle: "italic" },
  logRow: { display: "flex", gap: 4, alignItems: "center", padding: "3px 6px", borderLeft: "2px solid", borderRadius: "0 3px 3px 0", transition: "all 0.2s", flexWrap: "wrap" },
  dsGrid: { width: "100%", maxWidth: 650, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  dsCard: { padding: "10px", borderRadius: 7, border: "1px solid", transition: "all 0.2s" },
  colBlock: { padding: "6px 8px", borderRadius: 6, border: "1px solid", minWidth: 60, transition: "all 0.2s", cursor: "default" },
};

export default function InfraSimulator() {
  return (
    <>
      <Nav />
      <div style={{ paddingTop: 48 }}>
        <InfraSimulatorInner />
      </div>
    </>
  )
}
