// Motion roles, one tool per job:
//   anime.js  -> boot sequence: grid cells above the fold wipe in when a page opens
//   GSAP      -> scroll reveals ([data-reveal]) and parallax ([data-parallax])
//   CSS       -> every hover/press interaction (interruptible transitions)
//   Lenis     -> smooth scroll, wired to GSAP's ticker so ScrollTrigger stays in sync
import { type RefObject, useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import Lenis from '@studio-freight/lenis'
import { animate, stagger } from 'animejs'

gsap.registerPlugin(ScrollTrigger, useGSAP)
export { gsap, ScrollTrigger, useGSAP }

export const reducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches

// ─── Lenis singleton ─────────────────────────────────────────────────────────
// One instance for the whole app, wired to GSAP's ticker so ScrollTrigger
// always receives scroll events even under smooth-scroll easing.
let lenis: Lenis | null = null

function ensureLenis() {
  if (lenis) return lenis
  if (reducedMotion()) return null

  lenis = new Lenis({
    duration: 1.2,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  })

  // Wire Lenis into GSAP's ticker (the canonical integration)
  lenis.on('scroll', () => ScrollTrigger.update())
  gsap.ticker.add((time) => {
    if (lenis) lenis.raf(time * 1000)
  })
  gsap.ticker.lagSmoothing(0)

  return lenis
}

/** Call on route change to reset scroll position and kill stale ScrollTriggers. */
export function refreshScroll() {
  ScrollTrigger.getAll().forEach((t) => t.kill())
  if (lenis) lenis.scrollTo(0, { immediate: true })
}

// ─── Boot animation ───────────────────────────────────────────────────────────
/** anime.js: [data-boot] cells draw in left-to-right like a terminal booting. */
export function useBoot(scope: RefObject<HTMLElement | null>, ready = true) {
  useGSAP(() => {
    const cells = scope.current?.querySelectorAll<HTMLElement>('[data-boot]')
    if (!ready || !cells?.length || reducedMotion()) return
    const run = animate(cells, {
      clipPath: ['inset(0% 100% 0% 0%)', 'inset(0% 0% 0% 0%)'],
      opacity: [0, 1],
      duration: 700,
      delay: stagger(55),
      ease: 'outExpo',
    })
    return () => { run.revert() }
  }, { scope, dependencies: [ready] })
}

// ─── Scroll reveals ───────────────────────────────────────────────────────────
/**
 * GSAP: [data-reveal] rises in once on scroll, [data-parallax] drifts with it.
 *
 * Key guarantees:
 * 1. Under prefers-reduced-motion, elements are never hidden at all.
 * 2. Lenis is started so ScrollTrigger always receives scroll events.
 * 3. After fonts load and after `ready` turns true, ScrollTrigger.refresh()
 *    is called so freshly-rendered content gets correct measurements.
 * 4. Fail-safe IntersectionObserver: any [data-reveal] that enters the viewport
 *    and is still opacity:0 after 1.5 s is shown immediately regardless.
 */
export function useScrollMotion(
  scope: RefObject<HTMLElement | null>,
  ready = true,
) {
  // Start Lenis once when the hook first mounts
  useEffect(() => {
    ensureLenis()
  }, [])

  useGSAP(() => {
    if (!ready) return

    const root = scope.current
    if (!root) return

    // Under reduced-motion: never hide, just ensure Lenis isn't running
    if (reducedMotion()) {
      root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
        el.style.opacity = '1'
        el.style.transform = ''
      })
      return
    }

    const reveal = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))

    // Kill any leftover triggers before creating fresh ones (route-change safety)
    ScrollTrigger.getAll().forEach((t) => t.kill())

    // Set initial hidden state
    gsap.set(reveal, { opacity: 0, y: 32 })

    // Batch reveal: elements crossing 90% viewport height animate in
    ScrollTrigger.batch(reveal, {
      start: 'top 92%',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: 0.85,
          ease: 'expo.out',
          stagger: 0.06,
          overwrite: true,
        }),
    })

    // Parallax
    root.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
      gsap.fromTo(el, { yPercent: -6 }, {
        yPercent: 6,
        ease: 'none',
        scrollTrigger: { trigger: el.parentElement, scrub: true },
      })
    })

    // Refresh after fonts load for accurate measurements
    void document.fonts.ready.then(() => {
      ScrollTrigger.refresh()
    })

    ScrollTrigger.refresh()
  }, { scope, dependencies: [ready] })

  // ── Fail-safe ──────────────────────────────────────────────────────────────
  // Any [data-reveal] that is in the viewport and still hidden after 1.5 s
  // gets shown immediately. Prevents content from disappearing if GSAP
  // triggers misfired (e.g. the page loaded already scrolled down, or
  // ScrollTrigger.refresh() ran before the layout was stable).
  useEffect(() => {
    if (!ready || reducedMotion()) return

    const root = scope.current
    if (!root) return

    const timers = new Map<Element, ReturnType<typeof setTimeout>>()

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        if (entry.isIntersecting) {
          // Schedule a reveal if still invisible after 1.5 s
          timers.set(el, setTimeout(() => {
            const opacity = parseFloat(getComputedStyle(el).opacity)
            if (opacity < 0.5) {
              el.style.transition = 'opacity 0.5s ease, transform 0.5s ease'
              el.style.opacity = '1'
              el.style.transform = 'none'
            }
            timers.delete(el)
          }, 1500))
        } else {
          const t = timers.get(el)
          if (t !== undefined) { clearTimeout(t); timers.delete(el) }
        }
      }
    }, { threshold: 0.05 })

    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    els.forEach((el) => observer.observe(el))

    return () => {
      observer.disconnect()
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [ready, scope])
}

// ─── Marquee ──────────────────────────────────────────────────────────────────
const MARQUEE_SPEED = 45 // px/s

/**
 * Endless horizontal ticker. Track must contain its content twice.
 * Uses the Web Animations API on the compositor (no per-frame JS).
 * Hover/focus eases playback rate to 0 and back without freezing mid-frame.
 */
export function useMarquee(track: RefObject<HTMLElement | null>, ready = true) {
  useEffect(() => {
    const el = track.current
    if (!ready || !el || reducedMotion()) return

    // Wait one frame so scrollWidth is measured after layout
    const rafId = requestAnimationFrame(() => {
      const distance = el.scrollWidth / 2
      if (distance <= 0) return

      const anim = el.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(${-distance}px)` }],
        { duration: (distance / MARQUEE_SPEED) * 1000, iterations: Infinity },
      )

      let frame = 0
      const easeTo = (target: number, ms: number) => {
        cancelAnimationFrame(frame)
        const from = anim.playbackRate
        const start = performance.now()
        const step = (now: number) => {
          const p = Math.min((now - start) / ms, 1)
          const eased = target < from ? 1 - (1 - p) ** 2 : p * p
          anim.updatePlaybackRate(from + (target - from) * eased)
          if (p < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
      }

      const pause = () => easeTo(0, 600)
      const play  = () => easeTo(1, 800)
      el.addEventListener('mouseenter', pause)
      el.addEventListener('mouseleave', play)
      el.addEventListener('focusin',    pause)
      el.addEventListener('focusout',   play)

      // store cleanup on the animation object so the outer cleanup can reach it
      ;(anim as unknown as { _cleanup?: () => void })._cleanup = () => {
        cancelAnimationFrame(frame)
        anim.cancel()
        el.removeEventListener('mouseenter', pause)
        el.removeEventListener('mouseleave', play)
        el.removeEventListener('focusin',    pause)
        el.removeEventListener('focusout',   play)
      }
    })

    return () => {
      cancelAnimationFrame(rafId)
      // find the running animation and clean it up if it was created
      const running = el.getAnimations().find((a) => (a as unknown as { _cleanup?: () => void })._cleanup)
      if (running) {
        (running as unknown as { _cleanup?: () => void })._cleanup?.()
      }
    }
  }, [track, ready])
}

/** True while the element is on screen, so canvas effects can sleep. */
export function useInView(ref: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ref = useRef(ref) // stable ref to avoid re-subscribing
  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref])
  return inView
}
