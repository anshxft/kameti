import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import Nav from './components/Nav'
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

export default function App() {
  return (
    <BrowserRouter>
      <ScrollReset />
      <Nav />
      <main>
        <Suspense fallback={null}><Routes>
          <Route path="/"          element={<Home />} />
          <Route path="/new"       element={<NewCircle />} />
          <Route path="/k/:id"     element={<CirclePage />} />
          <Route path="/me"        element={<MyCircles />} />
          <Route path="/score"     element={<ScorePage />} />
          <Route path="/score/:address" element={<ScorePage />} />
          <Route path="/break"     element={<Break />} />
          <Route path="/reviewers" element={<Reviewers />} />
          <Route path="/bridge"    element={<Bridge />} />
        </Routes></Suspense>
      </main>
    </BrowserRouter>
  )
}
