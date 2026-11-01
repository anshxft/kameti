import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import ErrorBoundary from './components/ErrorBoundary'
import Nav from './components/Nav'
import PinwheelCursor from './components/PinwheelCursor'
import Home from './pages/Home'
const NewCircle = lazy(() => import('./pages/NewCircle'))
const CirclePage = lazy(() => import('./pages/CirclePage'))
const MyCircles = lazy(() => import('./pages/MyCircles'))
const ScorePage = lazy(() => import('./pages/Score'))
const Break = lazy(() => import('./pages/Break'))
const Reviewers = lazy(() => import('./pages/Reviewers'))
const Bridge = lazy(() => import('./pages/Bridge'))
import { refreshScroll } from './motion'

// Kill stale ScrollTrigger instances on every route change
function ScrollReset() {
  const { pathname } = useLocation()
  useEffect(() => { refreshScroll() }, [pathname])
  return null
}

// Soft fade on route change. `backwards` fill leaves no transform behind,
// so position:fixed children keep the viewport as their containing block.
function PageEnter({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <main key={pathname} className="page-enter">{children}</main>
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollReset />
      {/* Inside the router: low-balance toasts contain <Link>s to /bridge */}
      <Toaster position="top-center" />
      <PinwheelCursor />
      <Nav />
      <PageEnter>
        <ErrorBoundary><Suspense fallback={null}><Routes>
          <Route path="/"          element={<Home />} />
          <Route path="/new"       element={<NewCircle />} />
          <Route path="/k/:id"     element={<CirclePage />} />
          <Route path="/me"        element={<MyCircles />} />
          <Route path="/score"     element={<ScorePage />} />
          <Route path="/score/:address" element={<ScorePage />} />
          <Route path="/break"     element={<Break />} />
          <Route path="/reviewers" element={<Reviewers />} />
          <Route path="/bridge"    element={<Bridge />} />
          <Route path="*" element={<div className="pt-32 px-6 md:px-14 pb-24"><p className="label text-muted mb-4">404</p><h1 className="font-display text-4xl md:text-6xl font-bold mb-8">This page does not exist.</h1><a href="/" className="link-line label text-ink font-bold">Back to home</a></div>} />
        </Routes></Suspense></ErrorBoundary>
      </PageEnter>
    </BrowserRouter>
  )
}
