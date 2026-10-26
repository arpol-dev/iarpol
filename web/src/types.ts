/** Statut d'affichage calculé par le serveur (voir server/src/state.js). */
export type SessionStatus = 'running' | 'needs' | 'error' | 'unread' | 'rest'

export interface Session {
  id: string
  parentID: string | null
  title: string
  directory: string | null
  status: SessionStatus
  outcome: 'succeeded' | 'failed' | 'interrupted' | null
  created: number
  updated: number
  pending: { permissions: number; forms: number }
}

/* ── Détail d'une session (GET /api/sessions/:id, historique allégé par le serveur) ── */

/** Erreur d'un tour (fournisseur saturé, quota ou limite de débit atteints…), cf. server/src/sessions.js. */
export interface SessionError {
  type: string
  message: string
  status: number | null
  /** Délai annoncé par le fournisseur avant de pouvoir réessayer. */
  retryAfterMs: number | null
  detail: string | null
}


export type Message =
  | { id: string; role: 'user'; time: number | null; text: string; files: number }
  | {
      id: string
      role: 'assistant'
      time: number | null
      completed: number | null
      agent: string | null
      model: string | null
      error: SessionError | null
      /** Nouvelle tentative en cours après une erreur passagère. */
      retry: { attempt: number; at: number | null; error: SessionError | null } | null
      /** Texte de la réponse (Markdown) ; sans appels d'outils ni raisonnements. */
      text: string
    }
  | { id: string; role: 'idle'; time: number | null; outcome: string | null; error: SessionError | null }
  | { id: string; role: 'compaction'; time: number | null; status: string | null; error: SessionError | null }
  | { id: string; role: 'system'; time: number | null; notice: string | null; text: string }
  | { id: string; role: 'other'; time: number | null; type: string | null }

export interface SessionDetail {
  session: {
    id: string
    title: string
    directory: string | null
    agent: string | null
    model: string | null
    cost: number
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } | null
    outcome: string | null
    time: { created?: number; updated?: number; idle?: number; viewed?: number; archived?: number }
    archived: boolean
    /** Statut du tableau de bord, `null` si la session n'y figure plus (archivée, trop ancienne). */
    status: SessionStatus | null
    /** La session dans l'interface d'OpenCode (bouton « Ouvrir »), `null` si OpenCode est introuvable. */
    openUrl: string | null
  }
  messages: Message[]
  truncated: boolean
}

export interface Snapshot {
  /** `false` quand le serveur OpenCode est arrêté ou injoignable. */
  online: boolean
  version: string | null
  at: number
  sessions: Session[]
}

/* ── Plugins custom d'OpenCode et leurs skills (GET /api/plugins, /api/skills/:id) ── */

export interface SkillSummary {
  id: string
  name: string
  description: string
  /** Fichier rangé dans ~/.config/opencode/skills : modifiable depuis IArPol. */
  editable: boolean
}

export interface PluginInfo {
  id: string
  label: string
  active: boolean
  skills: SkillSummary[]
}

export interface SkillDetail {
  id: string
  name: string
  description: string
  plugin: { id: string; label: string }
  path: string
  editable: boolean
  /** Fichier SKILL.md complet, en-tête YAML compris, lu sur le disque. */
  content: string
  /** OpenCode tourne avec ce contenu ; sinon la modification attend son prochain rechargement. */
  loaded: boolean
}
