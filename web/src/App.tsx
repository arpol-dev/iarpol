import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { paintBackdrop } from './backdrop'
import { hubScale, layout } from './layout'
import { readInsets, WALLPAPER, WALLPAPER_LOW_FPS, WALLPAPER_NATIVE, type Insets } from './mode'
import { Network } from './Network'
import { PluginBar } from './PluginBar'
import { SessionPanel } from './SessionPanel'
import { usePaused } from './usePaused'
import { useSnapshot } from './useSnapshot'
import { useWallpaperTicker } from './useWallpaperTicker'

function useViewport() {
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ width: innerWidth, height: innerHeight })
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])
  return size
}

/**
 * Particules ambiantes (or + cyan), tirées une fois pour toutes, hors de la zone réservée en fond
 * d'écran. En fond d'écran économe, moins nombreuses et déplacées par `useWallpaperTicker` (vitesse
 * et phase en data-*) au lieu d'une animation CSS.
 */
function Particles({ insets }: { insets: Insets }) {
  const particles = useMemo(
    () =>
      Array.from({ length: WALLPAPER_LOW_FPS ? 12 : 26 }, (_, i) => ({
        gold: i % 3 === 0,
        size: 2 + Math.random() * 2,
        left: Math.random() * 100,
        duration: 14 + Math.random() * 12,
        delay: -Math.random() * 20,
        speed: 12 + Math.random() * 14,
        offset: Math.random() * 2000,
      })),
    [],
  )
  const left = (fraction: number) =>
    WALLPAPER ? `calc(${insets.left}px + ${fraction} * (100% - ${insets.left + insets.right}px))` : `${fraction * 100}%`
  return (
    <div className="particles" aria-hidden>
      {particles.map((p, i) =>
        WALLPAPER_LOW_FPS ? (
          <div
            key={i}
            className={`p ${p.gold ? 'gold' : 'cyan'}`}
            data-speed={p.speed}
            data-offset={p.offset}
            style={{ width: p.size, height: p.size, left: left(p.left / 100) }}
          />
        ) : (
          <div
            key={i}
            className={`p ${p.gold ? 'gold' : 'cyan'}`}
            style={{ width: p.size, height: p.size, left: left(p.left / 100), animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }}
          />
        ),
      )}
    </div>
  )
}

/**
 * Fond tramé (dégradés + lueur du cœur, cf. backdrop.ts), redessiné seulement quand la taille, la
 * position du cœur ou son intensité changent : c'est une image fixe le reste du temps.
 */
function Backdrop({ width, height, cx, cy, glow, factor }: { width: number; height: number; cx: number; cy: number; glow: number; factor: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvas.current) paintBackdrop(canvas.current, width, height, { cx, cy, size: glow, factor })
  }, [width, height, cx, cy, glow, factor])
  return <canvas ref={canvas} className="backdrop" aria-hidden />
}

/** Agrandit l'interface sur un très grand écran en mode fond d'écran (×1 à ×1,5). */
function uiScale(width: number, height: number, insets: Insets): number {
  if (!WALLPAPER) return 1
  const usableWidth = width - insets.left - insets.right
  const usableHeight = height - insets.top - insets.bottom
  return Math.max(1, Math.min(1.5, usableWidth / 1600, usableHeight / 900))
}

export default function App() {
  const { width, height } = useViewport()
  // La pause n'existe qu'en fond d'écran : une pause mémorisée ne doit pas figer le mode normal.
  const [storedPaused, togglePaused] = usePaused()
  const paused = WALLPAPER && storedPaused
  const { snapshot, linked } = useSnapshot(paused)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const closePanel = useCallback(() => setSelectedId(null), [])

  // Recalculé au redimensionnement : la zone de travail suit l'écran (et la barre des tâches).
  const insets = useMemo(() => readInsets(), [width, height])
  const ui = uiScale(width, height, insets)

  const sessions = snapshot?.sessions ?? []
  const net = useMemo(() => layout(sessions, width, height, insets, ui), [sessions, width, height, insets, ui])
  const dormant = !linked || (snapshot !== null && !snapshot.online)

  const selected = net.nodes.find((n) => n.session.id === selectedId)
  const origin = selected ? { x: selected.x, y: selected.y } : null
  useWallpaperTicker(sessions.some((s) => s.status === 'running' || s.status === 'needs'), paused)

  // Variables CSS lues par theme.css pour décaler la marque, la barre des plugins et le message hors ligne.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('wallpaper', WALLPAPER)
    root.classList.toggle('low-fps', WALLPAPER_LOW_FPS)
    for (const side of ['top', 'right', 'bottom', 'left'] as const) root.style.setProperty(`--inset-${side}`, `${insets[side]}px`)
    root.style.setProperty('--ui-scale', String(ui))
  }, [insets, ui])

  // Pause : plus aucune image calculée. Classe « paused » (animations et transitions figées, scène
  // atténuée, cf. theme.css), flux de données fermé (useSnapshot), minuteur arrêté en mode économe
  // (useWallpaperTicker) et ligne de temps SMIL des signaux figée en mode natif.
  useEffect(() => {
    if (!WALLPAPER) return
    document.documentElement.classList.toggle('paused', paused)
    if (!WALLPAPER_NATIVE) return
    const svg = document.querySelector<SVGSVGElement>('svg.net')
    if (paused) svg?.pauseAnimations()
    else svg?.unpauseAnimations()
  }, [paused])

  const glow = 400 * hubScale(net, ui)

  return (
    <>
      {/* Lueur du cœur atténuée en pause (comme le reste de la scène) ou quand le cœur est éteint. */}
      <Backdrop width={width} height={height} cx={net.cx} cy={net.cy} glow={glow} factor={paused ? 0.5 : dormant ? 0.35 : 1} />
      <Particles insets={insets} />
      <Network width={width} height={height} layout={net} ui={ui} dormant={dormant} selectedId={selectedId} onSelect={setSelectedId} />

      <PluginBar hidden={paused} />

      {/* Marque en haut à droite. En fond d'écran, le bouton pause prend la place du logo au survol. */}
      <div className={`brand${WALLPAPER ? ' with-pause' : ''}`}>
        <span className="name">IArPol</span>
        <span className="mark">
          <img src="/logo.png" alt="" />
          {WALLPAPER && (
            <button
              type="button"
              className={`pause${paused ? ' paused' : ''}`}
              onClick={togglePaused}
              aria-label={paused ? 'Reprendre les animations' : 'Mettre les animations en pause'}
              title={paused ? 'Reprendre les animations' : 'Mettre les animations en pause'}
            >
              <svg viewBox="0 0 16 16" aria-hidden>
                {paused ? <path d="M5 3.5 L12.5 8 L5 12.5 Z" /> : <path d="M4.5 3.5 h2.2 v9 h-2.2 Z M9.3 3.5 h2.2 v9 h-2.2 Z" />}
              </svg>
            </button>
          )}
        </span>
      </div>

      {dormant && <div className="offline">{linked ? 'OpenCode hors ligne' : 'connexion perdue'}</div>}

      {/* Clic sur un neurone : fenêtre de la session (échanges, actions, envoi de message). */}
      {selectedId && !paused && (
        <SessionPanel id={selectedId} summary={sessions.find((s) => s.id === selectedId)} origin={origin} onClose={closePanel} />
      )}
    </>
  )
}
