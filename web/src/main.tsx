import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './theme.css'
import App from './App'
import { WALLPAPER } from './mode'
import { ensureLatest } from './update'

// En fond d'écran (Hidamari), pas de service worker : la page est toujours en ligne, et il servirait
// l'ancienne version en cache après chaque déploiement. On retire aussi un éventuel ancien (seul le
// moteur web de Hidamari est concerné : chaque navigateur a son propre stockage).
if (WALLPAPER) navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
else
  registerSW({
    immediate: true,
    // registerType « autoUpdate » : la page se recharge d'elle-même dès qu'une nouvelle version prend
    // la main. Encore faut-il la détecter : une PWA restée ouverte (téléphone) ne revérifie pas seule,
    // donc on vérifie au retour sur l'application et toutes les heures.
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => registration.update().catch(() => {})
      setInterval(check, 60 * 60 * 1000)
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
    },
  })

// Version à jour garantie : au démarrage et à chaque retour sur l'application.
ensureLatest()
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && ensureLatest())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
