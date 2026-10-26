const params = new URLSearchParams(location.search)

/**
 * `?wallpaper` : affichage en fond d'écran (Hidamari sur ArPol-Station). Aucune animation CSS/SMIL :
 * chaque image affichée coûte cher (copie de tout l'écran par Xorg entre GPU), donc les mouvements
 * sont recalculés en JS à basse cadence, voir `useWallpaperTicker`.
 */
export const WALLPAPER = params.has('wallpaper')

function param(name: string): number | null {
  const value = params.get(name)
  if (value === null || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Images par seconde quand une session travaille ou attend (`?fps=`), et au repos. */
export const WALLPAPER_FPS_ACTIVE = param('fps') ?? 6
export const WALLPAPER_FPS_CALM = Math.min(2, WALLPAPER_FPS_ACTIVE)

/**
 * `&fps=` d'au moins 30 : animations natives (CSS/SMIL, à la cadence de l'écran), identiques au mode
 * normal. Pour une machine où chaque image coûte peu (ArPol-Station en mode PRIME nvidia).
 */
export const WALLPAPER_NATIVE = WALLPAPER && WALLPAPER_FPS_ACTIVE >= 30

/** Mode fond d'écran économe : aucune animation CSS/SMIL, mouvements recalculés en JS à basse cadence. */
export const WALLPAPER_LOW_FPS = WALLPAPER && !WALLPAPER_NATIVE

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Bandes à laisser libres sur les bords (barre des tâches…), en px : paramètres `left`, `top`,
 * `right`, `bottom`. À défaut, en mode fond d'écran, la zone de travail que rapporte le navigateur
 * (`screen.avail*`, ex. 52 px à gauche pour la barre Zorin), la fenêtre couvrant tout l'écran.
 */
export function readInsets(): Insets {
  const s = screen as Screen & { availLeft?: number; availTop?: number }
  const availLeft = s.availLeft ?? 0
  const availTop = s.availTop ?? 0
  const auto = WALLPAPER
    ? {
        left: availLeft,
        top: availTop,
        right: Math.max(0, s.width - availLeft - s.availWidth),
        bottom: Math.max(0, s.height - availTop - s.availHeight),
      }
    : { left: 0, top: 0, right: 0, bottom: 0 }
  return {
    left: param('left') ?? auto.left,
    top: param('top') ?? auto.top,
    right: param('right') ?? auto.right,
    bottom: param('bottom') ?? auto.bottom,
  }
}
