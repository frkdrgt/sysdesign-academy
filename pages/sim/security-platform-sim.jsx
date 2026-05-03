import { useState, useEffect, useRef, useCallback } from "react";
import Nav from '../../components/Nav'

// ══════════════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════════════

const SYSTEMS = {
  oauth: {
    label: "OAuth2 & OIDC",
    emoji: "🔑",
    accent: "#f97316",
    tagline: "Authorization Code · PKCE · Refresh Token Rotation",
    subsections: [
      {
        id: "auth_code_flow",
        name: "Authorization Code + PKCE",
        problem: "Kullanıcı 'Google ile giriş yap' butonuna bastı. Uygulamamız kullanıcının Google şifresini asla görmemeli ve Google kullanıcının profiline erişim izni vermesi için kullanıcıyı yönlendirmelidir. Ama authorization code network üzerinden gidip gelirken intercept edilirse ne olur?",
        solution: "OAuth2 Authorization Code Flow + PKCE (Proof Key for Code Exchange): (1) Client bir code_verifier (random 128 byte) üretir, SHA256'sını alır → code_challenge. (2) User, authorization server'a yönlendirilir, code_challenge gönderilir. (3) User login olur, izin verir, auth server callback URL'e authorization_code döndürür. (4) Client, code + code_verifier ile access_token ister. Auth server code_verifier'ı hash'ler, code_challenge ile eşleşiyor mu kontrol eder. (5) Eşleşirse access_token + refresh_token döner. PKCE'nin önemi: code intercept edilse bile saldırgan code_verifier'ı bilmediği için token alamaz. SPA ve mobile için zorunlu (implicit flow artık deprecated).",
        whenToUse: [
          "PKCE her zaman kullan: public client (SPA, mobile app) için zorunlu, confidential client (server-side web app) için de önerilir. PKCE, implicit flow'un tüm güvenlik problemlerini çözer. 2019'dan beri OAuth 2.0 Security BCP (Best Current Practice) PKCE'yi zorunlu kılıyor",
          "State parametresi ile CSRF koruması: authorization request'e random state ekle, callback'te doğrula. 'Attacker kurbanı kendi hesabına bağlamak' saldırısını önler (OAuth CSRF). Nonce: OIDC'de ID token'a replay saldırısını önler",
          "Scope granülaritesi tasarımı: 'read:profile', 'write:profile', 'read:orders', 'write:orders' — her izin ayrı scope. Kullanıcı hangi izni verdiğini açıkça görür. Scope 'admin' gibi monolitik olursa kullanıcı neye izin verdiğini bilemez. Least privilege: token sadece gerekli scope'u içermeli",
          "OIDC vs OAuth2 farkı: OAuth2 authorization (yetkilendirme) — 'bu uygulamanın X'e erişimine izin veriyorum'. OIDC authentication (kimlik doğrulama) — 'bu kullanıcı kim'. OIDC, OAuth2 üzerine inşa edilmiştir; ID token (JWT) ekler. 'Google ile giriş' = OIDC. 'GitHub API'ye erişim' = OAuth2",
          "Token endpoint güvenliği: client_secret confidential client'ta server-side tutulur, asla client'a (browser, mobile) gönderilmez. Mobile/SPA → PKCE + no client_secret. Server-side web app → client_secret + PKCE. Token endpoint HTTPS zorunlu, TLS 1.2 minimum",
        ],
        pitfalls: [
          "Authorization code'un tek kullanımlık olması zorunlu: kod bir kez kullanıldıktan sonra auth server onu geçersiz saymalı. Aynı kod ikinci kez kullanılırsa refresh_token da iptal et (code injection saldırısı belirtisi). Bazı auth server implementasyonları bunu atlar — güvenlik açığı",
          "Redirect URI doğrulama titizliği: authorization request'teki redirect_uri, kayıtlı URI ile tam eşleşmeli (prefix match değil, exact match). 'https://app.com/callback?extra=param' farklı URI. Saldırgan benzer domain kullanabilir: 'https://app.com.evil.com/callback'. Exact match ve whitelist zorunlu",
          "Token'ı nerede sakla (browser): localStorage — XSS ile çalınabilir (document.cookie okumak gibi). Cookie (HttpOnly) — XSS'e karşı korumalı ama CSRF riski var. SameSite=Strict + HttpOnly cookie en güvenli. Memory (state) — sayfa yenilenince kaybolur, UX bozulur. BFF pattern: token'ı server'da tut, session cookie'yi browser'a ver",
          "Implicit flow artık deprecated: access_token URL fragment'ta geliyordu (#access_token=...) — browser history'de kalırdı, log'lara düşerdi, referrer header'ında gözükebilirdi. 2019'dan beri tüm RFC ve BCP'ler implicit flow'u yasaklıyor. Yerine: Authorization Code + PKCE",
          "Consent screen atlatma: bazı OAuth implementasyonları aynı client için tekrar consent göstermez (prompt=none). Saldırgan kurbanı authorization endpoint'e yönlendirirse ve kurban login'se, consent görmeden otomatik authorize olabilir. Çözüm: kritik scope'lar için her seferinde consent iste (prompt=consent)",
        ],
        steps: [
          { from: "browser",  to: "app",        label: "click 'Google ile Giriş'",               color: "#f97316", delay: 0 },
          { from: "app",      to: "app",         label: "generate code_verifier + code_challenge", color: "#f97316", delay: 700, self: true },
          { from: "app",      to: "google",      label: "redirect: /authorize?code_challenge=X&state=Y", color: "#f97316", delay: 1400 },
          { from: "google",   to: "browser",     label: "login page → user authenticates",        color: "#fbbf24", delay: 2200 },
          { from: "browser",  to: "google",      label: "user grants consent",                    color: "#fbbf24", delay: 3000 },
          { from: "google",   to: "app",         label: "callback: ?code=AUTH_CODE&state=Y",       color: "#f97316", delay: 3800 },
          { from: "app",      to: "app",         label: "verify state=Y (CSRF check)",            color: "#34d399", delay: 4500, self: true },
          { from: "app",      to: "google",      label: "POST /token {code, code_verifier}",       color: "#f97316", delay: 5300 },
          { from: "google",   to: "google",      label: "verify: sha256(code_verifier)==code_challenge", color: "#fbbf24", delay: 6000, self: true },
          { from: "google",   to: "app",         label: "access_token + refresh_token + id_token", color: "#34d399", delay: 6800, note: "PKCE doğrulandı" },
          { from: "app",      to: "browser",     label: "HttpOnly session cookie (token server'da)", color: "#34d399", delay: 7600, note: "Token browser'da değil" },
        ],
        layout: {
          nodes: [
            { id: "browser", label: "Browser\n(User)", x: 60, y: 175, color: "#94a3b8" },
            { id: "app",     label: "App\nServer",     x: 250, y: 175, color: "#f97316" },
            { id: "google",  label: "Google\n(Auth Server)", x: 480, y: 175, color: "#fbbf24" },
          ],
        },
      },
      {
        id: "refresh_token",
        name: "Refresh Token Rotation",
        problem: "Access token 15 dakika geçerli — süresi dolunca kullanıcı her seferinde login olmalı mı? Refresh token ile yenileme yapılabilir. Ama refresh token çalınırsa saldırgan süresiz erişim kazanır. Çalınan token nasıl tespit edilir ve iptal edilir?",
        solution: "Refresh Token Rotation (RFC 6749 + 9068): her refresh token kullanımında yeni bir access_token + yeni bir refresh_token üretilir, eski refresh_token iptal edilir. Saldırı tespiti: eski (iptal edilmiş) refresh_token kullanılırsa bu ya replay saldırısı ya da token çalınmış demektir. Tüm token ailesi (token family) iptal edilir — hem saldırgan hem de gerçek kullanıcı logout olur. Kullanıcı beklenmedik logout görünce şüphelenir. Absolute expiry: refresh token maksimum 30-90 gün geçerli, sonrasında her halükarda yeniden login.",
        whenToUse: [
          "Token family (aile) takibi: her token chain'inin bir family_id'si olur. Refresh_token_1 → refresh_token_2 → refresh_token_3 hepsi aynı family. Eski token kullanılırsa family'deki tüm token'lar iptal edilir. Bu reuse detection mekanizması. Auth0, Okta, Keycloak bu pattern'i destekler",
          "Sliding expiry vs absolute expiry: sliding — her kullanımda TTL yenilenir, aktif kullanıcı hiç logout olmaz. Absolute — maksimum 90 gün sonra mutlaka re-login. Güvenlik: absolute + sliding birlikte. 'Son kullanımdan 30 gün sonra veya ilk kullanımdan 90 gün sonra hangisi önce gelirse'. Banking uygulamaları: 8 saat absolute, 15 dakika inaktivite sliding",
          "Secure storage stratejisi platform bazlı: iOS → Keychain (hardware-backed). Android → EncryptedSharedPreferences veya Keystore. Web → HttpOnly cookie (XSS-proof) veya BFF pattern (token server'da, session cookie browser'da). Desktop → OS credential manager. Her platform için en güvenli native storage zorunlu — localStorage/sessionStorage güvensiz",
          "Refresh token endpoint rate limiting: aynı refresh_token'a dakikada 1'den fazla request gelirse şüpheli. Distributed bots bunu farklı IP'lerden yapabilir — her token için değil, her family için rate limit uygula. Token rotation sırasında race condition: iki eş zamanlı request aynı refresh_token kullanırsa hangisi yeni token alır? Mutex ile serialize et veya idempotent rotation",
        ],
        pitfalls: [
          "Token revocation propagation gecikmesi: access_token kısa ömürlü (15dk) ve stateless (JWT) ise revoke edilse de 15 dakika geçerli. Gerçek zamanlı revocation için: introspection endpoint (her request'te token geçerliliği auth server'dan sorgulanır — her API çağrısına latency ekler) veya token blacklist (Redis'te iptal edilen token ID'leri) veya kısa TTL (1-5 dk access_token, revocation window küçülür)",
          "JWT'nin stateless paradoksu: JWT'yi decode edebilirsin ama imzayı doğrulamak için public key gerekir. Logout'ta JWT'yi invalidate etmek istersen bir yerde saklamak zorundasın — artık stateless değil. Çözüm: access_token çok kısa (5dk), logout'ta refresh_token'ı DB'den sil, kullanıcı 5dk sonra otomatik çıkış yapar",
          "Refresh token theft senaryosu: mobile app'te refresh token bellekte ya da güvensiz storage'da. Malware okur. Rotation ile: malware refresh_token'ı kullanınca yeni token alır, eski iptal olur. Gerçek kullanıcı bir sonraki API çağrısında 401 alır. Kullanıcı tekrar login olur, family iptal edilir, malware'ın token'ı da geçersiz. Ama aradaki pencerede (malware tokenı kullandı, kullanıcı fark etti arası) erişim sürer",
          "Interoperability: farklı client'lar aynı refresh_token'ı paylaşmamalı. Kullanıcının her client (web, iOS, Android) ayrı token family almalı. Logout 'bu cihazdan' → sadece bu family iptal. Logout 'tüm cihazlardan' → tüm family'ler iptal",
        ],
        steps: [
          { from: "client",  to: "api",       label: "GET /data [access_token expired]",   color: "#f97316", delay: 0 },
          { from: "api",     to: "client",    label: "401 Unauthorized",                    color: "#ef4444", delay: 700 },
          { from: "client",  to: "auth",      label: "POST /token {refresh_token=RT1}",     color: "#f97316", delay: 1500 },
          { from: "auth",    to: "auth",      label: "verify RT1, mark RT1 as used",        color: "#fbbf24", delay: 2200, self: true },
          { from: "auth",    to: "client",    label: "access_token=AT2 + refresh_token=RT2", color: "#34d399", delay: 3000, note: "RT1 iptal, RT2 yeni" },
          { from: "client",  to: "api",       label: "GET /data [AT2]",                     color: "#34d399", delay: 3800 },
          { from: "api",     to: "client",    label: "200 OK + data",                       color: "#34d399", delay: 4600 },
          { from: "attacker",to: "auth",      label: "POST /token {refresh_token=RT1} ← stolen", color: "#ef4444", delay: 5600 },
          { from: "auth",    to: "auth",      label: "RT1 already used! Revoke entire family", color: "#ef4444", delay: 6300, self: true },
          { from: "auth",    to: "attacker",  label: "400 invalid_grant (RT1 revoked)",     color: "#ef4444", delay: 7100 },
          { from: "auth",    to: "client",    label: "alert: suspicious activity detected", color: "#fbbf24", delay: 7900, note: "Kullanıcıya bildirim" },
        ],
        layout: {
          nodes: [
            { id: "client",   label: "Client\nApp",     x: 80,  y: 120, color: "#f97316" },
            { id: "attacker", label: "Attacker",        x: 80,  y: 280, color: "#ef4444" },
            { id: "auth",     label: "Auth\nServer",    x: 330, y: 200, color: "#fbbf24" },
            { id: "api",      label: "Resource\nAPI",   x: 560, y: 120, color: "#34d399" },
          ],
        },
      },
    ],
  },

  jwt_token: {
    label: "JWT vs Opaque Token",
    emoji: "🎟",
    accent: "#a78bfa",
    subsections: [
      {
        id: "jwt_anatomy",
        name: "JWT Anatomisi & Güvenlik",
        problem: "JWT her yerde kullanılıyor ama birçok implementasyon tehlikeli hata içeriyor. 'alg: none' saldırısı, weak secret, sensitive data in payload, token'ın nerede saklandığı — bunların hepsini bilen kaç kişi var?",
        solution: "JWT = header.payload.signature (Base64URL encoded, nokta ile ayrılmış). Header: {alg:'RS256', typ:'JWT'}. Payload: {sub:'userId', iat:timestamp, exp:timestamp, scope:'read:orders'}. Signature: RS256 ile private key ile imzalanır, public key ile doğrulanır. Asimetrik algoritma (RS256/ES256): auth server private key tutar, resource server public key ile doğrular — resource server'ın private key'e ihtiyacı yok, key dağıtımı güvenli. Simetrik (HS256): her servis aynı secret'ı bilmeli — paylaşım riski. Microservice'te RS256/ES256 tercih et.",
        whenToUse: [
          "RS256 (RSA) vs ES256 (ECDSA) seçimi: ES256 key boyutu çok daha küçük (256-bit vs 2048-bit RSA), imzalama daha hızlı, mobil için ideal. RS256 daha yaygın, ekosistem desteği geniş. ES256 performans kritikse. Her iki algoritma da güvenli — HS256 (HMAC) microservice'te sorunlu çünkü secret paylaşımı gerektirir",
          "JWT payload'a ne koyma: kullanıcı ID'si, roller, scope'lar uygun. Şifre hash'i, kredi kartı numarası, PII (telefon, adres) asla. JWT Base64 encoded — şifreli değil, herkes decode edebilir (sadece imzayı verify edemez). JWE (JSON Web Encryption) kullanmıyorsan payload herkese açık",
          "JWT'nin stateless avantajı: her API call'da auth server'a sorgu gerekmez, resource server public key ile lokal doğrular. P99 latency: introspection ~5ms, JWT ~0.1ms. Yüksek trafikli API'lerde bu fark büyük. Cache: JWKS (JSON Web Key Set) endpoint'ini cache'le, public key her request'te çekilmez",
          "nbf (not before) ve iat (issued at) claim'leri: nbf — bu tarihten önce geçersiz. Gelecek tarihli token'lar için kullanılır (scheduled access). iat — üretilme zamanı, token yaşını hesaplamak için. jti (JWT ID): her token'a unique ID, replay saldırısını önler. jti blacklist ile revoke edilmiş token'lar izlenebilir",
          "JWKS endpoint ve key rotation: auth server /jwks.json endpoint'i yayınlar, tüm aktif public key'leri içerir. Resource server bu endpoint'i cache'ler (TTL: 1 saat). Key rotation: yeni key çifti oluştur, eski key'i hemen silme. Eski key'le imzalı token'lar expire olana kadar eski key de JWKS'te kalır (kid ile ayırt edilir)",
        ],
        pitfalls: [
          "alg: none saldırısı: saldırgan JWT header'ını {alg:'none'} ile değiştirir, signature'ı siler. Bazı kütüphaneler bunu kabul eder. Çözüm: doğrulama sırasında algoritma whitelist'i belirt — beklenen algoritma dışındakileri reddet. Asla alg parametresini token'dan okuma, sabit kodla",
          "HS256 secret zayıflığı: 'secret123' gibi kısa/tahmin edilebilir HMAC key — brute force ile kırılır. JWT secret minimum 256-bit (32 byte) random olmalı. Farklı environment'lar için farklı secret. Secret rotation: mevcut token'lar expire olana kadar eski secret'la doğrulama devam eder, yeni token'lar yeni secret ile",
          "Token boyutu gerçeği: JWT base payload ~200-300 byte, claim'ler eklenince 500-1KB. Her HTTP request'te Authorization header olarak gönderilir. 100 claim, nested role, büyük scope listesi → 2-5KB JWT. Cookie boyutu sınırı 4KB. CDN/proxy log'ları her request'in header'ını loglar → JWT'deki veri log'lara düşer. Minimal payload: sadece sub, exp, scope",
          "Clock skew ve exp doğrulaması: farklı sunucuların saatleri birkaç saniye farklı olabilir. Token tam expire noktasındaysa bir server geçerli, başka server geçersiz sayar. Çözüm: ±30 saniye clock skew toleransı (leeway). Ama çok büyük leeway güvenlik riski — 5 dakika fazla",
          "JWT'ye güvenme ama verify etme hatası: 'JWT geldi, decode ettim, sub field'ına baktım' — signature doğrulamadan. Bu çok yaygın hata. Library'nin verify fonksiyonunu kullan, decode fonksiyonunu değil. RS256'da JWKS endpoint'ten public key çek, her token için doğrula. Expired token'ı kabul etme — exp claim'ini mutlaka kontrol et",
        ],
        steps: [
          { from: "client",    to: "auth",    label: "POST /token (login success)",         color: "#a78bfa", delay: 0 },
          { from: "auth",      to: "auth",    label: "sign JWT: RS256(header.payload, privateKey)", color: "#818cf8", delay: 700, self: true },
          { from: "auth",      to: "client",  label: "JWT: eyJhbGc.eyJzdW.SflKxw",          color: "#a78bfa", delay: 1500, note: "header.payload.sig" },
          { from: "client",    to: "api",     label: "GET /orders [Authorization: Bearer eyJ...]", color: "#a78bfa", delay: 2500 },
          { from: "api",       to: "jwks",    label: "GET /jwks.json (cached public key)",  color: "#60a5fa", delay: 3200 },
          { from: "jwks",      to: "api",     label: "RSA public key (kid=key-1)",          color: "#60a5fa", delay: 3900 },
          { from: "api",       to: "api",     label: "verify sig + exp + iss (no network)", color: "#34d399", delay: 4700, self: true },
          { from: "api",       to: "client",  label: "200 OK + orders data",                color: "#34d399", delay: 5500, note: "Auth server'a gidilmedi" },
          { from: "attacker",  to: "api",     label: "tampered JWT: {alg:'none'}.payload",  color: "#ef4444", delay: 6700 },
          { from: "api",       to: "attacker",label: "401: alg 'none' not allowed",          color: "#ef4444", delay: 7400, note: "Whitelist korudu" },
        ],
        layout: {
          nodes: [
            { id: "client",   label: "Client",          x: 60,  y: 130, color: "#a78bfa" },
            { id: "attacker", label: "Attacker",        x: 60,  y: 270, color: "#ef4444" },
            { id: "auth",     label: "Auth\nServer",    x: 250, y: 200, color: "#818cf8" },
            { id: "jwks",     label: "JWKS\nEndpoint",  x: 450, y: 80,  color: "#60a5fa" },
            { id: "api",      label: "Resource\nAPI",   x: 560, y: 200, color: "#34d399" },
          ],
        },
      },
      {
        id: "opaque_vs_jwt",
        name: "Opaque Token vs JWT",
        problem: "JWT stateless ama revoke edilemiyor. Opaque token revoke edilebilir ama her API çağrısında auth server'a istek gitmesi gerekiyor. Hangisi, ne zaman? Hybrid yaklaşım var mı?",
        solution: "Opaque token: auth server ürettiği random string, her doğrulamada introspection endpoint'i çağrılır. Token revoke edilince hemen geçersiz — gerçek zamanlı kontrol. JWT: self-contained, her doğrulama lokaldir. Revoke etmek için blacklist veya çok kısa TTL gerekir. Hybrid (RFC 9068 + best practice): access_token = kısa ömürlü JWT (5-15dk), refresh_token = opaque (DB'de). JWT expire olunca opaque refresh_token ile yeni JWT alınır. Logout: refresh_token'ı DB'den sil → maximum 15dk sonra JWT'ler de geçersiz. Kritik operasyon (para transfer, şifre değişikliği): JWT bile olsa re-authentication iste.",
        whenToUse: [
          "Opaque token ne zaman: B2B API (third-party developer) — token revocation anında etkili, şirket hesabı kapatılınca tüm API erişimi hemen kesilir. Admin paneli — yetki değişikliği hemen etkili. Finansal işlemler — her transaction'da introspection, kesin güvence. Dezavantaj: her API çağrısı auth server'a gider, latency artar, auth server SPOF olur",
          "JWT ne zaman: yüksek trafikli read-heavy API — auth server'a her seferinde gitmek hem latency hem maliyet. Microservice arası dahili iletişim — auth server'a erişmeden doğrulama. CDN'de cache'lenen API — CDN token doğrulama yapamaz, ama JWT'yi parse etmek için edge function eklenebilir. Stateless horizontal scale — her instance auth server'a bağımlı değil",
          "Token introspection caching: opaque token'ın her request'te auth server'a gitmesi yerine: token hash'ini Redis'e key, {scope, userId, exp} değer olarak cache'le (TTL = token'ın kalan ömrü). Böylece çoğu request Redis'ten cevap alır (< 1ms), auth server'a nadiren gider. Revoke: Redis'ten sil + DB'den sil. Cache invalidation süresi = max latency tolerated",
          "Token binding (DPoP - Demonstrating Proof of Possession): token bir client'ın public key'ine bağlanır. Token çalınsa bile başka client kullanamaz çünkü özel anahtarla imzalı proof gerekmektedir. RFC 9449 standard. mTLS token binding: MTLS client sertifikası token'a bağlanır — yalnızca o sertifikayla kullanılabilir",
        ],
        pitfalls: [
          "JWT revocation 'tüm cihazlardan çıkış' problemi: kullanıcı 'tüm cihazlardan çıkış' dedi. Refresh token'ları silebildin. Ama aktif JWT'ler hâlâ geçerli — expire olana kadar (15dk). Bu 15 dakikalık pencerede saldırgan hâlâ API'ye erişebilir. Çözüm: JWT'ye version/generation claim ekle. Her logout'ta user.token_version'ı artır. JWT doğrulamada DB'den user.token_version kontrol et. Bu stateless'ı bozar ama revocation window'u sıfırlar",
          "Introspection DoS: her request auth server'a giderse auth server SPOF olur. Auth server down → tüm API'ler çalışmaz. Cache partial fix sağlar ama cache miss'te yine auth server'a gidilir. Çözüm: auth server multi-region, health check, circuit breaker, fallback (cache'te bulunmazsa deny değil, kısa süre allow — degraded mode)",
          "JWT'yi API gateway'de doğrulama ama claim'leri upstream'e geçirmeme: gateway JWT'yi doğrular, ama upstream servise ham JWT veya decoded claim'leri header olarak geçirmezse upstream servis 'kim bu kullanıcı?' bilmez. Çözüm: gateway decoded claim'leri (X-User-Id, X-User-Scope) güvenilir header olarak geçirir. Upstream bu header'lara güvenir — JWT'yi tekrar doğrulamaması gerekir (zaten gateway doğruladı)",
        ],
        steps: [
          { from: "client",  to: "api",      label: "GET /data [opaque_token=abc123]",      color: "#a78bfa", delay: 0 },
          { from: "api",     to: "redis",    label: "GET token:abc123 (cache lookup)",       color: "#fbbf24", delay: 700 },
          { from: "redis",   to: "api",      label: "nil (cache miss)",                     color: "#475569", delay: 1400 },
          { from: "api",     to: "auth",     label: "POST /introspect {token:abc123}",       color: "#a78bfa", delay: 2100 },
          { from: "auth",    to: "api",      label: "{active:true, sub:42, scope:'read'}",   color: "#34d399", delay: 2900 },
          { from: "api",     to: "redis",    label: "SET token:abc123 {sub:42} EX 300",      color: "#fbbf24", delay: 3600, note: "5dk cache" },
          { from: "client",  to: "api",      label: "GET /data [opaque_token=abc123] again", color: "#a78bfa", delay: 4800 },
          { from: "api",     to: "redis",    label: "GET token:abc123",                      color: "#fbbf24", delay: 5500 },
          { from: "redis",   to: "api",      label: "HIT: {sub:42, scope:'read'}",           color: "#34d399", delay: 6200, note: "Auth server'a gidilmedi" },
          { from: "api",     to: "client",   label: "200 OK",                               color: "#34d399", delay: 7000 },
        ],
        layout: {
          nodes: [
            { id: "client", label: "Client",      x: 60,  y: 175, color: "#a78bfa" },
            { id: "api",    label: "Resource\nAPI", x: 260, y: 175, color: "#818cf8" },
            { id: "redis",  label: "Redis\nCache",  x: 450, y: 90,  color: "#fbbf24" },
            { id: "auth",   label: "Auth\nServer",  x: 570, y: 220, color: "#f97316" },
          ],
        },
      },
    ],
  },

  api_gateway: {
    label: "API Gateway Deep Dive",
    emoji: "🚪",
    accent: "#22d3ee",
    tagline: "Auth · Rate Limit · Circuit Breaker · Transform",
    subsections: [
      {
        id: "gateway_pipeline",
        name: "Request Pipeline",
        problem: "Her mikroservis kendi auth doğrulamasını, rate limiting'ini, logging'ini mi yapmalı? Bu cross-cutting concern'leri 50 servise ayrı ayrı eklemek hem kod tekrarı hem tutarsızlık yaratır. API Gateway tüm bunları tek bir yerden nasıl halleder?",
        solution: "API Gateway, tüm gelen trafiğin geçtiği tek giriş noktasıdır. Her request sıralı middleware pipeline'ından geçer: (1) SSL termination: TLS burada sonlanır, backend'e HTTP gider. (2) Auth: JWT/opaque token doğrulaması, claim'ler header'a eklenir. (3) Rate limiting: Redis ile sliding window, kullanıcı/IP/API key bazlı. (4) Request validation: schema validation (JSON Schema / OpenAPI). (5) Circuit breaker: downstream servis defalarca hata verirse istekleri kes. (6) Routing: path/header bazlı upstream servis seçimi. (7) Transform: request/response header ekleme/silme, payload transform. (8) Logging/tracing: correlation ID inject, request/response log. Her katman modüler — Kong, AWS API GW, Nginx, Envoy bu pipeline'ı plugin sistemiyle genişletir.",
        whenToUse: [
          "SSL termination gateway'de: backend servislere TLS yükü binmez. Gateway → backend arası iç ağda — güvenlik gereksinimi azalır (veya mTLS ile karşılanır). Sertifika yönetimi tek noktada — 50 serviste ayrı ayrı sertifika değil. Let's Encrypt auto-renewal: Certbot gateway'de çalışır",
          "Rate limiting granülaritesi: IP bazlı (DDoS'a karşı), API key bazlı (abuser'ı kes), user ID bazlı (cost per user), endpoint bazlı (/login endpoint'ine dakikada 5, /search'e 100). Farklı katmanlar farklı Redis key: 'ratelimit:ip:1.2.3.4:minute', 'ratelimit:key:apiKey123:hour'. Burst allowance: token bucket ile anlık spike'a izin ver ama ortalamayı koru",
          "Circuit breaker gateway seviyesinde: Hystrix, Resilience4j, Envoy'un outlierDetection'ı. Sayaçlar: ardarda 5 hata → circuit OPEN (30 saniye). OPEN'da: immediate 503, downstream'e hiç gitme. HALF-OPEN: 30 saniye sonra tek test request. Başarılı → CLOSED. Başarısız → OPEN. Bu pattern hem downstream'i korur hem client'a hızlı yanıt verir",
          "Request transformation kullanım alanları: mobile client'ın beklediği format ile backend'in ürettiği format farklı olabilir. Gateway'de response mapping: backend'in snake_case field'larını camelCase'e çevir. Backend version upgrade'inde: gateway v1 request'ini v2 formatına transform eder — client kodu değişmez. GraphQL → REST transcoding: gateway GraphQL query'yi REST endpoint çağrılarına çevirir",
          "Correlation ID propagation: gateway her request'e X-Correlation-Id header'ı inject eder (UUID). Tüm downstream servisler bu ID'yi log'larına ekler. Distributed trace: farklı servisler farklı sunucularda ama aynı correlation ID ile log'larını birleştirebilirsin. Jaeger/Zipkin: bu ID üzerinden trace görselleştirilir",
        ],
        pitfalls: [
          "Gateway SPOF ve HA: tek gateway node tüm trafiğin geçtiği yer — çökerse sistem tamamen durur. Çözüm: active-active cluster (birden fazla gateway instance, load balancer önünde). Gateway'in kendisi stateless olmalı — session/state dışarıda (Redis). Blue-green gateway deploy: yeni config/plugin deploy'unda kademeli rollout, anında rollback",
          "Rate limiting distributed race condition: iki gateway instance aynı anda aynı API key'in request'ini işliyor. Her ikisi Redis'e INCR gönderirse count iki kez artıyor gibi görünür ama aslında Redis tek-thread olduğu için INCR atomic. Sorun değil. Ama iki gateway FARKLI Redis'e yazıyorsa (yanlış config): her biri limit'in yarısını sayar, efektif limit 2x olur. Çözüm: tüm gateway instance'ları aynı Redis cluster'a yazmalı",
          "mTLS ve SSL termination birlikte: gateway SSL terminate eder, backend'e HTTP gönderir. Ama backend'e mTLS zorunluysa gateway backend'le ayrı TLS bağlantısı kurar. Bu 're-encryption' performans maliyeti var. Çözüm: gateway → backend arası için wildcard sertifika veya service mesh (gateway sidecar proxy olarak davranır)",
          "Webhook ve long-polling gateway üzerinden geçince: gateway genellikle request timeout ayarı var (30-60 saniye). Long polling (30+ saniye bekleyen request) gateway timeout'a çarpar. WebSocket de gateway'de special handling gerektirir (HTTP Upgrade, persistent connection). Çözüm: WebSocket için ayrı gateway path veya layer-4 load balancer",
          "Gateway logic creep: zamanla gateway'e too much business logic eklenir. 'Şu endpoint'e sadece premium kullanıcı gitsin' — bu gateway'de mi, uygulamada mı? Gateway: cross-cutting concern (auth, rate limit, routing). Business logic: serviste. Boundary sağlamak kritik — gateway şişerse test edilemez, deployment riski artar",
        ],
        steps: [
          { from: "client",  to: "gateway",   label: "POST /orders [Bearer JWT, body:{}]",   color: "#22d3ee", delay: 0 },
          { from: "gateway", to: "gateway",   label: "① SSL terminate + correlation ID inject", color: "#22d3ee", delay: 700, self: true },
          { from: "gateway", to: "auth_mw",   label: "② verify JWT (local, JWKS cache)",     color: "#a78bfa", delay: 1500 },
          { from: "auth_mw", to: "gateway",   label: "✓ userId=42, scope=write:orders",       color: "#34d399", delay: 2200 },
          { from: "gateway", to: "rl_mw",     label: "③ rate limit: apiKey 429/min?",         color: "#fbbf24", delay: 3000 },
          { from: "rl_mw",   to: "gateway",   label: "✓ 43/429 used",                        color: "#34d399", delay: 3700 },
          { from: "gateway", to: "cb_mw",     label: "④ circuit breaker: order-svc status?", color: "#f97316", delay: 4500 },
          { from: "cb_mw",   to: "gateway",   label: "CLOSED (healthy)",                     color: "#34d399", delay: 5200 },
          { from: "gateway", to: "order_svc", label: "⑤ POST /orders [X-User-Id: 42, X-Correlation-Id: uuid]", color: "#22d3ee", delay: 6000 },
          { from: "order_svc",to:"gateway",   label: "201 Created {orderId:99}",             color: "#34d399", delay: 6800 },
          { from: "gateway", to: "client",    label: "201 Created + X-RateLimit-Remaining: 386", color: "#22d3ee", delay: 7600, note: "Headers inject edildi" },
        ],
        layout: {
          nodes: [
            { id: "client",    label: "Client",      x: 50,  y: 175, color: "#94a3b8" },
            { id: "gateway",   label: "API\nGateway", x: 200, y: 175, color: "#22d3ee" },
            { id: "auth_mw",   label: "Auth\nMiddleware", x: 360, y: 80,  color: "#a78bfa" },
            { id: "rl_mw",     label: "Rate Limit\nMiddleware", x: 360, y: 175, color: "#fbbf24" },
            { id: "cb_mw",     label: "Circuit\nBreaker", x: 360, y: 280, color: "#f97316" },
            { id: "order_svc", label: "Order\nService", x: 560, y: 175, color: "#34d399" },
          ],
        },
      },
      {
        id: "zero_trust",
        name: "Zero Trust & mTLS Gateway",
        problem: "'İç ağdayız, güvendeyiz' varsayımı artık geçerli değil. VPN içindeki bir saldırgan lateral movement ile tüm internal servislere ulaşabilir. Zero Trust: 'asla güvenme, her zaman doğrula.' API gateway'de ve servisler arasında bu nasıl uygulanır?",
        solution: "Zero Trust mimarisinin üç prensibi: (1) Verify explicitly: her request'i kimlik + context + cihaz sağlığına göre doğrula, sadece ağ konumuna güvenme. (2) Least privilege access: minimum gerekli izin, just-in-time erişim, just-enough-access. (3) Assume breach: zaten ihlal edildiğini varsay, blast radius'u minimize et, lateral movement'ı engelle. Teknik implementasyon: mTLS (her servis kriptografik kimliğe sahip), SPIFFE workload identity (pod/container kimliği), micro-segmentation (network policy ile servisler arası bağlantı whitelist), continuous verification (statik bir kez auth değil, her request'te context check), privileged access workstation (yönetim erişimi bile verified device'dan).",
        whenToUse: [
          "Workload identity (SPIFFE/SPIRE): 'bu service account bu namespace'de çalışıyor' kriptografik kanıt. IP adresi veya hostname'e güvenme — bunlar değişebilir, spooflanabilir. SPIFFE ID: 'spiffe://trust-domain/path' formatında URI. Her workload kısa ömürlü X.509 sertifikası alır. Sertifika = workload'un pasaportu",
          "Micro-segmentation network policy: Kubernetes NetworkPolicy ile 'sadece order-service, payment-service'e bağlanabilir'. Default deny-all, explicit allow. Bu rule VPN veya firewall kuralından farklı: pod seviyesinde, dinamik, Kubernetes API ile yönetilen. Calico, Cilium network policy engine'leri",
          "Continuous authorization: request başlangıcında bir kez auth değil, session boyunca context izleme. Kullanıcı lokasyonu değişti (anomaly detection) → re-auth iste. Cihaz health check başarısız → session kes. Time-based access: iş saatleri dışında admin erişimi engelle. BeyondCorp (Google'ın zero trust modeli) bu yaklaşımı öncüledi",
          "Privileged access management (PAM): admin erişimi için just-in-time provisioning — 'bu sunucuya 2 saat SSH erişimi ver, sonra iptal et'. Kalıcı admin account yok. Her işlem log'lanır. Vault (HashiCorp) dynamic secrets: her erişim için tek kullanımlık credential üretir, otomatik rotate",
        ],
        pitfalls: [
          "Zero trust başlangıç maliyeti: mevcut sistemi zero trust'a çevirmek 6-18 aylık proje. Tüm servislere sidecar inject, tüm network trafiğine policy yazma, identity provider entegrasyonu. ROI: ihlal maliyeti minimize, audit kolaylığı, compliance (SOC2, PCI-DSS, HIPAA). Büyük ölçekte Cloudflare Access, Zscaler, Google BeyondCorp Enterprise bu geçişi kolaylaştırır",
          "mTLS sertifika yönetimi operasyonel yük: kısa ömürlü sertifika (24 saat) rotasyonu otomasyonu şart. Cert-manager (Kubernetes) + Vault PKI: otomatik issuance + renewal. Bir serviste sertifika expire olursa tüm incoming mTLS bağlantısı kesilir — monitoring + alerting kritik. Sertifika expiry 7 gün öncesinde alert",
          "Zero trust ve developer experience: her local geliştirme ortamında da policy zorlanırsa developer'lar CI/CD pipeline kurmak zorunda kalır. Çözüm: local dev için PERMISSIVE mode, staging/prod için STRICT. Feature flag veya Helm value ile env bazlı policy. Developer'ların zero trust policy'yi lokal test edebileceği araç (istioctl proxy-status) sağla",
        ],
        steps: [
          { from: "user",    to: "gateway",   label: "GET /admin/users [JWT + device cert]",  color: "#22d3ee", delay: 0 },
          { from: "gateway", to: "idp",       label: "verify: JWT + device health check",     color: "#a78bfa", delay: 700 },
          { from: "idp",     to: "gateway",   label: "✓ user:admin, device:compliant, loc:TR",color: "#34d399", delay: 1500 },
          { from: "gateway", to: "policy",    label: "evaluate policy: admin + compliant + TR?", color: "#fbbf24", delay: 2300 },
          { from: "policy",  to: "gateway",   label: "ALLOW: least-privilege scope granted",  color: "#34d399", delay: 3100 },
          { from: "gateway", to: "user_svc",  label: "mTLS: SVID verified, X-User-Id header", color: "#22d3ee", delay: 3900 },
          { from: "user_svc",to: "gateway",   label: "200 OK + audit logged",                 color: "#34d399", delay: 4700 },
          { from: "attacker",to: "gateway",   label: "GET /admin/users [stolen JWT, no cert]", color: "#ef4444", delay: 6000 },
          { from: "gateway", to: "idp",       label: "verify: JWT ok but no device cert",      color: "#a78bfa", delay: 6700 },
          { from: "idp",     to: "gateway",   label: "device: NON-COMPLIANT",                  color: "#ef4444", delay: 7500 },
          { from: "gateway", to: "attacker",  label: "403 Forbidden: device not trusted",      color: "#ef4444", delay: 8300, note: "Zero trust bloke etti" },
        ],
        layout: {
          nodes: [
            { id: "user",     label: "Admin\nUser",    x: 55,  y: 110, color: "#22d3ee" },
            { id: "attacker", label: "Attacker",       x: 55,  y: 270, color: "#ef4444" },
            { id: "gateway",  label: "Zero Trust\nGateway", x: 240, y: 190, color: "#22d3ee" },
            { id: "idp",      label: "Identity\nProvider", x: 420, y: 90,  color: "#a78bfa" },
            { id: "policy",   label: "Policy\nEngine", x: 420, y: 200, color: "#fbbf24" },
            { id: "user_svc", label: "Admin\nService", x: 590, y: 150, color: "#34d399" },
          ],
        },
      },
    ],
  },
};

const SYS_ORDER = ["oauth", "jwt_token", "api_gateway"];

function SecurityPlatformSimInner() {
  const [sysId, setSysId] = useState("oauth");
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
    <div style={P.root}>
      <div style={P.grid} />
      <header style={P.header}>
        <div style={P.hL}>
          <span style={{ ...P.hDot, background: accent }} />
          <span style={P.hTitle}>Güvenlik & Platform</span>
          <span style={P.hSub}>OAuth2/OIDC · JWT · API Gateway · Zero Trust</span>
        </div>
        <div style={{ ...P.hPill, color: accent, borderColor: accent + "44", background: accent + "11" }}>
          {sys.emoji} {sys.label} · {sub.name}
        </div>
      </header>

      <nav style={P.sysNav}>
        {SYS_ORDER.map(id => {
          const s = SYSTEMS[id];
          return (
            <button key={id} onClick={() => switchSys(id)} style={{
              ...P.sysBtn,
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

      <div style={P.subNav}>
        {sys.subsections.map((s, i) => (
          <button key={s.id} onClick={() => switchSub(i)} style={{
            ...P.subBtn,
            ...(subIdx === i ? { borderColor: accent, color: "#f1f5f9", background: accent + "18" } : {}),
          }}>{s.name}</button>
        ))}
      </div>

      <div style={P.body}>
        <aside style={P.left}>
          <div style={{ ...P.card, borderColor: accent + "44" }}>
            <div style={{ ...P.lbl, color: accent }}>⚠ Problem</div>
            <p style={P.txt}>{sub.problem}</p>
          </div>
          <div style={{ ...P.card, borderColor: "#0f2540" }}>
            <div style={P.lbl}>✦ Tasarım</div>
            <p style={P.txt}>{sub.solution}</p>
          </div>
          <div style={P.listCard}>
            <div style={P.lbl}>✓ Ne Zaman / Nasıl</div>
            {sub.whenToUse.map((w, i) => (
              <div key={i} style={P.row}>
                <span style={{ color: "#34d399", flexShrink: 0, marginTop: 2 }}>›</span>
                <span style={P.rowTxt}>{w}</span>
              </div>
            ))}
          </div>
          <div style={P.listCard}>
            <div style={P.lbl}>⚡ Güvenlik Tuzakları</div>
            {sub.pitfalls.map((p, i) => (
              <div key={i} style={P.row}>
                <span style={{ color: "#ef4444", flexShrink: 0, marginTop: 2 }}>›</span>
                <span style={P.rowTxt}>{p}</span>
              </div>
            ))}
          </div>
        </aside>

        <main style={P.center}>
          <FlowDiagram layout={sub.layout} steps={sub.steps} animStep={animStep} accent={accent} />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={run} disabled={running} style={{
              ...P.runBtn,
              background: running ? "transparent" : accent,
              color: running ? accent : "#040c18",
              borderColor: accent,
              boxShadow: running ? "none" : `0 0 28px ${accent}77`,
            }}>{running ? "⟳ Çalışıyor..." : done ? "↺ Tekrar" : "▶ Simüle Et"}</button>
            {done && <span style={{ color: accent, fontSize: 11, fontWeight: 700 }}>✓ {sub.steps.length} adım</span>}
          </div>
          <div style={P.log}>
            {activeSteps.length === 0 && <div style={P.logEmpty}>▶ başlatmak için butona bas</div>}
            {activeSteps.map((s, i) => (
              <div key={i} style={{ ...P.logRow, borderLeftColor: s.color, background: i === animStep ? s.color + "12" : "transparent", opacity: i === animStep ? 1 : 0.5 }}>
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
    <div style={P.svgWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }}>
        <defs>
          <filter id="glowP"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <marker id="arrP" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill={accent} /></marker>
          <marker id="arrPd" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill="#0f2845" /></marker>
        </defs>
        {uniqueEdges.map((key, i) => {
          const [f, t] = key.split("|"); const ln = arrow(f, t);
          return ln ? <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke="#091929" strokeWidth="1.5" strokeDasharray="3 6" markerEnd="url(#arrPd)" /> : null;
        })}
        {activeSteps.filter(s => !s.self && posMap[s.from] && posMap[s.to]).map((s, i) => {
          const ln = arrow(s.from, s.to); if (!ln) return null;
          const isLast = i === animStep; const c = s.color || accent;
          const mx = (ln.x1 + ln.x2) / 2, my = (ln.y1 + ln.y2) / 2;
          return (
            <g key={`ln-${i}`}>
              <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke={c} strokeWidth={isLast ? 2.8 : 1.2} opacity={isLast ? 1 : 0.3} markerEnd="url(#arrP)" filter={isLast ? "url(#glowP)" : undefined} />
              {isLast && (<><rect x={mx - 70} y={my - 18} width={140} height={14} rx={3} fill="#040c18" opacity="0.92" /><text x={mx} y={my - 6} textAnchor="middle" fill={c} fontSize="8" fontWeight="700" fontFamily="monospace">{s.label.substring(0, 40)}</text></>)}
            </g>
          );
        })}
        {activeSteps.filter(s => s.self && posMap[s.from]).map((s, i) => {
          const n = posMap[s.from]; const isLast = steps.indexOf(s) === animStep;
          return <text key={`sf-${i}`} x={n.x} y={n.y - 40} textAnchor="middle" fill={s.color} fontSize="8.5" fontWeight="800" fontFamily="monospace" filter={isLast ? "url(#glowP)" : undefined}>{s.label.substring(0, 42)}</text>;
        })}
        {nodes.map(n => {
          const isActive = current && !current.self && (current.from === n.id || current.to === n.id);
          const lines = n.label.split("\n");
          return (
            <g key={n.id}>
              {isActive && <circle cx={n.x} cy={n.y} r={32} fill={n.color + "12"} />}
              <circle cx={n.x} cy={n.y} r={22} fill="#040c18" stroke={isActive ? n.color : n.color + "44"} strokeWidth={isActive ? 2.5 : 1.5} filter={isActive ? "url(#glowP)" : undefined} />
              {lines.map((ln, li) => <text key={li} x={n.x} y={n.y + (lines.length === 1 ? 4 : li * 10 - 2)} textAnchor="middle" fill={isActive ? n.color : n.color + "77"} fontSize="8" fontWeight="700" fontFamily="monospace">{ln}</text>)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const P = {
  root: { minHeight: "100vh", background: "#040c18", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", display: "flex", flexDirection: "column", position: "relative" },
  grid: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "radial-gradient(circle at 15% 30%, #0d203818 0%, transparent 55%), radial-gradient(circle at 85% 70%, #1a0a1e18 0%, transparent 55%)" },
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

export default function SecurityPlatformSim() {
  return (
    <>
      <Nav />
      <div style={{ paddingTop: 48 }}>
        <SecurityPlatformSimInner />
      </div>
    </>
  )
}
