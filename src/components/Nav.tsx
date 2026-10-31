/**
 * Cybercore nav.
 * Desktop (≥640 px): wordmark + inline links + theme toggle + connect button.
 * Mobile (<640 px):  wordmark + theme toggle + connect button + ☰ hamburger.
 *   Hamburger opens a full-width bottom-anchored sheet with all nav links.
 *
 * Rules:
 * - Wordmark always visible in both themes (uses text-ink which switches with the theme).
 * - No icon-only glyphs in the link row — label text always shown; hidden on mobile via sheet.
 * - Theme toggle and connect never overlap (flex row, each item shrinks to content).
 * - Mobile sheet: slides up from off-screen, traps focus, closes on link click or outside tap.
 * - Lightning icon on /break uses text-ink (no leftover red/orange).
 */
import { Link, useLocation } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { Moon, Sun, Menu, X, ArrowRight, Zap } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

// ── Theme toggle ──────────────────────────────────────────────────────────────
function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark') { document.documentElement.dataset.theme = 'dark'; return true }
    return document.documentElement.dataset.theme === 'dark'
  })
  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.dataset.theme = next ? 'dark' : ''
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }
  return (
    <button
      onClick={toggle}
      className="press cell w-11 h-11 flex items-center justify-center text-ink hover:bg-paper-2 shrink-0"
      aria-label="Toggle theme"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

// ── Mobile sheet ──────────────────────────────────────────────────────────────
interface MobileSheetProps {
  open: boolean
  onClose: () => void
}

function MobileSheet({ open, onClose }: MobileSheetProps) {
  const loc = useLocation()
  const active = (path: string) =>
    loc.pathname === path || loc.pathname.startsWith(path + '/')
      ? 'text-ink font-bold'
      : 'text-muted'

  // Close on outside tap (the backdrop)
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  // Trap focus inside sheet when open
  const sheetRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) sheetRef.current?.focus()
  }, [open])

  const links = [
    { to: '/', label: 'Home' },
    { to: '/new', label: 'New Kameti' },
    { to: '/me', label: 'My Circles' },
    { to: '/score', label: 'Score' },
    { to: '/bridge', label: 'Bridge In' },
    { to: '/break', label: 'Try to Break It', icon: <Zap size={14} className="text-ink" /> },
    { to: '/reviewers', label: 'For Reviewers' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleBackdrop}
        className={`fixed inset-0 z-40 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(0,0,0,0.45)' }}
        aria-hidden={!open}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={`fixed left-0 right-0 bottom-0 z-50 frame bg-paper transition-transform duration-300 ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ outline: 'none' }}
      >
        {/* Sheet header */}
        <div className="cell flex items-center justify-between px-5 h-12">
          <span className="font-display text-sm font-bold tracking-widest uppercase text-ink">Menu</span>
          <button
            onClick={onClose}
            className="press cell w-10 h-10 flex items-center justify-center text-ink hover:bg-paper-2"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        {/* Links */}
        <nav>
          {links.map(({ to, label, icon }) => (
            <Link
              key={to}
              to={to}
              onClick={onClose}
              className={`cell flex items-center justify-between px-5 py-4 press hover:bg-paper-2 ${active(to)}`}
            >
              <span className="label text-base font-normal flex items-center gap-2">
                {icon}
                {label}
              </span>
              <ArrowRight size={14} className="text-muted" />
            </Link>
          ))}
        </nav>
      </div>
    </>
  )
}

// ── Nav ────────────────────────────────────────────────────────────────────────
export default function Nav() {
  const loc    = useLocation()
  const active = (path: string) =>
    loc.pathname === path || loc.pathname.startsWith(path + '/')
      ? 'text-ink'
      : 'text-muted'

  const [sheetOpen, setSheetOpen] = useState(false)

  // Close sheet on route change — defer to avoid synchronous setState-in-effect warning
  useEffect(() => {
    const id = setTimeout(() => setSheetOpen(false), 0)
    return () => clearTimeout(id)
  }, [loc.pathname])

  // Prevent body scroll when sheet is open
  useEffect(() => {
    document.body.style.overflow = sheetOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sheetOpen])

  return (
    <>
      <nav className="frame fixed top-0 left-0 right-0 z-50 bg-paper/90 backdrop-blur-sm overflow-x-hidden">
        {/* Single flex row — never wraps */}
        <div className="flex items-stretch h-12 min-w-0">

          {/* Wordmark — always visible, uses CSS-variable text-ink (switches with theme) */}
          <Link
            to="/"
            className="cell px-5 flex items-center press hover:bg-paper-2 shrink-0"
            aria-label="Kameti home"
          >
            <span className="font-display text-sm font-bold tracking-widest uppercase text-ink">
              Kameti
            </span>
          </Link>

          {/* Desktop links (hidden on mobile) */}
          <div className="hidden sm:flex flex-1 items-stretch min-w-0 overflow-x-hidden">
            <Link to="/"        className={`cell px-3 md:px-4 flex items-center label press hover:bg-paper-2 ${active('/')} whitespace-nowrap`}>Home</Link>
            <Link to="/new"     className={`cell px-3 md:px-4 flex items-center label press hover:bg-paper-2 ${active('/new')} whitespace-nowrap`}>New</Link>
            <Link to="/me"      className={`cell px-3 md:px-4 flex items-center label press hover:bg-paper-2 ${active('/me')} whitespace-nowrap`}>My Circles</Link>
            <Link to="/score"   className={`cell px-3 md:px-4 flex items-center label press hover:bg-paper-2 ${active('/score')} whitespace-nowrap`}>Score</Link>
            <Link to="/bridge"  className={`cell px-3 md:px-4 flex items-center label press hover:bg-paper-2 ${active('/bridge')} whitespace-nowrap`}>Bridge</Link>
            <Link to="/break"   className={`cell px-3 md:px-4 flex items-center gap-1.5 label press hover:bg-paper-2 ${active('/break')} whitespace-nowrap`}>
              <Zap size={11} className="text-ink" />
              Break
            </Link>
            <Link to="/reviewers" className={`cell px-3 md:px-4 flex items-center label press hover:bg-paper-2 ${active('/reviewers')} whitespace-nowrap`}>Reviewers</Link>
          </div>

          {/* Spacer on mobile so controls hug the right */}
          <div className="flex-1 sm:hidden" />

          {/* Right controls — always visible, never overlap */}
          <ThemeToggle />

          {/* Connect button */}
          <div className="cell flex items-center px-3 shrink-0">
            <ConnectKitButton.Custom>
              {({ isConnected, show, address }) => (
                <button
                  onClick={show}
                  className="press label px-3 py-1.5 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors whitespace-nowrap"
                >
                  {isConnected && address
                    ? `${address.slice(0, 6)}…${address.slice(-4)}`
                    : 'Connect'}
                </button>
              )}
            </ConnectKitButton.Custom>
          </div>

          {/* Hamburger — mobile only */}
          <button
            onClick={() => setSheetOpen(true)}
            className="sm:hidden press cell w-11 h-11 flex items-center justify-center text-ink hover:bg-paper-2 shrink-0"
            aria-label="Open navigation"
            aria-expanded={sheetOpen}
          >
            <Menu size={18} />
          </button>
        </div>
      </nav>

      {/* Mobile sheet (portal-like, rendered outside nav in the DOM) */}
      <MobileSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  )
}
