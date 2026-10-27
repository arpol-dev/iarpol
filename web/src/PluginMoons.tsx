import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getPlugins } from './api'
import type { Point } from './emerge'
import { hash, labelWidth, moonOrbit, type Layout, type Moon, type MoonOrbit } from './layout'
import { SkillPanel } from './SkillPanel'
import type { PluginInfo } from './types'

/** La liste suit les plugins chargés par OpenCode : rechargée régulièrement et à chaque ouverture. */
const REFRESH_MS = 60_000
const EDGE = 12
/** Écart entre une lune et la liste de ses skills. */
const LIST_GAP = 30

/** Le nom de cette lune est-il sous elle ? (rangée du haut : alternativement dessous et dessus) */
function labelBelow(mode: MoonOrbit['labels'], index: number): boolean {
  return mode === 'below' || (mode === 'alternate' && index % 2 === 0)
}

/** Place du nom : à gauche de la lune, ou dessous / dessus sur un écran étroit, sans sortir de l'écran. */
function labelPlace(moon: Moon, text: string, mode: MoonOrbit['labels'], index: number, area: Layout['area'], ui: number) {
  if (mode === 'side') return { x: moon.x - moon.r - 12 * ui, y: moon.y + 4 * ui, anchor: 'end' as const }
  const half = labelWidth(text, ui) / 2 + 6
  const x = Math.min(area.right - half, Math.max(area.left + half, moon.x))
  const y = labelBelow(mode, index) ? moon.y + moon.r + 14 * ui : moon.y - moon.r - 8 * ui
  return { x, y, anchor: 'middle' as const }
}

function MoonBody({
  plugin,
  moon,
  index,
  cx,
  cy,
  area,
  labels,
  ui,
  open,
  dimmed,
  onToggle,
}: {
  plugin: PluginInfo
  moon: Moon
  index: number
  cx: number
  cy: number
  area: Layout['area']
  labels: MoonOrbit['labels']
  ui: number
  open: boolean
  dimmed: boolean
  onToggle: () => void
}) {
  const { x, y, r } = moon
  // Éclairée par le cœur, comme par un soleil : la face tournée vers le logo est la plus claire.
  const toward = Math.atan2(cy - y, cx - x)
  const fx = 0.5 + 0.34 * Math.cos(toward)
  const fy = 0.5 + 0.34 * Math.sin(toward)
  const craters = [0, 1, 2].map((k) => {
    const a = hash(plugin.id, 10 + k) * Math.PI * 2
    const d = (0.2 + 0.4 * hash(plugin.id, 20 + k)) * r
    return { x: x + d * Math.cos(a), y: y + d * Math.sin(a), r: (0.1 + 0.11 * hash(plugin.id, 30 + k)) * r }
  })
  const label = labelPlace(moon, plugin.label, labels, index, area, ui)

  return (
    <g
      className={`moon${open ? ' open' : ''}${dimmed ? ' dimmed' : ''}${plugin.active ? '' : ' inactive'}`}
      role="button"
      tabIndex={0}
      aria-label={`Plugin ${plugin.label}`}
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}
    >
      <defs>
        <radialGradient id={`gMoon${index}`} fx={fx} fy={fy} cx={fx} cy={fy} r="0.85">
          <stop offset="0" stopColor="#e4f2ff" />
          <stop offset="0.3" stopColor="#8fb0d6" />
          <stop offset="0.68" stopColor="#24406a" />
          <stop offset="1" stopColor="#0a1528" />
        </radialGradient>
      </defs>
      <circle className="moon-hit" cx={x} cy={y} r={r * 2.2} />
      <circle className="moon-halo" cx={x} cy={y} r={r * 2.6} style={{ animationDelay: `${-index * 1.7}s` }} />
      <circle className="moon-body" cx={x} cy={y} r={r} fill={`url(#gMoon${index})`} />
      {craters.map((c, k) => (
        <circle key={k} className="moon-crater" cx={c.x} cy={c.y} r={c.r} />
      ))}
      <circle className="moon-rim" cx={x} cy={y} r={r} />
      <text className="moon-label" x={label.x} y={label.y} textAnchor={label.anchor} style={ui === 1 ? undefined : { fontSize: 11 * ui }}>
        {plugin.label}
      </text>
    </g>
  )
}

/**
 * Skills d'un plugin, en surimpression sur le fond (pas de fenêtre) : une ligne par skill, à droite
 * de sa lune et reliée à elle, ou sous la rangée des lunes sur un téléphone (`below`). Un clic sur
 * une skill ouvre sa fenêtre.
 */
function SkillList({
  plugin,
  moon,
  area,
  below,
  listRef,
  onPick,
}: {
  plugin: PluginInfo
  moon: Moon
  area: Layout['area']
  /** Haut de la liste quand elle s'affiche sous la rangée des lunes (téléphone). */
  below: number | null
  listRef: React.RefObject<HTMLDivElement | null>
  onPick: (id: string, origin: Point) => void
}) {
  const [top, setTop] = useState(moon.y)

  // Centrée sur la lune, sans sortir de la zone utile.
  useLayoutEffect(() => {
    if (below !== null) return
    const height = listRef.current?.offsetHeight ?? 0
    setTop(Math.max(area.top + EDGE + height / 2, Math.min(area.bottom - EDGE - height / 2, moon.y)))
  }, [moon.y, area.top, area.bottom, listRef, plugin, below])

  const left = below !== null ? area.left + EDGE : moon.x + moon.r + LIST_GAP
  return (
    <div
      ref={listRef}
      className={`skill-list${below !== null ? ' below' : ''}`}
      role="menu"
      aria-label={`Skills de ${plugin.label}`}
      style={{
        left,
        top: below ?? top,
        maxWidth: `calc(100vw - ${left + EDGE}px)`,
        maxHeight: below !== null ? `calc(100vh - ${below + EDGE}px)` : undefined,
      }}
    >
      {plugin.skills.map((skill, i) => (
        <button
          key={skill.id}
          type="button"
          role="menuitem"
          className="skill-line"
          style={{ animationDelay: `${i * 45}ms` }}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onPick(skill.id, { x: r.left + r.width / 2, y: r.top + r.height / 2 })
          }}
        >
          <span className="skill-name">{skill.name}</span>
          {skill.description && <span className="skill-desc">{skill.description}</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * Plugins custom d'OpenCode (ceux d'ArPol) en lunes, sur une orbite plus large que celle des
 * sessions, à gauche de l'écran. Un clic sur une lune fait apparaître ses skills sur le fond ; un
 * clic sur une skill ouvre sa fenêtre (lecture et modification).
 */
export function PluginMoons({
  layout,
  width,
  height,
  ui,
  hidden,
}: {
  layout: Layout
  width: number
  height: number
  ui: number
  hidden: boolean
}) {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [skill, setSkill] = useState<{ id: string; origin: Point } | null>(null)
  const layer = useRef<SVGSVGElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    getPlugins().then(setPlugins, () => {})
  }, [])

  useEffect(() => {
    if (hidden) return
    load()
    const timer = setInterval(load, REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hidden, load])

  // Liste ouverte : le reste de la scène s'efface (theme.css) ; un clic ailleurs ou Échap la referme.
  useEffect(() => {
    document.documentElement.classList.toggle('skills-open', openId !== null)
    if (!openId) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element
      if (!list.current?.contains(target) && !target.closest?.('.moon')) setOpenId(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenId(null)
    document.addEventListener('pointerdown', onDown)
    addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      removeEventListener('keydown', onKey)
    }
  }, [openId])

  useEffect(() => () => document.documentElement.classList.remove('skills-open'), [])

  const orbit = useMemo(() => moonOrbit(layout, (plugins ?? []).map((p) => ({ skills: p.skills.length, label: p.label })), ui), [layout, plugins, ui])
  const closeSkill = useCallback(() => setSkill(null), [])

  if (hidden || !plugins?.length) return null
  const { cx, cy, area } = layout
  const openIndex = plugins.findIndex((p) => p.id === openId)
  const openMoon = openIndex >= 0 ? orbit.moons[openIndex] : null
  // Téléphone : la liste s'affiche sous la rangée des lunes et de leurs noms.
  const listTop = orbit.top ? Math.max(...orbit.moons.map((m) => m.y + m.r)) + 34 * ui : null
  const tetherFrom = openMoon && (labelBelow(orbit.labels, openIndex) ? openMoon.y + openMoon.r + 20 * ui : openMoon.y + openMoon.r + 5)

  return (
    <>
      <svg ref={layer} className="moons" viewBox={`0 0 ${width} ${height}`} aria-label="Plugins custom d'OpenCode">
        <defs>
          <radialGradient id="gMoonHalo">
            <stop offset="0" stopColor="#9cc8ff" stopOpacity=".22" />
            <stop offset="1" stopColor="#2672C9" stopOpacity="0" />
          </radialGradient>
        </defs>
        {openMoon &&
          (listTop !== null ? (
            <line className="moon-tether" x1={openMoon.x} y1={tetherFrom ?? 0} x2={openMoon.x} y2={listTop - 6} />
          ) : (
            <line
              className="moon-tether"
              x1={openMoon.x + openMoon.r + 5}
              y1={openMoon.y}
              x2={openMoon.x + openMoon.r + LIST_GAP - 8}
              y2={openMoon.y}
            />
          ))}
        {plugins.map((plugin, i) => (
          <MoonBody
            key={plugin.id}
            plugin={plugin}
            moon={orbit.moons[i]}
            index={i}
            cx={cx}
            cy={cy}
            area={area}
            labels={orbit.labels}
            ui={ui}
            open={plugin.id === openId}
            dimmed={openId !== null && plugin.id !== openId}
            onToggle={() => {
              if (openId === plugin.id) return setOpenId(null)
              load()
              setOpenId(plugin.id)
            }}
          />
        ))}
      </svg>
      {openMoon && (
        <SkillList
          key={openId}
          plugin={plugins[openIndex]}
          moon={openMoon}
          area={area}
          below={listTop}
          listRef={list}
          onPick={(id, origin) => {
            setOpenId(null)
            setSkill({ id, origin })
          }}
        />
      )}
      {skill && <SkillPanel key={skill.id} id={skill.id} origin={skill.origin} onClose={closeSkill} />}
    </>
  )
}
