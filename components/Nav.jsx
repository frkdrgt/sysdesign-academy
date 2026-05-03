import Link from 'next/link'
import { useRouter } from 'next/router'

export default function Nav() {
  const router = useRouter()
  const isHome = router.pathname === '/'

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      background: '#040c18ee',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid #0d2040',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 20px',
    }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 16, fontWeight: 900,
          background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          fontFamily: 'var(--mono)',
        }}>SysDesign Academy</span>
      </Link>
      {!isHome && (
        <Link href="/" style={{
          fontSize: 10, color: '#334155', fontFamily: 'var(--mono)',
          fontWeight: 700, letterSpacing: 1,
          padding: '5px 12px', borderRadius: 5,
          border: '1px solid #0d2040',
          transition: 'all 0.15s',
        }}>← Ana Sayfa</Link>
      )}
    </div>
  )
}
