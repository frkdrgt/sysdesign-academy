import Head from 'next/head'
import Link from 'next/link'
import Nav from '../components/Nav'

const SIMS = [
  {
    href: '/sim/microservices-sim',
    emoji: '⬡',
    title: 'Mikroservis Desenleri',
    subtitle: 'API Gateway · Circuit Breaker · Saga · CQRS · Event Sourcing',
    desc: 'Dağıtık sistemlerin temel yapı taşları. Her desen için animasyonlu akış simülasyonu ve detaylı trade-off analizi.',
    tags: ['Mimari', 'Dağıtık Sistemler'],
    accent: '#38bdf8',
    count: '5 desen',
  },
  {
    href: '/sim/reliability-patterns-sim',
    emoji: '🛡',
    title: 'Güvenilirlik Desenleri',
    subtitle: 'Outbox · Idempotency · DLQ · Delivery Guarantees · 2PC',
    desc: 'Mesaj kayıplarını, duplicate işlemleri ve dağıtık transaction başarısızlıklarını önleyen üretim kritik desenler.',
    tags: ['Reliability', 'Mesajlaşma'],
    accent: '#a78bfa',
    count: '5 desen',
  },
  {
    href: '/sim/data-storage-sim',
    emoji: '🗄',
    title: 'Veri Depolama',
    subtitle: 'Sharding · Replication · Cache Desenleri',
    desc: 'Range/Hash/Consistent Hash sharding, Leader-Follower/Quorum replication, Cache-Aside/Write-Through/Write-Behind.',
    tags: ['Veritabanı', 'Cache'],
    accent: '#22d3ee',
    count: '9 senaryo',
  },
  {
    href: '/sim/scalability-sim',
    emoji: '📈',
    title: 'Ölçeklenebilirlik',
    subtitle: 'Rate Limiting · Load Balancing · Auto-Scaling',
    desc: 'Token bucket, leaky bucket, sliding window algoritmalarını canlı dene. LB stratejilerini ve auto-scaling tetikleyicilerini simüle et.',
    tags: ['Ölçekleme', 'Performans'],
    accent: '#f97316',
    count: '11 senaryo',
  },
  {
    href: '/sim/infra-systems-sim',
    emoji: '⚙',
    title: 'Altyapı Sistemleri',
    subtitle: 'Redis · Kafka · PostgreSQL · RabbitMQ · Elasticsearch · ClickHouse',
    desc: '6 kritik altyapı sistemi, 16 konu. Data structure seçimi, consumer group, MVCC, exchange tipleri, shard routing, columnar storage.',
    tags: ['Redis', 'Kafka', 'PostgreSQL'],
    accent: '#ef4444',
    count: '16 konu',
  },
  {
    href: '/sim/system-design-sim',
    emoji: '🏗',
    title: 'Sistem Tasarımı Soruları',
    subtitle: 'URL Shortener · Notification · News Feed · Chat · Autocomplete · Distributed Lock · Pastebin',
    desc: 'Interview\'da en sık sorulan 7 sistem tasarımı sorusu. Her biri için adım adım tasarım, trade-off kararları ve animasyonlu akış.',
    tags: ['Interview', 'Tasarım'],
    accent: '#34d399',
    count: '14 senaryo',
  },
  {
    href: '/sim/arch-patterns-sim',
    emoji: '🕸',
    title: 'Mimari Desenler',
    subtitle: 'Service Mesh · API Versioning · REST vs GraphQL vs gRPC',
    desc: 'Istio mTLS, canary deployment, API deprecation döngüsü, protokol karşılaştırmaları. Modern platform mühendisliği temelleri.',
    tags: ['Mimari', 'Platform'],
    accent: '#818cf8',
    count: '5 senaryo',
  },
  {
    href: '/sim/security-platform-sim',
    emoji: '🔐',
    title: 'Güvenlik & Platform',
    subtitle: 'OAuth2/OIDC · JWT · API Gateway · Zero Trust',
    desc: 'PKCE flow, refresh token rotation, JWT alg:none saldırısı, opaque vs JWT trade-off, gateway pipeline, zero trust mimarisi.',
    tags: ['Güvenlik', 'Auth'],
    accent: '#f97316',
    count: '6 senaryo',
  },
]

const STATS = [
  { value: '8', label: 'Simülasyon' },
  { value: '75+', label: 'Senaryo' },
  { value: '40+', label: 'Sistem & Desen' },
  { value: '500+', label: 'Animasyonlu Adım' },
]

export default function Home() {
  return (
    <>
      <Head>
        <title>SysDesign Academy — Sistem Tasarımı Simülatörü</title>
        <meta name="description" content="Mikroservisler, Kafka, Redis, OAuth2, API Gateway ve daha fazlasını interaktif simülasyonlarla öğren. Sistem tasarımı mülakatlarına hazırlan." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⬡</text></svg>" />
      </Head>

      <Nav />

      <main style={{ paddingTop: 48 }}>
        {/* Hero */}
        <section style={s.hero}>
          <div style={s.heroBg} />
          <div style={s.heroGrid} />

          <div style={s.heroContent}>
            <div style={s.heroBadge}>
              <span style={{ color: '#38bdf8' }}>◉</span>
              <span>Sistem Tasarımı · İnteraktif Öğrenme Platformu</span>
            </div>

            <h1 style={s.heroTitle}>
              <span style={s.heroTitleGrad}>SysDesign</span>
              <br />
              <span style={{ color: '#e2e8f0' }}>Academy</span>
            </h1>

            <p style={s.heroSub}>
              Mikroservislerden Zero Trust'a, Kafka'dan PostgreSQL MVCC'ye —<br />
              her desen animasyonlu simülasyon ve derin trade-off analiziyle.
            </p>

            {/* Stats */}
            <div style={s.statsRow}>
              {STATS.map(st => (
                <div key={st.label} style={s.statBox}>
                  <div style={s.statVal}>{st.value}</div>
                  <div style={s.statLbl}>{st.label}</div>
                </div>
              ))}
            </div>

            <a href="#simulations" style={s.heroBtn}>
              Simülasyonları Keşfet ↓
            </a>
          </div>
        </section>

        {/* Simulations Grid */}
        <section id="simulations" style={s.section}>
          <div style={s.sectionHeader}>
            <div style={s.sectionTag}>SİMÜLASYONLAR</div>
            <h2 style={s.sectionTitle}>Her Konu, Canlı Akışla</h2>
            <p style={s.sectionDesc}>
              Teori değil, görsel. Her senaryo adım adım animasyonlu — solda detaylı analiz, sağda canlı diyagram.
            </p>
          </div>

          <div style={s.grid}>
            {SIMS.map((sim, i) => (
              <SimCard key={sim.href} sim={sim} featured={i === 5} />
            ))}
          </div>
        </section>

        {/* Topics quick ref */}
        <section style={{ ...s.section, paddingTop: 0 }}>
          <div style={s.topicsBox}>
            <div style={s.sectionTag}>KAPSAM</div>
            <div style={s.topicsList}>
              {[
                'API Gateway', 'Circuit Breaker', 'Saga Pattern', 'CQRS', 'Event Sourcing',
                'Transactional Outbox', 'Idempotency', 'Dead Letter Queue', 'Delivery Guarantees',
                'Consistent Hashing', 'Leader–Follower', 'Quorum Replication',
                'Cache-Aside', 'Write-Through', 'Write-Behind',
                'Token Bucket', 'Leaky Bucket', 'Rate Limiting',
                'Redis Streams', 'Kafka ISR', 'Consumer Groups',
                'PostgreSQL MVCC', 'Connection Pooling', 'Index Types',
                'RabbitMQ Exchanges', 'Elasticsearch Sharding',
                'ClickHouse MergeTree', 'Materialized Views',
                'URL Shortener', 'News Feed', 'Chat System',
                'Search Autocomplete', 'Distributed Lock', 'Redlock',
                'Service Mesh', 'mTLS', 'Canary Deploy',
                'API Versioning', 'GraphQL vs REST vs gRPC',
                'OAuth2 PKCE', 'JWT Security', 'Zero Trust',
                'API Gateway Pipeline',
              ].map(t => (
                <span key={t} style={s.topicChip}>{t}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={s.footer}>
          <div style={{ color: '#1e3a5f', fontSize: 10, fontFamily: 'var(--mono)' }}>
            SysDesign Academy · Sistem Tasarımı Öğrenme Platformu
          </div>
        </footer>
      </main>
    </>
  )
}

function SimCard({ sim, featured }) {
  return (
    <Link href={sim.href} style={{
      ...s.card,
      borderColor: featured ? sim.accent + '44' : '#0d2040',
      ...(featured ? { background: sim.accent + '08' } : {}),
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = sim.accent + '88'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = `0 8px 32px ${sim.accent}22`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = featured ? sim.accent + '44' : '#0d2040'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ ...s.cardEmoji, background: sim.accent + '18', borderColor: sim.accent + '33' }}>
          {sim.emoji}
        </div>
        <span style={{ ...s.cardCount, color: sim.accent, borderColor: sim.accent + '44', background: sim.accent + '11' }}>
          {sim.count}
        </span>
      </div>

      {/* Title */}
      <h3 style={{ ...s.cardTitle, color: sim.accent }}>{sim.title}</h3>
      <p style={s.cardSubtitle}>{sim.subtitle}</p>
      <p style={s.cardDesc}>{sim.desc}</p>

      {/* Tags */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
        {sim.tags.map(t => (
          <span key={t} style={{ ...s.tag, borderColor: sim.accent + '33', color: sim.accent + 'bb' }}>{t}</span>
        ))}
      </div>

      {/* CTA */}
      <div style={{ ...s.cardCta, color: sim.accent, borderTop: `1px solid ${sim.accent}22` }}>
        Simülasyonu Aç <span style={{ marginLeft: 4 }}>→</span>
      </div>
    </Link>
  )
}

const s = {
  // Hero
  hero: {
    position: 'relative', overflow: 'hidden',
    minHeight: '92vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '80px 24px 60px',
  },
  heroBg: {
    position: 'absolute', inset: 0, zIndex: 0,
    background: 'radial-gradient(ellipse at 50% 40%, #0d2a4a44 0%, transparent 65%), radial-gradient(ellipse at 20% 80%, #1a0a3022 0%, transparent 50%)',
  },
  heroGrid: {
    position: 'absolute', inset: 0, zIndex: 0,
    backgroundImage: 'linear-gradient(rgba(56,189,248,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,0.04) 1px,transparent 1px)',
    backgroundSize: '40px 40px',
  },
  heroContent: {
    position: 'relative', zIndex: 1,
    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
    maxWidth: 680, gap: 24,
  },
  heroBadge: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 10, color: '#475569', letterSpacing: 2, textTransform: 'uppercase',
    fontFamily: 'var(--mono)',
    padding: '5px 16px', borderRadius: 20,
    border: '1px solid #0d2040', background: '#060f1e',
  },
  heroTitle: {
    fontSize: 'clamp(42px, 7vw, 72px)', fontWeight: 900, lineHeight: 1.05,
    fontFamily: 'var(--mono)', letterSpacing: -2,
  },
  heroTitleGrad: {
    background: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #f472b6 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  heroSub: {
    fontSize: 14, color: '#64748b', lineHeight: 1.8,
    fontFamily: 'var(--mono)', maxWidth: 560,
  },
  statsRow: {
    display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center',
  },
  statBox: {
    padding: '12px 20px', borderRadius: 8,
    border: '1px solid #0d2040', background: '#060f1e',
    textAlign: 'center', minWidth: 90,
  },
  statVal: {
    fontSize: 28, fontWeight: 900, color: '#38bdf8',
    fontFamily: 'var(--mono)',
    background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  statLbl: { fontSize: 9, color: '#334155', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2 },
  heroBtn: {
    display: 'inline-block',
    padding: '12px 32px', borderRadius: 8,
    background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
    color: '#040c18', fontWeight: 900, fontSize: 12, letterSpacing: 1,
    fontFamily: 'var(--mono)', textTransform: 'uppercase',
    border: 'none', transition: 'all 0.2s',
    boxShadow: '0 0 32px #38bdf844',
  },

  // Section
  section: { padding: '64px 24px', maxWidth: 1200, margin: '0 auto' },
  sectionHeader: { textAlign: 'center', marginBottom: 48 },
  sectionTag: {
    fontSize: 9, letterSpacing: 3, color: '#334155', textTransform: 'uppercase',
    marginBottom: 12, fontFamily: 'var(--mono)',
  },
  sectionTitle: {
    fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 800, color: '#e2e8f0',
    fontFamily: 'var(--mono)', marginBottom: 12,
  },
  sectionDesc: { fontSize: 12, color: '#475569', lineHeight: 1.8, maxWidth: 560, margin: '0 auto' },

  // Grid
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 16,
  },

  // Card
  card: {
    display: 'block',
    padding: '20px', borderRadius: 12, border: '1px solid',
    background: '#060f1e',
    transition: 'all 0.2s',
    cursor: 'pointer',
  },
  cardEmoji: {
    width: 44, height: 44, borderRadius: 10,
    border: '1px solid', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20,
  },
  cardCount: {
    fontSize: 9, fontWeight: 800, padding: '3px 10px',
    borderRadius: 12, border: '1px solid', letterSpacing: 1,
    fontFamily: 'var(--mono)',
  },
  cardTitle: { fontSize: 15, fontWeight: 800, marginBottom: 4, fontFamily: 'var(--mono)' },
  cardSubtitle: { fontSize: 10, color: '#334155', marginBottom: 10, lineHeight: 1.6 },
  cardDesc: { fontSize: 11, color: '#475569', lineHeight: 1.75 },
  tag: {
    fontSize: 9, padding: '2px 8px', borderRadius: 10,
    border: '1px solid', fontFamily: 'var(--mono)',
  },
  cardCta: {
    fontSize: 10, fontWeight: 700, letterSpacing: 1,
    paddingTop: 12, marginTop: 14,
    display: 'flex', alignItems: 'center',
    fontFamily: 'var(--mono)',
  },

  // Topics
  topicsBox: {
    background: '#060f1e', borderRadius: 12,
    border: '1px solid #0d2040', padding: '28px',
  },
  topicsList: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  topicChip: {
    fontSize: 10, padding: '4px 12px', borderRadius: 20,
    border: '1px solid #0d2040', color: '#334155',
    background: '#040c18', fontFamily: 'var(--mono)',
  },

  // Footer
  footer: {
    borderTop: '1px solid #0a1628',
    padding: '24px',
    textAlign: 'center',
  },
}
