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
/** Demi-ouverture de la zone de la sphère qui se charge autour du point d'émission (radians). */
const CHARGE_SPREAD = 0.42

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

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
  return `M${p(from)} A${r},${r} 0 0 ${to > from ? 1 : 0} ${p(to)}`
}

/** Fractions du cycle : SMIL exige des instants strictement croissants. */
function times(...t: number[]): string {
  return t.map((v) => v.toFixed(3)).join(';')
}

/**
 * Signal qui part du cœur vers une session qui travaille. Une charge électrostatique se rassemble
 * d'abord sur la surface de la sphère invisible (deux fronts qui convergent, crépitement, étincelles)
 * jusqu'au point d'émission, puis se libère et file le long de l'axone ; la session s'illumine à
 * son arrivée. Pour un sous-agent, le signal part directement de son parent.
 */
function Signal({ node, a, cx, cy, sphere, scale }: { node: Placed; a: Axon; cx: number; cy: number; sphere: number; scale: number }) {
  const { session, satellite, x, y } = node
  const { period, phase, charged: c, arrived: e } = signalTiming(session.id, satellite)
  const anim = { dur: `${period.toFixed(2)}s`, begin: `${(-phase * period).toFixed(2)}s`, repeatCount: 'indefinite' }
  const travel = { calcMode: 'spline', keySplines: '0 0 1 1; 0.5 0 0.3 1; 0 0 1 1' }

  return (
    <g className="signal" aria-hidden>
      {!satellite && (
        <g className="charge">
          {[a.angle - CHARGE_SPREAD, a.angle + CHARGE_SPREAD].map((from, i) => (
            <path key={i} className="charge-front" d={arc(cx, cy, sphere, from, a.angle)} pathLength={100} strokeDasharray="34 200" strokeWidth={1.6 * scale}>
              <animate attributeName="stroke-dashoffset" values="34;34;-66;-66" keyTimes={times(0, 0.04, c, 1)} {...anim} />
              <animate attributeName="opacity" values="0;0.95;0.95;0;0" keyTimes={times(0, 0.06, c - 0.03, c + 0.02, 1)} {...anim} />
            </path>
          ))}
          <path
            className="charge-crackle"
            d={arc(cx, cy, sphere, a.angle - CHARGE_SPREAD * 1.15, a.angle + CHARGE_SPREAD * 1.15)}
            pathLength={100}
            strokeDasharray="0.8 3.2"
            strokeWidth={1.2 * scale}
          >
            <animate attributeName="stroke-dashoffset" values="0;-24" dur="0.45s" repeatCount="indefinite" />
            <animate
              attributeName="opacity"
              calcMode="discrete"
              values="0;0.5;0.15;0.7;0.3;0.85;0.4;0"
              keyTimes={times(0, c * 0.2, c * 0.35, c * 0.5, c * 0.62, c * 0.75, c * 0.9, c + 0.02)}
              {...anim}
            />
          </path>
          {[
            '0.15;0.7;0.32;0.55;0.45;0.5',
            '0.82;0.25;0.62;0.4;0.56;0.5',
          ].map((points, i) => (
            <circle key={i} className="spark" r={1.3 * scale} opacity="0">
              <animateMotion
                path={arc(cx, cy, sphere, a.angle - CHARGE_SPREAD, a.angle + CHARGE_SPREAD)}
                calcMode="discrete"
                keyPoints={points}
                keyTimes={times(0, c * 0.25, c * 0.45, c * 0.62, c * 0.8, c * 0.93)}
                {...anim}
              />
              <animate
                attributeName="opacity"
                calcMode="discrete"
                values="0;0.9;0;0.8;0.2;0.9;0"
                keyTimes={times(0, c * 0.25 + i * 0.03, c * 0.38, c * 0.5 + i * 0.04, c * 0.7, c * 0.85, c + 0.01)}
                {...anim}
              />
            </circle>
          ))}
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
  const a = axon(node, cx, cy, sphere)
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
