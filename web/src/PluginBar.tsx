import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getPlugins } from './api'
import type { Point } from './emerge'
import { SkillPanel } from './SkillPanel'
import type { PluginInfo } from './types'

/** La liste suit les plugins chargés par OpenCode : rechargée régulièrement et à chaque ouverture. */
const REFRESH_MS = 60_000
const EDGE = 12

function PluginMenu({
  plugin,
  anchor,
  onPick,
  menuRef,
}: {
  plugin: PluginInfo
  anchor: DOMRect
  onPick: (id: string, origin: Point) => void
  menuRef: React.RefObject<HTMLDivElement | null>
}) {
  const [left, setLeft] = useState<number | null>(null)

  // Centré sous son plugin, sans sortir de l'écran ; la pointe du menu reste face au plugin.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const width = el.offsetWidth
    const ideal = anchor.left + anchor.width / 2 - width / 2
    const x = Math.max(EDGE, Math.min(ideal, innerWidth - width - EDGE))
    setLeft(x)
    el.style.setProperty('--caret-x', `${anchor.left + anchor.width / 2 - x}px`)
  }, [anchor, menuRef, plugin])

  return (
    <div
      ref={menuRef}
      className="plugin-menu"
      role="menu"
      aria-label={`Skills de ${plugin.label}`}
      style={{ top: anchor.bottom + 10, left: left ?? anchor.left, visibility: left === null ? 'hidden' : undefined }}
    >
      <header className="plugin-menu-head">
        <div className="plugin-menu-title">
          <span>{plugin.label}</span>
          <small>
            {plugin.skills.length} skill{plugin.skills.length > 1 ? 's' : ''}
          </small>
        </div>
      </header>
      <ul>
        {plugin.skills.map((skill) => (
          <li key={skill.id}>
            <button
              type="button"
              role="menuitem"
              className="skill-item"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                onPick(skill.id, { x: r.left + r.width / 2, y: r.top + r.height / 2 })
              }}
            >
              <span className="skill-name">
                {skill.name}
                <svg className={`skill-mode ${skill.editable ? 'editable' : 'locked'}`} viewBox="0 0 16 16" aria-label={skill.editable ? 'modifiable' : 'lecture seule'}>
                  {skill.editable ? (
                    <path d="M10.8 2.6 13.4 5.2 6 12.6 3 13l.4-3z" />
                  ) : (
                    <path d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7M3.5 7h9v6.5h-9z" />
                  )}
                </svg>
              </span>
              {skill.description && <span className="skill-desc">{skill.description}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Barre des plugins custom d'OpenCode (ceux d'ArPol), en haut de l'écran. Un clic sur un plugin déroule ses
 * skills ; un clic sur une skill ouvre sa fenêtre (lecture et modification).
 */
export function PluginBar({ hidden }: { hidden: boolean }) {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [open, setOpen] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const [skill, setSkill] = useState<{ id: string; origin: Point } | null>(null)
  const bar = useRef<HTMLElement>(null)
  const menu = useRef<HTMLDivElement>(null)

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

  // Menu ouvert : un clic ailleurs, Échap ou un redimensionnement le referme.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!bar.current?.contains(target) && !menu.current?.contains(target)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    const onResize = () => setOpen(null)
    document.addEventListener('pointerdown', onDown)
    addEventListener('keydown', onKey)
    addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      removeEventListener('keydown', onKey)
      removeEventListener('resize', onResize)
    }
  }, [open])

  const closeSkill = useCallback(() => setSkill(null), [])

  if (hidden) return null
  const current = open && plugins?.find((p) => p.id === open.id)

  return (
    <>
      {plugins && plugins.length > 0 && (
        <nav ref={bar} className="plugins" aria-label="Plugins custom d'OpenCode">
          {plugins.map((plugin) => (
            <button
              key={plugin.id}
              type="button"
              className={`plugin-chip${open?.id === plugin.id ? ' open' : ''}${plugin.active ? '' : ' inactive'}`}
              aria-expanded={open?.id === plugin.id}
              aria-haspopup="menu"
              onClick={(e) => {
                if (open?.id === plugin.id) return setOpen(null)
                load()
                setOpen({ id: plugin.id, anchor: e.currentTarget.getBoundingClientRect() })
              }}
            >
              <span className="plugin-dot" />
              <span className="plugin-label">{plugin.label}</span>
              <span className="plugin-count">{plugin.skills.length}</span>
            </button>
          ))}
        </nav>
      )}
      {current && (
        <PluginMenu
          plugin={current}
          anchor={open.anchor}
          menuRef={menu}
          onPick={(id, origin) => {
            setOpen(null)
            setSkill({ id, origin })
          }}
        />
      )}
      {skill && <SkillPanel key={skill.id} id={skill.id} origin={skill.origin} onClose={closeSkill} />}
    </>
  )
}
