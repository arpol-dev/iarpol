import { useEffect, useState } from 'react'
import { startDemo } from './demo'
import type { Snapshot } from './types'

const DEMO = new URLSearchParams(location.search).has('demo')

/**
 * État des sessions poussé par le serveur IArPol en SSE (`/api/stream`). `linked` passe à `false`
 * quand la connexion au serveur IArPol est coupée ; EventSource se reconnecte tout seul.
 * En pause, le flux est fermé (le dernier état reste affiché) : plus aucun message ni rendu, et le
 * serveur cesse d'interroger OpenCode s'il n'a plus d'autre client.
 */
export function useSnapshot(paused = false): { snapshot: Snapshot | null; linked: boolean } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [linked, setLinked] = useState(true)

  useEffect(() => {
    if (paused) return
    if (DEMO) return startDemo(setSnapshot)
    const source = new EventSource('/api/stream')
    source.onmessage = (e) => {
      setSnapshot(JSON.parse(e.data))
      setLinked(true)
    }
    source.onerror = () => setLinked(false)
    return () => source.close()
  }, [paused])

  return { snapshot, linked }
}
