import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import Nav from './components/Nav'
import Home from './pages/Home'
import NewCircle from './pages/NewCircle'
import CirclePage from './pages/CirclePage'
import MyCircles from './pages/MyCircles'
import ScorePage from './pages/Score'
import Break from './pages/Break'
import Reviewers from './pages/Reviewers'
import Bridge from './pages/Bridge'
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
        <Routes>
          <Route path="/"          element={<Home />} />
          <Route path="/new"       element={<NewCircle />} />
          <Route path="/k/:id"     element={<CirclePage />} />
          <Route path="/me"        element={<MyCircles />} />
          <Route path="/score"     element={<ScorePage />} />
          <Route path="/score/:address" element={<ScorePage />} />
          <Route path="/break"     element={<Break />} />
          <Route path="/reviewers" element={<Reviewers />} />
          <Route path="/bridge"    element={<Bridge />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
