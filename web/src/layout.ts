import type { Insets } from './mode'
import type { Session } from './types'

export interface Placed {
  session: Session
  x: number
  y: number
  /** Point d'attache de l'axone : le centre pour une session, le parent pour un sous-agent. */
  fromX: number
  fromY: number
  satellite: boolean
}

export interface Layout {
  cx: number
  cy: number
  rx: number
  ry: number
  /** Rayons du grand anneau qui tourne, ramenés dans l'écran sur un téléphone. */
  orbit: { rx: number; ry: number }
  /** Zone utile (écran moins les bandes réservées). */
  area: { left: number; top: number; right: number; bottom: number }
  nodes: Placed[]
}

const SINGLE_RING_MAX = 10
const SATELLITE_DISTANCE = 62
const SATELLITE_SPREAD = (35 * Math.PI) / 180
const ORBIT_GAP = 40
const ORBIT_MARGIN = 12
/** En dessous de cette dimension (téléphone), l'anneau qui tourne doit tenir dans l'écran dans tous les sens. */
const SMALL_SCREEN = 600

/**
 * Petit hash stable dans [0, 1] : l'irrégularité « organique » d'un nœud ne dépend que de son id.
 * `salt` donne des tirages indépendants pour un même id.
 */
export function hash(id: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  // Brassage final pour les tirages salés (sans sel : valeur historique, positions inchangées).
  if (salt) h = Math.imul(h ^ (h >>> 15), 2246822507) ^ (Math.imul(h, 3266489909) >>> 13)
  return (h >>> 0) / 4294967295
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * Échelle du cœur : dimensionné pour un écran 1600×900, il se resserre sur un écran étroit
 * (téléphone) et grandit avec l'interface sur un très grand écran.
 */
export function hubScale({ rx, ry }: Layout, ui: number): number {
  return Math.max(0.55, Math.min(1, rx / 496, ry / 288)) * ui
}

/**
 * Dispose les sessions sur une ellipse autour du centre de la zone utile (écran moins les bandes
 * réservées, ex. barre des tâches), deux anneaux au-delà de dix sessions, les plus récentes en
 * premier, et les sous-agents en satellites de leur parent.
 */
export function layout(sessions: Session[], width: number, height: number, insets = NO_INSETS, scale = 1): Layout {
  const usableWidth = width - insets.left - insets.right
  const usableHeight = height - insets.top - insets.bottom
  const cx = insets.left + usableWidth / 2
  const cy = insets.top + usableHeight / 2
  const rx = usableWidth * 0.31
  const ry = usableHeight * 0.32

  const ids = new Set(sessions.map((s) => s.id))
  const roots = sessions
    .filter((s) => !s.parentID || !ids.has(s.parentID))
    .sort((a, b) => b.created - a.created)

  const rings =
    roots.length <= SINGLE_RING_MAX
      ? [{ items: roots, scale: 1 }]
      : (() => {
          const inner = Math.min(8, Math.floor(roots.length / 3))
          return [
            { items: roots.slice(0, inner), scale: 0.58 },
            { items: roots.slice(inner), scale: 1.08 },
          ]
        })()

  const nodes: Placed[] = []
  for (const { items, scale } of rings) {
    items.forEach((session, i) => {
      const jitter = hash(session.id)
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / items.length + (jitter - 0.5) * 0.2
      const k = scale * (0.86 + jitter * 0.18)
      nodes.push({
        session,
        x: cx + rx * k * Math.cos(angle),
        y: cy + ry * k * Math.sin(angle),
        fromX: cx,
        fromY: cy,
        satellite: false,
      })
    })
  }

  for (const parent of [...nodes]) {
    const children = sessions.filter((s) => s.parentID === parent.session.id)
    const outward = Math.atan2(parent.y - cy, parent.x - cx)
    children.forEach((session, i) => {
      const offset = children.length === 1 ? 0 : (i / (children.length - 1) - 0.5) * 2 * SATELLITE_SPREAD
      nodes.push({
        session,
        x: parent.x + SATELLITE_DISTANCE * scale * Math.cos(outward + offset),
        y: parent.y + SATELLITE_DISTANCE * scale * Math.sin(outward + offset),
        fromX: parent.x,
        fromY: parent.y,
        satellite: true,
      })
    })
  }

  // L'anneau tourne : sur un téléphone, son grand axe passe aussi dans le sens de la petite
  // dimension de l'écran, d'où une réduction (proportions conservées) pour qu'il ne déborde pas.
  const reach = Math.max(rx, ry) + ORBIT_GAP
  const smallest = Math.min(usableWidth, usableHeight)
  const room = (smallest < SMALL_SCREEN ? smallest : usableWidth) / 2 - ORBIT_MARGIN
  const k = Math.min(1, room / reach)
  const orbit = { rx: (rx + ORBIT_GAP) * k, ry: (ry + ORBIT_GAP) * k }

  const area = { left: insets.left, top: insets.top, right: width - insets.right, bottom: height - insets.bottom }
  return { cx, cy, rx, ry, orbit, area, nodes }
}

export interface Moon {
  x: number
  y: number
  /** Angle sur l'orbite (radians, 180° = gauche). */
  angle: number
  r: number
}

export interface MoonOrbit {
  rx: number
  ry: number
  /** Noms à gauche des lunes s'il y a la place, sinon dessous (téléphone). */
  labels: 'side' | 'below'
  moons: Moon[]
}

const MOON_STEP = (22 * Math.PI) / 180
const MOON_SPAN_MAX = (110 * Math.PI) / 180
const MOON_MARGIN = 26
/** Largeur moyenne d'un caractère des noms (Cinzel 11 px, espacé), pour réserver leur place. */
const LABEL_CHAR = 8
const LABEL_GAP = 12

/** Largeur réservée au nom d'un plugin, en px. */
export function labelWidth(label: string, ui = 1): number {
  return label.length * LABEL_CHAR * ui
}

/**
 * Lunes des plugins : sur une orbite plus large que celle des sessions, uniquement sur son arc
 * gauche, régulièrement espacées autour de l'horizontale, dans l'ordre de haut en bas. Leur taille
 * croît un peu avec le nombre de skills. L'orbite est resserrée pour laisser la place des noms à
 * gauche ; quand l'écran est trop étroit (téléphone), les noms passent sous les lunes.
 */
export function moonOrbit(layout: Layout, items: { skills: number; label: string }[], ui = 1): MoonOrbit {
  const { cx, cy, rx, ry, area } = layout
  const radius = (n: number) => (10 + 2.6 * Math.sqrt(Math.max(1, n))) * ui
  const biggest = Math.max(0, ...items.map((p) => radius(p.skills)))
  const widest = Math.max(0, ...items.map((p) => labelWidth(p.label, ui)))
  const ideal = rx * 1.32
  const room = cx - area.left - MOON_MARGIN - biggest
  const sideRoom = room - widest - LABEL_GAP * ui
  const labels = sideRoom >= rx * 1.18 ? 'side' : 'below'
  const orbitRx = Math.min(ideal, labels === 'side' ? sideRoom : room)
  const orbitRy = ry * 1.22
  const span = Math.min(MOON_SPAN_MAX, MOON_STEP * Math.max(0, items.length - 1))
  const start = Math.PI + span / 2
  const step = items.length > 1 ? span / (items.length - 1) : 0
  const moons = items.map((p, i) => {
    const n = p.skills
    // De l'angle le plus haut (au-dessus de l'horizontale) vers le plus bas.
    const angle = start - i * step
    const y = cy + orbitRy * Math.sin(angle)
    return {
      angle,
      x: cx + orbitRx * Math.cos(angle),
      y: Math.max(area.top + MOON_MARGIN + biggest, Math.min(area.bottom - MOON_MARGIN - biggest, y)),
      r: radius(n),
    }
  })
  return { rx: orbitRx, ry: orbitRy, labels, moons }
}

/**
 * Courbure d'un axone, en fraction de sa longueur : à peine visible (de 3 à 7 %), jamais nulle pour
 * qu'aucun tracé ne soit parfaitement rectiligne, et de sens tiré de l'id.
 */
function curvature(id: string, salt: number): number {
  const h = hash(id, salt)
  return (h < 0.5 ? -1 : 1) * (0.03 + 0.08 * Math.abs(h - 0.5))
}

export interface Axon {
  /** Tracé de l'axone, du point d'émission vers la session. */
  d: string
  /** Point d'émission : sur la sphère invisible autour du cœur (ou le parent d'un sous-agent). */
  sx: number
  sy: number
  /** Angle du point d'émission sur la sphère (radians). */
  angle: number
}

/**
 * Axone à peine courbe d'une session, à la manière d'une ligne de champ : il quitte la sphère
 * invisible qui entoure le cœur perpendiculairement à sa surface, en un point légèrement décalé de
 * la direction de la session (±7°), puis s'infléchit vers elle. Un sous-agent est relié à son
 * parent par une courbe tout aussi légère.
 */
export function axon(node: Placed, cx: number, cy: number, sphere: number): Axon {
  const { session, x, y } = node
  if (node.satellite) {
    const mx = (node.fromX + x) / 2
    const my = (node.fromY + y) / 2
    const bend = curvature(session.id, 1)
    const qx = mx - (y - node.fromY) * bend
    const qy = my + (x - node.fromX) * bend
    return { d: `M${node.fromX},${node.fromY} Q${qx},${qy} ${x},${y}`, sx: node.fromX, sy: node.fromY, angle: 0 }
  }
  const toward = Math.atan2(y - cy, x - cx)
  const angle = toward + (hash(session.id, 2) - 0.5) * 0.24
  const sx = cx + sphere * Math.cos(angle)
  const sy = cy + sphere * Math.sin(angle)
  const length = Math.hypot(x - sx, y - sy)
  const ux = (x - sx) / length
  const uy = (y - sy) / length
  const bend = curvature(session.id, 3) * length
  const c1x = sx + Math.cos(angle) * length * 0.42
  const c1y = sy + Math.sin(angle) * length * 0.42
  const c2x = x - ux * length * 0.32 - uy * bend
  const c2y = y - uy * length * 0.32 + ux * bend
  const r = (n: number) => Math.round(n * 10) / 10
  return { d: `M${r(sx)},${r(sy)} C${r(c1x)},${r(c1y)} ${r(c2x)},${r(c2y)} ${r(x)},${r(y)}`, sx, sy, angle }
}
