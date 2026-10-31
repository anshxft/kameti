import { useRef, useEffect } from 'react'
import { useInView } from '@/motion'

const DOT_SPACING = 28
const DOT_RADIUS = 1.8
const HOVER_RADIUS = 130
const RIPPLE_SPEED = 180 // px/s

interface Ripple { x: number; y: number; t: number }

export default function DotGrid({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inView = useInView(canvasRef)
  const mouse = useRef({ x: -9999, y: -9999 })
  const ripples = useRef<Ripple[]>([])
  const rafRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0, h = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      w = canvas.offsetWidth; h = canvas.offsetHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.scale(dpr, dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onClick = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      ripples.current.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() })
      if (ripples.current.length > 6) ripples.current.shift()
    }
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('click', onClick)

    const isDark = () => document.documentElement.dataset.theme === 'dark'

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      if (!inView) return
      ctx.clearRect(0, 0, w, h)

      const now = performance.now()
      const mx = mouse.current.x, my = mouse.current.y

      for (let x = DOT_SPACING / 2; x < w; x += DOT_SPACING) {
        for (let y = DOT_SPACING / 2; y < h; y += DOT_SPACING) {
          const dx = x - mx, dy = y - my
          const dist = Math.sqrt(dx * dx + dy * dy)
          const hoverT = Math.max(0, 1 - dist / HOVER_RADIUS)

          // Ripple influence
          let rippleT = 0
          for (const rip of ripples.current) {
            const age = (now - rip.t) / 1000 // s
            const front = age * RIPPLE_SPEED
            const rdx = x - rip.x, rdy = y - rip.y
            const rdist = Math.sqrt(rdx * rdx + rdy * rdy)
            const waveDist = Math.abs(rdist - front)
            rippleT = Math.max(rippleT, Math.max(0, 1 - waveDist / 25) * Math.max(0, 1 - age / 1.4))
          }

          const t = Math.max(hoverT, rippleT)
          const base = isDark() ? 'rgb(232 232 227 / 0.18)' : 'rgb(11 11 11 / 0.18)'
          ctx.fillStyle = t > 0.01
            ? `rgba(127,250,183,${0.18 + t * 0.82})`
            : base
          ctx.beginPath()
          ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    rafRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafRef.current)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('click', onClick)
      ro.disconnect()
    }
  }, [inView])

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-auto ${className}`}
      aria-hidden
    />
  )
}
