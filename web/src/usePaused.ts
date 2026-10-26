import { useCallback, useState } from 'react'

const STORAGE_KEY = 'iarpol.paused'

/**
 * Pause manuelle des animations du mode fond d'écran, mémorisée dans le navigateur (le moteur de
 * Hidamari garde son stockage) : une pause choisie survit au redémarrage de la session.
 */
export function usePaused(): [boolean, () => void] {
  const [paused, setPaused] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')
  const toggle = useCallback(() => {
    setPaused((was) => {
      const next = !was
      if (next) localStorage.setItem(STORAGE_KEY, '1')
      else localStorage.removeItem(STORAGE_KEY)
      return next
    })
  }, [])
  return [paused, toggle]
}
