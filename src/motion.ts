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
    duration: 0.7,
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
    gsap.set(reveal, { y: 14 }) // never hide content: a late trigger must not leave a blank page

    // Batch reveal: elements crossing 90% viewport height animate in
    ScrollTrigger.batch(reveal, {
      start: 'top bottom+=320',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: 'expo.out',
          stagger: 0.02,
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

// ─── Hero entrance ────────────────────────────────────────────────────────────
const SCRAMBLE_GLYPHS = 'ABCDEFGHKMNRSTUVXYZ0123456789#$%'
const randomGlyph = () => SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)]
const CHAR_STAGGER = 0.024
const CHAR_FLIPS = 4
const FLIP_EVERY = 0.055
const FONT_WAIT_MS = 800

/**
 * GSAP: the headline assembles on load. Each [data-hero-char] rises out of its
 * [data-hero-word] mask while cycling glyphs, [data-hero-band] wipes in behind
 * it, then [data-hero-rise] blocks follow. Waits for fonts so widths are final.
 */
export function useHeroIntro(scope: RefObject<HTMLElement | null>) {
  useGSAP((_context, contextSafe) => {
    const root = scope.current
    if (!root || reducedMotion()) return

    const select = gsap.utils.selector(root)
    const chars = select('[data-hero-char]') as HTMLElement[]
    const words = select('[data-hero-word]')
    const band = select('[data-hero-band]')
    const rise = select('[data-hero-rise]')
    const mark = select('.hero-pinwheel')
    const eyebrow = select('[data-hero-eyebrow]')[0] as HTMLElement | undefined

    const markOpacity = mark[0] ? getComputedStyle(mark[0]).opacity : '0' // differs per theme

    // Hidden before first paint (useGSAP runs in a layout effect)
    gsap.set(chars, { yPercent: 115 })
    gsap.set(words, { clipPath: 'inset(0 -0.1em)' })
    gsap.set(band, { scaleX: 0, transformOrigin: 'left center' })
    gsap.set(rise, { opacity: 0, y: 16 })
    gsap.set(mark, { opacity: 0, scale: 0.7, rotation: -90 })
    if (eyebrow) gsap.set(eyebrow, { opacity: 0 })

    let cancelled = false
    const play = contextSafe!(() => {
      if (cancelled) return
      const tl = gsap.timeline({
        onComplete: () => { gsap.set([...chars, ...words], { clearProps: 'all' }) },
      })

      tl.to(mark, { opacity: markOpacity, scale: 1, rotation: 0, duration: 1.6, ease: 'expo.out', clearProps: 'all' }, 0)
      tl.to(band, { scaleX: 1, duration: 0.7, ease: 'expo.inOut' }, 0.12)

      if (eyebrow) {
        const text = eyebrow.textContent ?? ''
        const progress = { value: 0 }
        tl.set(eyebrow, { opacity: 1 }, 0)
        tl.to(progress, {
          value: text.length,
          duration: 0.7,
          ease: 'none',
          onUpdate: () => {
            const done = Math.floor(progress.value)
            eyebrow.textContent = text.slice(0, done) +
              Array.from(text.slice(done, done + 6), randomGlyph).join('')
          },
          onComplete: () => { eyebrow.textContent = text },
        }, 0)
      }

      chars.forEach((el, i) => {
        const real = el.textContent ?? ''
        el.style.width = `${el.getBoundingClientRect().width}px` // glyphs must not reflow the line
        el.style.textAlign = 'center'
        const start = 0.15 + i * CHAR_STAGGER
        for (let flip = 0; flip < CHAR_FLIPS; flip++) {
          tl.call(() => { el.textContent = randomGlyph() }, undefined, start + flip * FLIP_EVERY)
        }
        tl.call(() => { el.textContent = real }, undefined, start + CHAR_FLIPS * FLIP_EVERY)
        tl.to(el, { yPercent: 0, duration: 0.7, ease: 'expo.out' }, start)
      })

      tl.to(rise, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out', stagger: 0.09, clearProps: 'all' }, 0.7)
    })

    void Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
    ]).then(play)

    return () => { cancelled = true }
  }, { scope })
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
