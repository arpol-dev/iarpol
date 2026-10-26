import { useCallback, useLayoutEffect, useRef } from 'react'

export interface Point {
  x: number
  y: number
}

const OPEN_MS = 680
const CLOSE_MS = 420

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Images clés d'une fenêtre ramassée en un point lumineux sur `origin` (centre de l'écran à défaut)
 * jusqu'à sa place normale. Mesurée sans transformation en cours, d'où un appel à l'ouverture et à
 * la fermeture seulement.
 */
function frames(el: HTMLElement, origin: Point | null): Keyframe[] {
  const r = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  const o = origin ?? center
  const scale = Math.max(0.015, 22 / Math.max(r.width, r.height))
  const dx = o.x - center.x
  const dy = o.y - center.y
  return [
    // Point lumineux posé sur le neurone…
    {
      offset: 0,
      transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
      opacity: 0,
      borderRadius: '50%',
      filter: 'blur(3px) brightness(2.4)',
      boxShadow: '0 0 0 1px rgba(0, 212, 255, 0.95), 0 0 60px rgba(0, 212, 255, 1)',
    },
    // …qui s'en détache en s'éclairant, encore petit et rond…
    {
      offset: 0.3,
      transform: `translate(${dx * 0.72}px, ${dy * 0.72}px) scale(${Math.min(0.2, scale * 5)})`,
      opacity: 1,
      borderRadius: '50%',
      filter: 'blur(2px) brightness(1.8)',
      boxShadow: '0 0 0 1px rgba(0, 212, 255, 0.8), 0 0 70px rgba(0, 212, 255, 0.7)',
    },
    // …puis se déploie jusqu'à sa place.
    { offset: 0.75, filter: 'blur(0px) brightness(1.1)', boxShadow: '0 0 0 1px rgba(0, 212, 255, 0.4), 0 0 60px rgba(0, 212, 255, 0.2)' },
    { offset: 1, transform: 'none', opacity: 1, borderRadius: style.borderRadius, filter: 'none', boxShadow: style.boxShadow },
  ]
}

/**
 * Ouverture « qui sort de son nœud » : la fenêtre jaillit du point `origin` (le neurone cliqué, la
 * skill choisie…) et y retourne à la fermeture. `close` joue l'animation retour puis appelle
 * `onClosed`. Web Animations : non concernées par le gel des animations CSS du mode fond d'écran
 * économe, et seulement quelques images, ponctuellement.
 */
export function useEmergence(origin: Point | null, onClosed: () => void) {
  const panel = useRef<HTMLElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const last = useRef(origin)
  if (origin) last.current = origin
  const closing = useRef(false)

  useLayoutEffect(() => {
    const el = panel.current
    if (!el || reducedMotion()) return
    const content = [...el.children] as HTMLElement[]
    el.animate(frames(el, last.current), { duration: OPEN_MS, easing: 'cubic-bezier(0.45, 0.05, 0.25, 1)' })
    for (const child of content) child.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { duration: OPEN_MS, easing: 'ease-out' })
  }, [])

  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    const el = panel.current
    if (!el || reducedMotion()) return onClosed()
    overlay.current?.animate([{}, { backgroundColor: 'rgba(3, 7, 16, 0)' }], { duration: CLOSE_MS, fill: 'forwards' })
    if (overlay.current) overlay.current.style.pointerEvents = 'none'
    for (const child of [...el.children] as HTMLElement[]) {
      child.animate([{}, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration: CLOSE_MS, fill: 'forwards' })
    }
    const animation = el.animate(frames(el, last.current).reverse().map((f) => ({ ...f, offset: 1 - (f.offset as number) })), {
      duration: CLOSE_MS,
      easing: 'cubic-bezier(0.6, 0, 0.7, 0.4)',
      fill: 'forwards',
    })
    animation.finished.then(onClosed, onClosed)
  }, [onClosed])

  return { panel, overlay, close, origin: last.current }
}
