import { axon, hash, hubScale, type Axon, type Layout, type Placed } from './layout'
import { WALLPAPER_LOW_FPS } from './mode'

const STATUS_HINT = {
  running: 'en cours',
  needs: 'attend ta réponse',
  error: 'en erreur',
  unread: 'réponse à lire',
  rest: 'au repos',
} as const

/** Rayon de la sphère invisible autour du logo, sur laquelle les signaux se chargent (× échelle du cœur). */
const SPHERE = 62
/**
 * Inclinaison du pôle d'émission vers l'observateur : la charge se rassemble sur la face avant de la
 * sphère, ce qui donne à voir sa courbure (anneaux en ellipses, méridiens qui convergent).
 */
const POLE_TILT = (25 * Math.PI) / 180
/** Étendue de la zone qui se charge autour du pôle : distance angulaire sur la sphère (radians). */
const CHARGE_REACH = 0.66
const MERIDIANS = 7
const RINGS = 3
const RING_POINTS = 28
const MERIDIAN_POINTS = 12
const SPARKS = 5

type Vec = [number, number, number]

/** Repère de la sphère pour un pôle vu dans la direction `angle` : pôle `d` et deux axes `t`, `u` qui l'entourent. */
function poleFrame(angle: number) {
  const cg = Math.cos(POLE_TILT)
  const sg = Math.sin(POLE_TILT)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { d: [cg * c, cg * s, sg] as Vec, t: [-s, c, 0] as Vec, u: [-sg * c, -sg * s, cg] as Vec }
}
type PoleFrame = ReturnType<typeof poleFrame>

/**
 * Projection orthographique d'un point de la sphère, à la distance angulaire `a` du pôle et à
 * l'azimut `b`. Ce qui passe derrière la sphère est ramené sur son contour. `z` : profondeur (1 face
 * à l'observateur, 0 sur le contour).
 */
function onSphere(f: PoleFrame, a: number, b: number, cx: number, cy: number, r: number): { x: number; y: number; z: number } {
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cb = Math.cos(b)
  const sb = Math.sin(b)
  let [x, y, z] = [0, 1, 2].map((k) => ca * f.d[k] + sa * (cb * f.t[k] + sb * f.u[k]))
  if (z < 0) {
    const n = Math.hypot(x, y) || 1
    x /= n
    y /= n
    z = 0
  }
  return { x: cx + r * x, y: cy + r * y, z }
}

const pt = (p: { x: number; y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`

/** Anneau de latitude (cercle à distance angulaire `a` du pôle), vu en perspective. */
function ringPath(f: PoleFrame, a: number, cx: number, cy: number, r: number): string {
  const points = Array.from({ length: RING_POINTS }, (_, i) => pt(onSphere(f, a, (i / RING_POINTS) * 2 * Math.PI, cx, cy, r)))
  return `M${points.join(' L')} Z`
}

/** Méridien d'azimut `b`, tracé du bord de la zone chargée jusqu'au pôle. */
function meridianPath(f: PoleFrame, b: number, cx: number, cy: number, r: number): string {
  const points = Array.from({ length: MERIDIAN_POINTS }, (_, i) => pt(onSphere(f, CHARGE_REACH * (1 - i / (MERIDIAN_POINTS - 1)), b, cx, cy, r)))
  return `M${points.join(' L')}`
}

/**
 * Durées d'un cycle de signal, propres à chaque session (tirées de son id) : les signaux des
 * différentes sessions ne sont jamais synchronisés. `charged` et `arrived` : fractions du cycle où
 * la charge se libère puis où le signal atteint la session.
 */
export function signalTiming(id: string, satellite: boolean) {
  const period = satellite ? 1.6 + hash(id, 4) * 0.9 : 3 + hash(id, 4) * 2.6
  return {
    period,
    phase: hash(id, 5),
    charged: satellite ? 0.06 : 0.44,
    arrived: satellite ? 0.62 : 0.84,
  }
}

/** Fractions du cycle : SMIL exige des instants strictement croissants. */
function times(...t: number[]): string {
  return t.map((v) => v.toFixed(3)).join(';')
}

/**
 * Signal qui part du cœur vers une session qui travaille. Une charge électrostatique se rassemble
 * d'abord sur la surface de la sphère invisible, vue en 3D : des anneaux de latitude se resserrent
 * sur le pôle d'émission, des méridiens convergent vers lui, des étincelles crépitent sur la face
 * avant. Puis la charge se libère et file le long de l'axone ; la session s'illumine à son arrivée.
 * Pour un sous-agent, le signal part directement de son parent.
 */
function Signal({ node, a, cx, cy, sphere, scale }: { node: Placed; a: Axon; cx: number; cy: number; sphere: number; scale: number }) {
  const { session, satellite, x, y } = node
  const { period, phase, charged: c, arrived: e } = signalTiming(session.id, satellite)
  const anim = { dur: `${period.toFixed(2)}s`, begin: `${(-phase * period).toFixed(2)}s`, repeatCount: 'indefinite' }
  const travel = { calcMode: 'spline', keySplines: '0 0 1 1; 0.5 0 0.3 1; 0 0 1 1' }
  const f = poleFrame(a.angle)
  const turn = hash(session.id, 6) * 2 * Math.PI

  return (
    <g className="signal" aria-hidden>
      {!satellite && (
        <g className="charge">
          {/* Anneaux de latitude qui se resserrent sur le pôle, l'un après l'autre. */}
          {Array.from({ length: RINGS }, (_, k) => {
            const start = 0.03 + k * 0.1
            const span = c - start
            const reach = CHARGE_REACH * 0.95
            const shapes = [1, 1, 0.72, 0.48, 0.27, 0.11, 0.03, 0.03].map((q) => ringPath(f, Math.max(0.03, reach * q), cx, cy, sphere))
            return (
              <path key={k} className="charge-ring" d={shapes[0]} strokeWidth={1.1 * scale} opacity="0">
                <animate
                  attributeName="d"
                  values={shapes.join(';')}
                  keyTimes={times(0, start, start + span * 0.2, start + span * 0.4, start + span * 0.6, start + span * 0.8, c, 1)}
                  {...anim}
                />
                <animate attributeName="opacity" values="0;0;0.8;0.7;0;0" keyTimes={times(0, start, start + 0.04, c - 0.02, c + 0.01, 1)} {...anim} />
              </path>
            )
          })}
          {/* Méridiens : la charge les parcourt jusqu'au pôle, en léger décalé. */}
          {Array.from({ length: MERIDIANS }, (_, k) => {
            const b = turn + (k / MERIDIANS) * 2 * Math.PI
            const start = 0.02 + 0.12 * hash(session.id, 40 + k)
            const depth = onSphere(f, 0.6, b, cx, cy, sphere).z
            return (
              <path
                key={k}
                className="charge-front"
                d={meridianPath(f, b, cx, cy, sphere)}
                pathLength={100}
                strokeDasharray="30 200"
                strokeWidth={(0.6 + 0.9 * depth) * scale}
                opacity="0"
              >
                <animate attributeName="stroke-dashoffset" values="30;30;-70;-70" keyTimes={times(0, start, c, 1)} {...anim} />
                <animate attributeName="opacity" values={`0;0;${(0.45 + 0.5 * depth).toFixed(2)};0.9;0;0`} keyTimes={times(0, start, start + 0.03, c - 0.02, c + 0.01, 1)} {...anim} />
              </path>
            )
          })}
          {/* Étincelles sur la face avant, plus grosses quand elles sont plus proches. */}
          {Array.from({ length: SPARKS }, (_, k) => {
            let p = onSphere(f, 0.25 + 0.75 * hash(session.id, 50 + k), hash(session.id, 60 + k) * 2 * Math.PI, cx, cy, sphere)
            if (p.z < 0.2) p = onSphere(f, 0.25 + 0.5 * hash(session.id, 50 + k), hash(session.id, 60 + k) * 2 * Math.PI + Math.PI, cx, cy, sphere)
            const o = k * 0.035
            return (
              <circle key={k} className="spark" cx={p.x} cy={p.y} r={(0.7 + 0.9 * p.z) * scale} opacity="0">
                <animate
                  attributeName="opacity"
                  calcMode="discrete"
                  values="0;0.9;0;0.7;0;0.95;0"
                  keyTimes={times(0, c * 0.18 + o, c * 0.3 + o, c * 0.46 + o, c * 0.6 + o, c * 0.72 + o, c + 0.01)}
                  {...anim}
                />
              </circle>
            )
          })}
          <circle className="charge-glow" cx={a.sx} cy={a.sy} r="0">
            <animate attributeName="r" values={`0;0;${5 * scale};${8 * scale};0;0`} keyTimes={times(0, 0.1, c - 0.04, c, c + 0.08, 1)} {...anim} />
            <animate attributeName="opacity" values="0;0;0.9;1;0;0" keyTimes={times(0, 0.1, c - 0.04, c, c + 0.08, 1)} {...anim} />
          </circle>
        </g>
      )}

      <path className="comet-glow" d={a.d} pathLength={100} strokeDasharray="16 200" strokeWidth={5 * scale} opacity="0">
        <animate attributeName="stroke-dashoffset" values="16;16;-100;-100" keyTimes={times(0, c, e, 1)} {...travel} {...anim} />
        <animate attributeName="opacity" values="0;0;0.35;0.35;0;0" keyTimes={times(0, c - 0.005, c, e - 0.04, e, 1)} {...anim} />
      </path>
      <path className="comet-core" d={a.d} pathLength={100} strokeDasharray="10 200" strokeWidth={1.8 * scale} opacity="0">
        <animate attributeName="stroke-dashoffset" values="10;10;-100;-100" keyTimes={times(0, c, e, 1)} {...travel} {...anim} />
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={times(0, c - 0.005, c, e - 0.03, e, 1)} {...anim} />
      </path>
      <circle className="comet-head" r={2.6 * scale} opacity="0">
        <animateMotion path={a.d} keyPoints="0;0;1;1" keyTimes={times(0, c, e, 1)} {...travel} {...anim} />
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={times(0, c - 0.005, c, e - 0.02, e, 1)} {...anim} />
      </circle>

      <circle className="arrival" cx={x} cy={y} r={7 * scale} opacity="0">
        <animate attributeName="r" values={`${7 * scale};${7 * scale};${26 * scale};${26 * scale}`} keyTimes={times(0, e, Math.min(e + 0.14, 0.999), 1)} {...anim} />
        <animate attributeName="opacity" values="0;0;0.8;0;0" keyTimes={times(0, e - 0.005, e, Math.min(e + 0.14, 0.999), 1)} {...anim} />
      </circle>
    </g>
  )
}

function Neuron({
  node,
  cx,
  cy,
  sphere,
  ui,
  selected,
  onSelect,
}: {
  node: Placed
  cx: number
  cy: number
  /** Rayon de la sphère invisible autour du cœur. */
  sphere: number
  /** Facteur d'échelle de l'interface (grands écrans en mode fond d'écran). */
  ui: number
  selected: boolean
  onSelect: (id: string) => void
}) {
  const { session: s, x, y, satellite } = node
  // Le signal part du pôle d'émission, tourné vers l'observateur : projeté un peu en deçà du contour.
  const a = axon(node, cx, cy, sphere, Math.cos(POLE_TILT))
  const scale = (satellite ? 0.55 : 1) * ui
  const running = s.status === 'running'
  const timing = signalTiming(s.id, satellite)

  return (
    <g
      className={`node ${s.status}${satellite ? ' satellite' : ''}${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={STATUS_HINT[s.status]}
      data-period={timing.period}
      data-phase={timing.phase}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(s.id)
      }}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(s.id)}
    >
      <path className="axon" d={a.d} />
      {/* En fond d'écran économe, pas de SMIL : flux en pointillés sur l'axone et lueur au point
          d'émission, animés à basse cadence par useWallpaperTicker. */}
      {running &&
        (WALLPAPER_LOW_FPS ? (
          !satellite && <circle className="charge-lite" cx={a.sx} cy={a.sy} r={4 * scale} />
        ) : (
          <Signal node={node} a={a} cx={cx} cy={cy} sphere={sphere} scale={scale} />
        ))}
      <g className="body" style={{ transformOrigin: `${x}px ${y}px` }}>
        <circle className="halo" cx={x} cy={y} r={46 * scale} />
        <circle className="ring" cx={x} cy={y} r={16 * scale} />
        <circle className="ring urgent" cx={x} cy={y} r={16 * scale} />
        <circle className="dot" cx={x} cy={y} r={7 * scale} />
      </g>
    </g>
  )
}

export function Network({
  width,
  height,
  layout,
  ui = 1,
  dormant,
  selectedId,
  onSelect,
}: {
  width: number
  height: number
  layout: Layout
  /** Facteur d'échelle de l'interface (grands écrans en mode fond d'écran). */
  ui?: number
  /** Serveur OpenCode ou IArPol injoignable : le cœur s'éteint. */
  dormant: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const { cx, cy, orbit, nodes } = layout
  const hub = hubScale(layout, ui)
  const sphere = SPHERE * hub

  return (
    <svg
      className={`net${dormant ? ' dormant' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      onClick={() => onSelect(null)}
      aria-label="Sessions IA"
    >
      <defs>
        <radialGradient id="gCyan">
          <stop offset="0" stopColor="#00D4FF" stopOpacity=".55" />
          <stop offset="1" stopColor="#00D4FF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="gGold">
          <stop offset="0" stopColor="#F0B840" stopOpacity=".5" />
          <stop offset="1" stopColor="#C8941A" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="gError">
          <stop offset="0" stopColor="#FF5D6C" stopOpacity=".5" />
          <stop offset="1" stopColor="#C8323F" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="gCharge">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset=".35" stopColor="#00D4FF" stopOpacity=".9" />
          <stop offset="1" stopColor="#00D4FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gRing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2672C9" />
          <stop offset=".55" stopColor="#00D4FF" />
          <stop offset="1" stopColor="#F0B840" />
        </linearGradient>
      </defs>

      {/* La lueur du cœur est dessinée dans le fond tramé (backdrop.ts), sous les éléments animés. */}
      <g className="hub">
        <g className="ring-a" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <ellipse cx={cx} cy={cy} rx={orbit.rx} ry={orbit.ry} fill="none" stroke="url(#gRing)" strokeOpacity=".22" strokeWidth="1.2" strokeDasharray="1 7" strokeLinecap="round" />
        </g>
        <g className="ring-b" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy} r={110 * hub} fill="none" stroke="url(#gRing)" strokeOpacity=".3" strokeWidth="1" strokeDasharray={`${40 * hub} ${14 * hub}`} />
        </g>
        <circle cx={cx} cy={cy} r={78 * hub} fill="none" stroke="rgba(38,114,201,0.25)" strokeWidth="1" />
      </g>

      <image className="core" href="/logo.png" x={cx - 42 * hub} y={cy - 42 * hub} width={84 * hub} height={84 * hub} />

      {nodes.map((n) => (
        <Neuron key={n.session.id} node={n} cx={cx} cy={cy} sphere={sphere} ui={ui} selected={n.session.id === selectedId} onSelect={onSelect} />
      ))}
    </svg>
  )
}
