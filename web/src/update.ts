import { BUILD, getMe } from './api'

const TRIES_KEY = 'iarpol.update-tries'
/** Tentatives de mise à jour par version annoncée : au-delà, on renonce (pas de boucle). */
const MAX_TRIES = 2
/** Temps maximal d'attente de l'activation du nouveau service worker (téléchargement compris). */
const ACTIVATION_TIMEOUT_MS = 60_000

/** Attend que `worker` soit actif (ou le délai maximal). */
function activated(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ACTIVATION_TIMEOUT_MS)
    const check = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        clearTimeout(timer)
        resolve()
      }
    }
    worker.addEventListener('statechange', check)
    check()
  })
}

/**
 * Filet de sécurité des mises à jour : si le serveur annonce une version plus récente que celle qui
 * tourne (PWA remise au premier plan sans être relancée, page de Hidamari jamais rechargée…), on
 * fait télécharger la nouvelle version au service worker, on **attend qu'elle soit active**, puis on
 * recharge. Recharger avant la fin du téléchargement servait encore l'ancienne version (une version
 * de retard). Deux tentatives au plus par version annoncée.
 */
export async function ensureLatest() {
  if (!BUILD) return
  const me = await getMe().catch(() => null)
  if (!me?.build || me.build === BUILD) return

  const tries = JSON.parse(sessionStorage.getItem(TRIES_KEY) ?? '{}') as Record<string, number>
  if ((tries[me.build] ?? 0) >= MAX_TRIES) return
  tries[me.build] = (tries[me.build] ?? 0) + 1
  sessionStorage.setItem(TRIES_KEY, JSON.stringify(tries))

  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  if (registration) {
    await registration.update().catch(() => {})
    // Nouvelle version en cours de téléchargement ou en attente : on attend qu'elle prenne la main
    // (skipWaiting). Si elle est déjà active, le rechargement la sert directement.
    const incoming = registration.installing ?? registration.waiting
    if (incoming) await activated(incoming)
  }
  location.reload()
}
