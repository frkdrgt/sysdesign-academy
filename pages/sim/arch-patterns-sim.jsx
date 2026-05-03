import { useState, useEffect, useRef, useCallback } from "react";
import Nav from '../../components/Nav'

// ══════════════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════════════

const SYSTEMS = {
  service_mesh: {
    label: "Service Mesh",
    emoji: "🕸",
    accent: "#818cf8",
    tagline: "Istio · Envoy · mTLS · Traffic Control",
    subsections: [
      {
        id: "sidecar_mtls",
        name: "Sidecar & mTLS",
        problem: "Servisler arası trafik plaintext: ağda dinleyen biri tüm internal API'leri okuyabilir. Her servise TLS kodu yazmak zorunda kalmak istiyoruz. Ama 50 mikroservis varsa her birine sertifika yönetimi eklemek yönetilemez hale gelir. Üstelik 'Order Service, Payment Service'e çağrı yapma yetkisi var mı?' sorusunu servis kodunda değil, altyapıda çözmek istiyoruz.",
        solution: "Sidecar proxy (Envoy) her pod'a otomatik inject edilir. Uygulama kodu TLS'den haberdar değil — sadece localhost'a HTTP yazar, sidecar bunu mTLS ile şifreler ve karşı tarafın kimliğini doğrular. mTLS (mutual TLS): her iki taraf da sertifikasını sunar — sadece server'ı doğrulamak değil, client'ı da doğrulamak. Sertifika dağıtımı: Istio'nun control plane'i (Istiod) SPIFFE/SPIRE protokolü ile her pod'a otomatik kısa ömürlü sertifika (SVID) verir, 24 saatte bir rotasyon. AuthorizationPolicy: 'sadece order-service, payment-service'in /charge endpoint'ini çağırabilir' kuralı YAML'da tanımlanır, her sidecar bunu enforce eder.",
        whenToUse: [
          "mTLS everywhere: zero-trust network — her servis çağrısı hem şifreli hem kimlik doğrulamalı. 'Ağ içindeyiz, güvendeyiz' varsayımını tamamen terk et. Production'daki ihlallerin %70'i lateral movement (yan hareket) ile gerçekleşir",
          "SPIFFE SVID: 'spiffe://cluster.local/ns/default/sa/order-service' formatında workload identity. IP veya hostname'e değil kriptografik kimliğe güven. Pod yeniden başlayınca otomatik yeni sertifika — sertifika yönetimi sıfır operasyonel yük",
          "AuthorizationPolicy granülaritesi: namespace seviyesi ('payments namespace'e sadece frontend namespace'den erişim'), servis seviyesi ('payment-svc'e sadece order-svc'), metod seviyesi ('DELETE /orders sadece admin-svc'). RBAC yerine attribute-based. Değişiklik: YAML güncelle, pod restart yok",
          "PeerAuthentication STRICT modu: namespace'teki tüm trafiği mTLS'e zorla. PERMISSIVE mod: mTLS ve plaintext karışık, migration sırasında kullan. STRICT'e geçmeden önce tüm servislerin sidecar'ı olduğundan emin ol — olmayan servis erişim kaybeder",
          "Telemetri otomatik: her sidecar, request'i intercept ettiği için latency, error rate, throughput metriklerini Prometheus'a otomatik raporlar. Uygulama kodu instrumentation yazmak zorunda değil. Jaeger distributed trace: her request'e correlation ID inject edilir, tüm hop'lar görselleştirilir",
        ],
        pitfalls: [
          "Sidecar overhead gerçeği: her request için ek iki hop (giden sidecar + gelen sidecar). Latency katkısı: ~1-3ms per request. Çoğu uygulama için tolere edilebilir. Ama high-frequency internal call'larda (loop içinde 1000 çağrı) birikir. Çözüm: eBPF tabanlı mesh (Cilium) sidecar olmadan kernel seviyesinde policy uygular — overhead ~0.1ms",
          "Control plane SPOF: Istiod down olursa yeni sertifika dağıtılamaz. Mevcut sertifikalar 24 saat geçerli, bu sürede yeni pod başlatılırsa sertifika alamaz. Çözüm: Istiod'u multi-replica deploy et, PodDisruptionBudget ekle. Sertifika TTL'yi artırma — trade-off: TTL uzunsa compromise edilmiş sertifika daha uzun geçerli",
          "gRPC streaming ve mTLS: uzun süreli gRPC stream bağlantısında sertifika expire olabilir. Envoy sertifika rotasyonunu otomatik handle eder ama uygulama bağlantıyı kapatıp yeniden açmayı desteklemelidir. Retry logic: gRPC'de connection draining sırasında in-flight stream kaybı yaşanabilir",
          "Debug zorluğu: trafik şifreli olduğu için tcpdump çalışmaz. Envoy'un admin endpoint'i (/config_dump, /clusters) ile mesh durumunu incele. Kiali dashboard: mesh topolojisi, error rate, mTLS durumu görselleştirir. istioctl analyze: misconfiguration tespiti",
          "Namespace boundary ve egress: service mesh sadece cluster içini kapsar. Dış servislere çıkış (third-party API) için ServiceEntry + EgressGateway tanımla. Aksi hâlde sidecar dış trafiği bloke edebilir (REGISTRY_ONLY mod). Legacy servisler için VM injection: mesh'i VM'lere de extend edebilirsin",
        ],
        steps: [
          { from: "order",    to: "sidecar_o", label: "HTTP localhost:8080/charge",         color: "#818cf8", delay: 0,    note: "Uygulama TLS bilmez" },
          { from: "sidecar_o",to: "istiod",    label: "SVID sertifika al (SPIFFE)",         color: "#a78bfa", delay: 700  },
          { from: "istiod",   to: "sidecar_o", label: "x509 SVID (24s TTL)",                color: "#a78bfa", delay: 1400 },
          { from: "sidecar_o",to: "sidecar_p", label: "mTLS: TLS1.3 + client cert",         color: "#34d399", delay: 2200, note: "Şifreli + kimlik" },
          { from: "sidecar_p",to: "istiod",    label: "AuthorizationPolicy kontrol",        color: "#fbbf24", delay: 3000 },
          { from: "istiod",   to: "sidecar_p", label: "ALLOW: order→payment /charge",       color: "#34d399", delay: 3700 },
          { from: "sidecar_p",to: "payment",   label: "HTTP localhost:8080/charge",         color: "#818cf8", delay: 4500, note: "Uygulama plaintext alır" },
          { from: "payment",  to: "sidecar_p", label: "200 OK",                             color: "#34d399", delay: 5300 },
          { from: "sidecar_p",to: "sidecar_o", label: "mTLS response",                     color: "#34d399", delay: 6000 },
          { from: "sidecar_o",to: "order",     label: "HTTP 200 (decrypted)",               color: "#818cf8", delay: 6700 },
        ],
        layout: {
          nodes: [
            { id: "order",    label: "Order\nService",   x: 70,  y: 170, color: "#818cf8" },
            { id: "sidecar_o",label: "Envoy\nSidecar",   x: 210, y: 170, color: "#60a5fa" },
            { id: "istiod",   label: "Istiod\n(Control)", x: 350, y: 70,  color: "#a78bfa" },
            { id: "sidecar_p",label: "Envoy\nSidecar",   x: 490, y: 170, color: "#60a5fa" },
            { id: "payment",  label: "Payment\nService", x: 590, y: 170, color: "#818cf8" },
          ],
        },
      },
      {
        id: "traffic_control",
        name: "Traffic Control & Canary",
        problem: "Yeni bir servis versiyonu deploy ediyoruz. Tüm trafiği birden yeni versiyona vermek riskli — bug varsa tüm kullanıcılar etkilenir. %5 trafik yeni versiyona, %95 eskiye giderse ve metrikler iyiyse kademeli artırabilir miyiz? Blue-green switch sırasında in-flight request'ler kaybolmasın.",
        solution: "Istio VirtualService + DestinationRule: HTTP header, user segment veya ağırlık bazlı trafik bölme. Canary: weight: 5 → v2, weight: 95 → v1. Header-based: 'X-Beta-User: true' header'ı varsa v2'ye git (internal test). Kademeli artış: 5% → 10% → 25% → 50% → 100%. Her aşamada error rate ve latency izle, eşik aşılırsa otomatik rollback. Circuit breaker: Envoy'da outlierDetection ile sağlıksız pod'u otomatik ejection. Fault injection: test için %5 isteğe yapay 500ms gecikme veya HTTP 500 inject et — chaos engineering.",
        whenToUse: [
          "Canary vs Blue-Green farkı: Blue-Green — iki tam environment, anlık switch, geri alma kolay, pahalı (2x infra). Canary — aynı environment'ta ağırlıklı split, kademeli, ucuz. Kullanıcı bazlı: internal team'e v2 ver, dış kullanıcılara v1 — bu header-based routing ile yapılır",
          "Header-based routing production kullanımı: 'Cookie: beta_user=true' veya 'X-User-Id: {id}' ile belirli kullanıcıları yeni versiyona yönlendir. A/B test altyapısı: feature flag servisi ile Istio routing birleştirilir — feature flag 'true' olan user'a v2, diğerlerine v1",
          "Outlier detection (circuit breaker at infra level): consecutive_5xx: 5 — ardarda 5 HTTP 500 dönerse pod'u 30 saniye ejection pool'a al. baseEjectionTime: 30s, maxEjectionPercent: 50 — max pool'un %50'si ejection'da olabilir. Bu uygulama seviyesi circuit breaker'dan farklı: infra'da çalışır, kod değişmez",
          "Fault injection testing: VirtualService'e 'fault: delay: percentage: 10, fixedDelay: 5s' ekle — %10 request'e 5s gecikme. 'fault: abort: percentage: 5, httpStatus: 503' — %5 request'i 503 ile sonlandır. Bu chaos engineering'i production'da güvenli yapar: scope sınırlı, revert kolay",
          "Traffic mirroring (shadowing): prod trafiğinin kopyasını yeni versiyona gönder, cevabı görmezden gel. V2 gerçek yük altında test edilir, kullanıcı etkilenmez. DB write'lar dikkat: mirror edilen request da DB'ye yazabilir — idempotent olmayan operasyonlarda tehlikeli",
        ],
        pitfalls: [
          "Session affinity ve canary: kullanıcı v1'deyken v2'ye geçerse session state kaybolabilir (farklı pod, farklı in-memory state). Çözüm: stateless servisler + dış session store (Redis) zorunlu. Istio consistent hashing: Cookie veya header bazlı aynı kullanıcıyı aynı pod'a gönder — ancak pod scale-out'ta consistency bozulur",
          "Canary rollback zamanlaması: v2 deploy edildi, %5 trafik aldı. 5 dakika sonra error rate %2'den %8'e çıktı. Rollback: weight: 0 → v2. Ama zaten hata alan %5'lik kullanıcılar etkilendi. Çözüm: automated rollback — Flagger gibi araç error rate SLO'su aşılınca otomatik rollback tetikler",
          "VirtualService + DestinationRule sırası önemli: DestinationRule subset tanımlanmadan VirtualService subset'e referans verirse trafik 503 alır. Önce DestinationRule apply et, sonra VirtualService. GitOps pipeline'da bu sırayı garantile",
          "Egress için ServiceEntry unutulursa: yeni servis harici bir API'ye (Stripe, SendGrid) çağrı yapıyor. Mesh REGISTRY_ONLY modundaysa bu çağrı bloke edilir, 502/503 alınır. Debug: 'kubectl logs <pod> -c istio-proxy | grep BlackHoleCluster' — black hole'a giden trafik bloke demek. Çözüm: ServiceEntry tanımla",
        ],
        steps: [
          { from: "client",  to: "gateway",  label: "GET /api/checkout",               color: "#818cf8", delay: 0 },
          { from: "gateway", to: "vs",       label: "VirtualService routing kuralları", color: "#a78bfa", delay: 700 },
          { from: "vs",      to: "checkout_v1", label: "weight:95 → v1 pod",           color: "#60a5fa", delay: 1500, note: "%95 trafik" },
          { from: "vs",      to: "checkout_v2", label: "weight:5 → v2 pod",            color: "#fbbf24", delay: 1700, note: "%5 canary" },
          { from: "checkout_v2", to: "vs",   label: "❌ error_rate > 5%",              color: "#ef4444", delay: 3000 },
          { from: "vs",      to: "flagger",  label: "SLO breach detected",             color: "#ef4444", delay: 3700 },
          { from: "flagger", to: "vs",       label: "weight:0 → v2 ROLLBACK",          color: "#34d399", delay: 4500 },
          { from: "vs",      to: "checkout_v1", label: "weight:100 → v1 (safe)",       color: "#34d399", delay: 5300, note: "Otomatik rollback" },
        ],
        layout: {
          nodes: [
            { id: "client",      label: "Client",      x: 50,  y: 170, color: "#94a3b8" },
            { id: "gateway",     label: "Ingress\nGateway", x: 180, y: 170, color: "#818cf8" },
            { id: "vs",          label: "Virtual\nService", x: 330, y: 170, color: "#a78bfa" },
            { id: "checkout_v1", label: "checkout\nv1 (95%)", x: 490, y: 100, color: "#60a5fa" },
            { id: "checkout_v2", label: "checkout\nv2 (5%)", x: 490, y: 250, color: "#fbbf24" },
            { id: "flagger",     label: "Flagger\nController", x: 600, y: 170, color: "#f97316" },
          ],
        },
      },
    ],
  },

  api_versioning: {
    label: "API Versioning",
    emoji: "📌",
    accent: "#38bdf8",
    tagline: "URL · Header · Content Negotiation",
    subsections: [
      {
        id: "strategies",
        name: "Versioning Stratejileri",
        problem: "API v1 kullanıcıları var, v2 deploy ediyoruz. v2'de breaking change var: response formatı değişti, bir field kaldırıldı. Eski client'lar bozulmamalı. Aynı anda birden fazla versiyonu nasıl destekleriz? Versiyonu nerede belirtiriz: URL'de mi, header'da mı, request body'de mi?",
        solution: "4 ana strateji: (1) URL path versioning: /api/v1/users — en görünür, cache-friendly, en yaygın. Breaking change'i kolayca izole eder. (2) Header versioning: 'API-Version: 2' — URL temiz kalır, aynı endpoint farklı davranır, cache'lenmesi güç. (3) Query param: /api/users?version=2 — basit ama 'kirli' URL. (4) Content negotiation: Accept: application/vnd.myapi.v2+json — REST puristler tercih eder, ama client'a öğretmesi zor. Pratikte: public API → URL versioning (GitHub, Stripe, Twilio hepsi /v1/, /v2/). Internal microservice → header versioning. Deprecation: eski versiyon Sunset header ile tarih bildirilir, log'da deprecated version kullanımı izlenir.",
        whenToUse: [
          "URL versioning ne zaman: public API, SDK dağıtımı yapıyorsanız, cache (CDN, browser) kritikse. /v1/orders ve /v2/orders farklı CDN cache entry — aynı resource, farklı format. Stripe, GitHub, Twilio, AWS hepsi bu yolu seçer. Dezavantaj: URL çirkinleşir, versiyonlar arası kod duplikasyonu",
          "Header versioning ne zaman: internal microservice API'leri, URL'nin temiz kalması önemli, birden fazla API gateway katmanı var. 'API-Version: 2024-01-01' tarih bazlı versiyon (Stripe'ın yeni yöntemi) — tarih geçince eski davranış, yeni tarih verince yeni davranış. Breaking change olmadan deprecation mümkün",
          "Content negotiation ne zaman: gerçek REST (HATEOAS) uygulaması, media type versioning 'application/vnd.github.v3+json'. Accept header'ı zaten HTTP standardı — versiyonlamayı HTTP semantiğine entegre eder. Dezavantaj: client'lar Accept header göndermeyi genellikle unutur, debug'ı zor",
          "Additive change vs breaking change ayrımı: yeni field ekleme = non-breaking (eski client'lar görmezden gelir). Field kaldırma/yeniden adlandırma/tip değiştirme = breaking. Sadece breaking change'ler için yeni versiyon aç. Tolerant reader pattern: client bilinmeyen field'ları ignore etmeli — bu disiplin versiyon patlamasını önler",
          "Sunset header: 'Sunset: Sat, 31 Dec 2025 23:59:59 GMT' — bu versiyonun kapanma tarihi. Deprecation-Notice: 'v1 API will be removed on 2026-01-01, migrate to v2'. Client'lar bu header'ı okuyup alert üretebilir. Atlassian, GitHub bu header'ı kullanır",
        ],
        pitfalls: [
          "Version explosion: her küçük değişiklik için yeni versiyon açmak — v1, v2, v3...v47. Yıl sonunda 47 versiyonu maintain etmek imkânsız. Çözüm: sadece breaking change'ler yeni versiyon açar. Non-breaking değişiklikler (yeni field, yeni endpoint) aynı versiyona eklenir. Politika: her 6-12 ayda bir major versiyon, eski versiyon 12-18 ay desteklenir sonra sunset",
          "Versiyonlar arası kod duplikasyonu: /v1/users ve /v2/users handler'ları ayrı dosyalar olursa aynı bug her iki yerde de fix edilmeli. Çözüm: versiyona göre farklılaşan sadece transformer/serializer katmanı — business logic ortak. Adapter pattern: v1Adapter.transform(user) ve v2Adapter.transform(user) aynı domain object'i farklı format'a çevirir",
          "URL versioning cache invalidation sorunu: CDN /v1/products'ı cache'lemiş, /v2/products yeni endpoint — farklı cache key. Geçiş sırasında eski client'lar v1'e, yeni client'lar v2'ye gidebilir. Sorun değil, istenilen davranış bu. Ama A/B test sırasında aynı user'ın bazen v1 bazen v2 görmesi tutarsızlık yaratır",
          "GraphQL'de versiyon yönetimi farklı: GraphQL resmi olarak versiyonlamayı tavsiye etmez. Bunun yerine: field deprecation (@deprecated direktifi), additive schema evolution. 'type Query' genişler ama küçülmez. Eski client'lar eski field'ları okumaya devam eder. Çözüm: schema stitching veya Federation ile zaman içinde eski field'ları aşamalı kaldır",
        ],
        steps: [
          { from: "client_v1", to: "gateway",   label: "GET /api/v1/users/42",              color: "#38bdf8", delay: 0 },
          { from: "gateway",   to: "router",    label: "path prefix: v1 → v1 handler",     color: "#38bdf8", delay: 700 },
          { from: "router",    to: "v1_handler",label: "UserResponseV1{id,name,email}",    color: "#60a5fa", delay: 1400 },
          { from: "v1_handler",to: "client_v1", label: "200 {id:42, name:'Faruk', email}", color: "#38bdf8", delay: 2200, note: "v1 format" },
          { from: "client_v2", to: "gateway",   label: "GET /api/v2/users/42",             color: "#a78bfa", delay: 3200 },
          { from: "gateway",   to: "router",    label: "path prefix: v2 → v2 handler",     color: "#a78bfa", delay: 3900 },
          { from: "router",    to: "v2_handler",label: "UserResponseV2{id,fullName,contact}", color: "#818cf8", delay: 4600 },
          { from: "v2_handler",to: "client_v2", label: "200 {id:42, fullName:'Faruk D.', contact:{email,phone}}", color: "#a78bfa", delay: 5400, note: "v2 yeni format" },
        ],
        layout: {
          nodes: [
            { id: "client_v1",  label: "Client\n(v1 SDK)",  x: 60,  y: 100, color: "#38bdf8" },
            { id: "client_v2",  label: "Client\n(v2 SDK)",  x: 60,  y: 260, color: "#a78bfa" },
            { id: "gateway",    label: "API\nGateway",      x: 220, y: 180, color: "#60a5fa" },
            { id: "router",     label: "Version\nRouter",   x: 370, y: 180, color: "#818cf8" },
            { id: "v1_handler", label: "v1\nHandler",       x: 530, y: 100, color: "#38bdf8" },
            { id: "v2_handler", label: "v2\nHandler",       x: 530, y: 260, color: "#a78bfa" },
          ],
        },
      },
      {
        id: "deprecation",
        name: "Deprecation & Migration",
        problem: "v1 API'yi kapatmak istiyoruz. 10.000 client var, kim v2'ye geçti kim geçmedi? Geçmeyenlere nasıl baskı uygularsın ama onları kırmadan? Ani kapatma tüm eski client'ları bozar.",
        solution: "Observe → Notify → Degrade → Sunset döngüsü: (1) Observe: her v1 request'i logla — hangi client_id, hangi endpoint, ne sıklıkta. (2) Notify: Sunset header + email/Slack bildirimi + developer portal duyurusu. (3) Degrade: belirli tarihten sonra v1'e rate limit uygula (300/dk → 100/dk → 10/dk). (4) Sunset: v1 tamamen kapatılır, 410 Gone döner. Migration guide: v1→v2 changelog, SDK migration tool, compatibility layer (v1 request'i v2'ye otomatik çevir, eski response formatına dönüştür).",
        whenToUse: [
          "Usage analytics ile deprecation kararı: v1'e gelen request sayısı 6 aydır %80 düştü ama hâlâ %5 var. Bu %5 kim? API key bazlı breakdown: 3 büyük enterprise müşteri, 200 küçük integrasyon. Enterprise'larla direkt iletişim kur. Küçüklere otomatik email + migration guide. API analytics platformu: Kong, Apigee, AWS API GW hepsi bu breakdown'ı sağlar",
          "Compatibility shim (köprü katmanı): v1 request'ini al, v2 request'ine dönüştür, v2'yi çağır, response'u v1 formatına dönüştür. Client kodu değiştirmek zorunda değil. Bu shim'i 6-12 ay çalıştır, v1 traffic'i sıfıra inince shim'i kapat. Stripe'ın versioning stratejisi bu — eski API key'leri belirli bir API versiyonuna 'pinned' kalır",
          "Rate limiting ile migration baskısı: v1'e throttle uygula — eskiden 1000 req/min olan limit 100 req/min'e düşürülür. Client'ların iş etkisi artar, migration öncelik haline gelir. Throttle error response'una migration guide URL'si ekle: {error:'v1_rate_limited', migrate_to:'https://docs.api.com/v2-migration'}",
          "API versioning için semantic versioning farkı: semver (1.2.3) library/SDK için, API için major versiyon (v1/v2) yeterli. Minor version API'de anlamsız — client'lar major'a göre uyum sağlar. Tarih bazlı versiyon (2024-01-01) takvim odaklı geliştirme için iyi: her breaking change yeni tarih, client'lar kullandıkları tarihe 'pinned' kalır",
        ],
        pitfalls: [
          "Long tail problem: büyük müşteriler v2'ye geçti, küçük integrasyonlar geçmedi. v1 kapatılınca küçük müşteriler bozulur, destek talebi patlar. Çözüm: v1 traffic'i sıfıra inmeden asla kapatma. 'Zero traffic' tanımı: son 30 gün boyunca günlük < 10 request. O zaman bile 30 gün önceden son duyuru gönder",
          "SDK versiyonları ile API versiyonlarının senkronizasyonu: Python SDK v2.0 API v2'yi destekliyorsa, müşteri hem API versiyonunu hem SDK versiyonunu güncellemelidir. Bu double migration yükü bırakır. Çözüm: SDK otomatik API versiyon seçimi — 'api_version' parametresini gizle, SDK hangi API versiyonuna konuştuğunu bilsin",
          "Webhook endpoint versiyonlama: client bir webhook URL'si kayıt etmiş. Bu URL'ye hangi format'ta payload gönderiyoruz? v1 webhook payload ve v2 payload farklı. Çözüm: webhook subscription'a versiyon ekle — client hangi format istediğini bildirir. Versiyon değişince tüm aktif webhook'lara migration notice gönder",
        ],
        steps: [
          { from: "v1_client",   to: "api",       label: "GET /v1/orders (deprecated)",    color: "#f97316", delay: 0 },
          { from: "api",         to: "analytics", label: "log: client_id=SDK-123 v1 usage",color: "#818cf8", delay: 700 },
          { from: "api",         to: "v1_client", label: "200 OK + Sunset: Dec 31 2025",   color: "#38bdf8", delay: 1400, note: "Sunset header" },
          { from: "analytics",   to: "notifier",  label: "v1 usage detected: SDK-123",     color: "#fbbf24", delay: 2400 },
          { from: "notifier",    to: "dev_email",  label: "Email: v1 deprecation notice",  color: "#fbbf24", delay: 3200 },
          { from: "v1_client",   to: "api",        label: "GET /v1/orders (after sunset)",  color: "#ef4444", delay: 4400 },
          { from: "api",         to: "v1_client",  label: "410 Gone: migrate to /v2",       color: "#ef4444", delay: 5200, note: "v1 kapatıldı" },
          { from: "v1_client",   to: "api",        label: "GET /v2/orders",                 color: "#34d399", delay: 6200 },
          { from: "api",         to: "v1_client",  label: "200 OK (v2 format)",             color: "#34d399", delay: 7000, note: "Migration tamamlandı" },
        ],
        layout: {
          nodes: [
            { id: "v1_client",  label: "Old\nClient",    x: 60,  y: 170, color: "#f97316" },
            { id: "api",        label: "API\nGateway",   x: 230, y: 170, color: "#38bdf8" },
            { id: "analytics",  label: "Analytics\nDB",  x: 380, y: 80,  color: "#818cf8" },
            { id: "notifier",   label: "Notification\nService", x: 530, y: 80, color: "#fbbf24" },
            { id: "dev_email",  label: "Dev\nEmail",     x: 600, y: 170, color: "#fbbf24" },
          ],
        },
      },
    ],
  },

  api_styles: {
    label: "REST vs GraphQL vs gRPC",
    emoji: "⚡",
    accent: "#34d399",
    tagline: "Protocol · Trade-off · Use Case",
    subsections: [
      {
        id: "comparison",
        name: "Protokol Karşılaştırması",
        problem: "Yeni bir servis veya API tasarlıyorsunuz. REST mi, GraphQL mi, gRPC mi seçmelisiniz? Her birinin ne zaman üstün olduğunu, nerede bottleneck yarattığını ve gerçek production senaryolarında nasıl davrandığını açıklayabilmek lazım.",
        solution: "REST: HTTP/1.1 + JSON. Evrensel client desteği. Stateless. Resource odaklı. Her endpoint bir kaynak (noun). Caching: HTTP standartları çalışır. Overfetch/underfetch sorunu: /users/42 endpoint'i 20 alan döndürür, client 3 tanesini kullanır. GraphQL: tek endpoint, client tam istediği field'ları seçer. N+1 sorunu DataLoader ile çözülür. Type system ile schema documentation otomatik. Subscription ile real-time. Dezavantaj: caching karmaşık, query complexity DoS riski. gRPC: HTTP/2 + Protocol Buffers (binary). 5-10x daha küçük payload, 2-3x daha hızlı serialization. Bidirectional streaming. Strongly-typed IDL (proto dosyası). Dezavantaj: browser desteği sınırlı (gRPC-Web gerekli), insan tarafından okunamaz payload.",
        whenToUse: [
          "REST ne zaman: public API (third-party developer erişimi), browser'dan direkt çağrı, basit CRUD, CDN caching kritik, ekip REST biliyor. GitHub, Stripe, Twitter/X REST API sunar çünkü ekosistem en geniş, her dilde client var, Postman/curl ile test edilebilir",
          "GraphQL ne zaman: mobile app (bandwidth optimize et — sadece gerekli field'ları çek), BFF (Backend For Frontend) katmanı, farklı client'ların farklı field ihtiyacı var (web geniş veri, mobile dar veri), hızlı ürün iterasyonu (schema değişikliği backend değişikliği gerektirmez), GitHub v4 API ve Shopify Storefront API GraphQL kullanır",
          "gRPC ne zaman: microservice arası internal iletişim, high-performance (IoT, real-time, low-latency), streaming (bidirectional), polyglot environment (proto dosyasından her dil için otomatik client üretilir). Google, Lyft, Netflix internal servis iletişiminde gRPC kullanır. Pub/Sub gibi streaming: server-side streaming, client-side streaming, bidirectional streaming",
          "Hybrid mimariler gerçek hayatta norm: public API → REST. Mobile BFF → GraphQL. Internal microservice → gRPC. Örnek: Netlify public REST API sunar, ama frontend'leri GraphQL kullanır, backend servisler gRPC ile konuşur. API Gateway bu protokol dönüşümlerini handle eder (transcoding)",
          "Protocol Buffer (protobuf) avantajları sayısal: 100 byte JSON → ~20 byte protobuf (5x küçük). Serialization: JSON parse ~10µs, protobuf parse ~1µs. Özellikle yüksek frekans microservice çağrılarında bu fark büyük. Schema evolution: protobuf field numaraları — yeni field ekleme backward compatible (eski client bilinmeyen field'ı ignore eder)",
        ],
        pitfalls: [
          "GraphQL N+1 sorunu ve DataLoader: 'users listesini getir, her user için posts getir' → 1 + N DB sorgusu. 100 user varsa 101 sorgu. DataLoader: tüm user ID'lerini topla, tek batch query ile çek. Ama DataLoader uygulama kodu gerektirir — otomatik gelmez. ORM ile (TypeORM eager loading) aynı sorunu yaratırsın, DataLoader yerine DB seviyesinde JOIN kullan",
          "gRPC browser limitation: gRPC HTTP/2 trailer kullanır, tarayıcılar trailer'ı desteklemez. gRPC-Web (Envoy transcoding) gerekli — ek altyapı. Alternatif: Connect Protocol (Buf ekibi) — gRPC ile uyumlu ama HTTP/1.1 ve browser üzerinden çalışır",
          "REST overfetch gerçek maliyeti: mobil app /user endpoint'inden 2KB JSON alıyor ama 200 byte kullanıyor. Günde 1M request → 2TB veri transferi, yalnızca 200GB kullanılıyor. 1.8TB waste. LTE'de her 100KB ~10ms ek latency. GraphQL veya field projection (?fields=id,name) ile çözülür",
          "GraphQL query complexity ve güvenlik: 'arkadaşların arkadaşlarının arkadaşları' gibi deeply nested query — response 100MB olabilir, server memory patlar. Query depth limit (max 5), query complexity limit (max 1000 puan), query timeout (max 10s) zorunlu. Persisted queries: production'da sadece pre-approved query hash'lerini kabul et — arbitrary query engellenir",
          "Schema drift ve contract testing: REST'te OpenAPI spec veya GraphQL schema'da yapılan değişiklikler client'ları bozabilir. Consumer-Driven Contract Testing (Pact): consumer beklediği formatı 'contract' olarak yazar, provider her deploy'da bu contract'ları test eder. Böylece breaking change deploy'dan önce yakalanır",
        ],
        steps: [
          { from: "mobile",   to: "gql_api",   label: "POST /graphql {query: user{id,name,avatar}}", color: "#34d399", delay: 0,    note: "Sadece 3 field" },
          { from: "gql_api",  to: "dataloader",label: "batch: userIds=[42]",                        color: "#34d399", delay: 700  },
          { from: "dataloader",to:"user_db",    label: "SELECT id,name,avatar WHERE id IN (42)",     color: "#22d3ee", delay: 1400 },
          { from: "user_db",  to: "mobile",    label: "{id:42, name:'Faruk', avatar:'url'}  28B",   color: "#34d399", delay: 2200, note: "Sadece istenen veri" },
          { from: "web_app",  to: "rest_api",  label: "GET /api/v1/users/42",                       color: "#38bdf8", delay: 3400 },
          { from: "rest_api", to: "user_db",   label: "SELECT * FROM users WHERE id=42",            color: "#22d3ee", delay: 4100 },
          { from: "user_db",  to: "web_app",   label: "{id,name,email,phone,addr,created...} 2KB",  color: "#38bdf8", delay: 4900, note: "Overfetch: 2KB" },
          { from: "svc_a",    to: "svc_b",     label: "gRPC: GetUser(id=42) [protobuf binary]",     color: "#a78bfa", delay: 6100 },
          { from: "svc_b",    to: "svc_a",     label: "UserProto{42,'Faruk'} [20B binary]",         color: "#a78bfa", delay: 6800, note: "5x küçük payload" },
        ],
        layout: {
          nodes: [
            { id: "mobile",     label: "Mobile\nApp",     x: 50,  y: 80,  color: "#34d399" },
            { id: "gql_api",    label: "GraphQL\nAPI",    x: 210, y: 80,  color: "#34d399" },
            { id: "dataloader", label: "Data\nLoader",    x: 370, y: 80,  color: "#6ee7b7" },
            { id: "web_app",    label: "Web\nApp",        x: 50,  y: 210, color: "#38bdf8" },
            { id: "rest_api",   label: "REST\nAPI",       x: 210, y: 210, color: "#38bdf8" },
            { id: "svc_a",      label: "Service\nA",      x: 50,  y: 310, color: "#a78bfa" },
            { id: "svc_b",      label: "Service\nB",      x: 210, y: 310, color: "#a78bfa" },
            { id: "user_db",    label: "User\nDB",        x: 530, y: 180, color: "#22d3ee" },
          ],
        },
      },
    ],
  },
};

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
const SYS_ORDER = ["service_mesh", "api_versioning", "api_styles"];

function ArchPatternsSimInner() {
  const [sysId, setSysId] = useState("service_mesh");
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
  const activeSteps = animStep >= 0 ? sub.steps.slice(0, animStep + 1) : [];

  return (
    <div style={A.root}>
      <div style={A.grid} />
      <header style={A.header}>
        <div style={A.hL}>
          <span style={{ ...A.hDot, background: accent }} />
          <span style={A.hTitle}>Mimari Desenler</span>
          <span style={A.hSub}>Service Mesh · API Versioning · REST vs GraphQL vs gRPC</span>
        </div>
        <div style={{ ...A.hPill, color: accent, borderColor: accent + "44", background: accent + "11" }}>
          {sys.emoji} {sys.label} · {sub.name}
        </div>
      </header>

      <nav style={A.sysNav}>
        {SYS_ORDER.map(id => {
          const s = SYSTEMS[id];
          return (
            <button key={id} onClick={() => switchSys(id)} style={{
              ...A.sysBtn,
              ...(sysId === id ? { borderColor: s.accent, color: s.accent, background: s.accent + "12", boxShadow: `0 0 18px ${s.accent}44` } : {}),
            }}>
              <span style={{ fontSize: 16 }}>{s.emoji}</span>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700 }}>{s.label}</div>
                <div style={{ fontSize: 8, color: sysId === id ? s.accent + "99" : "#1e3a5f" }}>{s.tagline}</div>
              </div>
            </button>
          );
        })}
      </nav>

      <div style={A.subNav}>
        {sys.subsections.map((s, i) => (
          <button key={s.id} onClick={() => switchSub(i)} style={{
            ...A.subBtn,
            ...(subIdx === i ? { borderColor: accent, color: "#f1f5f9", background: accent + "18" } : {}),
          }}>{s.name}</button>
        ))}
      </div>

      <div style={A.body}>
        <aside style={A.left}>
          <div style={{ ...A.card, borderColor: accent + "44" }}>
            <div style={{ ...A.lbl, color: accent }}>⚠ Problem</div>
            <p style={A.txt}>{sub.problem}</p>
          </div>
          <div style={{ ...A.card, borderColor: "#0f2540" }}>
            <div style={A.lbl}>✦ Tasarım</div>
            <p style={A.txt}>{sub.solution}</p>
          </div>
          <div style={A.listCard}>
            <div style={A.lbl}>✓ Ne Zaman / Nasıl</div>
            {sub.whenToUse.map((w, i) => (
              <div key={i} style={A.row}>
                <span style={{ color: "#34d399", flexShrink: 0, marginTop: 2 }}>›</span>
                <span style={A.rowTxt}>{w}</span>
              </div>
            ))}
          </div>
          <div style={A.listCard}>
            <div style={A.lbl}>⚡ Trade-off / Dikkat</div>
            {sub.pitfalls.map((p, i) => (
              <div key={i} style={A.row}>
                <span style={{ color: "#f97316", flexShrink: 0, marginTop: 2 }}>›</span>
                <span style={A.rowTxt}>{p}</span>
              </div>
            ))}
          </div>
        </aside>

        <main style={A.center}>
          <FlowDiagram layout={sub.layout} steps={sub.steps} animStep={animStep} accent={accent} />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={run} disabled={running} style={{
              ...A.runBtn,
              background: running ? "transparent" : accent,
              color: running ? accent : "#040c18",
              borderColor: accent,
              boxShadow: running ? "none" : `0 0 28px ${accent}77`,
            }}>{running ? "⟳ Çalışıyor..." : done ? "↺ Tekrar" : "▶ Simüle Et"}</button>
            {done && <span style={{ color: accent, fontSize: 11, fontWeight: 700 }}>✓ {sub.steps.length} adım</span>}
          </div>
          <div style={A.log}>
            {activeSteps.length === 0 && <div style={A.logEmpty}>▶ başlatmak için butona bas</div>}
            {activeSteps.map((s, i) => (
              <div key={i} style={{ ...A.logRow, borderLeftColor: s.color, background: i === animStep ? s.color + "12" : "transparent", opacity: i === animStep ? 1 : 0.5 }}>
                <span style={{ color: s.color, fontWeight: 800, fontSize: 9, minWidth: 55 }}>{s.from?.toUpperCase()}</span>
                <span style={{ color: "#1e3a5f", fontSize: 9 }}>──▶</span>
                <span style={{ color: "#64748b", fontWeight: 600, fontSize: 9, minWidth: 55 }}>{s.to?.toUpperCase()}</span>
                <span style={{ color: "#334155", fontSize: 9, flex: 1 }}>{s.label.substring(0, 58)}</span>
                {s.note && <span style={{ color: s.color + "cc", fontSize: 9, fontWeight: 700 }}>← {s.note}</span>}
              </div>
            ))}
            {done && <div style={{ color: accent, fontSize: 10, fontWeight: 800, borderTop: `1px solid ${accent}22`, paddingTop: 5, marginTop: 4 }}>✓ Akış tamamlandı</div>}
          </div>
        </main>
      </div>
    </div>
  );
}

function FlowDiagram({ layout, steps, animStep, accent }) {
  const W = 660, H = 350;
  if (!layout?.nodes) return null;
  const { nodes } = layout;
  const posMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const activeSteps = animStep >= 0 ? steps.slice(0, animStep + 1) : [];
  const current = animStep >= 0 ? steps[animStep] : null;

  function arrow(fId, tId) {
    const a = posMap[fId], b = posMap[tId];
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1, pad = 26;
    return { x1: a.x + dx / len * pad, y1: a.y + dy / len * pad, x2: b.x - dx / len * pad, y2: b.y - dy / len * pad };
  }

  const uniqueEdges = [...new Set(steps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map(s => `${s.from}|${s.to}`))];

  return (
    <div style={A.svgWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }}>
        <defs>
          <filter id="glowA"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <marker id="arrA" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill={accent} /></marker>
          <marker id="arrAd" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill="#0f2845" /></marker>
        </defs>
        {uniqueEdges.map((key, i) => {
          const [f, t] = key.split("|"); const ln = arrow(f, t);
          return ln ? <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke="#091929" strokeWidth="1.5" strokeDasharray="3 6" markerEnd="url(#arrAd)" /> : null;
        })}
        {activeSteps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map((s, i) => {
          const ln = arrow(s.from, s.to); if (!ln) return null;
          const isLast = i === animStep; const c = s.color || accent;
          const mx = (ln.x1 + ln.x2) / 2, my = (ln.y1 + ln.y2) / 2;
          return (
            <g key={`ln-${i}`}>
              <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke={c} strokeWidth={isLast ? 2.8 : 1.2} opacity={isLast ? 1 : 0.3} markerEnd="url(#arrA)" filter={isLast ? "url(#glowA)" : undefined} />
              {isLast && (<><rect x={mx - 70} y={my - 18} width={140} height={14} rx={3} fill="#040c18" opacity="0.92" /><text x={mx} y={my - 6} textAnchor="middle" fill={c} fontSize="8" fontWeight="700" fontFamily="monospace">{s.label.substring(0, 40)}</text></>)}
            </g>
          );
        })}
        {activeSteps.filter(s => s.self && posMap[s.from]).map((s, i) => {
          const n = posMap[s.from]; const isLast = steps.indexOf(s) === animStep;
          return <text key={`sf-${i}`} x={n.x} y={n.y - 40} textAnchor="middle" fill={s.color} fontSize="8.5" fontWeight="800" fontFamily="monospace" filter={isLast ? "url(#glowA)" : undefined}>{s.label.substring(0, 40)}</text>;
        })}
        {nodes.map(n => {
          const isActive = current && !current.self && (current.from === n.id || current.to === n.id);
          const lines = n.label.split("\n");
          return (
            <g key={n.id}>
              {isActive && <circle cx={n.x} cy={n.y} r={32} fill={n.color + "12"} />}
              <circle cx={n.x} cy={n.y} r={22} fill="#040c18" stroke={isActive ? n.color : n.color + "44"} strokeWidth={isActive ? 2.5 : 1.5} filter={isActive ? "url(#glowA)" : undefined} />
              {lines.map((ln, li) => <text key={li} x={n.x} y={n.y + (lines.length === 1 ? 4 : li * 10 - 2)} textAnchor="middle" fill={isActive ? n.color : n.color + "77"} fontSize="8" fontWeight="700" fontFamily="monospace">{ln}</text>)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const A = {
  root: { minHeight: "100vh", background: "#040c18", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", display: "flex", flexDirection: "column", position: "relative" },
  grid: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "radial-gradient(circle at 20% 30%, #0d1e3820 0%, transparent 55%), radial-gradient(circle at 80% 70%, #1a0a2820 0%, transparent 55%)" },
  header: { position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid #0a1f35", background: "#040c18" },
  hL: { display: "flex", alignItems: "center", gap: 8 },
  hDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0 },
  hTitle: { fontSize: 15, fontWeight: 800, color: "#f1f5f9" },
  hSub: { fontSize: 9, color: "#1e3a5f", letterSpacing: 2, marginLeft: 8 },
  hPill: { fontSize: 9, fontWeight: 700, padding: "4px 12px", borderRadius: 20, border: "1px solid", letterSpacing: 0.5 },
  sysNav: { position: "relative", zIndex: 1, display: "flex", gap: 4, padding: "8px 24px", borderBottom: "1px solid #0a1f35", overflowX: "auto" },
  sysBtn: { display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 7, border: "1px solid #0a1f35", background: "transparent", cursor: "pointer", color: "#1e3a5f", fontFamily: "inherit", transition: "all 0.2s", flexShrink: 0 },
  subNav: { position: "relative", zIndex: 1, display: "flex", gap: 4, padding: "6px 24px", borderBottom: "1px solid #0a1f35", flexWrap: "wrap" },
  subBtn: { padding: "5px 14px", borderRadius: 5, border: "1px solid #0a1f35", background: "transparent", cursor: "pointer", color: "#334155", fontFamily: "inherit", fontSize: 10, fontWeight: 700, transition: "all 0.15s" },
  body: { position: "relative", zIndex: 1, display: "flex", flex: 1 },
  left: { width: 310, flexShrink: 0, padding: "14px", borderRight: "1px solid #0a1f35", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" },
  card: { background: "#060f1e", borderRadius: 7, padding: "10px 12px", border: "1px solid" },
  lbl: { fontSize: 8, fontWeight: 800, letterSpacing: 2, color: "#1e3a5f", marginBottom: 6, textTransform: "uppercase" },
  txt: { fontSize: 11, color: "#64748b", lineHeight: 1.9, margin: 0 },
  listCard: { background: "#060f1e", borderRadius: 7, padding: "10px 12px", border: "1px solid #0a1f35", display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", gap: 6, alignItems: "flex-start" },
  rowTxt: { fontSize: 11, color: "#475569", lineHeight: 1.75 },
  center: { flex: 1, padding: "14px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflowY: "auto" },
  svgWrap: { width: "100%", maxWidth: 680, background: "#060f1e", borderRadius: 10, border: "1px solid #0a1f35", aspectRatio: "660/350", overflow: "hidden" },
  runBtn: { padding: "10px 32px", borderRadius: 7, border: "1px solid", fontFamily: "inherit", fontSize: 11, fontWeight: 800, letterSpacing: 1.5, cursor: "pointer", transition: "all 0.2s", textTransform: "uppercase" },
  log: { width: "100%", maxWidth: 680, background: "#060f1e", borderRadius: 8, border: "1px solid #0a1f35", padding: "10px 14px", maxHeight: 220, overflowY: "auto" },
  logEmpty: { fontSize: 9, color: "#0a1f35", fontStyle: "italic" },
  logRow: { display: "flex", gap: 6, alignItems: "center", padding: "3px 6px 3px 8px", borderLeft: "2px solid", borderRadius: "0 3px 3px 0", transition: "all 0.25s", flexWrap: "wrap", marginBottom: 2 },
};

export default function ArchPatternsSim() {
  return (
    <>
      <Nav />
      <div style={{ paddingTop: 48 }}>
        <ArchPatternsSimInner />
      </div>
    </>
  )
}
