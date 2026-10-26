import { useEffect } from 'react'
import { WALLPAPER_FPS_ACTIVE, WALLPAPER_FPS_CALM, WALLPAPER_LOW_FPS } from './mode'

const TAU = Math.PI * 2

/** Périodes (s) des animations, reprises de theme.css ; ondes ralenties pour rester lisibles à 6 i/s. */
const BREATHE = { running: 2.4, unread: 4.8, needs: 1.6, error: 3.2 } as const
const RIPPLE_RUNNING = 3.2
const RIPPLE_NEEDS = 2.4
/** Motif des pointillés de l'axone d'une session en cours (theme.css : `stroke-dasharray: 3 9`). */
const AXON_DASH = 12

type Status = keyof typeof BREATHE

function setRipple(el: SVGElement, t: number, period: number) {
  const p = (t / period) % 1
  el.style.transform = `scale(${0.6 + 2.6 * p})`
  el.style.opacity = String(0.7 * (1 - p))
}

function clear(el: HTMLElement | SVGElement) {
  el.style.transform = ''
  el.style.opacity = ''
}

/** Une image : toutes les valeurs dépendent uniquement de `t`, pas de l'image précédente. */
function frame(t: number) {
  document.querySelectorAll<SVGGElement>('.ring-b').forEach((el) => {
    el.style.transform = `rotate(${(t * 4) % 360}deg)`
  })
  document.querySelectorAll<SVGGElement>('.node').forEach((node) => {
    const status = (Object.keys(BREATHE) as Status[]).find((s) => node.classList.contains(s))
    const halo = node.querySelector<SVGElement>('.halo')
    const ring = node.querySelector<SVGElement>('.ring:not(.urgent)')
    const urgent = node.querySelector<SVGElement>('.ring.urgent')
    const axon = node.querySelector<SVGElement>('.axon')
    if (!halo || !ring || !urgent || !axon) return

    if (status) halo.style.transform = `scale(${1 + 0.15 * Math.sin((TAU * t) / BREATHE[status])})`
    else clear(halo)
    // Neurone sélectionné : on laisse theme.css dessiner l'anneau de sélection.
    if (status === 'running' && !node.classList.contains('selected')) setRipple(ring, t, RIPPLE_RUNNING)
    else clear(ring)
    if (status === 'needs') setRipple(urgent, t, RIPPLE_NEEDS)
    else clear(urgent)
    // Décalage négatif : les pointillés filent vers la fin du tracé, du cœur vers la session. Chaque
    // session a sa propre période et sa propre phase (data-*, cf. Network.tsx) : rien n'est synchrone.
    const period = Number(node.dataset.period) || 4
    const cycle = (t / period + (Number(node.dataset.phase) || 0)) % 1
    axon.style.strokeDashoffset = status === 'running' ? String(-((t * 16 + cycle * AXON_DASH) % AXON_DASH)) : ''
    // Lueur au point d'émission sur la sphère : elle se charge puis se libère à chaque cycle.
    const charge = node.querySelector<SVGElement>('.charge-lite')
    if (charge) charge.style.opacity = String(cycle < 0.45 ? 0.9 * (cycle / 0.45) : Math.max(0, 0.9 * (1 - (cycle - 0.45) / 0.12)))
  })

  const span = innerHeight + 20
  document.querySelectorAll<HTMLElement>('.p').forEach((el) => {
    const y = (t * Number(el.dataset.speed) + Number(el.dataset.offset)) % span
    const p = y / span
    el.style.transform = `translateY(${-y}px)`
    el.style.opacity = String(0.8 * Math.min(1, p / 0.08, (1 - p) / 0.08))
  })
}

/**
 * Anime le mode fond d'écran à cadence fixe : 6 i/s quand une session travaille ou attend, 2 i/s
 * au repos. Entre deux images rien ne change, donc rien n'est repeint. En pause, une seule image
 * (pour que la scène figée soit complète, particules comprises), puis plus rien. Sans effet hors
 * du mode fond d'écran économe.
 */
export function useWallpaperTicker(active: boolean, paused: boolean) {
  useEffect(() => {
    if (!WALLPAPER_LOW_FPS) return
    const tick = () => frame(performance.now() / 1000)
    tick()
    if (paused) return
    const timer = setInterval(tick, 1000 / (active ? WALLPAPER_FPS_ACTIVE : WALLPAPER_FPS_CALM))
    return () => clearInterval(timer)
  }, [active, paused])
}
