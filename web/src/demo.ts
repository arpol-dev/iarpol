import type { Session, SessionStatus, Snapshot } from './types'

/**
 * Données simulées (`/?demo`) pour voir tous les états et leurs transitions sans dépendre de
 * l'activité réelle des sessions OpenCode.
 */
const SEED: Array<[string, SessionStatus, string?]> = [
  ['IArPol', 'running'],
  ['ArPol-odoo-dev', 'running'],
  ['0k-odoo-upgrade', 'needs'],
  ['aspivix', 'unread'],
  ['ArPol-Mind', 'rest'],
  ['mas-reemploi', 'running'],
  ['quickparts', 'error'],
  ['urssaf_tdae', 'unread'],
  ['explore', 'running', 'IArPol'],
]
const CYCLE: SessionStatus[] = ['running', 'unread', 'needs', 'running', 'error', 'running', 'rest']

export function startDemo(onSnapshot: (s: Snapshot) => void): () => void {
  const now = Date.now()
  const sessions: Session[] = SEED.map(([title, status, parent], i) => ({
    id: `demo_${title}`,
    parentID: parent ? `demo_${parent}` : null,
    title,
    directory: null,
    status,
    outcome: null,
    created: now - i * 600_000,
    updated: now,
    pending: { permissions: status === 'needs' ? 1 : 0, forms: 0 },
  }))

  const emit = () => onSnapshot({ online: true, version: 'demo', at: Date.now(), sessions: sessions.map((s) => ({ ...s })) })
  emit()
  const timer = setInterval(() => {
    const roots = sessions.filter((s) => !s.parentID)
    const s = roots[Math.floor(Math.random() * roots.length)]
    s.status = CYCLE[(CYCLE.indexOf(s.status) + 1) % CYCLE.length]
    emit()
  }, 4000)
  return () => clearInterval(timer)
}
