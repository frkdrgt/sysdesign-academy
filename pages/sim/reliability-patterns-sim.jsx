import { useState, useEffect, useRef, useCallback } from "react";
import Nav from '../../components/Nav'

// ─────────────────────────────────────────────
// PATTERN DEFINITIONS
// ─────────────────────────────────────────────
const PATTERNS = [
  {
    id: "outbox",
    name: "Transactional Outbox",
    category: "MESAJ GÜVENİLİRLİĞİ",
    emoji: "📤",
    accent: "#22d3ee",
    problem: "Servis DB'ye başarıyla yazar, ama mesajı broker'a publish etmeden hemen önce process çökerse ne olur? DB'de kayıt var, kuyrukta yok — veri tutarsızlığı kaçınılmaz.",
    solution: "DB transaction'ı içinde hem iş verisini (orders tablosu) hem de olayı (outbox tablosu) tek atomik işlemde yaz. Ayrı bir Relay process periyodik olarak outbox'taki sent=false kayıtları okuyup broker'a iletir, ardından sent=true yapar. Bu sayede publish işlemi transaction dışına taşınır ve crash-safe hale gelir.",
    whenToUse: [
      "Dual-write sorununu önlemek: DB yaz + broker publish asla aynı anda atomik yapılamaz",
      "At-least-once garantisi yeterli ama mesaj kaybı kabul edilemez olduğunda",
      "Event Sourcing mimarisi olmayan ama domain event güvenilirliği gereken servislerde",
      "Outbox relay yerine CDC (Debezium) kullanarak transaction log'u okuyup Kafka'ya aktarmak daha efektif bir varyant",
    ],
    pitfalls: [
      "Outbox tablosu şişebilir: sent=true kayıtları için TTL + periyodik temizlik job'u zorunlu",
      "Relay process idempotent olmalı: aynı outbox kaydını iki kez işlerse broker'a duplicate gider — consumer'ın da idempotent olması gerekir",
      "Relay'i distributed çalıştırırsan locking mekanizması (advisory lock veya optimistic lock) şart, aksi hâlde aynı mesaj iki relay tarafından gönderilir",
      "CDC (Debezium) alternatifi: WAL'ı okuyup Kafka'ya yazar, uygulama kodu hiç değişmez — ama altyapı kompleksliği artar",
    ],
    stages: [
      {
        id: "happy",
        label: "✓ Normal Akış",
        desc: "DB transaction + outbox yazımı tek atomik işlemde gerçekleşir",
        nodes: [
          { id: "api",    label: "API",          x: 60,  y: 160, color: "#94a3b8" },
          { id: "db",     label: "DB\n(orders)", x: 230, y: 100, color: "#22d3ee" },
          { id: "outbox", label: "DB\n(outbox)", x: 230, y: 220, color: "#22d3ee" },
          { id: "relay",  label: "Relay\nProcess", x: 400, y: 160, color: "#818cf8" },
          { id: "queue",  label: "Message\nQueue", x: 560, y: 160, color: "#f472b6" },
        ],
        steps: [
          { from: "api",    to: "db",     label: "INSERT order",         color: "#22d3ee",  delay: 0 },
          { from: "api",    to: "outbox", label: "INSERT outbox event",  color: "#22d3ee",  delay: 700,  note: "Aynı TX içinde" },
          { from: "relay",  to: "outbox", label: "SELECT unsent",        color: "#818cf8",  delay: 1600 },
          { from: "relay",  to: "queue",  label: "publish(event)",       color: "#f472b6",  delay: 2400 },
          { from: "relay",  to: "outbox", label: "mark sent=true",       color: "#818cf8",  delay: 3200 },
        ],
        annotations: [
          { x: 145, y: 165, text: "BEGIN TX", color: "#22d3ee" },
          { x: 145, y: 240, text: "COMMIT", color: "#22d3ee" },
        ],
      },
      {
        id: "crash",
        label: "💥 Çökme Senaryosu",
        desc: "Servis publish'ten önce çökse bile outbox relay mesajı iletiyor",
        nodes: [
          { id: "api",    label: "API\n(ÇÖKTÜ)",   x: 60,  y: 160, color: "#ef4444" },
          { id: "db",     label: "DB\n(orders)",   x: 230, y: 100, color: "#22d3ee" },
          { id: "outbox", label: "DB\n(outbox)",   x: 230, y: 220, color: "#fbbf24" },
          { id: "relay",  label: "Relay\nProcess", x: 400, y: 160, color: "#818cf8" },
          { id: "queue",  label: "Message\nQueue", x: 560, y: 160, color: "#f472b6" },
        ],
        steps: [
          { from: "api",    to: "db",     label: "INSERT order ✓",       color: "#22d3ee",  delay: 0 },
          { from: "api",    to: "outbox", label: "INSERT outbox ✓",      color: "#fbbf24",  delay: 700 },
          { from: "api",    to: "api",    label: "💥 PROCESS CRASHED",   color: "#ef4444",  delay: 1400, self: true },
          { from: "relay",  to: "outbox", label: "SELECT unsent",        color: "#818cf8",  delay: 2400 },
          { from: "outbox", to: "relay",  label: "sent=false → bulundu", color: "#fbbf24",  delay: 3200 },
          { from: "relay",  to: "queue",  label: "publish(event) ✓",     color: "#f472b6",  delay: 4000, note: "Mesaj kaybolmadı!" },
        ],
      },
    ],
  },

  {
    id: "idempotency",
    name: "Idempotency",
    category: "DUPLICATE KORUMA",
    emoji: "🔑",
    accent: "#a78bfa",
    problem: "Ağ hatası veya timeout sonrası client aynı isteği tekrar gönderir. 'POST /order' iki kez ulaşırsa sipariş iki kez oluşabilir mi? Ödeme servisi iki kez para çekebilir mi?",
    solution: "Her istek header'ında bir `Idempotency-Key` (UUID) taşır. Server bu key'i Redis gibi hızlı bir store'da arar: daha önce işlenmişse sakladığı yanıtı direkt döner, DB'ye hiç dokunmaz. İlk kez geliyorsa işlemi yapar, sonucu key ile birlikte TTL'li olarak saklar.",
    whenToUse: [
      "Ödeme ve para transferi: aynı işlemin iki kez çalışması doğrudan maddi zarar yaratır",
      "Sipariş oluşturma: müşteri 'Sipariş Ver' butonuna iki kez tıklarsa tek sipariş oluşmalı",
      "E-posta / SMS gönderimi: kullanıcıya aynı bildirim iki kez gitmemeli",
      "Stripe, Braintree gibi ödeme gateway'leri bu pattern'i standart olarak zorunlu tutar",
    ],
    pitfalls: [
      "TTL seçimi kritik: çok kısa → meşru retry duplicate sayılır; çok uzun → key store gereksiz şişer. Genelde 24 saat iyi bir başlangıç",
      "Key olarak client'ın kendi ürettiği değeri kullan (UUID v4); server-side generate edersen client retry'da aynı key'i bilemez",
      "Distributed key store'da race condition: iki istek aynı anda gelip ikisi de 'null' görürse duplicate işlem yapılır — SET NX (Redis) veya DB unique constraint ile çöz",
      "Idempotency-Key başka bir kullanıcının key'i ile çakışabilir — key'e userId prefix ekle: '{userId}:{uuid}'",
    ],
    stages: [
      {
        id: "first",
        label: "① İlk İstek",
        desc: "Yeni idempotency-key → işlem yapılır, sonuç key ile birlikte saklanır",
        nodes: [
          { id: "client",  label: "Client",          x: 60,  y: 160, color: "#94a3b8" },
          { id: "api",     label: "Order API",       x: 240, y: 160, color: "#a78bfa" },
          { id: "keystore",label: "Key Store\n(Redis)", x: 430, y: 90,  color: "#fbbf24" },
          { id: "db",      label: "Orders DB",       x: 430, y: 230, color: "#22d3ee" },
        ],
        steps: [
          { from: "client",   to: "api",      label: "POST /order\nKey: abc-123",   color: "#a78bfa", delay: 0 },
          { from: "api",      to: "keystore", label: "GET abc-123",                 color: "#fbbf24", delay: 800 },
          { from: "keystore", to: "api",      label: "null (yeni key)",             color: "#94a3b8", delay: 1500 },
          { from: "api",      to: "db",       label: "INSERT order",                color: "#22d3ee", delay: 2200 },
          { from: "api",      to: "keystore", label: "SET abc-123 → {orderId:42}",  color: "#fbbf24", delay: 3000 },
          { from: "api",      to: "client",   label: "201 Created {id:42}",         color: "#a78bfa", delay: 3800, note: "İşlem tamamlandı" },
        ],
      },
      {
        id: "duplicate",
        label: "② Duplicate İstek",
        desc: "Aynı key tekrar gelir → DB'ye dokunulmaz, önceki cevap döner",
        nodes: [
          { id: "client",   label: "Client\n(retry)", x: 60,  y: 160, color: "#f97316" },
          { id: "api",      label: "Order API",       x: 240, y: 160, color: "#a78bfa" },
          { id: "keystore", label: "Key Store\n(Redis)", x: 430, y: 90, color: "#fbbf24" },
          { id: "db",       label: "Orders DB",       x: 430, y: 230, color: "#22d3ee" },
        ],
        steps: [
          { from: "client",   to: "api",      label: "POST /order\nKey: abc-123 (retry)", color: "#f97316", delay: 0 },
          { from: "api",      to: "keystore", label: "GET abc-123",                       color: "#fbbf24", delay: 800 },
          { from: "keystore", to: "api",      label: "HIT → {orderId:42}",                color: "#fbbf24", delay: 1500, note: "Zaten var!" },
          { from: "api",      to: "client",   label: "200 OK {id:42}  ← CACHED",         color: "#a78bfa", delay: 2300, note: "DB'ye yazılmadı" },
        ],
        crossedLines: [
          { from: "api", to: "db", label: "DB yazımı engellendi" }
        ],
      },
    ],
  },

  {
    id: "delivery",
    name: "Delivery Guarantees",
    category: "MESAJ TESLİMATI",
    emoji: "📦",
    accent: "#34d399",
    problem: "Broker veya network geçici olarak düşerse mesaj kaybolabilir mi? Tekrar gönderilirse consumer aynı mesajı iki kez işler mi? Bu üç soru cevabı birbirini dışlayan üç farklı garanti seviyesi tanımlar.",
    solution: "At-most-once: ACK beklenmez, fire-and-forget — hızlı ama kayıp olabilir. At-least-once: ACK gelmezse retry yapılır — kayıp olmaz ama consumer idempotent olmazsa duplicate işleme riski var. Exactly-once: Kafka'nın idempotent producer + transactional API'si ile sağlanır — en güvenli ama en pahalı, throughput düşer.",
    whenToUse: [
      "At-most-once: click tracking, IoT sensör verisi, metrics — birkaç kayıp tolere edilebilir ve hız kritik",
      "At-least-once: e-posta bildirimi, order event'leri — kayıp kabul edilemez, consumer tarafında duplicate kontrolü yapılabilir",
      "Exactly-once: finansal işlemler, stok güncelleme, para transferi — hem kayıp hem duplicate kabul edilemez",
      "RabbitMQ varsayılan olarak at-least-once; Kafka'da exactly-once için enable.idempotence=true + transactional.id zorunlu",
    ],
    pitfalls: [
      "Exactly-once 'end-to-end' değil: Kafka sağlasa da consumer kendi DB'sine yazarken crash ederse duplicate oluşur — consumer'ı da transactional yapmak gerekir",
      "At-least-once alan her consumer idempotent OLMAK ZORUNDA: aksi hâlde retry = bug",
      "ACK stratejisi önemli: consumer mesajı alır almaz ACK ederse (auto-commit) ama işleme sırasında çökerse mesaj kaybolur → işlem bittikten sonra ACK et",
      "Kafka partition sayısı exactly-once throughput'unu doğrudan etkiler: partition = paralelizm birimi, ama transaction overhead artar",
    ],
    stages: [
      {
        id: "atmost",
        label: "At-Most-Once",
        desc: "Mesaj gönderilir, ACK beklenmez. Hızlıdır ama kayıp olabilir",
        nodes: [
          { id: "producer", label: "Producer",  x: 80,  y: 160, color: "#94a3b8" },
          { id: "broker",   label: "Broker",    x: 300, y: 160, color: "#34d399" },
          { id: "consumer", label: "Consumer",  x: 520, y: 160, color: "#94a3b8" },
        ],
        steps: [
          { from: "producer", to: "broker",   label: "send(msg) fire-and-forget", color: "#34d399", delay: 0 },
          { from: "broker",   to: "consumer", label: "deliver(msg)",              color: "#34d399", delay: 900 },
          { from: "broker",   to: "producer", label: "💥 ACK gelmedi — kayıp",   color: "#ef4444", delay: 1800, note: "Mesaj kaybolabilir" },
        ],
      },
      {
        id: "atleast",
        label: "At-Least-Once",
        desc: "ACK gelmezse tekrar gönderilir. Duplicate olabilir, consumer idempotent olmalı",
        nodes: [
          { id: "producer", label: "Producer",  x: 80,  y: 160, color: "#fbbf24" },
          { id: "broker",   label: "Broker",    x: 300, y: 160, color: "#34d399" },
          { id: "consumer", label: "Consumer",  x: 520, y: 160, color: "#fbbf24" },
        ],
        steps: [
          { from: "producer", to: "broker",   label: "send(msg #1)",             color: "#34d399", delay: 0 },
          { from: "broker",   to: "consumer", label: "deliver(msg #1)",          color: "#34d399", delay: 700 },
          { from: "broker",   to: "producer", label: "❌ ACK timeout",            color: "#ef4444", delay: 1400 },
          { from: "producer", to: "broker",   label: "retry: send(msg #1) again",color: "#fbbf24", delay: 2200 },
          { from: "broker",   to: "consumer", label: "deliver(msg #1) AGAIN",   color: "#f97316", delay: 3000, note: "Duplicate!" },
          { from: "consumer", to: "broker",   label: "ACK ✓ (idempotent işlendi)", color: "#34d399", delay: 3800 },
        ],
      },
      {
        id: "exactlyonce",
        label: "Exactly-Once",
        desc: "Kafka idempotent producer + transactional consumer. En güvenli, en pahalı.",
        nodes: [
          { id: "producer", label: "Producer\n(idempotent)", x: 70,  y: 160, color: "#818cf8" },
          { id: "broker",   label: "Broker\n(Kafka)",        x: 300, y: 160, color: "#34d399" },
          { id: "consumer", label: "Consumer\n(tx-aware)",   x: 530, y: 160, color: "#818cf8" },
        ],
        steps: [
          { from: "producer", to: "broker",   label: "beginTransaction()",          color: "#818cf8", delay: 0 },
          { from: "producer", to: "broker",   label: "send(msg, seq=1)",            color: "#818cf8", delay: 700 },
          { from: "broker",   to: "producer", label: "ACK(seq=1)",                  color: "#34d399", delay: 1400 },
          { from: "producer", to: "broker",   label: "commitTransaction()",         color: "#818cf8", delay: 2100 },
          { from: "broker",   to: "consumer", label: "deliver(msg) — exactly once", color: "#34d399", delay: 2900, note: "Tek teslimat garantisi" },
          { from: "consumer", to: "broker",   label: "commitOffset()",              color: "#818cf8", delay: 3700 },
        ],
      },
    ],
  },

  {
    id: "retry",
    name: "Retry & Dead Letter Queue",
    category: "HATA YÖNETİMİ",
    emoji: "♻️",
    accent: "#f97316",
    problem: "Downstream servis geçici olarak 503 dönüyor. Hemen tekrar denersek daha da boğarız. Sonsuz retry yaparsa kuyruk tıkanır. Bazı mesajlar hiçbir zaman işlenemez (poison pill). Bunların hepsi farklı sorun.",
    solution: "Exponential backoff: her denemede bekleme süresi katlanır (1s→2s→4s→8s), downstream'e soluk aldırır. Max retry sayısına ulaşan mesaj Dead Letter Queue'ya (DLQ) taşınır. DLQ izlenir, alarm verilir; sorun düzeldikten sonra mesajlar requeue edilir ya da manuel incelenir.",
    whenToUse: [
      "Network geçici hatalar (TCP timeout, DNS flap): birkaç saniye bekleyince genelde çözülür, backoff idealdir",
      "Downstream servis yeniden başlıyor (rolling deploy): kısa backoff + jitter ile thundering herd önlenir",
      "Rate limit aşımı (HTTP 429): Retry-After header'ına göre bekleme süresi ayarlanmalı",
      "Poison pill tespiti: belirli bir mesaj her zaman failse (bozuk format, validation hatası) sonsuz retry yapılmamalı → DLQ'ya al",
    ],
    pitfalls: [
      "Jitter eklemeden backoff kullanma: tüm consumer'lar aynı anda retry yaparsa thundering herd oluşur — full jitter (random(0, 2^attempt * base)) ekle",
      "DLQ'yu alarm'sız bırakma: mesaj oraya düştü ama kimse bakmadı = sessiz veri kaybı. Mutlaka CloudWatch/Datadog alarmı kur",
      "Retry politikasını mesaj tipine göre ayarla: validation hatası (400) retry edilmemeli çünkü hiçbir zaman başarılı olmaz",
      "DLQ'dan requeue etmeden önce downstream'i düzelt, aksi hâlde mesajlar DLQ'ya geri döner ve döngüye girersin",
    ],
    stages: [
      {
        id: "exponential",
        label: "Exponential Backoff",
        desc: "Her başarısız denemede bekleme süresi katlanır: 1s → 2s → 4s → 8s",
        nodes: [
          { id: "consumer",  label: "Consumer",   x: 80,  y: 160, color: "#f97316" },
          { id: "service",   label: "Downstream\nService", x: 320, y: 160, color: "#ef4444" },
          { id: "scheduler", label: "Retry\nScheduler", x: 320, y: 280, color: "#818cf8" },
        ],
        steps: [
          { from: "consumer",  to: "service",   label: "attempt #1",          color: "#f97316", delay: 0 },
          { from: "service",   to: "consumer",  label: "❌ 503 Error",         color: "#ef4444", delay: 700 },
          { from: "consumer",  to: "scheduler", label: "schedule retry in 1s", color: "#818cf8", delay: 1400 },
          { from: "scheduler", to: "consumer",  label: "attempt #2 (after 1s)", color: "#f97316", delay: 2200 },
          { from: "consumer",  to: "service",   label: "attempt #2",           color: "#f97316", delay: 2800 },
          { from: "service",   to: "consumer",  label: "❌ 503 Error",          color: "#ef4444", delay: 3500 },
          { from: "consumer",  to: "scheduler", label: "schedule retry in 2s", color: "#818cf8", delay: 4200 },
          { from: "scheduler", to: "consumer",  label: "attempt #3 (after 2s)", color: "#f97316", delay: 5000 },
          { from: "consumer",  to: "service",   label: "attempt #3",            color: "#f97316", delay: 5600 },
          { from: "service",   to: "consumer",  label: "✓ 200 OK",             color: "#34d399", delay: 6300, note: "Başarılı!" },
        ],
      },
      {
        id: "dlq",
        label: "Dead Letter Queue",
        desc: "Max retry aşıldı → mesaj DLQ'ya taşınır, sistem akışı bloke olmaz",
        nodes: [
          { id: "consumer", label: "Consumer",    x: 80,  y: 140, color: "#f97316" },
          { id: "service",  label: "Downstream",  x: 300, y: 140, color: "#ef4444" },
          { id: "mainq",    label: "Main Queue",  x: 80,  y: 260, color: "#f97316" },
          { id: "dlq",      label: "Dead Letter\nQueue", x: 480, y: 200, color: "#dc2626" },
          { id: "ops",      label: "Ops / Alert", x: 480, y: 310, color: "#fbbf24" },
        ],
        steps: [
          { from: "mainq",   to: "consumer", label: "dequeue(msg)",            color: "#f97316", delay: 0 },
          { from: "consumer",to: "service",  label: "attempt #1",              color: "#f97316", delay: 700 },
          { from: "service", to: "consumer", label: "❌ FAIL",                  color: "#ef4444", delay: 1400 },
          { from: "consumer",to: "service",  label: "attempt #2",              color: "#f97316", delay: 2200 },
          { from: "service", to: "consumer", label: "❌ FAIL",                  color: "#ef4444", delay: 2900 },
          { from: "consumer",to: "service",  label: "attempt #3 (max)",        color: "#f97316", delay: 3700 },
          { from: "service", to: "consumer", label: "❌ FAIL — max retries!",   color: "#ef4444", delay: 4400 },
          { from: "consumer",to: "dlq",      label: "→ DLQ (poison pill)",     color: "#dc2626", delay: 5200, note: "Ana akış devam eder" },
          { from: "dlq",     to: "ops",      label: "🔔 Alert: DLQ mesajı var", color: "#fbbf24", delay: 6000 },
        ],
      },
    ],
  },

  {
    id: "twopc",
    name: "Two-Phase Commit vs Eventual",
    category: "KONSİSTENSİ",
    emoji: "⚖️",
    accent: "#fb923c",
    problem: "Order Service ve Stock Service farklı DB'lerde. Sipariş kaydı oluştu ama stok düşürme başarısız olursa? Ya da stok düştü ama sipariş kaydı oluşmadıysa? İki DB'yi aynı anda atomik güncellemek mümkün mü?",
    solution: "2PC: Coordinator tüm katılımcılara önce PREPARE sorar, hepsi READY derse COMMIT gönderir — atomik ama yavaş, lock tutar, koordinatör SPOF'tur. Eventual Consistency (BASE): her servis kendi DB'sine yazar, sonra event yayar; diğer servis gecikmeli ama eninde sonunda tutarlı hale gelir — hızlı, yüksek availability, stale read riski var.",
    whenToUse: [
      "2PC: banka muhasebe kayıtları, çift taraflı defter (T hesabı) — hem kaynak hem hedef hesabın atomik güncellenmesi şart",
      "Eventual: e-ticaret sipariş + stok — birkaç saniyelik tutarsızlık tolere edilebilir, availability daha önemli",
      "Eventual: sosyal medya beğeni sayacı, profil görüntülenme — gecikmeli tutarlılık kullanıcı deneyimini bozmaz",
      "Kural: CAP teoremi gereği partition tolerance varsa ya C (2PC) ya A (eventual) seçilir, ikisi birden olmaz",
    ],
    pitfalls: [
      "2PC koordinatör SPOF: koordinatör çökerse tüm katılımcılar lock'lu kalır, sistem durur — high-availability coordinator şart",
      "2PC lock süreleri: PREPARE ile COMMIT arasında tüm satırlar kilitli kalır, cascading timeout zincirine yol açabilir",
      "Eventual consistency + okuma: kullanıcı stok güncellenmeden önce ürünü görürse 'hâlâ stokta var' yazabilir — overselling riski, soft reservation ile çözülür",
      "Microservice ortamında 2PC pratikte neredeyse hiç kullanılmaz: Saga + compensating transaction tercih edilir çünkü her servis kendi DB'sini kontrol eder",
    ],
    stages: [
      {
        id: "twopc_flow",
        label: "2-Phase Commit",
        desc: "Coordinator önce PREPARE sorar, tümü hazır ise COMMIT gönderir",
        nodes: [
          { id: "coord", label: "Coordinator",  x: 300, y: 60,  color: "#fb923c" },
          { id: "db1",   label: "DB-1\n(Orders)", x: 120, y: 240, color: "#22d3ee" },
          { id: "db2",   label: "DB-2\n(Stock)",  x: 480, y: 240, color: "#22d3ee" },
        ],
        steps: [
          { from: "coord", to: "db1",   label: "PREPARE?",          color: "#fb923c", delay: 0 },
          { from: "coord", to: "db2",   label: "PREPARE?",          color: "#fb923c", delay: 400 },
          { from: "db1",   to: "coord", label: "READY ✓",           color: "#22d3ee", delay: 1200 },
          { from: "db2",   to: "coord", label: "READY ✓",           color: "#22d3ee", delay: 1600 },
          { from: "coord", to: "db1",   label: "COMMIT",            color: "#34d399", delay: 2400 },
          { from: "coord", to: "db2",   label: "COMMIT",            color: "#34d399", delay: 2800 },
          { from: "db1",   to: "coord", label: "ACK",               color: "#22d3ee", delay: 3600 },
          { from: "db2",   to: "coord", label: "ACK",               color: "#22d3ee", delay: 4000, note: "Atomik ✓ ama yavaş" },
        ],
      },
      {
        id: "eventual_flow",
        label: "Eventual Consistency",
        desc: "Her servis kendi DB'sine hemen yazar, event ile diğerini günceller",
        nodes: [
          { id: "svc1",    label: "Order\nService",   x: 80,  y: 160, color: "#a78bfa" },
          { id: "db1",     label: "Orders DB",        x: 80,  y: 300, color: "#22d3ee" },
          { id: "bus",     label: "Event Bus",        x: 300, y: 160, color: "#f472b6" },
          { id: "svc2",    label: "Stock\nService",   x: 520, y: 160, color: "#a78bfa" },
          { id: "db2",     label: "Stock DB",         x: 520, y: 300, color: "#22d3ee" },
        ],
        steps: [
          { from: "svc1",  to: "db1",   label: "INSERT order NOW",    color: "#22d3ee", delay: 0 },
          { from: "svc1",  to: "bus",   label: "emit OrderCreated",   color: "#f472b6", delay: 700 },
          { from: "bus",   to: "svc2",  label: "consume event",       color: "#f472b6", delay: 1500 },
          { from: "svc2",  to: "db2",   label: "UPDATE stock LATER",  color: "#22d3ee", delay: 2200, note: "Eventual ✓ hızlı" },
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
function ReliabilitySimInner() {
  const [patternIdx, setPatternIdx] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [animStep, setAnimStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef([]);

  const pattern = PATTERNS[patternIdx];
  const stage = pattern.stages[stageIdx];

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const selectPattern = (pi) => {
    clearTimers(); setPatternIdx(pi); setStageIdx(0);
    setAnimStep(-1); setRunning(false); setDone(false);
  };
  const selectStage = (si) => {
    clearTimers(); setStageIdx(si);
    setAnimStep(-1); setRunning(false); setDone(false);
  };

  const run = useCallback(() => {
    const steps = PATTERNS[patternIdx].stages[stageIdx].steps;
    clearTimers(); setAnimStep(-1); setRunning(true); setDone(false);
    steps.forEach((s, i) => {
      const t = setTimeout(() => {
        setAnimStep(i);
        if (i === steps.length - 1) {
          setTimeout(() => { setRunning(false); setDone(true); }, 700);
        }
      }, s.delay);
      timers.current.push(t);
    });
  }, [patternIdx, stageIdx]);

  useEffect(() => () => clearTimers(), []);

  const activeSteps = animStep >= 0 ? stage.steps.slice(0, animStep + 1) : [];

  return (
    <div style={S.root}>
      <div style={S.scanlines} />

      {/* ── HEADER ── */}
      <header style={S.header}>
        <div style={S.headerBrand}>
          <span style={{ ...S.brandDot, background: pattern.accent }} />
          <span style={S.brandText}>Reliability Patterns</span>
          <span style={S.brandSub}>Dağıtık Sistemler</span>
        </div>
        <div style={S.headerMeta}>
          <span style={{ ...S.pill, borderColor: pattern.accent + "66", color: pattern.accent }}>
            {pattern.category}
          </span>
        </div>
      </header>

      {/* ── PATTERN NAV ── */}
      <nav style={S.patternNav}>
        {PATTERNS.map((p, i) => (
          <button key={p.id} onClick={() => selectPattern(i)}
            style={{
              ...S.pBtn,
              ...(i === patternIdx ? {
                background: p.accent + "18",
                borderColor: p.accent,
                color: p.accent,
                boxShadow: `0 0 20px ${p.accent}33`,
              } : {}),
            }}>
            <span style={S.pEmoji}>{p.emoji}</span>
            <span style={S.pName}>{p.name}</span>
          </button>
        ))}
      </nav>

      {/* ── BODY ── */}
      <div style={S.body}>

        {/* LEFT PANEL */}
        <aside style={S.left}>
          {/* Problem/Solution */}
          <div style={{ ...S.card, borderColor: pattern.accent + "33" }}>
            <div style={{ ...S.cardLabel, color: pattern.accent }}>⚠ Problem</div>
            <p style={S.cardText}>{pattern.problem}</p>
          </div>
          <div style={{ ...S.card, borderColor: "#334155" }}>
            <div style={S.cardLabel}>✦ Çözüm</div>
            <p style={S.cardText}>{pattern.solution}</p>
          </div>

          {/* When to use */}
          <div style={S.listCard}>
            <div style={S.cardLabel}>✓ Ne Zaman</div>
            {pattern.whenToUse.map((w, i) => (
              <div key={i} style={S.listRow}>
                <span style={{ color: "#34d399" }}>›</span>
                <span style={S.listText}>{w}</span>
              </div>
            ))}
          </div>

          {/* Pitfalls */}
          <div style={S.listCard}>
            <div style={S.cardLabel}>⚡ Dikkat Et</div>
            {pattern.pitfalls.map((p, i) => (
              <div key={i} style={S.listRow}>
                <span style={{ color: "#f97316" }}>›</span>
                <span style={S.listText}>{p}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* CENTER: DIAGRAM */}
        <main style={S.center}>
          {/* Stage tabs */}
          <div style={S.stageTabs}>
            {pattern.stages.map((st, i) => (
              <button key={st.id} onClick={() => selectStage(i)}
                style={{
                  ...S.stageBtn,
                  ...(i === stageIdx ? {
                    background: pattern.accent + "22",
                    borderColor: pattern.accent,
                    color: "#f1f5f9",
                  } : {}),
                }}>
                {st.label}
              </button>
            ))}
          </div>

          <p style={S.stageDesc}>{stage.desc}</p>

          {/* SVG Diagram */}
          <div style={S.svgBox}>
            <DiagramSVG
              nodes={stage.nodes}
              steps={stage.steps}
              activeStep={animStep}
              activeColor={pattern.accent}
              crossedLines={stage.crossedLines}
            />
          </div>

          {/* Run button */}
          <button onClick={run} disabled={running}
            style={{
              ...S.runBtn,
              background: running ? "transparent" : pattern.accent,
              color: running ? pattern.accent : "#080e1c",
              borderColor: pattern.accent,
              boxShadow: running ? "none" : `0 0 24px ${pattern.accent}77`,
            }}>
            {running ? "⟳ Çalışıyor..." : done ? "↺ Tekrar" : "▶ Simüle Et"}
          </button>
        </main>

        {/* RIGHT: LOG */}
        <aside style={S.right}>
          <div style={S.logHeader}>
            <span style={S.cardLabel}>📡 Adım Akışı</span>
            {done && <span style={{ ...S.doneBadge, color: pattern.accent, borderColor: pattern.accent + "55" }}>✓ Tamam</span>}
          </div>
          <div style={S.log}>
            {activeSteps.length === 0 && (
              <div style={S.logEmpty}>▶ başlatmayı bekliyor</div>
            )}
            {activeSteps.map((s, i) => {
              const isLatest = i === animStep;
              const errColor = s.color === "#ef4444" || s.color === "#dc2626";
              return (
                <div key={i} style={{
                  ...S.logRow,
                  borderLeftColor: s.color,
                  background: isLatest ? s.color + "0d" : "transparent",
                  opacity: isLatest ? 1 : 0.65,
                }}>
                  <div style={S.logLine}>
                    <span style={{ color: s.color, fontWeight: 700, fontSize: 10 }}>
                      {s.from?.toUpperCase()}
                    </span>
                    <span style={{ color: "#334155", fontSize: 9 }}>──▶</span>
                    <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: 10 }}>
                      {s.to?.toUpperCase()}
                    </span>
                  </div>
                  <div style={S.logMsg}>{s.label}</div>
                  {s.note && <div style={{ ...S.logNote, color: s.color }}>{s.note}</div>}
                </div>
              );
            })}
          </div>

          {/* Step counter */}
          <div style={S.stepCounter}>
            <span style={{ color: "#334155" }}>Adım</span>
            <span style={{ color: pattern.accent, fontWeight: 800 }}>{animStep + 1}</span>
            <span style={{ color: "#334155" }}>/</span>
            <span style={{ color: "#64748b" }}>{stage.steps.length}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SVG DIAGRAM
// ─────────────────────────────────────────────
function DiagramSVG({ nodes, steps, activeStep, activeColor, crossedLines = [] }) {
  const W = 620, H = 360;
  const posMap = Object.fromEntries(nodes.map(n => [n.id, { x: n.x, y: n.y }]));

  const activeSteps = activeStep >= 0 ? steps.slice(0, activeStep + 1) : [];
  const currentStep = activeStep >= 0 ? steps[activeStep] : null;

  function arrow(x1, y1, x2, y2, color, id) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const nx = dx/len, ny = dy/len;
    const pad = 32;
    return { x1: x1 + nx*pad, y1: y1 + ny*pad, x2: x2 - nx*pad, y2: y2 - ny*pad };
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }}>
      <defs>
        {["active", "dim", "error", "warn", "ok", "crossed"].map(t => {
          const c = t === "active" ? activeColor : t === "error" ? "#ef4444" : t === "warn" ? "#f97316" : t === "ok" ? "#34d399" : t === "crossed" ? "#ef444455" : "#334155";
          return (
            <marker key={t} id={`arr-${t}`} markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
              <polygon points="0 0, 7 2.5, 0 5" fill={c} />
            </marker>
          );
        })}
        <filter id="halo">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* background lines */}
      {steps.filter(s => s.from !== s.to && !s.self).map((s, i) => {
        const a = posMap[s.from], b = posMap[s.to];
        if (!a || !b) return null;
        const ar = arrow(a.x, a.y, b.x, b.y);
        return <line key={i} x1={ar.x1} y1={ar.y1} x2={ar.x2} y2={ar.y2} stroke="#0f2342" strokeWidth="1" strokeDasharray="3 5" />;
      })}

      {/* crossed lines */}
      {crossedLines.map((cl, i) => {
        const a = posMap[cl.from], b = posMap[cl.to];
        if (!a || !b) return null;
        const ar = arrow(a.x, a.y, b.x, b.y);
        const mx = (ar.x1+ar.x2)/2, my = (ar.y1+ar.y2)/2;
        return (
          <g key={`crossed-${i}`}>
            <line x1={ar.x1} y1={ar.y1} x2={ar.x2} y2={ar.y2} stroke="#ef444444" strokeWidth="2" strokeDasharray="4 4" />
            <line x1={mx-12} y1={my-12} x2={mx+12} y2={my+12} stroke="#ef4444" strokeWidth="2.5" />
            <line x1={mx+12} y1={my-12} x2={mx-12} y2={my+12} stroke="#ef4444" strokeWidth="2.5" />
          </g>
        );
      })}

      {/* active message lines */}
      {activeSteps.map((s, i) => {
        if (s.self) return null;
        const a = posMap[s.from], b = posMap[s.to];
        if (!a || !b) return null;
        const ar = arrow(a.x, a.y, b.x, b.y);
        const isLatest = i === activeStep;
        const mx = (ar.x1+ar.x2)/2, my = (ar.y1+ar.y2)/2;
        const c = s.color || activeColor;
        return (
          <g key={`msg-${i}`}>
            <line
              x1={ar.x1} y1={ar.y1} x2={ar.x2} y2={ar.y2}
              stroke={c} strokeWidth={isLatest ? 2.5 : 1.2}
              markerEnd={`url(#arr-${isLatest ? "active" : "dim"})`}
              opacity={isLatest ? 1 : 0.4}
              filter={isLatest ? "url(#halo)" : undefined}
            />
            {isLatest && (
              <>
                <rect x={mx - 60} y={my - 20} width={120} height={16} rx={3} fill="#080e1c" opacity="0.85" />
                <text x={mx} y={my - 8} textAnchor="middle" fill={c} fontSize="9" fontWeight="700"
                  fontFamily="'JetBrains Mono', monospace">{s.label.split("\n")[0]}</text>
                {s.label.includes("\n") && (
                  <text x={mx} y={my + 4} textAnchor="middle" fill={c + "bb"} fontSize="8"
                    fontFamily="'JetBrains Mono', monospace">{s.label.split("\n")[1]}</text>
                )}
              </>
            )}
          </g>
        );
      })}

      {/* self-referential steps */}
      {activeSteps.filter(s => s.self).map((s, i) => {
        const n = posMap[s.from];
        if (!n) return null;
        const isLatest = steps.indexOf(s) === activeStep;
        return (
          <g key={`self-${i}`}>
            <text x={n.x} y={n.y - 44} textAnchor="middle" fill={s.color} fontSize="10" fontWeight="800"
              fontFamily="'JetBrains Mono', monospace" filter={isLatest ? "url(#halo)" : undefined}>
              {s.label}
            </text>
          </g>
        );
      })}

      {/* nodes */}
      {nodes.map(n => {
        const isActive = currentStep && (currentStep.from === n.id || currentStep.to === n.id);
        const lines = n.label.split("\n");
        return (
          <g key={n.id}>
            {isActive && <circle cx={n.x} cy={n.y} r={38} fill={n.color + "15"} />}
            <circle cx={n.x} cy={n.y} r={28} fill="#080e1c"
              stroke={isActive ? n.color : n.color + "44"}
              strokeWidth={isActive ? 2.5 : 1.5}
              filter={isActive ? "url(#halo)" : undefined}
            />
            {lines.map((ln, li) => (
              <text key={li} x={n.x} y={n.y + (lines.length === 1 ? 4 : li * 11 - 3)} textAnchor="middle"
                fill={isActive ? n.color : n.color + "88"} fontSize="9" fontWeight="700"
                fontFamily="'JetBrains Mono', monospace">
                {ln}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const S = {
  root: {
    minHeight: "100vh",
    background: "#080e1c",
    color: "#e2e8f0",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    position: "relative",
    display: "flex",
    flexDirection: "column",
  },
  scanlines: {
    position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
    backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px)",
  },
  header: {
    position: "relative", zIndex: 1,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 28px 12px",
    borderBottom: "1px solid #0d1e35",
    background: "linear-gradient(to bottom, #0a1225, #080e1c)",
  },
  headerBrand: { display: "flex", alignItems: "center", gap: 10 },
  brandDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  brandText: { fontSize: 18, fontWeight: 800, letterSpacing: -0.5, color: "#f1f5f9" },
  brandSub: { fontSize: 9, color: "#334155", letterSpacing: 3, textTransform: "uppercase", marginTop: 2 },
  headerMeta: { display: "flex", gap: 8 },
  pill: {
    fontSize: 9, padding: "3px 10px", borderRadius: 20, border: "1px solid",
    fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
  },
  patternNav: {
    position: "relative", zIndex: 1,
    display: "flex", gap: 4, padding: "10px 28px",
    borderBottom: "1px solid #0d1e35", overflowX: "auto",
    background: "#080e1c",
  },
  pBtn: {
    display: "flex", alignItems: "center", gap: 6,
    padding: "7px 14px", borderRadius: 6, border: "1px solid #1a2a3f",
    background: "transparent", cursor: "pointer", color: "#475569",
    transition: "all 0.2s", flexShrink: 0,
  },
  pEmoji: { fontSize: 15 },
  pName: { fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" },
  body: {
    position: "relative", zIndex: 1,
    display: "flex", flex: 1, minHeight: 0,
  },
  left: {
    width: 230, flexShrink: 0, padding: "16px 14px",
    borderRight: "1px solid #0d1e35", display: "flex", flexDirection: "column", gap: 10,
    overflowY: "auto",
  },
  card: {
    background: "#0a1220", borderRadius: 8, padding: "10px 12px",
    border: "1px solid",
  },
  cardLabel: { fontSize: 9, fontWeight: 800, letterSpacing: 2, color: "#475569", marginBottom: 6, textTransform: "uppercase" },
  cardText: { fontSize: 10, color: "#94a3b8", lineHeight: 1.8, margin: 0 },
  listCard: {
    background: "#0a1220", borderRadius: 8, padding: "10px 12px",
    border: "1px solid #0d1e35", display: "flex", flexDirection: "column", gap: 4,
  },
  listRow: { display: "flex", gap: 6, alignItems: "flex-start" },
  listText: { fontSize: 10, color: "#64748b", lineHeight: 1.6 },
  center: {
    flex: 1, padding: "16px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
  },
  stageTabs: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" },
  stageBtn: {
    padding: "6px 14px", borderRadius: 5, border: "1px solid #1a2a3f",
    background: "transparent", cursor: "pointer", color: "#475569",
    fontSize: 10, fontWeight: 700, transition: "all 0.2s",
    fontFamily: "inherit",
  },
  stageDesc: { fontSize: 10, color: "#64748b", margin: 0, textAlign: "center", maxWidth: 500 },
  svgBox: {
    width: "100%", maxWidth: 640,
    background: "#060c18", borderRadius: 10,
    border: "1px solid #0d1e35",
    aspectRatio: "620/360", overflow: "hidden",
  },
  runBtn: {
    padding: "10px 28px", borderRadius: 6, border: "1px solid",
    fontFamily: "inherit", fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
    cursor: "pointer", transition: "all 0.2s", textTransform: "uppercase",
  },
  right: {
    width: 220, flexShrink: 0, padding: "16px 12px",
    borderLeft: "1px solid #0d1e35", display: "flex", flexDirection: "column", gap: 8,
  },
  logHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  doneBadge: { fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 10, border: "1px solid" },
  log: {
    flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4,
    maxHeight: 420,
  },
  logEmpty: { fontSize: 9, color: "#1e293b", fontStyle: "italic" },
  logRow: {
    padding: "6px 8px 6px 8px",
    borderLeft: "2px solid",
    borderRadius: "0 4px 4px 0",
    transition: "all 0.25s",
  },
  logLine: { display: "flex", gap: 4, alignItems: "center", marginBottom: 2 },
  logMsg: { fontSize: 9, color: "#64748b", lineHeight: 1.5, wordBreak: "break-word" },
  logNote: { fontSize: 9, fontWeight: 700, marginTop: 3, letterSpacing: 0.5 },
  stepCounter: {
    display: "flex", gap: 4, alignItems: "center", justifyContent: "center",
    fontSize: 10, padding: "6px", borderTop: "1px solid #0d1e35", marginTop: "auto",
  },
};

export default function ReliabilitySim() {
  return (
    <>
      <Nav />
      <div style={{ paddingTop: 48 }}>
        <ReliabilitySimInner />
      </div>
    </>
  )
}
