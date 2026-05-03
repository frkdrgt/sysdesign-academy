import { useState, useEffect, useRef, useCallback } from "react";
import Nav from '../../components/Nav'

// ══════════════════════════════════════════════════════════════════
// SYSTEM DEFINITIONS
// ══════════════════════════════════════════════════════════════════

const SYSTEMS = {
  url_shortener: {
    label: "URL Shortener",
    emoji: "🔗",
    accent: "#38bdf8",
    tagline: "bit.ly / tinyurl tipi servis",
    scales: "100M URL/gün · 10:1 okuma/yazma · P99 < 10ms redirect",
    subsections: [
      {
        id: "write_flow",
        name: "URL Yazma Akışı",
        problem: "Uzun URL'yi kısaltırken iki temel sorunla karşılaşırsın. Birincisi hash collision: farklı iki uzun URL aynı kısa koda düşebilir. İkincisi idempotency: aynı uzun URL farklı kullanıcılar tarafından iki kez kısaltılınca farklı kod mu üretelim yoksa aynı kodu mı döndürelim? Bunlara ek olarak distributed ortamda iki API sunucusu aynı anda aynı kodu üretirse race condition oluşur.",
        solution: "Tercih edilen yaklaşım: Base62(MD5(longUrl)) → ilk 7 karakteri al. 62^7 ≈ 3.5 trilyon kombinasyon verdiği için pratikte collision son derece nadirdir. Collision olursa progressive probing: hash'e bir salt ekleyip tekrar dene. Idempotency için: önce Redis'te longUrl→shortCode mapping'ini ara, varsa direkt döndür, yoksa üret ve DB'ye yaz. DB'de `short_code` kolonuna UNIQUE constraint ekle; aynı anda iki request aynı kodu yazarsa biri constraint violation alır, retry yaparak yeni kod üretir. Büyük ölçekte: API sunucuları önceden üretilmiş ID havuzundan (pre-generated pool) çeker, hash üretme overhead'i tamamen kalkar.",
        whenToUse: [
          "MD5 + Base62 + 7 karakter: 62^7 = 3.5T kombinasyon; günde 100M URL üretsen 35.000 yılda dolar — mülakatta bu hesabı yap",
          "NanoID / Snowflake ID: timestamp + workerID + sequence → collision-free, sıralı, distributed-safe. MD5 yerine tercih edilebilir",
          "Pre-generated pool: background job 1M ID üretip `available_ids` tablosuna yazar; API her istek için SELECT + DELETE (atomic) ile alır — race condition yok, collision yok",
          "Idempotency cache: Redis'te `longUrl:hash → shortCode` mapping'i 24 saat tut; aynı URL tekrar gelirse DB'ye hiç gitme, cache'ten dön",
          "Custom alias: kullanıcı 'my-company/promo' gibi alias seçiyorsa sadece DB'ye UNIQUE INSERT yeterli; hash mantığına gerek yok",
        ],
        pitfalls: [
          "Base62 vs Base58: Base62'de '0' (sıfır), 'O' (büyük o), '1' (bir), 'l' (küçük L) karışıklığa yol açar. Kullanıcı URL'yi eliyle yazarsa hata yapar. Bit.ly ve Bitcoin Base58 kullanır — bu 4 karakteri çıkart",
          "MD5 deterministic ama güvenli değil: aynı URL → aynı hash iyi (cache hit), ama MD5 kriptografik olarak kırık. Kısa kod güvenlik gerektirmiyorsa sorun yok; ama URL'yi tahmin edilemez yapmak istersen HMAC-SHA256 kullan",
          "Sequential counter (1,2,3...): tahmin edilebilir — rakipler sistematik olarak tüm ID'leri tarayıp veri toplayabilir. Güvenlik gerektiren sistemlerde asla kullanma",
          "Race condition + unique violation: iki concurrent request aynı hash'i üretip aynı anda INSERT yaparsa biri unique constraint violation alır. Bu exception'ı yakala, yeni hash üret ve retry yap — max retry count sınırla (3-5)",
        ],
        steps: [
          { from: "client",  to: "api",    label: "POST /shorten {url:'https://long...'}", color: "#38bdf8", delay: 0 },
          { from: "api",     to: "cache",  label: "GET longUrl:hash?",     color: "#fbbf24", delay: 700 },
          { from: "cache",   to: "api",    label: "nil (miss)",             color: "#475569", delay: 1300 },
          { from: "api",     to: "hasher", label: "base62(md5(url))[:7]",  color: "#38bdf8", delay: 2000 },
          { from: "hasher",  to: "api",    label: "'aB3xZ9k'",             color: "#38bdf8", delay: 2700 },
          { from: "api",     to: "db",     label: "INSERT (short,long) ON CONFLICT retry", color: "#22d3ee", delay: 3400 },
          { from: "db",      to: "api",    label: "✓ saved",               color: "#34d399", delay: 4200 },
          { from: "api",     to: "cache",  label: "SET aB3xZ9k→longUrl TTL=24h", color: "#fbbf24", delay: 4900 },
          { from: "api",     to: "client", label: "201 {shortUrl:'bit.ly/aB3xZ9k'}", color: "#38bdf8", delay: 5600 },
        ],
      },
      {
        id: "redirect_flow",
        name: "Redirect Akışı",
        problem: "100M/gün okuma trafiği: her redirect için DB'ye gitseydik saniyede ~1160 DB sorgusu yapardık; bu noktada DB bottleneck olur. Ama daha önemlisi, tüm bu okuma trafiğini nerede durduracağımıza karar vermek gerekiyor: CDN'de mi, Redis'te mi, yoksa origin sunucusunda mı?",
        solution: "Katmanlı cache stratejisi: CDN edge → Redis → DB. İlk katman Cloudflare/Akamai: popüler URL'ler coğrafi olarak yakın PoP'tan (Point of Presence) serve edilir, origin'e hiç gitmez. İkinci katman Redis: CDN miss olursa Redis'te ara, O(1) okuma. Üçüncü katman DB: tamamen soğuk URL'ler için. HTTP status code seçimi kritik: 302 Found → her seferinde server'a gelir → analitik verisi toplanır ama yük fazla. 301 Moved Permanently → browser ve CDN agresif cache'ler → yük neredeyse sıfır ama analitik kör. Analitik tamamen async: redirect sırasında Kafka'ya event at, ClickHouse'a async yaz.",
        whenToUse: [
          "302 Found (Temporary Redirect): tıklama sayısı, coğrafi dağılım, cihaz türü gibi analitik metriklerin toplanması gerekiyorsa her request server'a geldiği için bu verileri yakalayabilirsin — bit.ly ve benzerleri bu yüzden 302 kullanır",
          "301 Moved Permanently: analitik tamamen önemsizse ve yük minimizasyonu öncelikliyse; browser ve CDN'ler bu kodu görünce sonraki istekleri server'a hiç göndermez — statik pazarlama URL'leri için ideal",
          "CDN edge caching: Cloudflare Page Rule veya AWS CloudFront behavior ile /r/* pattern'ini cache'le; TTL = URL'nin aktif olduğu süre. Hot URL'lerin %99'u origin'e ulaşmadan döner",
          "Redis cache-aside: CDN miss sonrası shortCode'u Redis'te ara, yoksa DB'den çek ve Redis'e yaz (TTL 24s). Hot URL'ler Redis'te sonsuz yaşar; LRU eviction en soğuk URL'leri atar",
          "Analitik async pipeline: redirect sırasında Kafka'ya {shortCode, timestamp, geoIP, userAgent} at; Kafka consumer ClickHouse'a batch insert yapar — redirect latency'ye sıfır katkı",
        ],
        pitfalls: [
          "301 cache geri alınamaz: bir kere 301 gönderdikten sonra o URL'yi devre dışı bırakamazsın çünkü browser cache'indeki kullanıcılar hiç server'a gelmez — URL expire edilse veya redirect hedefi değişse bile eski hedeften devam ederler. Kampanya URL'lerinde 301 asla kullanma",
          "Cache stampede (Thundering Herd): viral bir URL'nin TTL'i expire olduğu anda binlerce eş zamanlı request DB'ye yığılır. Çözüm: (1) Probabilistic Early Expiration — TTL dolmadan küçük ihtimalle cache'i yenile, (2) Redis mutex lock — sadece bir process DB'ye gitsin diğerleri beklesin, (3) Staggered TTL — her URL için TTL'ye random jitter ekle",
          "DB sharding yanlış key seçimi: URL'leri `created_at` (timestamp) ile range shard yaparsan yeni URL'lerin tamamı son shard'a düşer — hotspot. shortCode'un hash'ine göre consistent hashing kullan, uniform dağılım garanti",
          "Analytics bottleneck: her redirect'te senkron DB write yapılırsa (click count++) bu yazma işlemi latency'ye eklenir ve high-traffic'te DB darboğaz olur. Redis INCR ile counter tut, periyodik olarak DB'ye flush et",
        ],
        steps: [
          { from: "browser", to: "cdn",    label: "GET bit.ly/aB3xZ9k",        color: "#38bdf8", delay: 0 },
          { from: "cdn",     to: "redis",  label: "cache lookup: aB3xZ9k",      color: "#fbbf24", delay: 700 },
          { from: "redis",   to: "cdn",    label: "HIT → https://long-url.com", color: "#34d399", delay: 1400, note: "DB'ye gidilmedi" },
          { from: "cdn",     to: "browser",label: "302 Location: https://long-url.com", color: "#38bdf8", delay: 2100 },
          { from: "cdn",     to: "kafka",  label: "async: click event {id,geo,ua}", color: "#f97316", delay: 2500, note: "Analitik async" },
          { from: "kafka",   to: "analytics", label: "consume → clickhouse insert", color: "#f97316", delay: 3300 },
        ],
      },
      {
        id: "scale",
        name: "Ölçekleme Stratejisi",
        problem: "Viral bir URL tweet'leniyor ve saniyeler içinde 1M eş zamanlı istek geliyor. Tek Redis node çöküyor, origin sunucu bunalıyor. Ölçekleme adımları neler? Ne zaman hangi katmanı devreye alırsın?",
        solution: "Kapasitesi hesapla önce: 100M URL/gün = 1160 write/s, 1:10 read oranı = 11.600 read/s normal yük. Viral spike: tek URL'ye 1M/s. Bu yükü katman katman kes: (1) CDN edge: %90-95 isteği origin'e ulaşmadan döndürür. (2) Redis Cluster: geri kalan %5-10'u Redis karşılar. (3) Read replica'lar: analitik sorgular için. (4) Write path ayrı: URL yazmak nadirdir, shard'lı Postgres veya DynamoDB yeterli. Depolama hesabı: 100M URL/gün × 500B = 50GB/gün → yılda 18TB. 3 yıllık veri = 54TB → TTL politikası ve cold storage zorunlu.",
        whenToUse: [
          "CDN önceliği: redirect trafiğinin %90'ı CDN'de kesilebilir çünkü shortCode → longUrl mapping'i immutable'dır (bir kez yazılır, hiç değişmez) — uzun TTL veya immutable header ile CDN'de sonsuza cache'le",
          "Read replica: analitik sorgular (son 7 günde en çok tıklanan URL'ler, geo breakdown) read replica'ya yönlendir; master sadece yazma alır. PgBouncer ile connection pool ekle",
          "Pre-generated ID havuzu: farklı bir servis arka planda 1M ID üretip `id_pool` tablosuna yazar. URL kısaltma API'si sadece `DELETE FROM id_pool RETURNING id` yapar — O(1), hash yok, collision yok, lock yok",
          "Multi-region active-passive: US'te master DB, EU'da read replica. EU kullanıcıları redirect için replica'ya gider (< 10ms), yazma için US master'a gider (nadir olduğu için kabul edilebilir latency)",
          "Bloom filter: bir shortCode daha önce kullanılmış mı? Bloom filter ile O(1) space-efficient check — DB'ye gitme. False positive oranı %1 altında tutmak için optimal bit array boyutunu hesapla: m = -n·ln(p) / (ln2)²",
        ],
        pitfalls: [
          "Thundering herd gerçek senaryosu: Elon Musk 50M follower'lı hesabından bir short URL paylaşıyor. Tweet yayınlanma anı → saniyeler içinde 500K+ click. CDN'de cache yoksa (ilk kez paylaşıldıysa) tüm istekler origin'e yığılır. Çözüm: tweet yayınlanmadan önce URL'yi proactively CDN'e push et veya CDN'in coalesce özelliğini aç (aynı URL için tek origin request, diğerleri bekler)",
          "Storage büyümesi ve TTL: 100M URL/gün × 365 = 36.5B kayıt/yıl. 500 bytes/row = 18TB/yıl sadece ham veri. Index + WAL + replica = 3-4x → 50-70TB/yıl. Çözüm: (1) inactive URL'leri 1 yıl sonra S3 Glacier'e taşı, (2) free tier URL'lere 90 günlük TTL koy, (3) paid kullanıcıya kalıcı URL sat",
          "Custom domain karmaşıklığı: kullanıcı 'go.mycompany.com/promo' gibi kendi domain'ini kullanmak istiyor. Bu durumda wildcard SSL sertifikası (*.mycompany.com), DNS CNAME → platform, ve reverse proxy routing gerekir. Her custom domain için ayrı SSL provisioning maliyeti — Let's Encrypt ACME protokolü otomatize edebilir",
          "Abuse ve güvenlik: phishing URL'leri kısaltmak için servis kullanılabilir — Google Safe Browsing API ile URL'yi kısaltmadan önce kontrol et. Rate limiting: aynı IP'den dakikada 10'dan fazla kısaltma isteği → 429. URL'nin hedefi her gün kontrol et, malicious olursa redirect engelle",
        ],
        steps: [
          { from: "browser",   to: "cloudflare", label: "GET sht.ly/aB3x (1M concurrent)", color: "#38bdf8", delay: 0 },
          { from: "cloudflare",to: "cloudflare", label: "edge cache HIT → 302 (no origin)", color: "#34d399", delay: 700, self: true, note: "CDN absorbe etti" },
          { from: "cloudflare",to: "redis_cluster", label: "cache miss → Redis Cluster", color: "#fbbf24", delay: 1600 },
          { from: "redis_cluster",to: "cloudflare",  label: "HIT: longUrl",             color: "#34d399", delay: 2300 },
          { from: "cloudflare",to: "db_shard",     label: "Redis miss → DB shard lookup", color: "#22d3ee", delay: 3200 },
          { from: "db_shard",  to: "redis_cluster", label: "warm cache",                color: "#fbbf24", delay: 4000 },
        ],
      },
    ],
  },

  notification: {
    label: "Notification System",
    emoji: "🔔",
    accent: "#f472b6",
    tagline: "Push · Email · SMS · In-App",
    scales: "10M+ bildirim/gün · < 1s push · multi-channel",
    subsections: [
      {
        id: "fanout",
        name: "Fan-Out Stratejileri",
        problem: "100M kullanıcılı bir platformda 50M takipçisi olan bir celebrity tweet attı. Naif yaklaşım: tweet anında tüm 50M takipçinin inbox'ına yaz (fan-out on write). Ama bu, saniyeler içinde 50M DB write'ı demektir. DB'yi öldürür. Alternatif: hiç yazma, okuma sırasında hesapla (fan-out on read). Ama her kullanıcı feed'i açtığında 1000 takip edilen kişinin son postlarını birleştirmek O(following_count) → çok yavaş. İkisi arasında trade-off nerede?",
        solution: "Twitter/Instagram'ın üretime aldığı hybrid model: takipçi sayısı < 10K olan kullanıcı (normal user) için fan-out on write — tweet anında tüm takipçilerin Redis inbox'ına ZADD ile yaz, okuma O(1). Takipçi sayısı ≥ 10K olan kullanıcı (celebrity) için fan-out on read — tweet sadece tweet DB'ye yazılır; okuma sırasında celebrity'nin son postları çekilip normal inbox ile merge edilir. Bu hybrid model ile 50M write spike'ı ortadan kalkar ve celebrity problemi çözülür. Fanout worker'ları paginated olarak çalışır: 1000'er follower gruplarında queue'ya atar, queue workers Redis ZADD yapar. Böylece DB ani spike yerine düzenli akış görür.",
        whenToUse: [
          "Fan-out on write (push): okuma O(1) ZREVRANGE, sub-millisecond. 1000 takip eden = 1000 ZADD per post ama bu yük write-time'a yayılır, read-time sıfır. 500M DAU'lu Instagram'ın normal user için seçimi bu",
          "Fan-out on read (pull): celebrity için. Tweet sadece bir kez yazılır. Okuma sırasında 'SELECT * FROM tweets WHERE author_id IN (celebrity_ids) ORDER BY ts DESC LIMIT 20' ile merge. Maliyeti okuma zamanına taşır ama celebrity sayısı az olduğu için toplam yük düşer",
          "Hybrid threshold belirleme: Twitter ~10K, Instagram ~100K follower'ı cut-off olarak kullanır. Bu değer A/B test + load test ile belirlenir; sisteminize göre değişir",
          "Redis ZADD inbox: score = Unix timestamp (float), member = postId. ZREVRANGE inbox:userId 0 19 → son 20 post O(log N). ZREMRANGEBYSCORE ile 30 günden eski postları temizle",
          "Fanout rate limiting: celebrity tweet'i geldiğinde 50M follower ID'sini Kafka'ya at, Kafka consumer'lar Redis ZADD yapar — rate limiter ile saniyede max 100K write yapılır. Tüm fanout 500 saniyede (8 dakika) tamamlanır, DB asla spike görmez",
        ],
        pitfalls: [
          "Write amplification matematigi: 1 celebrity tweet × 50M follower = 50M Redis ZADD. Her ZADD ~1µs → 50 saniye tek thread'de. 10 parallel worker → 5 saniye. Ama 100 celebrity aynı anda tweet atarsa 100 × 50M = 5B write → Kafka queue depth patlar. Çözüm: celebrity tweet'leri throttle et, fanout queue'nun depth'ini izle",
          "Unfollow/block retroactive silme: kullanıcı birisini takipten çıkardığında o kişinin daha önce inbox'a yazılan tweetleri nasıl silinecek? Silmek imkânsız çünkü inbox'ta sadece postId var, kim yazdı bilgisi yok. Çözüm: read-time filter — feed servis ederken 'block/unfollow listesindeki authorId'leri filtrele'. Post DB'ye gitmek gerekir ama cache ile amortize edilir",
          "Hot shard - follower DB: celebrity'nin 50M follower ID'sini saklayan tablo belirli bir DB shard'ına yığılabilir. Fanout worker bu shard'ı paginated okurken o shard tek başına %100 CPU'ya ulaşır. Çözüm: follower listesini consistent hash ile farklı shard'lara dağıt",
          "Inbox memory yönetimi: 500M aktif user × 1000 postId × 8 byte = 4TB Redis. Bu çok fazla. Çözüm: sadece son 7 günde login olan aktif kullanıcılar için inbox tut. Inactive kullanıcı login olunca lazy rebuild — 'SELECT son 50 post' ile inbox'ı baştan oluştur",
        ],
        steps: [
          { from: "celebrity",  to: "api",      label: "POST /tweet {text:'Hello 50M!'}", color: "#f472b6", delay: 0 },
          { from: "api",        to: "tweet_db",  label: "INSERT tweet (id=999)",           color: "#22d3ee", delay: 700 },
          { from: "api",        to: "fan_svc",   label: "async: fanout(tweetId=999)",       color: "#f472b6", delay: 1300 },
          { from: "fan_svc",    to: "follow_db", label: "SELECT follower_ids (50M) paginated", color: "#818cf8", delay: 2100 },
          { from: "fan_svc",    to: "msg_queue", label: "enqueue 50M inbox writes (batched)", color: "#f97316", delay: 3000, note: "Async, rate-limited" },
          { from: "msg_queue",  to: "inbox_workers", label: "workers: ZADD inbox:{userId} score=ts member=999", color: "#fbbf24", delay: 3800 },
          { from: "normal_user",to: "feed_api",  label: "GET /feed",                       color: "#f472b6", delay: 5000 },
          { from: "feed_api",   to: "redis",     label: "ZREVRANGE inbox:normalUserId 0 20", color: "#34d399", delay: 5700, note: "Pre-populated: hızlı" },
        ],
      },
      {
        id: "multi_channel",
        name: "Multi-Channel Routing",
        problem: "Bir sipariş kargoya verildi. Kullanıcıya push bildirimi, e-posta ve SMS göndermek istiyoruz. Ama her kanalın farklı provider'ı var (APNs, FCM, SendGrid, Twilio), her provider'ın farklı rate limiti ve failure modu var. SMS provider çökerse e-posta da etkilenmeli mi? Aynı bildirim iki kez gönderilirse ne olur?",
        solution: "Notification Service merkezi bir router + orchestrator görevi görür. Akış: (1) Trigger event gelir (order_shipped, payment_failed vb.). (2) Servis, user preference DB'den bu kullanıcının hangi kanalları aktif ettiğini çeker. (3) Her aktif kanal için ayrı bir queue'ya mesaj bırakır. (4) Her kanalın dedicated worker'ı kendi queue'sunu tüketir ve ilgili provider'a çağrı yapar. Kritik tasarım kararları: kanallar birbirinden tamamen izole edilmiş queue'larda çalışır — SMS provider çökünce sadece SMS queue durur, e-posta akışı etkilenmez. Her mesaj idempotency key taşır — retry sırasında aynı mesaj iki kez gönderilmez. Her kanal için ayrı DLQ: başarısız mesajlar analiz için DLQ'da birikir.",
        whenToUse: [
          "Kanal öncelik sırası: push (< 1s, ücretsiz) > in-app (< 100ms, ücretsiz) > email (1-5 dakika, çok ucuz) > SMS (saniyeler, en pahalı). Kullanıcı push'u kapatmışsa email'e düş, email de kapalıysa SMS'e geç — bu waterfall mantığı kritik",
          "User preference tablosu: {userId, push:bool, email:bool, sms:bool, quiet_hours:{start:22, end:8}, timezone:'Europe/Istanbul'}. Gece 02:00'de SMS gönderme — timezone'u dikkate al",
          "Template service: bildirim içeriği ayrı bir servis tarafından render edilir. {template_id: 'order_shipped', params: {order_id, tracking_url}} gönder; template servisi i18n + personalization uygular. Böylece notification worker içerik bilmez, sadece iletir",
          "Idempotency key yapısı: '{notification_id}:{channel}:{userId}' — aynı kombinasyon ikinci kez gelirse provider'a çağrı yapma, cached response döndür. Key TTL: 24 saat yeterli",
          "Provider failover: SendGrid çökerse Mailgun'a geç, o da çökerse AWS SES. Provider seçimi health check sonucuna göre yapılır — circuit breaker her provider için ayrı tutulur",
        ],
        pitfalls: [
          "APNs ve FCM rate limit gerçekleri: APNs production'da token başına saniyede 3 push ile başlar ve burst limit vardır. FCM'de saniyede 600.000 mesaj limiti var ama tek bir topic'e burst atmak throttle'a neden olur. Çözüm: token bazlı queue ile her device için saniyede max 1 push; acil bildirimlere öncelik ver (priority=high FCM parametresi APNs'i uyandırır)",
          "Push token lifecycle yönetimi: kullanıcı uygulamayı sildiğinde veya yeniden yüklediğinde APNs/FCM token değişir ya da geçersiz hale gelir. APNs Feedback Service ve FCM'in RegistrationToken refresh event'i ile stale token'ları temizle. Stale token'a gönderim hem para harcar hem bounce rate artırır",
          "Email deliverability gizli karmaşıklığı: SPF, DKIM, DMARC DNS kayıtları yanlışsa email spam'e düşer. Hard bounce (kalıcı — adres yok): adresi hemen suppress list'e al, bir daha gönderme. Soft bounce (geçici — mailbox full): max 3 kez retry. Unsubscribe linki CAN-SPAM/GDPR zorunluluğu — olmayan bir email servisinin tüm mailleri spam'e gider",
          "Duplicate gönderim senaryosu: worker mesajı işledi, provider'a gönderdi, ama queue'ya ACK göndermeden çöktü. Queue mesajı tekrar teslim eder, ikinci worker aynı mesajı tekrar işler. Sonuç: kullanıcı aynı bildirimi iki kez alır. Sadece idempotency key ile önlenebilir — provider çağrısından önce Redis'te 'SET notif:{key} NX EX 86400' yap; zaten varsa skip et",
        ],
        steps: [
          { from: "trigger",  to: "notif_svc",  label: "send({userId, type:'order_shipped'})", color: "#f472b6", delay: 0 },
          { from: "notif_svc",to: "user_pref",  label: "GET preferences userId=42",            color: "#818cf8", delay: 700 },
          { from: "user_pref",to: "notif_svc",  label: "{push:true, email:true, sms:false}",   color: "#818cf8", delay: 1400 },
          { from: "notif_svc",to: "push_q",     label: "enqueue push notification",             color: "#38bdf8", delay: 2100 },
          { from: "notif_svc",to: "email_q",    label: "enqueue email notification",            color: "#fbbf24", delay: 2300 },
          { from: "push_q",   to: "fcm",        label: "FCM: send to device token",             color: "#38bdf8", delay: 3100 },
          { from: "email_q",  to: "sendgrid",   label: "SendGrid: send transactional email",    color: "#fbbf24", delay: 3300 },
          { from: "fcm",      to: "push_q",     label: "❌ token invalid → DLQ",               color: "#ef4444", delay: 4100, note: "Token temizlenecek" },
          { from: "sendgrid", to: "email_q",    label: "✓ delivered",                          color: "#34d399", delay: 4100 },
        ],
      },
    ],
  },

  news_feed: {
    label: "News Feed",
    emoji: "📰",
    accent: "#a78bfa",
    tagline: "Twitter / Instagram tipi timeline",
    scales: "500M DAU · 300K post/sn · P99 feed < 200ms",
    subsections: [
      {
        id: "feed_generation",
        name: "Feed Oluşturma",
        problem: "500M DAU'lu bir platform. Kullanıcı uygulamayı her açtığında son 20 postu görmek istiyor. Naif yöntem: 'SELECT p.* FROM posts p JOIN follows f ON p.author_id = f.following_id WHERE f.follower_id = ? ORDER BY p.created_at DESC LIMIT 20'. Bu sorgu 1000 takip edilen × milyonlarca post = join operasyonu devasa. P99 < 200ms hedefini DB sorgusuyla yakalayamazsın. Ne yapacaksın?",
        solution: "Pre-computed timeline (push model): post yazıldığı anda, tüm takipçilerin Redis inbox'ına asenkron olarak yazılır. Okuma sırasında sadece 'ZREVRANGE inbox:userId 0 19' çalışır — O(log N), sub-millisecond. Uygulama: inbox Redis sorted set olarak tutulur; score = Unix timestamp (milisaniye cinsinden float), member = postId. Fan-out queue bir Kafka topic'i olarak yapılandırılır; her partition belirli bir kullanıcı aralığını işler. Yazar postu oluştururken DB'ye yazar ve Kafka'ya event atar. Kafka consumer'lar social graph DB'den follower listesini batch olarak çeker ve Redis'e ZADD yapar. Okuma sırasında sadece postId listesi Redis'ten çekilir; post detayları ayrı bir batch çağrısıyla alınır — N+1 sorgu değil tek MGET.",
        whenToUse: [
          "Redis ZADD yapısı: ZADD inbox:{userId} {timestamp_ms} {postId}. ZREVRANGE inbox:{userId} 0 19 → son 20 post. ZCARD ile inbox boyutunu kontrol et, 1000'i aştıysa ZREMRANGEBYRANK ile en eskileri sil. Memory: 1000 entry × 8 byte × 500M user = 4TB — sadece aktif kullanıcılar için tut",
          "Cursor-based pagination: 'ZREVRANGEBYSCORE inbox:userId (lastScore +inf LIMIT 0 20' ile sonsuz scroll. offset-based değil çünkü yeni post gelince offsetler kayar. Score = timestamp olduğu için cursor = son görülen timestamp",
          "Cold start / inactive user: 30 gün login olmamış kullanıcının inbox'ı yok ya da expire olmuş. Login olduğunda lazy rebuild: 'SELECT last 50 posts FROM followed users' ile on-demand oluştur, sonra normal push model devam eder",
          "Post detay fetch: Redis inbox'tan [postId1, postId2...] listesini aldıktan sonra ayrı bir cache katmanına git: 'MGET post:5001 post:4998...' — her post ayrı bir Redis key'de saklanır, TTL 24 saat. Miss olursa DB'den çek ve cache'e yaz",
          "Fanout worker scaling: Kafka partition sayısı = fan-out worker sayısı. Her worker kendi partition'ını işler; paralel fan-out. Worker 1000 follower'ı Redis pipeline kullanarak batch ZADD yapar — her ZADD ayrı TCP round-trip yerine pipeline ile tek seferde gönderilir, 10-50x daha hızlı",
        ],
        pitfalls: [
          "Post silme senkronizasyonu: bir kullanıcı postunu sildiğinde o post binlerce ya da milyonlarca inbox'ta hâlâ duruyor. Bu inbox'lardan geriye dönük silmek pratik olarak imkânsız. Çözüm: feed servis ederken her postId için deleted_at kontrolü yap. Bunu verimli yapmak için: postId batch olarak post cache'e çekilirken deleted olanları filtrele; client'a silinmiş post yerine boşluk gönder veya bir sonraki postla doldur",
          "Like/comment counter consistency: her postun beğeni sayısı sürekli değişiyor. Bu sayacı her post oluşturmada DB'ye sync yazmak mümkün değil. Çözüm: Redis INCR ile real-time sayaç tut (post:{id}:likes). Her 5 dakikada bir veya threshold aşılınca (her 100 like'ta bir) DB'ye async sync et. Okuma: her zaman Redis'ten oku. Bu eventual consistency, çoğu sosyal platform için kabul edilebilir",
          "Memory şişmesi: 500M user için inbox tutmak bile 4TB Redis. Bunu azaltmak için: (1) Son 7 günde aktif olmayan kullanıcıların inbox'larını delete et — onlar login olunca lazy rebuild. (2) Inbox max boyutu 500 post ile sınırla — çoğu kullanıcı 500 postu hiç görmeden çıkıyor. (3) TTL: her inbox key için 7 günlük TTL, aktif kullanıcılar için EXPIRE ile yenile",
          "Social graph DB bottleneck: fan-out sırasında her post için follower listesini social graph DB'den çekmek gerekiyor. 1M post/saat × ortalama 100 follower = 100M DB okuma/saat. Çözüm: follower listesini de cache'le — 'followers:{userId}' Redis set'i. Yeni takip/takipten çıkma event'lerinde bu set'i güncelle",
        ],
        steps: [
          { from: "user_a",    to: "post_api",   label: "POST /post {text:'Hello World'}",     color: "#a78bfa", delay: 0 },
          { from: "post_api",  to: "post_db",    label: "INSERT post id=5001",                  color: "#22d3ee", delay: 700 },
          { from: "post_api",  to: "fanout_q",   label: "publish(postId=5001, authorId=UserA)", color: "#a78bfa", delay: 1400 },
          { from: "fanout_q",  to: "graph_db",   label: "GET followers(UserA) → [B,C,D...]",   color: "#818cf8", delay: 2200 },
          { from: "fanout_q",  to: "redis",      label: "ZADD inbox:B ts=now 5001",             color: "#fbbf24", delay: 3000 },
          { from: "fanout_q",  to: "redis",      label: "ZADD inbox:C ts=now 5001",             color: "#fbbf24", delay: 3100 },
          { from: "user_b",    to: "feed_api",   label: "GET /feed (UserB opens app)",          color: "#a78bfa", delay: 4200 },
          { from: "feed_api",  to: "redis",      label: "ZREVRANGE inbox:B 0 19",               color: "#fbbf24", delay: 4900 },
          { from: "redis",     to: "feed_api",   label: "[5001, 4998, 4991...]",                color: "#34d399", delay: 5600 },
          { from: "feed_api",  to: "post_db",    label: "MGET post:5001 post:4998... (batch)",  color: "#22d3ee", delay: 6300 },
          { from: "feed_api",  to: "user_b",     label: "← 20 posts rendered",                 color: "#a78bfa", delay: 7200, note: "< 50ms" },
        ],
      },
      {
        id: "ranking",
        name: "Feed Sıralama & Ranking",
        problem: "Kronolojik feed artık yeterli değil — kullanıcılar ilgisiz postları atlıyor, engagement düşüyor. Kişiselleştirilmiş ranking isteniyor. Ama ML ranking pipeline P99 < 200ms hedefiyle nasıl sığdırılır? Feature store nedir, neden gerekli?",
        solution: "İki aşamalı ranking mimarisi: (1) Candidate retrieval: kullanıcı için 500-2000 aday post belirlenir. Bu aşama hızlı ve rough olabilir — son 48 saatteki postlar, takip edilenler, trend olanlar. (2) Ranking model: aday postlar ML modelinden geçirilir, her posta bir engagement score atanır. Feature'lar: post tarafı (yaş, beğeni/comment/paylaşım hızı, media türü, author authority), kullanıcı tarafı (o kullanıcının benzer postlara geçmiş etkileşimi, interest vektörü). Feature store: real-time feature (son 1 dakikadaki like velocity) + pre-computed feature (kullanıcı interest embedding'i) bir arada tutulur. Model inference: ONNX ile quantize edilmiş model, batch inference < 20ms. (3) Post-ranking: business rules uygula — aynı yazardan max 3 post, reklam yerleştirme, diversity injection.",
        whenToUse: [
          "Feature store mimarisi: Feast veya Tecton gibi feature platform. Batch feature'lar (kullanıcı interest vektörü, author historical CTR) günlük Spark job ile hesaplanıp Redis/Cassandra'ya yazılır. Real-time feature'lar (son 5 dakikadaki like count, post view velocity) Flink ile stream'den hesaplanıp ayrı Redis key'lerine yazılır. Inference sırasında her iki feature grubu birleştirilir",
          "Recency decay fonksiyonu: score = raw_score × e^(-λ × hours_since_post). λ parametresi A/B test ile tune edilir. Haber platformu için λ büyük (24 saatlik post %10 değerinde), sosyal platform için λ küçük (seminal içerik haftalarca öne çıkabilir)",
          "Two-tower model: kullanıcı vektörü (user tower) ve post vektörü (item tower) ayrı ayrı hesaplanır, dot product ile similarity skoru çıkar. Bu model özellikle candidate retrieval için verimli: user vektörünü önceden hesapla, post vektörlerini ANN index'te ara (FAISS, ScaNN) — O(log N) retrieval",
          "A/B testing altyapısı: ranking model değişikliklerini %5 traffic'e önce aç. Primary metric: long-term engagement (session length, next-day retention) — sadece like sayısına bakma, clickbait'i ödüllendirirsin. Experiment tracking: MLflow veya W&B ile model versiyonları izle",
        ],
        pitfalls: [
          "Filter bubble ve diversity problemi: kullanıcı sürekli aynı türde içerik görürse interest vektörü o yönde güçlenir, farklı içerikler hiç gösterilmez. Sonuç: kullanıcı sıkılır, churn artar. Çözüm: her feed'e %10-20 oranında diversity injection — kullanıcının normalde görmediği kategorilerden serendipity post ekle. Netflix bu oranı her kullanıcı için ayrı tune eder",
          "Cold start problemi iki boyutlu: yeni kullanıcı (hiç interaction yok, interest bilinmiyor) ve yeni post (hiç engagement yok, kalitesi bilinmiyor). Yeni kullanıcı: onboarding'de interest seçtir, demografik benzer kullanıcıların davranışını başlangıç noktası yap. Yeni post: global trending içeriklerle birlikte küçük bir random exposure ver, early engagement sinyaline göre promote/demote et",
          "Feature leakage ve training/serving skew: ML modeli train edilirken kullanılan feature'lar inference sırasında aynı şekilde hesaplanmazsa model gerçek hayatta beklenen performansı vermez. Özellikle zaman bazlı feature'larda dikkat: train'de 'post yaşı = post_time - label_time' ama serving'de 'post yaşı = post_time - now()'. Feature pipeline'ı hem train hem serve için aynı kod tabanından çalıştır",
          "Ranking latency bütçesi: 200ms P99 hedefin var. Candidate retrieval: ~30ms. Feature fetch: ~20ms (Redis). Model inference (ONNX, batch 200 post): ~40ms. Post-ranking business rules: ~5ms. Total: ~95ms. Kalan buffer kademe kaymalarına karşı. Model büyürse (transformer bazlı) inference time artar — quantization (INT8) ve model pruning zorunlu. Fallback: model timeout'ta kronolojik sıralama ile serve et",
        ],
        steps: [
          { from: "user",      to: "feed_api",   label: "GET /feed?algo=ranked",                color: "#a78bfa", delay: 0 },
          { from: "feed_api",  to: "candidate",  label: "retrieve top-1000 candidates",         color: "#818cf8", delay: 700 },
          { from: "candidate", to: "feature_store", label: "GET user_vector + post_features",   color: "#60a5fa", delay: 1500 },
          { from: "feature_store",to:"ranker",   label: "features: [recency,likes,affinity...]", color: "#60a5fa", delay: 2300 },
          { from: "ranker",    to: "feed_api",   label: "ranked 20 posts (ML scores)",          color: "#34d399", delay: 3100 },
          { from: "feed_api",  to: "diversity",  label: "inject diversity (max 3 same author)",  color: "#fbbf24", delay: 3900 },
          { from: "feed_api",  to: "user",       label: "← personalized feed",                  color: "#a78bfa", delay: 4700, note: "P99 < 200ms" },
        ],
      },
    ],
  },

  chat: {
    label: "Chat System",
    emoji: "💬",
    accent: "#34d399",
    tagline: "WhatsApp / Slack tipi mesajlaşma",
    scales: "50M DAU · 10B mesaj/gün · < 100ms delivery",
    subsections: [
      {
        id: "message_flow",
        name: "Mesaj İletim Akışı",
        problem: "Alice bir mesaj gönderiyor ama Bob o anda offline. Mesaj kaybolmamalı. Bob online olunca tam olarak o mesajı almalı. Ayrıca Alice'in 'delivered' (✓✓) ve 'read' (mavi ✓✓) görmesi lazım. Binlerce eş zamanlı kullanıcı WebSocket bağlantısı kuruyorsa, hangi kullanıcı hangi sunucuya bağlı? Mesaj yanlış sunucuya gitmiş olabilir.",
        solution: "Mimari: birden fazla chat server, her server'a yüzlerce bin WebSocket bağlantısı. Sorun: Alice, chat-srv-A'ya bağlı; Bob, chat-srv-B'ye bağlı; mesaj nasıl geçiyor? Çözüm: mesaj persistence layer + message broker (Kafka). Alice mesaj gönderir → chat-srv-A DB'ye yazar → Kafka'ya event atar. Kafka consumer, Bob'un hangi sunucuda olduğunu presence service'ten sorar (Redis: 'userId:serverAddress') → chat-srv-B'ye iletir → Bob'un WebSocket bağlantısına push eder. Bob offline ise: mesaj DB'de duruyor, Bob login olunca çeker. Sıralama garantisi: her conversation'a monoton artan sequence number atanır — Snowflake ID timestamp bileşeni veya DB sequence. Client clock asla güven kaynağı değil.",
        whenToUse: [
          "WebSocket vs HTTP: WebSocket — tam çift yönlü, persistent bağlantı, overhead çok düşük (frame header 2-14 byte, HTTP header 500+ byte). SSE (Server-Sent Events) — tek yönlü server→client, HTTP üzerinden çalışır, proxy dostu, read-only akış için (bildirim, live score). Long polling — WebSocket yoksa fallback, her 30s'de yeni request, latency yüksek",
          "Presence sistemi: her client 5 saniyede bir heartbeat gönderir: 'SET user:{id}:online {serverAddr} EX 10'. 10 saniye heartbeat gelmezse key expire olur = offline. Okuma: 'GET user:{id}:online' — sonuç varsa online ve hangi sunucuda. Bu yaklaşım O(1) lookup ve otomatik cleanup sağlar",
          "Message ID olarak Snowflake: 41 bit timestamp + 10 bit machine ID + 12 bit sequence = 64 bit integer. Timestamp bileşeni sayesinde sıralanabilir (monoton artan), distributed ortamda merkezi koordinasyon gerektirmez, saniyede 4096 ID per machine",
          "At-least-once delivery + deduplication: client mesajı gönderirken UUID client_message_id ekler. Server bu ID'yi idempotency key olarak kullanır — aynı client_message_id tekrar gelirse DB'ye yazmaz, önceki sonucu döndürür. Client, server'dan ACK alana kadar retry yapar (exponential backoff, max 5 deneme)",
        ],
        pitfalls: [
          "WebSocket sticky session problemi: Alice chat-srv-A'ya bağlı, mesajı chat-srv-B'de çalışan bir consumer işliyor. B, Alice'e delivered notification göndermek için Alice'in nerede olduğunu bilmiyor. Çözüm: Redis Pub/Sub — her chat server kendi channel'ına subscribe olur ('chat-srv-A' channel). Delivered notification göndermek isteyen servis Alice'in server'ını presence'dan öğrenir, o server'ın channel'ına publish eder",
          "Message ordering görünür karmaşıklığı: Alice hızlıca iki mesaj gönderiyor. İkinci mesaj ağda daha hızlı gidip önce işlenebilir — client timestamp'e güvenirsen sıra bozulur. Çözüm: server-side sequence number per conversation. Conversation bazlı monoton artan sequence: 'INCR conv:{id}:seq' Redis ile atomik. Client sequence gap fark ederse missing message'ları re-fetch eder",
          "Large group chat ölçeği: 10.000 kişilik bir Slack kanalında her mesaj 10.000 WebSocket'e push edilmeli. 1000 mesaj/dakika × 10.000 kullanıcı = 10M WebSocket frame/dakika. Bu fan-out yükü tek Kafka partition'ın üstesinden gelemeyebilir. Çözüm: broadcast channel mimarisi — group message için fan-out yapma, kullanıcılar 'channel:X' Redis Pub/Sub'a subscribe olur, mesaj bir kez publish edilir, tüm server'lar kendi bağlı kullanıcılarına push eder",
          "End-to-end şifreleme (E2EE) trade-off'ları: Signal Protocol ile E2EE'de mesajlar server'da şifreli tutulur, server anahtarı bilmez. Bu güvenlik sağlar ama server-side search, moderation, spam detection imkânsız hale gelir. WhatsApp E2EE kullanır ama metadata (kim kiminle ne zaman) görünürdür. Moderasyon için: client-side tarama veya hash-based CSAM detection (PhotoDNA benzeri, içeriği açmadan)",
        ],
        steps: [
          { from: "alice",      to: "chat_srv_a",  label: "WS: send {to:Bob, text:'Hey!', cid:uuid}", color: "#34d399", delay: 0 },
          { from: "chat_srv_a", to: "msg_db",      label: "INSERT msg (seq=1001, conv=AB)",             color: "#22d3ee", delay: 700 },
          { from: "chat_srv_a", to: "kafka",        label: "publish conv:AB msg:1001",                  color: "#f97316", delay: 1400 },
          { from: "kafka",      to: "chat_srv_b",  label: "consume: msg for Bob",                       color: "#f97316", delay: 2200 },
          { from: "chat_srv_b", to: "presence",    label: "is Bob online?",                             color: "#818cf8", delay: 3000 },
          { from: "presence",   to: "chat_srv_b",  label: "Bob: ONLINE ws:srv-B",                       color: "#34d399", delay: 3700 },
          { from: "chat_srv_b", to: "bob",         label: "WS push: {seq:1001, text:'Hey!'}",           color: "#34d399", delay: 4400 },
          { from: "bob",        to: "chat_srv_b",  label: "ACK {seq:1001}",                             color: "#34d399", delay: 5100 },
          { from: "chat_srv_b", to: "alice",       label: "WS: delivered ✓✓",                          color: "#34d399", delay: 5800, note: "Double tick" },
        ],
      },
      {
        id: "offline_sync",
        name: "Offline Sync & Group Chat",
        problem: "Bob 3 gün offline kaldı. Tekrar açtığında 500 mesajı nasıl alacak? Offset'e göre fetch mi, zaman damgasına göre mi? Ayrıca 1000 kişilik bir grup var. Her mesaj için 1000 WebSocket push yaparsak sunucu bunalır. Grup mesajlaşması individual chat'ten farklı mı tasarlanmalı?",
        solution: "Offline sync için cursor-based mesaj senkronizasyonu: client, sunucuya her conversation için son gördüğü sequence number'ı (last_seen_seq) gönderir. Sunucu 'SELECT * FROM messages WHERE conv_id = ? AND seq > last_seen_seq ORDER BY seq ASC LIMIT 100' yapar. 100'lük batch sonra bir sonraki cursor ile devam. Bu yöntemin avantajı: idempotent (aynı request iki kez yapılsa aynı sonuç), pagination O(1) index lookup. Grup mesajlaşması için iki model ayrışır: küçük grup (< 500 üye) fan-out on write — her mesaj tüm üyelerin inbox'ına yazılır. Büyük grup/kanal (500+ üye) fan-out on read — mesaj bir kez yazılır, online üyeler WebSocket push alır, offline üyeler login'de çeker. 10K üyeli grup için: Kafka topic (group:channel_id) → tüm server'lar bu topic'i consume eder → kendi bağlı kullanıcılarına push eder. Bu scatter-gather değil broadcast modeli.",
        whenToUse: [
          "Sync cursor tasarımı: last_seen_seq conversation bazlı saklanır — client-side storage (SQLite/IndexedDB). Server'a gönderilirken: {'conv_1': 1001, 'conv_2': 483, 'conv_3': 0} şeklinde. Server tüm conv'lar için paralel SELECT yapar. Her 100 mesajlık batch arasında progressive rendering — kullanıcı ilk batch'i görürken arka planda diğerleri yükleniyor",
          "Message retention stratejisi: mesajların ne kadar saklanacağı iş kararı. WhatsApp: son 30 gün aktif değilse yerel arşivde. Slack: free tier 90 gün, paid plan sınırsız ama maliyeti var. DB'de: hot storage (son 90 gün) → PostgreSQL. Cold storage (90 gün+) → S3 Parquet dosyaları. Arama: hot → Elasticsearch, cold → Athena (S3 üzerinde SQL)",
          "Büyük grup için Kafka fan-out: her chat server group:channelId topic'ini consume eder. Mesaj gelince kendi bağlı kullanıcıları arasında o grubun üyesi olanları filtreler ve WebSocket push yapar. Toplam WS push sayısı = online üye sayısı. 10K üyenin 5K'si online → 5K push, 5K offline üye için DB'de mesaj hazır bekliyor",
          "Read receipt at scale: 10K üyeli grupta her mesaj 10K okundu bildirimi üretirse saniyede milyonlarca event olur. Çözüm: aggregate read receipt — 'X kişi okudu' göster, kim okudu listesi lazy load. Veya sampling: sadece ilk 100 okuyanın receipt'ini sakla, geri kalanlar için '100+' göster. Telegram bu yaklaşımı kullanır",
        ],
        pitfalls: [
          "Gap detection ve re-fetch: client sequence 1,2,3,5 aldı — 4 kayıp. Client bu gap'i fark edip 'GET /messages?conv=X&seq=4' isteği atmalı. Eğer client bu kontrolü yapmazsa sessiz mesaj kaybı yaşanır. Implementasyon: her mesaj geldiğinde 'expected_seq = last_seq + 1, actual_seq = msg.seq' kontrol et, eşit değilse gap recovery başlat",
          "Group membership değişimi sırasında mesaj tutarsızlığı: kullanıcı gruba katıldığında geçmiş mesajları görebilmeli mi? WhatsApp: evet (gruba katılmadan önceki mesajlar görünür). Slack: sadece katıldıktan sonraki. Bu iş kararı teknik tasarımı etkiler: geçmiş görünürse tüm history erişilebilir ve arama sonuçlarında çıkmalı; görünmezse join timestamp'e göre mesajları filtrele",
          "Media mesaj koordinasyonu: büyük dosya (50MB video) websocket üzerinden transfer edilmez — presigned S3 URL ile direkt upload. Akış: (1) client 'POST /media/upload-url' ister, (2) server S3 presigned URL döner, (3) client S3'e direkt yükler, (4) upload tamamlanınca 'PATCH /media/{id}/complete' çağırır, (5) server mesajı {type:'media', url:'s3://...'} olarak gönderir. Başka kullanıcı tıkladığında presigned download URL üretilir (expiry: 1 saat)",
          "Şifreleme anahtarı yönetimi E2EE'de: Signal Protocol'de her cihazın bir Identity Key çifti var (uzun ömürlü) ve sürekli rotation'a uğrayan ephemeral key'ler (Double Ratchet). Grup şifrelemesi için: her grup üyesinin public key'i ile şifreleme yapılır — 1000 üyeli grupta 1000 ayrı şifreleme işlemi. Bu hem hesaplama hem bant genişliği maliyeti; büyük gruplar için Sender Keys optimizasyonu kullanılır (tek şifreleme, grup key dağıtımı)",
        ],
        steps: [
          { from: "bob",        to: "chat_api",   label: "GET /sync?after=seq:998 (reconnect)",  color: "#34d399", delay: 0 },
          { from: "chat_api",   to: "msg_db",     label: "SELECT * WHERE conv IN (...) AND seq > 998 LIMIT 100", color: "#22d3ee", delay: 800 },
          { from: "msg_db",     to: "chat_api",   label: "← 47 missed messages",                 color: "#22d3ee", delay: 1600 },
          { from: "chat_api",   to: "bob",        label: "batch: [msg999...msg1045]",             color: "#34d399", delay: 2400, note: "Cursor sync" },
          { from: "group_user", to: "chat_api",   label: "POST group:1000 {text:'Meeting now!'}",color: "#a78bfa", delay: 3600 },
          { from: "chat_api",   to: "fanout_q",   label: "enqueue fanout: 1000 members",         color: "#f97316", delay: 4400 },
          { from: "fanout_q",   to: "ws_servers", label: "push to 700 online members via WS",    color: "#34d399", delay: 5200 },
          { from: "fanout_q",   to: "push_svc",   label: "push notif to 300 offline members",    color: "#f472b6", delay: 5400 },
        ],
      },
    ],
  },

  autocomplete: {
    label: "Search Autocomplete",
    emoji: "🔎",
    accent: "#fbbf24",
    tagline: "Google / Bing arama önerisi",
    scales: "5M sorgu/sn · < 100ms · top-10 öneri",
    subsections: [
      {
        id: "trie_design",
        name: "Trie & Prefix Cache",
        problem: "Kullanıcı arama kutusuna her harf girdiğinde 100ms içinde 10 öneri gönderilmeli. 5M sorgu/saniye trafiği var — her karakter girişi için origin'e istek atmak imkânsız. Öneri nasıl bu kadar hızlı geliyor? Trie mi, inverted index mi, Redis ZSET mi? Trending arama 'ChatGPT' gibi bir şey anında nasıl #1 sıraya giriyor?",
        solution: "Servis katmanları: (1) Client-side debounce: her keystroke'ta değil, kullanıcı 150-300ms durduğunda istek gönder. Böylece istek sayısı 5-10x azalır. (2) CDN edge cache: kısa prefix'ler ('go', 'py', 'sy') global olarak aynı — CDN'de cache'le, TTL 60-300s. Hit rate %80+. (3) API katmanı: CDN miss'te Redis'e git. (4) Redis ZSET per prefix: 'syst:suggestions' key'inde sorted set, score = frekans, member = arama terimi. ZREVRANGEBYSCORE ile top-10 O(log N). Trie'ya göre üstünlük: Redis ZSET distributed, scale-out kolay, hot prefix'te replication otomatik. Trie memory'de daha verimli ama single-node sınırlı. Google ölçeğinde: custom trie implementation + RPC ile distributed serving. Mülakatta: Redis ZSET implementasyonu açıklanabilir ve yeterli.",
        whenToUse: [
          "Debounce + CDN önce: client 300ms bekler, CDN'de hit olursa origin'e hiç gitmez. Popüler prefix'ler ('the', 'how', 'wh') milyonlarca kullanıcı tarafından paylaşılır — CDN cache hit rate çok yüksek. Cache-Control: max-age=60 başlığı yeterli",
          "Redis ZSET prefix design: her prefix için ayrı key — 's', 'sy', 'sys', 'syst', 'syste', 'system'. Her key top-100 terimi saklar (top-10 dön ama personalization için 100 tut). Key başına bellek: 100 entry × 30 byte ortalama term = 3KB. 10M unique prefix × 3KB = 30GB — uygun boyut",
          "Typo tolerance için yaklaşımlar: (1) Edit distance ≤1 expansion — 'systm' → 'system' için tüm 1-edit-distance varyantları Redis'te ara, birleştir, tekrar rank. Maliyetli ama kaliteli. (2) N-gram index — karakterleri üçlü gruplara ayır ('sys', 'yst', 'ste') ve intersection ile eşleştir. (3) Phonetic hashing (Soundex/Metaphone) — telaffuz bazlı eşleştirme. Production'da genellikle (2) kullanılır",
          "Personalization overlay: global top-10 + kullanıcı önceki arama geçmişi merge edilir. Kullanıcı 'faruk' aradıysa 'f' yazınca 'faruk' önceliklenir. Redis'te per-user history sorted set: 'user:{id}:searches' ZSET, score=timestamp, member=query. Merge: global score × 0.7 + personal score × 0.3",
          "Max prefix derinliği sınırlaması: 30 karakter prefix için 30 ayrı Redis key var. Kullanıcı arama kutusuna 30+ karakter yazarsa (bu nadir) her karakter için key oluşturmak yerine max 12-15 karakterde kes — o noktada artık prefix değil full-text search gerekiyor, Elasticsearch'e geç",
        ],
        pitfalls: [
          "Cache invalidation hızı vs freshness: CDN TTL 60 saniye ise trending bir terim 60 saniye öneri listesine girmeyebilir. TTL 10 saniyeye çekersen CDN cache hit rate düşer, origin yükü artar. Çözüm: CDN stale-while-revalidate — eski öneriyi döndür ama arka planda cache'i güncelle (RFC 5861). Kullanıcı 60s eski öneriyi görür ama origin hiç flood olmaz",
          "Viral trending terimi gecikmesi: 'deprem' kelimesi tweet storm başladığında anında #1 olmalı. Batch update (günlük) çalışmaz. Çözüm: Flink 1 dakikalık tumbling window ile query count'ları toplar, eşik aşılınca (son 1 dakikada 10K'dan fazla aratıldıysa) Redis ZADD ile skoru update eder. Böylece viral terim 1-2 dakika içinde önerilere girer",
          "Prefix key explosion: tüm unique query prefix kombinasyonları için Redis key oluşturmak key sayısını patlatabilir. Örnek: 'system design interview questions' sorgusu 40 prefix üretir. 100M unique sorgu × 40 prefix × 3KB = 12TB Redis. Çözüm: sadece top-N (N=500K) frequent query için prefix key oluştur. Uzun kuyruk (long tail) sorgular için Elasticsearch full-text search'e düş",
          "Multi-language ve unicode karmaşıklığı: Türkçe 'şeker' için 'ş' karakterinin unicode normalizasyonu önemli. NFD vs NFC formları farklı byte dizileri üretir, aynı prefix farklı key'lere düşer. Çözüm: tüm query'leri kaydetmeden önce NFC normalize et, lowercase yap. Türkçe özel: 'İ' (büyük noktalı i) → 'i' (küçük) normalizasyonu, locale-aware toLower kullan (Java: str.toLowerCase(new Locale('tr', 'TR')))",
        ],
        steps: [
          { from: "user",     to: "browser",   label: "type: 'sys' (debounce 100ms)",         color: "#fbbf24", delay: 0 },
          { from: "browser",  to: "cdn_cache", label: "GET /suggest?q=sys",                    color: "#fbbf24", delay: 700 },
          { from: "cdn_cache",to: "browser",   label: "HIT: ['system design','syscall','sys*']",color: "#34d399", delay: 1400, note: "Edge cache" },
          { from: "user",     to: "browser",   label: "type: 'syst' (new prefix)",             color: "#fbbf24", delay: 2400 },
          { from: "browser",  to: "api",       label: "GET /suggest?q=syst (cache miss)",      color: "#fbbf24", delay: 3100 },
          { from: "api",      to: "redis",     label: "ZREVRANGE syst:suggestions 0 9",        color: "#f97316", delay: 3800 },
          { from: "redis",    to: "api",       label: "['system design','system call'...]",     color: "#34d399", delay: 4500 },
          { from: "api",      to: "cdn_cache", label: "cache prefix 'syst' TTL=60s",           color: "#fbbf24", delay: 5200 },
          { from: "api",      to: "browser",   label: "← top-10 suggestions",                  color: "#fbbf24", delay: 5900, note: "< 30ms total" },
        ],
      },
      {
        id: "indexing_pipeline",
        name: "Index Güncelleme Pipeline",
        problem: "Arama trendleri sürekli değişiyor. 'ChatGPT' kelimesi dün hiç aratılmıyordu, bugün milyonlarca kez aratıldı ve hemen önerilere girmeli. Günlük batch job 24 saat gecikme katıyor — kabul edilemez. Gerçek zamanlı index güncelleme pipeline'ı nasıl çalışır?",
        solution: "İki katmanlı güncelleme pipeline'ı: (1) Real-time streaming: her arama eventi Kafka'ya düşer. Flink 1 dakikalık tumbling window ile prefix bazlı count toplar. Eşik aşılınca (1 dakikada 1000+ arama) Redis'e ZINCRBY gönderir — öneri listesi anında güncellenir. (2) Günlük batch rebalance: gece Spark job tüm sorgu logunu okur, frekans hesaplar, tüm Redis key'lerini yeniden yazar — global ranking sıfırlanır, günlük drift düzeltilir. Bu iki katman birlikte çalışır: streaming real-time trending'i yakalar, batch doğruluk sağlar. Blue-green deployment: yeni Spark job çıktısı önce staging Redis'e yazılır, test edilir, sonra production Redis ile swap edilir — anlık geçiş, sıfır downtime.",
        whenToUse: [
          "Flink tumbling window seçimi: 1 dakikalık window — viral trendleri yakalar, noise'u filtreler. 10 saniyelik window çok agresif (bot trafiği trending'e girer), 10 dakikalık window çok yavaş (trending fırsat geçer). Window boyutu iş ihtiyacına göre A/B test ile belirlenir",
          "ZINCRBY vs ZADD: mevcut skoru artırmak için ZINCRBY kullan — 'ZINCRBY syst:suggestions 1000 system_design'. ZADD NX: sadece yeni term ekle. ZADD XX: sadece var olanı güncelle. Batch sonunda tüm prefix'ler için ZADD ile complete replacement yapılır",
          "Frekans decay: dünkü viral terim bugün relevance kaybetmeli. Çözüm: time-weighted score = count × decay_factor. Decay factor = 0.9^(hours_since_search). Flink'te watermark kullanarak geç gelen eventleri handle et. Günlük batch'te decay uygula: tüm skorları 0.7 ile çarp, yeni sayımları ekle",
          "Index build maliyet optimizasyonu: günlük 100M sorgu → Spark job. Prefix üretimi: her sorgu 'system design' için 's','sy','sys'...'system design' gibi prefix'ler üretir = O(query_length) prefix. 100M sorgu × ortalama 15 karakter = 1.5B prefix event. Spark partition'laması: prefix key'e göre partition → her executor kendi prefix grubunu aggregate eder, shuffle minimize",
        ],
        pitfalls: [
          "Frequency manipulation: bazı kullanıcılar kendi markalarının arama önerisinde çıkması için bot farm kurabilir. Önlem: (1) IP based deduplication — aynı IP'den 1 dakikada max 5 aynı sorgu say. (2) User session bazlı unique count — bot farklı IP'den gelse de session pattern'i anormal. (3) Anomaly detection: bir query'nin dakikalık büyüme hızı normalin 10x üstündeyse al, flag'le, manuel incelemeye al",
          "Snapshot consistency: Spark job uzun çalışır (2-4 saat) ve bu sürede streaming pipeline kendi Redis güncellemelerini yapmaya devam eder. Batch tamamlanınca Redis'i bulk overwrite ederse streaming güncellemeleri kaybedilir. Çözüm: batch staging Redis'e yazar, production'a geçerken streaming güncellemelerini de merge eder — son 1 saatlik streaming delta'yı batch sonucuna ekle",
          "Cold cache restart: Redis tamamen sıfırlandığında (crash, migration) tüm öneri listesi boş olur. Kullanıcıya boş öneri dönmek kötü deneyim. Çözüm: Redis başlarken S3'ten en son snapshot'ı yükle (warm-up script). Snapshot: günlük Spark job çıktısını S3'e RDB formatında yedekle. Warm-up süresi: 30GB index için ~5 dakika. Bu süre için read replica'lar devreye girer",
        ],
        steps: [
          { from: "users",     to: "search_api",  label: "1M 'chatgpt' queries in 1 hour",     color: "#fbbf24", delay: 0 },
          { from: "search_api",to: "kafka",       label: "log: query_events stream",            color: "#f97316", delay: 700 },
          { from: "kafka",     to: "flink",       label: "consume stream",                      color: "#f97316", delay: 1500 },
          { from: "flink",     to: "flink",       label: "tumbling window 1min: count prefixes", color: "#fb923c", delay: 2300, self: true },
          { from: "flink",     to: "redis",       label: "ZINCRBY cha:s 50000 'chatgpt'",       color: "#f97316", delay: 3100 },
          { from: "flink",     to: "redis",       label: "ZINCRBY chat:s 50000 'chatgpt'",      color: "#f97316", delay: 3300 },
          { from: "user",      to: "api",         label: "GET /suggest?q=chat",                 color: "#fbbf24", delay: 4300 },
          { from: "api",       to: "redis",       label: "ZREVRANGE chat:suggestions 0 9",      color: "#fbbf24", delay: 5000 },
          { from: "redis",     to: "api",         label: "['chatgpt'(#1!), 'chat'...]",         color: "#34d399", delay: 5700, note: "Trending #1'e girdi" },
        ],
      },
    ],
  },

  distributed_lock: {
    label: "Distributed Lock",
    emoji: "🔐",
    accent: "#f97316",
    tagline: "Redis SETNX · Redlock · Fencing Token",
    scales: "distributed systems · race condition önleme",
    subsections: [
      {
        id: "setnx",
        name: "Redis SETNX & Fencing",
        problem: "İki farklı sunucu aynı anda envanter azaltıyor: 'SELECT qty FROM inventory WHERE id=5' her ikisi de 10 görüyor, her ikisi de 10-1=9 yazıyor. Sonuç: 2 satış yapıldı ama envanter sadece 1 azaldı. Overselling. DB transaction yeterli değil mi? Neden distributed lock gerekiyor?",
        solution: "DB transaction tek sunucu içinde race condition'ı önler ama iki farklı process/sunucu farklı DB bağlantısıyla çalışıyorsa SELECT FOR UPDATE bile yetmez — farklı transaction'lar sıralı çalışmak zorunda ama her ikisi de aynı row'u lock'layıp birbirini bekler (deadlock) veya lock olmadan devam eder. Redis distributed lock: SET lock:inv:{id} {uuid} NX EX 30. NX (Not eXists): key yoksa yaz, varsa işlem başarısız. EX 30: 30 saniye TTL — process çökerse lock otomatik düşer. UUID value: hangi process lock'u aldı? Release sırasında önce GET yapıp kendi UUID'ini kontrol eder, eşleşiyorsa DEL yapar. Bu GET+DEL atomikliği için Lua script kullanılır — Redis single-threaded olduğu için Lua script başka komuta ara verilmez. Fencing token: her lock acquire'da Redis INCR ile artan sayı alınır; DB'ye yazarken bu token da gönderilir, DB 'son gördüğüm token'dan küçükse reject et' der — stale process eski tokenla zarar veremez.",
        whenToUse: [
          "SET NX EX atomikliği: eski yöntem SETNX + EXPIRE iki ayrı komuttu — aralarında process çökerse TTL atanmaz, lock sonsuza kilitli kalır. Doğru yöntem: SET key value NX EX seconds — tek atomik komut. Redis 2.6.12'den itibaren bu syntax mevcut",
          "UUID lock value neden önemli: sadece 'SET lock:res 1 NX EX 30' yapsan ve process 25. saniyede yavaşlayıp TTL expire olduktan sonra DEL yapmaya çalışsa başkasının lock'ını silersin. UUID ile: 'yalnızca benim UUID'im varsa DEL yap' — başkasının lock'ını asla silemezsin",
          "Lua script atomik release: IF redis.call('GET', KEYS[1]) == ARGV[1] THEN return redis.call('DEL', KEYS[1]) ELSE return 0 END. Bu script GET ve DEL arasında başka bir işlem giremez çünkü Redis Lua scriptleri single-threaded çalışır. Python redis-py ile: r.eval(lua_script, 1, lock_key, my_uuid)",
          "Fencing token kullanımı: lock alırken Redis INCR ile monoton artan token al. DB'ye yaz: 'UPDATE inventory SET qty=qty-1 WHERE id=5 AND last_fencing_token < {token}; UPDATE inventory SET last_fencing_token={token} WHERE id=5'. GC pause sonrası uyanan stale process daha küçük token'a sahip, DB yazmasını reddeder",
          "WatchDog / lock extension: işlem sürenin uzayacağını baştan bilmiyorsun. Çözüm: arka plan thread her TTL/3 saniyede bir 'EXPIRE lock:res 30' ile lock'ı extend eder. İşlem bitince thread durdurulur. Redisson (Java), SharpRedis (.NET) bu mekanizmayı built-in sunar",
        ],
        pitfalls: [
          "GC pause kaynaklı false expiry: process Java/Go/C#'ta garbage collection pause'a girdi, 35 saniye dondu. Lock TTL 30 saniyeydi, expire oldu. Başka process lock aldı ve işlemi yaptı. İlk process GC'den çıkıp devam etti — iki process aynı anda kritik section'da. TTL'yi ne kadar artırırsan artır bu riski sıfırlayamazsın (GC 10 dakika da sürebilir). Tek gerçek çözüm: fencing token ile DB tarafında da kontrol et",
          "Redis down durumu: lock alınamıyor. Sistem ne yapmalı? İki seçenek: (1) Fail-open: lock alamasan da işlemi yap (risk: race condition). (2) Fail-close: lock alamazsan 503 dön (risk: availability düşer). Kritik işlemler için fail-close + circuit breaker: Redis'e bağlanamıyorsa 'degraded mode'a geç, kullanıcıya hata ver, Redis recover edince normal moda dön",
          "Re-entrant lock tuzağı: aynı process kendi tuttuğu lock'ı tekrar almaya çalışıyor (özyinelemeli çağrı gibi). Basit SETNX ile bu deadlock'a girer. Çözüm: lock value'yu UUID yerine 'UUID:count' yap; aynı UUID tekrar gelince count'u artır, DEL yerine count azalt; count 0 olunca gerçekten DEL yap",
          "Lock granularity tasarımı: 'lock:inventory' gibi tek global lock tüm envanteri serialize eder — paralel işlem imkânsız. 'lock:inventory:{product_id}' ile ürün bazlı lock: farklı ürünler paralel işlenebilir, aynı ürün serialize edilir. Lock granularity küçüldükçe throughput artar ama lock yönetimi karmaşıklaşır ve deadlock riski artar (birden fazla lock alıyorsan sıralama protokolü şart)",
        ],
        steps: [
          { from: "process_a", to: "redis",     label: "SET lock:inv NX EX 30 value=uuid-A",   color: "#f97316", delay: 0 },
          { from: "redis",     to: "process_a", label: "OK — lock acquired (token=42)",         color: "#34d399", delay: 700 },
          { from: "process_b", to: "redis",     label: "SET lock:inv NX EX 30 value=uuid-B",   color: "#ef4444", delay: 1400 },
          { from: "redis",     to: "process_b", label: "nil — lock busy, retry after backoff",  color: "#ef4444", delay: 2100, note: "Bloke edildi" },
          { from: "process_a", to: "inventory_db", label: "UPDATE inv SET qty=qty-1 WHERE token>41", color: "#22d3ee", delay: 3000 },
          { from: "inventory_db",to:"process_a", label: "✓ updated (token accepted)",           color: "#22d3ee", delay: 3800 },
          { from: "process_a", to: "redis",     label: "Lua: GET→uuid-A match → DEL lock:inv", color: "#f97316", delay: 4600 },
          { from: "redis",     to: "process_a", label: "lock released",                         color: "#34d399", delay: 5300 },
          { from: "process_b", to: "redis",     label: "SET lock:inv NX EX 30 value=uuid-B",   color: "#f97316", delay: 6100, note: "Artık alabilir" },
        ],
      },
      {
        id: "redlock",
        name: "Redlock Algoritması",
        problem: "Tek Redis node çökünce tüm lock mekanizması devre dışı kalıyor. Redis Sentinel failover sırasında (30 saniye) lock alınamıyor. Ayrıca master-replica mimarisinde lock alındı, ACK gelmeden master çöktü ve replica'ya promote edildi — yeni master lock'ı bilmiyor, başka process aynı lock'ı alabiliyor. Bu kritik sistemlerde kabul edilemez. Çözüm?",
        solution: "Redlock algoritması (Martin Kleppmann tartışmalı bulsa da): N = 5 bağımsız Redis instance (replication değil, gerçekten izole). Her instance'a aynı anda SET lock:res UUID NX EX TTL gönderilir. Başarılı yanıt sayısı ⌊N/2⌋ + 1 = 3 veya üstüyse lock geçerli. Toplam geçen süre (t_elapsed) lock validity time'dan az olmalı: remaining_validity = TTL - t_elapsed - clock_drift_safety_margin. 2 node çökse bile 3/5 ile devam. Lock release: tüm N instance'a DEL gönder. Alternatifler: ZooKeeper ephemeral znode, etcd lease (Kubernetes'in kendi distributed lock mekanizması), PostgreSQL advisory lock.",
        whenToUse: [
          "5 bağımsız Redis instance gerekliliği: farklı fiziksel sunucularda, farklı availability zone'larda. Aynı sunucunun 5 Redis instance'ı değil — sunucu çökünce hepsi gider. 3 node ile de çalışır (quorum=2) ama 2'ye karşı tolerans azalır; production'da 5 önerilir",
          "Clock drift güvenlik payı: validity_time = TTL - t_acquire - clock_drift_factor. clock_drift_factor genellikle TTL'nin %10-20'si. Bu sayı küçüldükçe işlem için kalan pencere de küçülür — işlemi bu pencerede bitirmen gerekiyor",
          "Quorum başarısız olursa: 5 instance'tan 3'üne yazılamadıysa lock acquire başarısız sayılır ve yazılmış olan tüm instance'lardan sil (cleanup), sonra backoff ile retry. Cleanup kritik: yarım lock bırakırsan başka client quorum'a ulaşamaz",
          "ZooKeeper/etcd ne zaman Redlock'tan üstün: strict sequential consistency gereken durumlarda. etcd Raft consensus ile leader election yapıyor, split-brain imkânsız. Ekstra altyapı maliyetini göze alabiliyorsan etcd daha güvenli garanti verir",
        ],
        pitfalls: [
          "Martin Kleppmann'ın itirazı öğrenilmeli: Redlock'un güvenli olmadığını iddia ediyor çünkü clock assumption var. Senaryo: Process-1 lock aldı, uzun GC pause'a girdi, lock TTL doldu, Process-2 Redlock ile aynı lock'ı aldı, Process-1 GC'den çıkıp hâlâ lock'u olduğunu sanıyor. İki process aynı anda kritik section'da. Antirez'in yanıtı: bu senaryo single-node Redis'te de mümkün, fencing token ekleyerek çözülür. Sonuç: Redlock + fencing token birlikte kullan",
          "Node restart ve persistent lock: Redis instance restart olunca RAM'deki key'ler silinir (AOF olmadan). 5 instance'tan 2'si restart oldu, 3'ünde hâlâ lock var. Yeni bir client 3 instance'ta lock alamaz (eski lock var), diğer 2'sinde alır = 2/5 quorum yetersiz. Çözüm: AOF ile fsync=always — her write diske sync edilir, restart sonrası lock'lar korunur",
          "Redlock vs. Paxos/Raft farkı: Redlock quorum tabanlı ama consensus protokolü değil. Raft'ta leader seçimi kesin, split-brain imkânsız. Redlock'ta iki client aynı anda 3/5 quorum'a ulaşabilir (clock skew + timing) — teorik olarak mümkün. Finansal sistemlerde sıfır tolerans varsa ZooKeeper/etcd kullan",
          "Performance trade-off: 5 Redis node'a eş zamanlı request, en yavaş yanıt (P99) lock süresini belirler. Bir node yavaşlarsa (50ms) tüm lock acquire 50ms'ye çıkar. Timeout ekle: her node'a max 10ms bekle, timeout → o node'u failed say. Bu timeout clock drift hesabından düşülmeli",
        ],
        steps: [
          { from: "client",  to: "redis1",  label: "SET lock uuid NX EX 30",  color: "#f97316", delay: 0 },
          { from: "client",  to: "redis2",  label: "SET lock uuid NX EX 30",  color: "#f97316", delay: 100 },
          { from: "client",  to: "redis3",  label: "SET lock uuid NX EX 30",  color: "#f97316", delay: 200 },
          { from: "client",  to: "redis4",  label: "SET lock uuid NX EX 30",  color: "#f97316", delay: 300 },
          { from: "client",  to: "redis5",  label: "SET lock uuid NX EX 30",  color: "#f97316", delay: 400 },
          { from: "redis1",  to: "client",  label: "OK ✓",                    color: "#34d399", delay: 1100 },
          { from: "redis2",  to: "client",  label: "OK ✓",                    color: "#34d399", delay: 1200 },
          { from: "redis3",  to: "client",  label: "OK ✓",                    color: "#34d399", delay: 1300 },
          { from: "redis4",  to: "client",  label: "nil (down)",               color: "#ef4444", delay: 1400 },
          { from: "redis5",  to: "client",  label: "nil (timeout)",            color: "#ef4444", delay: 1500 },
          { from: "client",  to: "client",  label: "3/5 quorum ✓ lock acquired!", color: "#34d399", delay: 2300, self: true },
        ],
      },
    ],
  },

  pastebin: {
    label: "Pastebin / File Upload",
    emoji: "📋",
    accent: "#818cf8",
    tagline: "Blob storage · CDN · Deduplication",
    scales: "10M paste/gün · 100MB max · P99 upload < 2s",
    subsections: [
      {
        id: "upload_flow",
        name: "Upload & Deduplication",
        problem: "Aynı 50MB video dosyası 10.000 kullanıcı tarafından yükleniyor. Naif yaklaşım: her birini S3'e yeni obje olarak yaz = 500GB anlamsız depolama. Üstelik her upload app server'dan geçerse 50MB × 10.000 = 500GB bant genişliği kullanılır, uygulama sunucusu bottleneck olur. Hem deduplication hem bandwidth tasarrufu nasıl sağlanır?",
        solution: "Content-addressed storage: dosyanın SHA256 hash'i hesaplanır, bu hash storage key'i olur. Aynı content → aynı hash → S3'te tek kopya. Upload akışı: (1) Client tarayıcıda/uygulamada SHA256 hesaplar. (2) App server'a sadece hash + boyut + metadata gönderir. (3) App server DB'de hash'i arar: varsa presigned download URL'i anında döner, yükleme yok. (4) Yoksa S3 presigned upload URL üretir, client'a gönderir. (5) Client S3'e direkt yükler — app server'dan geçmez, bandwidth tasarrufu. (6) S3 upload tamamlanınca webhook → app server DB'ye metadata yazar. (7) Async virus scan tetiklenir. Reference counting: aynı S3 objesine birden fazla paste referans ediyor; silme sırasında sayacı azalt, 0 olunca S3'ten de sil.",
        whenToUse: [
          "Client-side SHA256 hesaplama: WebCrypto API (browser) veya native hash (mobil). 50MB dosya için ~200ms. Kullanıcı fark etmez. Bu hash sunucuya dosya gitmeden duplicate kontrolü yapılmasını sağlar",
          "Presigned URL güvenliği: PUT presigned URL — sadece o key'e, belirtilen content-type ile, max belirtilen süre içinde yükleme izni. Başka key'e yazamaz, başka format yükleyemez. URL sızarsa 15 dakikada otomatik expire",
          "S3 multipart upload: 5MB üstü dosyalar için. Dosya paralel chunk'lara bölünür, her chunk ayrı PUT, başarısız chunk retry edilir. 100MB dosya için: 10 × 10MB chunk, paralel upload → 3-5x hız artışı. NetworkError sonrası sıfırdan başlamak yerine sadece başarısız chunk'ları yeniden yükle",
          "Chunk-level deduplication: rsync algoritması. Dosyayı sabit boyutlu (Rabin fingerprint ile rolling hash → variable size) chunk'lara böl, her chunk ayrı hash. Aynı dosyanın %80'i daha önce yüklendiyse sadece %20'sini gönder. GitHub, Dropbox bu yaklaşımı kullanır",
          "Virus scan async pipeline: upload tamamlanınca S3 event → Lambda/worker tetiklenir → ClamAV/SentinelOne scan. Temizse: paste status → 'public'. Tehlikeliyse: S3 objesini quarantine bucket'a taşı, kullanıcıya bildir, DB'de 'quarantined' flag. Scan tamamlanana kadar paste 'processing' durumunda, dosyaya erişim yok",
        ],
        pitfalls: [
          "Hash hesaplama timing attack: iki farklı içerik için aynı SHA256 hash çıkması pratikte imkânsız (2^256 işlem gerekir) ama teorik collision için paranoyak kontrol: hash + dosya boyutu + ilk 1KB içerik karşılaştır. Güvenlik açısından: hash'i storage key olarak kullanmak güvenli ama access control ayrıca uygulanmalı — hash'i bilen herkes dosyaya erişebilir demek değil",
          "Presigned URL'yi client'tan direkt üretme hatası: bazı implementasyonlarda AWS credentials client'a gönderilerek client presigned URL üretiyor. Bu ciddi güvenlik açığı. Credentials her zaman sunucu tarafında, presigned URL sunucu tarafından üretilip client'a gönderilmeli",
          "Reference count race condition: iki kullanıcı aynı anda aynı hash'li dosyayı yüklüyor. Birinci duplicate check yapıyor: yok. İkinci de duplicate check yapıyor: yok. Her ikisi de S3'e yazıyor. DB'ye iki ayrı INSERT yapılıyor — ama bu sadece metadata fazlası, S3'te tek kopya. Sorun: birisi silerken reference count'u sıfıra indirip S3'ten silerse diğeri broken link alır. Çözüm: INSERT ON CONFLICT + atomic increment, silme sırasında transaction ile count azalt + 0 kontrolü",
          "Large file upload UX: kullanıcı 2GB dosya yüklerken tarayıcı sekmesi kapanırsa ne olur? Çözüm: resumable upload. S3 multipart upload ID sakla (localStorage), sekme tekrar açılınca kaldığı yerden devam et. Sunucu tarafında: 'LIST multipart uploads' ile yarım kalan upload'ları listele, 24 saat sonra temizle (S3 lifecycle policy)",
        ],
        steps: [
          { from: "client",    to: "app",      label: "POST /upload {sha256:'abc123', size:2MB}", color: "#818cf8", delay: 0 },
          { from: "app",       to: "meta_db",  label: "SELECT s3_key WHERE hash='abc123'",        color: "#22d3ee", delay: 700 },
          { from: "meta_db",   to: "app",      label: "null — new content",                       color: "#475569", delay: 1400 },
          { from: "app",       to: "s3",       label: "generate presigned URL (PUT /bucket/abc123)", color: "#f97316", delay: 2100 },
          { from: "s3",        to: "app",      label: "presignedUrl (expires 15min)",             color: "#f97316", delay: 2800 },
          { from: "app",       to: "client",   label: "← presignedUrl + pasteId",                color: "#818cf8", delay: 3500 },
          { from: "client",    to: "s3",       label: "PUT presignedUrl (direct upload, 2MB)",    color: "#f97316", delay: 4300, note: "App server'dan geçmez" },
          { from: "s3",        to: "app",      label: "upload complete webhook",                  color: "#f97316", delay: 5300 },
          { from: "app",       to: "meta_db",  label: "INSERT paste(id, hash, s3_key, userId)",   color: "#22d3ee", delay: 6000 },
          { from: "app",       to: "virus_scan", label: "async: scan(s3_key)",                   color: "#ef4444", delay: 6700, note: "Async scan" },
        ],
      },
      {
        id: "cdn_serving",
        name: "CDN & Access Control",
        problem: "Bir paste public olabilir (herkes görebilir) veya private (sadece link sahibi). Public paste CDN'den serve edilmeli — ama private paste CDN'de cache'lenirse herkes URL'yi bilirse erişebilir. Silinen bir içerik CDN'de cache'liyse kullanıcı silen kişi olsa da görmeye devam ediyor. Bu üç senaryoyu nasıl handle ederiz?",
        solution: "Public paste için: S3 objesine public-read ACL + Content-addressed URL (hash = URL). CDN'e Cache-Control: public, max-age=31536000, immutable gönder. İmmutable direktifi: bu içerik asla değişmez, sonsuza cache'le. Hash değişmeden içerik değişemez (content-addressed), bu yüzden immutable güvenli. Private paste için: S3 objesine private ACL. Erişim sadece CloudFront signed URL ile. Signed URL = URL + expiry + signature (CloudFront private key ile). Signature expire olunca CDN erişimi reddeder — hiçbir CDN node'u cache'i döndürmez. Silme akışı: S3 objesini sil (veya private yap) + CloudFront invalidation API ile cache temizle. Invalidation 10-60 saniye sürer — bu pencerede cached kopyaya hâlâ erişilebilir. Gerçek zamanlı silme için: S3 soft delete (deleted_at) + CDN origin request handler (Lambda@Edge ile: origin'e her istekte 'deleted_at null mu?' kontrol et).",
        whenToUse: [
          "CloudFront Signed URL vs Signed Cookie farkı: Signed URL — tek bir dosya için, URL'ye yerleşik imza. Signed Cookie — birden fazla dosya için (playlist, video parçaları), tüm domain için geçerli. Pastebin için Signed URL yeterli; Netflix HLS streaming gibi çok parçalı içerik için Signed Cookie",
          "Cache-Control: immutable + content hash: hash değişmeden içerik değişemez. Bu yüzden TTL'yi 1 yıl koy ve immutable direktifi ekle. Browser ve CDN bu dosyayı hiç yenilememesini bilir. Versiyon değişince yeni hash = yeni URL = otomatik cache bust. Bu pattern CSS/JS bundle'larında da kullanılır",
          "Lambda@Edge ile dynamic access control: CloudFront'un her origin request'te bir Lambda function çalıştırılabilir. Bu Lambda DB'ye bakıp 'bu paste silindi mi? Bu kullanıcının erişim hakkı var mı?' kontrol eder. Miss → 403. Hit → S3'ten serve et. Latency: Lambda@Edge ~5-10ms. Çok sık erişilen paste'ler için bu check'i de cache'le (1 dakika TTL)",
          "Geo-restriction: bazı içerikler belirli ülkelerde yasal olarak kısıtlı (telif hakkı, GDPR, yerel yasa). CloudFront geo-restriction özelliği ile ülke bazlı erişimi IP'ye göre engelle. Daha granüler kontrol için Lambda@Edge + MaxMind GeoIP",
          "GDPR silme süreci: kullanıcı 'hesabımı sil' dedi. İçerik S3'ten silinmeli + CDN cache temizlenmeli + DB'den metadata silinmeli + log'lardan PII temizlenmeli. Bu adımların senkronizasyonu için saga pattern veya outbox pattern kullan. GDPR 30 gün içinde silme zorunluluğu koyar — compliance log tut",
        ],
        pitfalls: [
          "CDN invalidation gecikmesi kritik senaryo: kullanıcı yanlışlıkla şifre içeren bir dosya yükledi, hemen sildi. Ama CDN'deki kopya 60 saniye daha erişilebilir. Bu 60 saniyede web crawler'lar veya özel toollar dosyayı bulabilir. Çözüm: hassas içerik için CDN'de cache'leme — 'Cache-Control: no-store, no-cache' ile CDN'i devre dışı bırak, her request origin'e gitsin. Performans maliyeti var ama güvenlik kazanımı önemli",
          "Signed URL abuse ve sharing: private paste için signed URL 1 saat geçerliyse, alan kişi bu URL'yi başkasıyla paylaşabilir. 1 saat boyunca anyone with the URL erişebilir. Çözüm: (1) IP restriction ekle (CloudFront'un destekliği). (2) TTL'yi kısalt (15 dakika). (3) Her erişimde yeni signed URL üret (single-use token). Trade-off: kısa TTL = daha sık token üretimi = daha fazla origin yükü",
          "S3 Object Versioning ile soft delete: S3 bucket'ta versioning aktif olunca bir obje silinince delete marker eklenir ama önceki versiyonlar korunur. Bu GDPR'la çelişebilir: kullanıcı sildi ama S3'te hâlâ var. Çözüm: versioning'i kullanıyorsan silme sonrası tüm versiyonları da sil veya lifecycle policy ile 30 günde tamamen temizle",
          "Origin Shield maliyet tuzağı: CloudFront'un Origin Shield özelliği cache miss'lerde tüm edge location'ların tek bir 'shield' PoP üzerinden origin'e gitmesini sağlar — origin yükünü azaltır. Ama her Origin Shield request'i ayrıca faturalandırılır. Yüksek cache hit rate'i olan (immutable content) servislerde Origin Shield net maliyet artışı yaratabilir — aktifleştirmeden önce hesapla",
        ],
        steps: [
          { from: "user",     to: "app",      label: "GET /paste/abc123 (public)",              color: "#818cf8", delay: 0 },
          { from: "app",      to: "meta_db",  label: "SELECT * WHERE pasteId='abc123'",          color: "#22d3ee", delay: 700 },
          { from: "meta_db",  to: "app",      label: "{s3_key:'abc123', public:true}",           color: "#22d3ee", delay: 1400 },
          { from: "app",      to: "user",     label: "302 → cdn.example.com/abc123",             color: "#818cf8", delay: 2100 },
          { from: "user",     to: "cdn",      label: "GET cdn.example.com/abc123",               color: "#fbbf24", delay: 2900 },
          { from: "cdn",      to: "user",     label: "HIT: content (Cache-Control: immutable)",  color: "#34d399", delay: 3600, note: "S3'e gidilmedi" },
          { from: "owner",    to: "app",      label: "DELETE /paste/abc123",                     color: "#ef4444", delay: 4800 },
          { from: "app",      to: "s3",       label: "DELETE s3://bucket/abc123",                color: "#f97316", delay: 5500 },
          { from: "app",      to: "cdn",      label: "CloudFront: createInvalidation /abc123",   color: "#fbbf24", delay: 6200 },
          { from: "cdn",      to: "app",      label: "invalidation queued (10-60s)",             color: "#fbbf24", delay: 7000, note: "Gecikmeli temizlik" },
        ],
      },
    ],
  },
};

// ══════════════════════════════════════════════════════════════
// NODE LAYOUTS
// ══════════════════════════════════════════════════════════════
const LAYOUTS = {
  write_flow:       { nodes: [{ id:"client",x:50,y:160,color:"#94a3b8",label:"Client"},{id:"api",x:190,y:160,color:"#38bdf8",label:"API"},{id:"cache",x:320,y:80,color:"#fbbf24",label:"Redis\nCache"},{id:"hasher",x:320,y:160,color:"#818cf8",label:"Hasher"},{id:"db",x:320,y:260,color:"#22d3ee",label:"URL DB"}]},
  redirect_flow:    { nodes: [{ id:"browser",x:50,y:160,color:"#94a3b8",label:"Browser"},{id:"cdn",x:190,y:160,color:"#38bdf8",label:"CDN\nEdge"},{id:"redis",x:350,y:100,color:"#fbbf24",label:"Redis"},{id:"kafka",x:470,y:100,color:"#f97316",label:"Kafka"},{id:"analytics",x:580,y:100,color:"#818cf8",label:"Analytics"},{id:"origin",x:350,y:240,color:"#22d3ee",label:"Origin\nServer"}]},
  scale:            { nodes: [{ id:"browser",x:40,y:160,color:"#94a3b8",label:"Browser"},{id:"cloudflare",x:180,y:160,color:"#f97316",label:"Cloudflare\nCDN"},{id:"redis_cluster",x:360,y:90,color:"#fbbf24",label:"Redis\nCluster"},{id:"db_shard",x:360,y:250,color:"#22d3ee",label:"DB Shards"}]},
  fanout:           { nodes: [{ id:"celebrity",x:40,y:80,color:"#f472b6",label:"Celebrity"},{id:"api",x:180,y:80,color:"#f472b6",label:"API"},{id:"tweet_db",x:320,y:40,color:"#22d3ee",label:"Tweet\nDB"},{id:"fan_svc",x:320,y:120,color:"#818cf8",label:"Fanout\nService"},{id:"follow_db",x:460,y:80,color:"#60a5fa",label:"Follow\nDB"},{id:"msg_queue",x:460,y:180,color:"#f97316",label:"Message\nQueue"},{id:"inbox_workers",x:580,y:180,color:"#fbbf24",label:"Workers"},{id:"normal_user",x:40,y:280,color:"#94a3b8",label:"User"},{id:"feed_api",x:180,y:280,color:"#f472b6",label:"Feed\nAPI"},{id:"redis",x:320,y:280,color:"#fbbf24",label:"Redis\nInbox"}]},
  multi_channel:    { nodes: [{ id:"trigger",x:40,y:160,color:"#94a3b8",label:"Trigger"},{id:"notif_svc",x:180,y:160,color:"#f472b6",label:"Notif\nService"},{id:"user_pref",x:320,y:80,color:"#818cf8",label:"User\nPrefs"},{id:"push_q",x:320,y:160,color:"#38bdf8",label:"Push\nQueue"},{id:"email_q",x:320,y:240,color:"#fbbf24",label:"Email\nQueue"},{id:"fcm",x:480,y:130,color:"#60a5fa",label:"FCM"},{id:"sendgrid",x:480,y:250,color:"#34d399",label:"SendGrid"}]},
  feed_generation:  { nodes: [{ id:"user_a",x:40,y:160,color:"#a78bfa",label:"User A"},{id:"post_api",x:170,y:160,color:"#a78bfa",label:"Post\nAPI"},{id:"post_db",x:300,y:80,color:"#22d3ee",label:"Post\nDB"},{id:"fanout_q",x:300,y:180,color:"#f97316",label:"Fanout\nQueue"},{id:"graph_db",x:430,y:100,color:"#60a5fa",label:"Social\nGraph DB"},{id:"redis",x:430,y:220,color:"#fbbf24",label:"Redis\nInbox"},{id:"user_b",x:560,y:120,color:"#94a3b8",label:"User B"},{id:"feed_api",x:480,y:160,color:"#a78bfa",label:"Feed\nAPI"},{id:"post_db2",x:560,y:250,color:"#22d3ee",label:"Post\nDB"}]},
  ranking:          { nodes: [{ id:"user",x:50,y:160,color:"#94a3b8",label:"User"},{id:"feed_api",x:190,y:160,color:"#a78bfa",label:"Feed\nAPI"},{id:"candidate",x:340,y:80,color:"#818cf8",label:"Candidate\nRetrieval"},{id:"feature_store",x:500,y:80,color:"#60a5fa",label:"Feature\nStore"},{id:"ranker",x:500,y:200,color:"#34d399",label:"ML\nRanker"},{id:"diversity",x:340,y:280,color:"#fbbf24",label:"Diversity\nFilter"}]},
  message_flow:     { nodes: [{ id:"alice",x:40,y:120,color:"#34d399",label:"Alice"},{id:"bob",x:580,y:120,color:"#34d399",label:"Bob"},{id:"chat_srv_a",x:170,y:120,color:"#22d3ee",label:"Chat\nSrv-A"},{id:"chat_srv_b",x:450,y:120,color:"#22d3ee",label:"Chat\nSrv-B"},{id:"msg_db",x:280,y:240,color:"#60a5fa",label:"Message\nDB"},{id:"kafka",x:350,y:120,color:"#f97316",label:"Kafka"},{id:"presence",x:350,y:260,color:"#818cf8",label:"Presence\nService"}]},
  offline_sync:     { nodes: [{ id:"bob",x:40,y:120,color:"#34d399",label:"Bob\n(offline→on)"},{id:"chat_api",x:200,y:120,color:"#22d3ee",label:"Chat\nAPI"},{id:"msg_db",x:380,y:80,color:"#60a5fa",label:"Message\nDB"},{id:"group_user",x:40,y:270,color:"#a78bfa",label:"Group\nUser"},{id:"fanout_q",x:350,y:200,color:"#f97316",label:"Fanout\nQueue"},{id:"ws_servers",x:530,y:160,color:"#34d399",label:"WS\nServers"},{id:"push_svc",x:530,y:270,color:"#f472b6",label:"Push\nService"}]},
  trie_design:      { nodes: [{ id:"user",x:40,y:160,color:"#94a3b8",label:"User"},{id:"browser",x:170,y:160,color:"#fbbf24",label:"Browser"},{id:"cdn_cache",x:320,y:80,color:"#f97316",label:"CDN\nCache"},{id:"api",x:320,y:200,color:"#fbbf24",label:"Suggest\nAPI"},{id:"redis",x:490,y:200,color:"#ef4444",label:"Redis\nZSET"}]},
  indexing_pipeline:{ nodes: [{ id:"users",x:40,y:160,color:"#94a3b8",label:"Users"},{id:"search_api",x:170,y:160,color:"#fbbf24",label:"Search\nAPI"},{id:"kafka",x:310,y:160,color:"#f97316",label:"Kafka"},{id:"flink",x:450,y:160,color:"#fb923c",label:"Flink\nStream"},{id:"redis",x:590,y:160,color:"#ef4444",label:"Redis\nZSET"},{id:"user",x:310,y:290,color:"#94a3b8",label:"User"},{id:"api",x:450,y:290,color:"#fbbf24",label:"API"}]},
  setnx:            { nodes: [{ id:"process_a",x:50,y:100,color:"#f97316",label:"Process\nA"},{id:"process_b",x:50,y:260,color:"#ef4444",label:"Process\nB"},{id:"redis",x:260,y:180,color:"#ef4444",label:"Redis\nLock"},{id:"inventory_db",x:460,y:160,color:"#22d3ee",label:"Inventory\nDB"}]},
  redlock:          { nodes: [{ id:"client",x:50,y:160,color:"#f97316",label:"Client"},{id:"redis1",x:230,y:60,color:"#ef4444",label:"Redis-1"},{id:"redis2",x:350,y:60,color:"#ef4444",label:"Redis-2"},{id:"redis3",x:470,y:60,color:"#ef4444",label:"Redis-3"},{id:"redis4",x:350,y:200,color:"#475569",label:"Redis-4\n(down)"},{id:"redis5",x:470,y:200,color:"#475569",label:"Redis-5\n(timeout)"}]},
  upload_flow:      { nodes: [{ id:"client",x:40,y:160,color:"#94a3b8",label:"Client"},{id:"app",x:200,y:160,color:"#818cf8",label:"App\nServer"},{id:"meta_db",x:370,y:80,color:"#22d3ee",label:"Meta\nDB"},{id:"s3",x:540,y:160,color:"#f97316",label:"S3\nStorage"},{id:"virus_scan",x:370,y:270,color:"#ef4444",label:"Virus\nScanner"}]},
  cdn_serving:      { nodes: [{ id:"user",x:40,y:120,color:"#94a3b8",label:"User"},{id:"owner",x:40,y:270,color:"#818cf8",label:"Owner"},{id:"app",x:200,y:190,color:"#818cf8",label:"App\nServer"},{id:"meta_db",x:370,y:120,color:"#22d3ee",label:"Meta\nDB"},{id:"cdn",x:500,y:120,color:"#fbbf24",label:"CDN\nEdge"},{id:"s3",x:500,y:270,color:"#f97316",label:"S3"}]},
};

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
const SYS_ORDER = ["url_shortener","notification","news_feed","chat","autocomplete","distributed_lock","pastebin"];

function SystemDesignSimInner() {
  const [sysId, setSysId] = useState("url_shortener");
  const [subIdx, setSubIdx] = useState(0);
  const [animStep, setAnimStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef([]);

  const sys = SYSTEMS[sysId];
  const sub = sys.subsections[subIdx];
  const accent = sys.accent;

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const switchSys = (id) => { clearTimers(); setSysId(id); setSubIdx(0); setAnimStep(-1); setRunning(false); setDone(false); };
  const switchSub = (i) => { clearTimers(); setSubIdx(i); setAnimStep(-1); setRunning(false); setDone(false); };

  const run = useCallback(() => {
    const steps = SYSTEMS[sysId].subsections[subIdx].steps;
    clearTimers(); setAnimStep(-1); setRunning(true); setDone(false);
    steps.forEach((s, i) => {
      const t = setTimeout(() => {
        setAnimStep(i);
        if (i === steps.length - 1) setTimeout(() => { setRunning(false); setDone(true); }, 700);
      }, s.delay);
      timers.current.push(t);
    });
  }, [sysId, subIdx]);

  useEffect(() => () => clearTimers(), []);

  const layoutKey = (() => {
    const id = sub.id;
    if (LAYOUTS[id]) return id;
    return Object.keys(LAYOUTS)[0];
  })();

  const activeSteps = animStep >= 0 ? sub.steps.slice(0, animStep + 1) : [];

  return (
    <div style={C.root}>
      <div style={C.bg} />

      {/* HEADER */}
      <header style={C.header}>
        <div style={C.hLeft}>
          <span style={{ ...C.hDot, background: accent }} />
          <span style={C.hTitle}>System Design Interview</span>
          <span style={C.hSub}>Simülatör · {SYS_ORDER.length} Soru · Adım Adım</span>
        </div>
        <div style={{ ...C.hTag, color: accent, borderColor: accent + "44", background: accent + "11" }}>
          {sys.emoji} {sys.label} · {sys.scales}
        </div>
      </header>

      {/* SYSTEM NAV */}
      <nav style={C.sysNav}>
        {SYS_ORDER.map(id => {
          const s = SYSTEMS[id];
          return (
            <button key={id} onClick={() => switchSys(id)} style={{
              ...C.sysBtn,
              ...(sysId === id ? { borderColor: s.accent, color: s.accent, background: s.accent + "12", boxShadow: `0 0 18px ${s.accent}44` } : {}),
            }}>
              <span>{s.emoji}</span>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                <span style={{ fontSize: 10, fontWeight: 700 }}>{s.label}</span>
                <span style={{ fontSize: 8, color: sysId === id ? s.accent + "aa" : "#1e3a5f" }}>{s.tagline}</span>
              </div>
            </button>
          );
        })}
      </nav>

      {/* SUB NAV */}
      <div style={C.subNav}>
        {sys.subsections.map((s, i) => (
          <button key={s.id} onClick={() => switchSub(i)} style={{
            ...C.subBtn,
            ...(subIdx === i ? { borderColor: accent, color: "#f1f5f9", background: accent + "18" } : {}),
          }}>{s.name}</button>
        ))}
      </div>

      {/* BODY */}
      <div style={C.body}>

        {/* LEFT */}
        <aside style={C.left}>
          <div style={{ ...C.card, borderColor: accent + "44" }}>
            <div style={{ ...C.lbl, color: accent }}>⚠ Problem</div>
            <p style={C.txt}>{sub.problem}</p>
          </div>
          <div style={{ ...C.card, borderColor: "#0f2845" }}>
            <div style={C.lbl}>✦ Tasarım</div>
            <p style={C.txt}>{sub.solution}</p>
          </div>
          <div style={C.listCard}>
            <div style={C.lbl}>✓ Temel Kararlar</div>
            {sub.whenToUse.map((w, i) => (
              <div key={i} style={C.row}>
                <span style={{ color: "#34d399", flexShrink: 0, marginTop: 1 }}>›</span>
                <span style={C.rowTxt}>{w}</span>
              </div>
            ))}
          </div>
          <div style={C.listCard}>
            <div style={C.lbl}>⚡ Dikkat / Trade-off</div>
            {sub.pitfalls.map((p, i) => (
              <div key={i} style={C.row}>
                <span style={{ color: "#f97316", flexShrink: 0, marginTop: 1 }}>›</span>
                <span style={C.rowTxt}>{p}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* CENTER */}
        <main style={C.center}>
          {/* SVG Diagram */}
          <FlowDiagram layout={LAYOUTS[layoutKey]} steps={sub.steps} animStep={animStep} accent={accent} />

          {/* Controls */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={run} disabled={running} style={{
              ...C.runBtn,
              background: running ? "transparent" : accent,
              color: running ? accent : "#060d1b",
              borderColor: accent,
              boxShadow: running ? "none" : `0 0 28px ${accent}77`,
            }}>{running ? "⟳ Simüle ediliyor..." : done ? "↺ Tekrar Çalıştır" : "▶ Simülasyonu Başlat"}</button>
            {done && <span style={{ color: accent, fontSize: 11, fontWeight: 700 }}>✓ {sub.steps.length} adım tamamlandı</span>}
          </div>

          {/* Step log */}
          <div style={C.log}>
            {activeSteps.length === 0 && (
              <div style={C.logEmpty}>Simülasyonu başlatmak için ▶ butonuna bas</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {activeSteps.map((s, i) => {
                const isLast = i === animStep;
                return (
                  <div key={i} style={{
                    ...C.logRow,
                    borderLeftColor: s.color,
                    background: isLast ? s.color + "12" : "transparent",
                    opacity: isLast ? 1 : 0.55,
                  }}>
                    <span style={{ color: s.color, fontWeight: 800, fontSize: 9, minWidth: 60 }}>{s.from?.toUpperCase()}</span>
                    <span style={{ color: "#1e3a5f", fontSize: 9 }}>──▶</span>
                    <span style={{ color: "#64748b", fontWeight: 600, fontSize: 9, minWidth: 60 }}>{s.to?.toUpperCase()}</span>
                    <span style={{ color: "#334155", fontSize: 9, flex: 1 }}>{s.label.substring(0, 55)}</span>
                    {s.note && <span style={{ color: s.color + "cc", fontSize: 9, fontWeight: 700, marginLeft: 4 }}>← {s.note}</span>}
                  </div>
                );
              })}
            </div>
            {done && <div style={{ color: accent, fontSize: 10, fontWeight: 800, borderTop: `1px solid ${accent}22`, paddingTop: 6, marginTop: 4 }}>✓ Akış tamamlandı</div>}
          </div>
        </main>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// FLOW DIAGRAM
// ══════════════════════════════════════════════════════════════
function FlowDiagram({ layout, steps, animStep, accent }) {
  const W = 640, H = 340;
  if (!layout?.nodes) return null;
  const { nodes } = layout;
  const posMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const activeSteps = animStep >= 0 ? steps.slice(0, animStep + 1) : [];
  const current = animStep >= 0 ? steps[animStep] : null;

  function arrow(fId, tId) {
    const a = posMap[fId], b = posMap[tId];
    if (!a || !b) return null;
    const dx = b.x-a.x, dy = b.y-a.y, len = Math.sqrt(dx*dx+dy*dy)||1, pad = 26;
    return { x1:a.x+dx/len*pad, y1:a.y+dy/len*pad, x2:b.x-dx/len*pad, y2:b.y-dy/len*pad };
  }

  const uniqueEdges = [...new Set(
    steps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map(s => `${s.from}|${s.to}`)
  )];

  return (
    <div style={C.svgWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"100%" }}>
        <defs>
          <filter id="glow5"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <marker id="arr5" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill={accent}/></marker>
          <marker id="arr5d" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill="#0f2845"/></marker>
        </defs>

        {/* Ghost edges */}
        {uniqueEdges.map((key, i) => {
          const [f, t] = key.split("|");
          const ln = arrow(f, t);
          return ln ? <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke="#091929" strokeWidth="1.5" strokeDasharray="3 6" markerEnd="url(#arr5d)"/> : null;
        })}

        {/* Active lines */}
        {activeSteps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map((s, i) => {
          const ln = arrow(s.from, s.to);
          if (!ln) return null;
          const isLast = i === animStep;
          const c = s.color || accent;
          const mx=(ln.x1+ln.x2)/2, my=(ln.y1+ln.y2)/2;
          return (
            <g key={`ln-${i}`}>
              <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                stroke={c} strokeWidth={isLast?2.8:1.2} opacity={isLast?1:0.3}
                markerEnd="url(#arr5)"
                filter={isLast?"url(#glow5)":undefined}
              />
              {isLast && (
                <>
                  <rect x={mx-68} y={my-17} width={136} height={14} rx={3} fill="#040b16" opacity="0.92"/>
                  <text x={mx} y={my-6} textAnchor="middle" fill={c} fontSize="8" fontWeight="700" fontFamily="monospace">{s.label.substring(0,38)}</text>
                </>
              )}
            </g>
          );
        })}

        {/* Self steps */}
        {activeSteps.filter(s => s.self && posMap[s.from]).map((s, i) => {
          const n = posMap[s.from];
          const isLast = steps.indexOf(s) === animStep;
          return (
            <text key={`sf-${i}`} x={n.x} y={n.y-40} textAnchor="middle"
              fill={s.color} fontSize="8.5" fontWeight="800" fontFamily="monospace"
              filter={isLast?"url(#glow5)":undefined}>
              {s.label.substring(0, 40)}
            </text>
          );
        })}

        {/* Nodes */}
        {nodes.map(n => {
          const isActive = current && !current.self && (current.from===n.id || current.to===n.id);
          const lines = n.label.split("\n");
          return (
            <g key={n.id}>
              {isActive && <circle cx={n.x} cy={n.y} r={32} fill={n.color+"12"}/>}
              <circle cx={n.x} cy={n.y} r={22} fill="#040b16"
                stroke={isActive ? n.color : n.color+"44"}
                strokeWidth={isActive ? 2.5 : 1.5}
                filter={isActive ? "url(#glow5)" : undefined}
              />
              {lines.map((ln, li) => (
                <text key={li} x={n.x} y={n.y+(lines.length===1?4:li*10-2)}
                  textAnchor="middle" fill={isActive?n.color:n.color+"77"}
                  fontSize="8" fontWeight="700" fontFamily="monospace">{ln}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════════
const C = {
  root: { minHeight:"100vh", background:"#040b16", color:"#e2e8f0", fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace", display:"flex", flexDirection:"column", position:"relative" },
  bg: { position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
    backgroundImage:"linear-gradient(rgba(56,189,248,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,0.025) 1px,transparent 1px)",
    backgroundSize:"40px 40px" },
  header: { position:"relative", zIndex:1, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 24px", borderBottom:"1px solid #0a1f35", background:"#040b16" },
  hLeft: { display:"flex", alignItems:"center", gap:8 },
  hDot: { width:9, height:9, borderRadius:"50%", flexShrink:0 },
  hTitle: { fontSize:15, fontWeight:800, color:"#f1f5f9" },
  hSub: { fontSize:9, color:"#1e3a5f", letterSpacing:2, marginLeft:6 },
  hTag: { fontSize:9, fontWeight:700, padding:"4px 12px", borderRadius:20, border:"1px solid", letterSpacing:0.5, maxWidth:380, textAlign:"right" },
  sysNav: { position:"relative", zIndex:1, display:"flex", gap:4, padding:"8px 24px", borderBottom:"1px solid #0a1f35", overflowX:"auto", flexWrap:"nowrap" },
  sysBtn: { display:"flex", alignItems:"center", gap:8, padding:"7px 14px", borderRadius:7, border:"1px solid #0a1f35", background:"transparent", cursor:"pointer", color:"#1e3a5f", fontFamily:"inherit", transition:"all 0.2s", flexShrink:0 },
  subNav: { position:"relative", zIndex:1, display:"flex", gap:4, padding:"6px 24px", borderBottom:"1px solid #0a1f35", flexWrap:"wrap" },
  subBtn: { padding:"5px 14px", borderRadius:5, border:"1px solid #0a1f35", background:"transparent", cursor:"pointer", color:"#334155", fontFamily:"inherit", fontSize:10, fontWeight:700, transition:"all 0.15s" },
  body: { position:"relative", zIndex:1, display:"flex", flex:1 },
  left: { width:310, flexShrink:0, padding:"14px", borderRight:"1px solid #0a1f35", display:"flex", flexDirection:"column", gap:8, overflowY:"auto" },
  card: { background:"#060f1e", borderRadius:7, padding:"10px 12px", border:"1px solid" },
  lbl: { fontSize:8, fontWeight:800, letterSpacing:2, color:"#1e3a5f", marginBottom:6, textTransform:"uppercase" },
  txt: { fontSize:11, color:"#64748b", lineHeight:1.9, margin:0 },
  listCard: { background:"#060f1e", borderRadius:7, padding:"10px 12px", border:"1px solid #0a1f35", display:"flex", flexDirection:"column", gap:6 },
  row: { display:"flex", gap:6, alignItems:"flex-start" },
  rowTxt: { fontSize:11, color:"#475569", lineHeight:1.75 },
  center: { flex:1, padding:"14px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:12, overflowY:"auto" },
  svgWrap: { width:"100%", maxWidth:660, background:"#060f1e", borderRadius:10, border:"1px solid #0a1f35", aspectRatio:"640/340", overflow:"hidden" },
  runBtn: { padding:"10px 32px", borderRadius:7, border:"1px solid", fontFamily:"inherit", fontSize:11, fontWeight:800, letterSpacing:1.5, cursor:"pointer", transition:"all 0.2s", textTransform:"uppercase" },
  log: { width:"100%", maxWidth:660, background:"#060f1e", borderRadius:8, border:"1px solid #0a1f35", padding:"10px 14px", maxHeight:220, overflowY:"auto" },
  logEmpty: { fontSize:9, color:"#0a1f35", fontStyle:"italic" },
  logRow: { display:"flex", gap:6, alignItems:"center", padding:"3px 6px 3px 8px", borderLeft:"2px solid", borderRadius:"0 3px 3px 0", transition:"all 0.25s", flexWrap:"wrap" },
};

export default function SystemDesignSim() {
  return (
    <>
      <Nav />
      <div style={{ paddingTop: 48 }}>
        <SystemDesignSimInner />
      </div>
    </>
  )
}
