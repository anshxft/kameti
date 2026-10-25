import { Link, useLocation } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'

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
    <button onClick={toggle}
      className="press cell w-11 h-11 flex items-center justify-center text-ink hover:bg-paper-2"
      aria-label="Toggle theme">
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

export default function Nav() {
  const loc    = useLocation()
  const active = (path: string) =>
    loc.pathname === path || loc.pathname.startsWith(path + '/')
      ? 'text-ink'
      : 'text-muted'

  return (
    <nav className="frame fixed top-0 left-0 right-0 z-50 bg-paper/90 backdrop-blur-sm overflow-x-hidden">
      <div className="flex items-stretch h-12 min-w-0">

        {/* Logo */}
        <Link to="/" className="cell px-5 flex items-center press hover:bg-paper-2 shrink-0">
          <span className="font-display text-sm font-bold tracking-widest uppercase">Kameti</span>
        </Link>

        {/* Nav links */}
        <div className="flex-1 flex items-stretch min-w-0">
          <Link to="/" className={`cell px-3 sm:px-4 flex items-center label press hover:bg-paper-2 ${active('/')}`}>
            <span className="hidden sm:inline">Home</span>
            <span className="sm:hidden">~</span>
          </Link>
          <Link to="/new" className={`cell px-3 sm:px-4 flex items-center label press hover:bg-paper-2 ${active('/new')}`}>
            <span className="hidden sm:inline">New</span>
            <span className="sm:hidden">+</span>
          </Link>
          <Link to="/me" className={`cell px-3 sm:px-4 flex items-center label press hover:bg-paper-2 ${active('/me')}`}>
            <span className="hidden sm:inline">My Circles</span>
            <span className="sm:hidden">◎</span>
          </Link>
          <Link to="/score" className={`cell px-3 sm:px-4 flex items-center label press hover:bg-paper-2 ${active('/score')}`}>
            <span className="hidden sm:inline">Score</span>
            <span className="sm:hidden">★</span>
          </Link>
        </div>

        {/* Theme + Connect */}
        <ThemeToggle />
        <div className="cell flex items-center px-3 shrink-0">
          <ConnectKitButton.Custom>
            {({ isConnected, show, address }) => (
              <button onClick={show}
                className="press label px-3 py-1.5 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors">
                {isConnected && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connect'}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </nav>
  )
}
