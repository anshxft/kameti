/**
 * Trailing cursor: a ring that follows the pointer and turns into the spinning
 * Kameti pinwheel over anything clickable. The native cursor stays visible, so
 * wallets, forms and text selection behave normally.
 * Mouse only, and off under prefers-reduced-motion.
 */
import { useEffect, useRef } from 'react'
import { gsap, reducedMotion } from '@/motion'

const CLICKABLE = 'a, button, [role="button"], select, summary, label, input[type="range"]'
const TEXT_FIELD = 'input:not([type="range"]), textarea, [contenteditable="true"]'
const PETAL = 'M50 7H93A43 43 0 0 1 50 50Z'

type CursorState = 'idle' | 'hover' | 'text'

function stateFor(target: EventTarget | null): CursorState {
  if (!(target instanceof Element)) return 'idle'
  if (target.closest(TEXT_FIELD)) return 'text'
  return target.closest(CLICKABLE) ? 'hover' : 'idle'
}

export default function PinwheelCursor() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el || reducedMotion() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return

    gsap.set(el, { xPercent: -50, yPercent: -50 })
    const moveX = gsap.quickTo(el, 'x', { duration: 0.28, ease: 'power3.out' })
    const moveY = gsap.quickTo(el, 'y', { duration: 0.28, ease: 'power3.out' })
    let shown = false

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      if (!shown) {
        gsap.set(el, { x: e.clientX, y: e.clientY })
        el.dataset.visible = 'true'
        shown = true
      }
      moveX(e.clientX)
      moveY(e.clientY)
      el.dataset.state = stateFor(e.target)
    }
    const onDown = () => { el.dataset.pressed = 'true' }
    const onUp = () => { delete el.dataset.pressed }
    const onLeave = () => {
      delete el.dataset.visible
      shown = false
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <div ref={root} className="pinwheel-cursor" data-state="idle" aria-hidden="true">
      <div className="pinwheel-cursor__body">
        <svg className="pinwheel-cursor__mark" viewBox="0 0 100 100">
          {[0, 90, 180, 270].map((deg) => (
            <path key={deg} d={PETAL} transform={`rotate(${deg} 50 50)`} />
          ))}
        </svg>
      </div>
    </div>
  )
}
