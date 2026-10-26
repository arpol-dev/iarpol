/**
 * Fond de l'interface (dégradés de couleur + lueur du cœur) calculé en JS avec une précision complète,
 * puis tramé au moment de l'arrondi sur 256 niveaux.
 *
 * Pourquoi : un fond très sombre et très étalé ne parcourt qu'une dizaine de niveaux par couleur sur
 * plusieurs milliers de pixels. Un dégradé CSS arrondi sans tramage (cas de WebKitGTK, donc de
 * Hidamari) montre alors des disques concentriques bien délimités. Ici chaque pixel est arrondi au
 * niveau inférieur ou supérieur selon un seuil « interleaved gradient noise » : écart maximal d'un
 * niveau (invisible), et la moyenne locale suit exactement le dégradé continu.
 */

type RGB = [number, number, number]
type Stop = [offset: number, alpha: number]

interface Radial {
  /** Centre et rayons, en pixels de l'image. */
  cx: number
  cy: number
  rx: number
  ry: number
  color: RGB
  stops: Stop[]
  /** Facteur appliqué à l'opacité (lueur atténuée quand le cœur est éteint ou en pause). */
  factor?: number
}

const BG: RGB = [6, 12, 26] // --bg
const BLUE: RGB = [38, 114, 201]
const CYAN: RGB = [0, 212, 255]
const GOLD: RGB = [200, 148, 26]

/** Décroissance adoucie (au lieu d'une décroissance linéaire) : pas de cassure au bord du dégradé. */
const EASE = [1, 0.82, 0.55, 0.3, 0.1, 0]
function eased(alpha: number, end: number): Stop[] {
  return EASE.map((k, i): Stop => [(end * i) / (EASE.length - 1), alpha * k])
}

function alphaAt(stops: Stop[], t: number): number {
  if (t <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [o1, a1] = stops[i]
    if (t <= o1) {
      const [o0, a0] = stops[i - 1]
      return a0 + ((a1 - a0) * (t - o0)) / (o1 - o0)
    }
  }
  return stops[stops.length - 1][1]
}

/**
 * Dégradé « ellipse at X% Y% » de CSS (taille farthest-corner par défaut) : l'ellipse a les
 * proportions des côtés les plus éloignés et passe par le coin le plus éloigné (facteur √2).
 */
function cssEllipse(w: number, h: number, xPct: number, yPct: number, color: RGB, alpha: number, end: number): Radial {
  const cx = (w * xPct) / 100
  const cy = (h * yPct) / 100
  return {
    cx,
    cy,
    rx: Math.max(cx, w - cx) * Math.SQRT2,
    ry: Math.max(cy, h - cy) * Math.SQRT2,
    color,
    stops: eased(alpha, end),
  }
}

/** Seuil de tramage dans [0, 1) : motif très fin, sans répétition visible (Jimenez 2014). */
function ign(x: number, y: number): number {
  const f = 0.06711056 * x + 0.00583715 * y
  const g = 52.9829189 * (f - Math.floor(f))
  return g - Math.floor(g)
}

export interface Glow {
  cx: number
  cy: number
  /** Diamètre en pixels CSS. */
  size: number
  /** Opacité relative (1 normal, plus faible quand le cœur est éteint ou en pause). */
  factor: number
}

/** Dessine le fond complet dans `canvas`, à la taille de la fenêtre (pixels physiques). */
export function paintBackdrop(canvas: HTMLCanvasElement, width: number, height: number, glow: Glow) {
  const dpr = devicePixelRatio || 1
  const w = Math.round(width * dpr)
  const h = Math.round(height * dpr)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Ordre de composition : du dessous vers le dessus (même rendu que l'ancien fond CSS, dont le
  // premier dégradé listé était au-dessus), puis la lueur du cœur.
  const layers: Radial[] = [
    cssEllipse(w, h, 10, 70, BLUE, 0.09, 0.45),
    cssEllipse(w, h, 60, 85, GOLD, 0.06, 0.4),
    cssEllipse(w, h, 80, 35, CYAN, 0.06, 0.45),
    cssEllipse(w, h, 25, 15, BLUE, 0.14, 0.5),
    {
      cx: glow.cx * dpr,
      cy: glow.cy * dpr,
      rx: (glow.size / 2) * dpr,
      ry: (glow.size / 2) * dpr,
      color: BLUE,
      stops: eased(0.35, 1),
      factor: glow.factor,
    },
  ]

  const image = ctx.createImageData(w, h)
  const data = image.data
  let i = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = BG[0]
      let g = BG[1]
      let b = BG[2]
      for (const l of layers) {
        const dx = (x + 0.5 - l.cx) / l.rx
        const dy = (y + 0.5 - l.cy) / l.ry
        const a = alphaAt(l.stops, Math.sqrt(dx * dx + dy * dy)) * (l.factor ?? 1)
        if (a <= 0) continue
        r += (l.color[0] - r) * a
        g += (l.color[1] - g) * a
        b += (l.color[2] - b) * a
      }
      const d = ign(x, y)
      data[i] = Math.floor(r + d)
      data[i + 1] = Math.floor(g + d)
      data[i + 2] = Math.floor(b + d)
      data[i + 3] = 255
      i += 4
    }
  }
  ctx.putImageData(image, 0, 0)
}
