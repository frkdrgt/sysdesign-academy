# SysDesign Academy

**Sistem tasarımı desenlerini animasyonlu simülasyonlarla öğren.**

Mikroservislerden Zero Trust'a, Kafka'dan PostgreSQL MVCC'ye — her desen adım adım akış diyagramı, derinlemesine trade-off analizi ve interaktif simülasyonla. Sistem tasarımı mülakatlarına hazırlanmak veya üretim kararlarını pekiştirmek için tasarlandı.

🔗 **[sysdesign-academy-phi](https://sysdesign-academy-phi.vercel.app/)** *(deploy sonrası güncellenecek)*

---

## İçerik

### 1. Mikroservis Desenleri
API Gateway, Circuit Breaker, Saga Pattern, CQRS, Event Sourcing. Her desen için başarılı akış ve hata senaryosu ayrı ayrı simüle edilir.

### 2. Güvenilirlik Desenleri
Transactional Outbox, Idempotency, Dead Letter Queue, Delivery Guarantees (at-most-once / at-least-once / exactly-once), Two-Phase Commit vs Eventual Consistency. Çökme ve duplicate senaryoları dahil.

### 3. Veri Depolama
Range / Hash / Consistent Hash sharding — interaktif key tester ile hangi key hangi shard'a düşüyor canlı hesaplanır. Leader–Follower, Multi-Leader, Quorum replication topolojileri. Cache-Aside, Write-Through, Write-Behind desenleri.

### 4. Ölçeklenebilirlik
Token Bucket, Leaky Bucket, Fixed Window, Sliding Window rate limiting — gerçek zamanlı istek gönderme ile algoritma farkı görülür. Round Robin, Least Connections, Consistent Hash load balancing — sunucu yükleri canlı izlenir. CPU ve queue-depth tabanlı auto-scaling zaman serisi grafiği.

### 5. Altyapı Sistemleri
**Redis:** Data structures, Pub/Sub vs Streams, Cluster & Sentinel failover  
**Kafka:** Partition & Offset, Consumer Groups, Replication & ISR  
**PostgreSQL:** Index tipleri, MVCC & VACUUM, Connection Pooling  
**RabbitMQ:** Exchange tipleri (Direct/Topic/Fanout), DLQ & Priority Queue  
**Elasticsearch:** Indexing & Mapping, Shard Routing & scatter-gather  
**ClickHouse:** Columnar storage — row-store ile interaktif karşılaştırma, Materialized Views

### 6. Sistem Tasarımı Soruları
Interview'da en sık sorulan 7 soru, 14 senaryo:

| Soru | Senaryolar |
|------|-----------|
| URL Shortener | Hash collision, redirect akışı, viral ölçekleme |
| Notification System | Fan-out on write vs read, multi-channel routing |
| News Feed | Feed oluşturma, ML ranking pipeline |
| Chat System | WebSocket + Kafka mesaj iletimi, offline sync |
| Search Autocomplete | Trie & prefix cache, real-time index pipeline |
| Distributed Lock | Redis SETNX & fencing token, Redlock algoritması |
| Pastebin / File Upload | SHA256 dedup, presigned URL, CDN access control |

### 7. Mimari Desenler
Service Mesh: Istio sidecar injection, SPIFFE/SPIRE mTLS, AuthorizationPolicy. Traffic control: canary deploy, Flagger otomatik rollback, fault injection. API Versioning stratejileri ve deprecation döngüsü. REST vs GraphQL vs gRPC protokol karşılaştırması.

### 8. Güvenlik & Platform
OAuth2 Authorization Code + PKCE akışı. Refresh Token Rotation ve token family reuse detection. JWT anatomisi, alg:none saldırısı, JWKS endpoint. Opaque token vs JWT trade-off ve introspection caching. API Gateway request pipeline (7 katman). Zero Trust mimarisi ve mTLS gateway.

---

## Özellikler

- **Animasyonlu akış diyagramları** — her adım tek tek canlanır, hangi servisten hangisine mesaj gittiği görülür
- **Detaylı sol panel** — problem tanımı, tasarım kararı, ne zaman kullanılır, üretim tuzakları
- **Adım akış logu** — her mesajın içeriği, kaynak ve hedef servis, önemli notlar
- **İnteraktif bileşenler** — key tester (sharding), rate limit simülatörü (gerçek zamanlı), LB yük izleme, auto-scaling grafiği, columnar vs row-store karşılaştırması
- **Tekrar çalıştır** — her simülasyon sıfırdan başlatılabilir

---

## Teknik Yığın

- **Framework:** Next.js 14 (Pages Router)
- **Stil:** Vanilla CSS-in-JS, tasarım token'ları ile tutarlı tema
- **Font:** JetBrains Mono
- **Deploy:** Vercel (zero-config)
- **Bağımlılık:** Yalnızca React + Next.js — harici UI kütüphanesi yok

---

## Yerel Geliştirme

```bash
git clone https://github.com/frkdrgt/sysdesign-academy.git
cd sysdesign-academy
npm install
npm run dev
# http://localhost:3000
```

## Deploy

```bash
# Vercel CLI
npm i -g vercel
vercel --prod
```

Ya da GitHub reposunu [vercel.com](https://vercel.com) üzerinden import et — otomatik algılar ve deploy eder.

---

## Proje Yapısı

```
sysdesign-academy/
├── pages/
│   ├── index.jsx                     # Ana sayfa
│   └── sim/
│       ├── microservices-sim.jsx
│       ├── reliability-patterns-sim.jsx
│       ├── data-storage-sim.jsx
│       ├── scalability-sim.jsx
│       ├── infra-systems-sim.jsx
│       ├── system-design-sim.jsx
│       ├── arch-patterns-sim.jsx
│       └── security-platform-sim.jsx
├── components/
│   └── Nav.jsx
└── styles/
    └── globals.css
```

---

## Kapsanan Konular

`API Gateway` `Circuit Breaker` `Saga Pattern` `CQRS` `Event Sourcing` `Transactional Outbox` `Idempotency` `Dead Letter Queue` `At-least-once` `Exactly-once` `2PC` `Eventual Consistency` `Consistent Hashing` `Range Sharding` `Hash Sharding` `Leader–Follower` `Multi-Leader` `Quorum` `Cache-Aside` `Write-Through` `Write-Behind` `Token Bucket` `Leaky Bucket` `Sliding Window` `Rate Limiting` `Round Robin` `Least Connections` `Auto-Scaling` `Redis Streams` `Redis Sentinel` `Redis Cluster` `Kafka Partitioning` `Consumer Groups` `ISR` `PostgreSQL MVCC` `Connection Pooling` `B-Tree Index` `GIN` `BRIN` `RabbitMQ Exchanges` `Elasticsearch Sharding` `ClickHouse MergeTree` `Materialized Views` `URL Shortener` `News Feed` `Chat System` `Search Autocomplete` `Distributed Lock` `Redlock` `Pastebin` `Service Mesh` `mTLS` `SPIFFE` `Canary Deploy` `API Versioning` `GraphQL` `gRPC` `OAuth2` `PKCE` `JWT` `Refresh Token Rotation` `Zero Trust` `API Gateway Pipeline`
