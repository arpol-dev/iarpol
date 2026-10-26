import type { PluginInfo, SessionDetail, SkillDetail } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `erreur ${res.status}`)
  return data as T
}

/**
 * Version de cette interface : nom du script principal (empreinte Vite), `null` en développement.
 * Envoyée au serveur pour savoir dans les journaux quelle version tourne réellement sur un appareil.
 */
export const BUILD = import.meta.env.DEV ? null : (new URL(import.meta.url).pathname.split('/').pop() ?? null)

/**
 * Cet appareil peut-il lire les échanges et agir sur les sessions ? (liste blanche côté serveur) ;
 * `build` : version à jour de l'interface côté serveur.
 */
export const getMe = () => call<{ trusted: boolean; build: string | null }>('GET', `/api/me?b=${BUILD ?? 'dev'}`)
export const getSessionDetail = (id: string) => call<SessionDetail>('GET', `/api/sessions/${id}`)
export const sendMessage = (id: string, text: string) => call<{ ok: true }>('POST', `/api/sessions/${id}/prompt`, { text })
export const finishSession = (id: string) => call<{ ok: true }>('POST', `/api/sessions/${id}/finish`)
export const markViewed = (id: string) => call<{ ok: true }>('POST', `/api/sessions/${id}/view`)
export const getPlugins = () => call<{ plugins: PluginInfo[] }>('GET', '/api/plugins').then((r) => r.plugins)
export const getSkill = (id: string) => call<SkillDetail>('GET', `/api/skills/${encodeURIComponent(id)}`)
export const saveSkill = (id: string, content: string) => call<SkillDetail>('PUT', `/api/skills/${encodeURIComponent(id)}`, { content })

/** Service local d'ArPol-Station (station/iarpol-open) qui ouvre une vraie fenêtre OpenCode. */
const OPEN_HELPER = 'http://127.0.0.1:4891/open'
const OPEN_TIMEOUT_MS = 4000

function openWithImage(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = setTimeout(() => reject(new Error("service d'ouverture injoignable sur ce PC")), OPEN_TIMEOUT_MS)
    img.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error("service d'ouverture injoignable sur ce PC"))
    }
    img.src = `${target}&t=${Date.now()}`
  })
}

/**
 * Ouvre la session dans OpenCode.
 * - Fond d'écran (moteur de Hidamari, qui ne sait pas ouvrir de fenêtre) : via le service local de la
 *   station, qui lance une fenêtre d'application. Repli par image si le moteur refuse `fetch` vers
 *   http://127.0.0.1 depuis une page https.
 * - Navigateur ou PWA (téléphone, PC) : nouvelle fenêtre ou onglet sur l'interface d'OpenCode.
 * Si OpenCode n'est pas connecté au serveur ou n'a pas accès à la session, c'est lui qui l'affiche.
 */
export async function openInOpenCode(url: string, viaLocalHelper: boolean): Promise<void> {
  if (!viaLocalHelper) {
    const win = window.open(url, '_blank')
    if (!win) throw new Error("le navigateur a bloqué l'ouverture")
    win.opener = null
    return
  }
  const target = `${OPEN_HELPER}?url=${encodeURIComponent(url)}`
  let res: Response
  try {
    res = await fetch(target, { signal: AbortSignal.timeout(OPEN_TIMEOUT_MS) })
  } catch {
    return openWithImage(target)
  }
  if (!res.ok) throw new Error(`le service d'ouverture a refusé (erreur ${res.status})`)
}
