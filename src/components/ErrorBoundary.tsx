import { Component, type ErrorInfo, type ReactNode } from 'react'

const STALE_BUILD = /dynamically imported module|importing a module script failed|loading chunk|mime type/i
const RELOAD_GUARD_KEY = 'kameti-stale-build-reload'
const RELOAD_GUARD_MS = 30_000

/** After a deploy, an open tab asks for chunks that no longer exist. One reload fixes it. */
function reloadOnceForStaleBuild(error: Error): boolean {
  if (!STALE_BUILD.test(error.message)) return false
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0)
    if (Date.now() - last < RELOAD_GUARD_MS) return false
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    return false // no storage means no loop guard, so show the message instead
  }
  window.location.reload()
  return true
}

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Shows a way out instead of a blank page when anything below it throws while rendering. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack)
    reloadOnceForStaleBuild(error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="pt-32 px-6 md:px-14 pb-24">
        <p className="label text-muted mb-4">Page error</p>
        <h1 className="font-display text-4xl md:text-6xl font-bold mb-6">This page hit an error.</h1>
        <p className="text-muted mb-8 max-w-2xl">
          Your funds are safe: they are held by the contract, not this page. Reload to try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="press px-8 py-4 bg-signal text-on-signal border border-ink label font-bold"
        >
          Reload page
        </button>
        <p className="label text-muted text-[10px] mt-8 break-all">{error.message}</p>
      </div>
    )
  }
}
