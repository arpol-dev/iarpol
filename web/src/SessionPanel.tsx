import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError, finishSession, getDraft, getMe, getSessionDetail, markViewed, openInOpenCode, saveDraft, sendMessage } from './api'
import { useEmergence, type Point } from './emerge'
import { Markdown } from './Markdown'
import { WALLPAPER } from './mode'
import type { Message, Session, SessionDetail, SessionError } from './types'

const STATUS_LABEL = {
  running: 'en cours',
  needs: 'attend ta réponse',
  error: 'en erreur',
  unread: 'réponse à lire',
  rest: 'au repos',
} as const

const OUTCOME_LABEL: Record<string, string> = { succeeded: 'réussi', failed: 'échec', interrupted: 'interrompu' }
const CONFIRM_MS = 3000
/** Durée de l'effet d'envol quand la session s'ouvre dans OpenCode (theme.css : depart). */
const DEPART_MS = 550
/** Délai sans frappe avant d'enregistrer le brouillon. */
const DRAFT_SAVE_MS = 600
/** Distance au bas du fil en dessous de laquelle on suit les nouveaux messages. */
const STICK_PX = 120

function clock(time: number | null | undefined): string {
  return time ? new Date(time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''
}

function ago(time: number | null | undefined): string {
  if (!time) return ''
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.round(hours / 24)} j`
}

function shortPath(path: string | null): string {
  return path ? path.replace(/^\/home\/[^/]+/, '~') : ''
}

function tokens(t: SessionDetail['session']['tokens']): string {
  if (!t) return ''
  const total = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  return total >= 1e6 ? `${(total / 1e6).toFixed(1)} M jetons` : `${Math.round(total / 1000)} k jetons`
}

const ERROR_LABEL: Record<string, string> = {
  'provider.rate-limit': 'Limite d’utilisation atteinte',
  'provider.quota': 'Quota épuisé',
  'provider.auth': 'Accès refusé par le fournisseur',
  'provider.internal': 'Erreur du fournisseur',
  aborted: 'Tour interrompu',
}

function errorLabel(error: SessionError): string {
  if (/overload/i.test(error.message)) return 'Fournisseur surchargé'
  if (/quota|credit|billing/i.test(error.message)) return 'Quota épuisé'
  return ERROR_LABEL[error.type] ?? (error.type.startsWith('provider.') ? 'Erreur du fournisseur' : 'Erreur')
}

/** « nouvel essai possible vers 16:42 (dans 59 min) » d'après le délai annoncé par le fournisseur ; `null` une fois passé. */
function retryHint(error: SessionError, time: number | null): string | null {
  if (!error.retryAfterMs || !time) return null
  const at = time + error.retryAfterMs
  const minutes = Math.round((at - Date.now()) / 60000)
  if (minutes <= 0) return null
  const left = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
  return `nouvel essai possible vers ${clock(at)} (dans ${left})`
}

/** Erreur d'un tour : pourquoi la session s'est arrêtée. */
function ErrorCard({ error, time, title }: { error: SessionError; time: number | null; title?: string }) {
  const hint = retryHint(error, time)
  return (
    <div className="error-card" role="alert">
      <div className="error-head">
        <span className="error-title">{title ?? errorLabel(error)}</span>
        {error.status && error.status !== 200 && <span className="error-code">{error.status}</span>}
        <span className="error-type">{error.type}</span>
      </div>
      <p className="error-message">{error.message}</p>
      {error.detail && <p className="error-detail">{error.detail}</p>}
      {hint && <p className="error-hint">{hint}</p>}
    </div>
  )
}

/**
 * L'erreur d'une réponse est aussi portée par la fin de tour qui suit : on ne l'affiche sur la
 * réponse que si la fin de tour ne la répète pas (ni pour une simple interruption).
 */
function showAssistantError(messages: Message[], index: number): boolean {
  const m = messages[index]
  if (m.role !== 'assistant' || !m.error || m.error.type === 'aborted') return false
  for (const next of messages.slice(index + 1)) {
    if (next.role === 'idle') return next.error?.message !== m.error.message
    if (next.role === 'user') break
  }
  return true
}

/**
 * Messages affichés : une réponse qui n'a fait qu'appeler des outils (sans texte, ni erreur, ni
 * nouvelle tentative) n'apparaît pas. L'heure et le modèle vont sous la dernière réponse visible.
 */
function visible(messages: Message[]): { m: Message; showError: boolean }[] {
  return messages.flatMap((m, i): { m: Message; showError: boolean }[] => {
    if (m.role !== 'assistant') return [{ m, showError: false }]
    const showError = showAssistantError(messages, i)
    return m.text.trim() || m.retry || showError ? [{ m, showError }] : []
  })
}

/** Dernière fin de tour en erreur, pour le bandeau : pourquoi la session est en rouge. */
function failure(detail: SessionDetail | null): { error: SessionError; hint: string | null } | null {
  const idle = [...(detail?.messages ?? [])].reverse().find((m) => m.role === 'idle')
  if (!idle || idle.role !== 'idle' || idle.outcome !== 'failed' || !idle.error) return null
  const hint = retryHint(idle.error, idle.time)
  return { error: idle.error, hint: hint ? `${hint.charAt(0).toUpperCase()}${hint.slice(1)}, puis envoie un message pour relancer.` : null }
}

const Entry = memo(
  /** `meta` : heure et modèle, affichés seulement sous la dernière réponse d'une suite (épuré). */
  function Entry({ m, meta, showError }: { m: Message; meta: boolean; showError: boolean }) {
    switch (m.role) {
      case 'user':
        return (
          <div className="msg user">
            <div className="bubble">{m.text}</div>
            <div className="msg-time">{clock(m.time)}</div>
          </div>
        )
      case 'assistant':
        return (
          <div className="msg assistant">
            {m.text && (
              <div className="md">
                <Markdown text={m.text} />
              </div>
            )}
            {m.retry && (
              <div className="retry-line">
                Nouvelle tentative n°{m.retry.attempt}
                {m.retry.error ? ` · ${errorLabel(m.retry.error)} : ${m.retry.error.message}` : ''}
              </div>
            )}
            {showError && m.error && <ErrorCard error={m.error} time={m.completed ?? m.time} />}
            {meta && (
              <div className="msg-time">
                {clock(m.completed ?? m.time)}
                {m.model ? ` · ${m.model}` : ''}
              </div>
            )}
          </div>
        )
      case 'idle':
        return (
          <>
            {m.error && <ErrorCard error={m.error} time={m.time} />}
            <div className={`turn-end${m.outcome === 'failed' ? ' failed' : ''}`}>
              <span>
                fin du tour{m.outcome ? ` · ${OUTCOME_LABEL[m.outcome] ?? m.outcome}` : ''} · {clock(m.time)}
              </span>
            </div>
          </>
        )
      case 'compaction':
        return m.status === 'failed' && m.error ? <ErrorCard error={m.error} time={m.time} title="Compaction de l’historique échouée" /> : null
      case 'system':
        return <div className="system-line">{m.notice === 'instructions' ? 'Instructions chargées' : m.text}</div>
      default:
        return null
    }
  },
  // L'historique est rechargé en entier à chaque mise à jour : on ne redessine que ce qui a changé.
  (a, b) => a.meta === b.meta && a.showError === b.showError && JSON.stringify(a.m) === JSON.stringify(b.m),
)

export function SessionPanel({
  id,
  summary,
  origin,
  onClose,
}: {
  id: string
  summary: Session | undefined
  /** Position du neurone de la session : la fenêtre en sort à l'ouverture et y retourne à la fermeture. */
  origin: Point | null
  onClose: () => void
}) {
  const emergence = useEmergence(origin, onClose)
  const close = emergence.close
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trusted, setTrusted] = useState<boolean | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [opening, setOpening] = useState(false)
  const [departing, setDeparting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const thread = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const input = useRef<HTMLTextAreaElement>(null)
  // Brouillon : texte non envoyé, gardé par le serveur (fermeture de la fenêtre, autre appareil).
  const [draftSaved, setDraftSaved] = useState<boolean | null>(null)
  const typed = useRef(false)
  const pendingDraft = useRef<string | null>(null)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => {
    getSessionDetail(id)
      .then((d) => {
        setDetail(d)
        setError(null)
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 403 ? 'forbidden' : e.message))
  }, [id])

  useEffect(() => {
    getMe().then((me) => setTrusted(me.trusted), () => setTrusted(false))
  }, [])

  // Brouillon repris à l'ouverture, sauf si l'on a déjà commencé à écrire entre-temps.
  useEffect(() => {
    if (!trusted) return
    getDraft(id).then(
      (d) => {
        if (typed.current || !d?.text) return
        setDraft(d.text)
        setDraftSaved(true)
      },
      () => {},
    )
  }, [id, trusted])

  const flushDraft = useCallback(
    (keepalive = false) => {
      if (draftTimer.current) clearTimeout(draftTimer.current)
      draftTimer.current = null
      const text = pendingDraft.current
      if (text === null) return
      pendingDraft.current = null
      saveDraft(id, text, keepalive).then(
        () => setDraftSaved(text.trim() ? true : null),
        () => setDraftSaved(false),
      )
    },
    [id],
  )

  const editDraft = (text: string) => {
    typed.current = true
    setDraft(text)
    setDraftSaved(null)
    pendingDraft.current = text
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(flushDraft, DRAFT_SAVE_MS)
  }

  // Fenêtre fermée (ou page quittée) avant l'enregistrement : on l'envoie tout de suite.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flushDraft(true)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flushDraft(true)
    }
  }, [flushDraft])

  // Rechargé à l'ouverture, puis à chaque changement signalé par le tableau de bord (nouveau message,
  // changement de statut) : pas de sondage propre à la fenêtre.
  useEffect(load, [load, summary?.updated, summary?.status])

  // Ouvrir la fenêtre vaut lecture : un retour non consulté passe « au repos ».
  useEffect(() => {
    if (trusted) markViewed(id).catch(() => {})
  }, [id, trusted, summary?.status])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [close])

  // Suit le bas du fil comme une messagerie, sauf si l'on est remonté lire plus haut.
  useLayoutEffect(() => {
    const el = thread.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [detail])

  // Zone de saisie qui grandit avec le texte (plafonnée par max-height en CSS).
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirming])

  const s = detail?.session
  const archived = Boolean(s?.archived)
  const status = archived ? null : (summary?.status ?? s?.status ?? null)
  const canAct = trusted === true && !archived && !!detail
  const lastError = failure(detail)
  const entries = visible(detail?.messages ?? [])

  const send = async () => {
    const text = draft.trim()
    if (!text || !canAct || sending) return
    setSending(true)
    setSendError(null)
    // Le serveur efface le brouillon une fois le message envoyé : rien ne doit le réécrire ensuite.
    if (draftTimer.current) clearTimeout(draftTimer.current)
    pendingDraft.current = null
    try {
      await sendMessage(id, text)
      setDraft('')
      setDraftSaved(null)
      stick.current = true
      load()
    } catch (e) {
      setSendError((e as Error).message)
      // Envoi refusé : le texte reste un brouillon, à garder tel quel.
      pendingDraft.current = draft
      flushDraft()
    } finally {
      setSending(false)
      input.current?.focus()
    }
  }

  const finish = async () => {
    if (!canAct || finishing) return
    if (!confirming) return setConfirming(true)
    setConfirming(false)
    setFinishing(true)
    setActionError(null)
    try {
      await finishSession(id)
      // Clôture confirmée : la fenêtre se referme dans son neurone, qui disparaît du réseau.
      close()
    } catch (e) {
      setActionError(`Impossible de clôturer : ${(e as Error).message}`)
      setFinishing(false)
    }
  }

  // « Ouvrir » : la session dans OpenCode, puis la fenêtre s'envole comme si elle devenait la fenêtre
  // OpenCode. L'ouverture doit partir dans le geste du clic (window.open), d'où aucun await avant.
  const open = async () => {
    const url = s?.openUrl
    if (!url || opening || departing) return
    setOpening(true)
    setActionError(null)
    try {
      await openInOpenCode(url, WALLPAPER)
      setDeparting(true)
      setTimeout(onClose, DEPART_MS)
    } catch (e) {
      setActionError(`Impossible d'ouvrir dans OpenCode : ${(e as Error).message}`)
    } finally {
      setOpening(false)
    }
  }

  const composerNote = archived
    ? 'Session clôturée : envoi désactivé.'
    : trusted === false
      ? 'Lecture seule depuis cet appareil.'
      : null

  return (
    <div ref={emergence.overlay} className={`overlay${departing ? ' departing' : ''}`} onClick={(e) => e.target === e.currentTarget && close()}>
      {emergence.origin && <span className="emerge-burst" style={{ left: emergence.origin.x, top: emergence.origin.y }} aria-hidden />}
      <section
        ref={emergence.panel}
        className={`panel${departing ? ' departing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={s?.title ?? 'Session'}
      >
        <header className="panel-head">
          <div className="panel-title">
            <h2>{s?.title ?? summary?.title ?? '…'}</h2>
            <div className="panel-meta">
              <span className={`chip ${archived ? 'archived' : (status ?? 'rest')}`}>
                {archived ? 'clôturée' : status ? STATUS_LABEL[status] : 'hors tableau de bord'}
              </span>
              {s?.directory && <span>{shortPath(s.directory)}</span>}
              {s?.model && <span>{[s.agent, s.model].filter(Boolean).join(' · ')}</span>}
              {s?.time.updated && <span>{ago(s.time.updated)}</span>}
              {s?.tokens && <span>{tokens(s.tokens)}</span>}
            </div>
          </div>
          <div className="panel-actions">
            <button
              type="button"
              className="cta-open"
              onClick={open}
              disabled={trusted !== true || !s?.openUrl || opening || departing}
              title="Ouvrir la session dans OpenCode"
            >
              {opening ? 'Ouverture…' : 'Ouvrir'}
            </button>
            <button
              type="button"
              className={`cta-finish${confirming ? ' confirming' : ''}`}
              onClick={finish}
              disabled={!canAct || finishing}
              title="Clôturer la session : son objectif est atteint"
            >
              {finishing ? 'Clôture…' : confirming ? 'Confirmer ?' : 'Clôturer'}
            </button>
          </div>
        </header>
        <button type="button" className="close" onClick={close} aria-label="Fermer">
          ×
        </button>

        {lastError && status === 'error' && (
          <div className="banner error">
            Le dernier tour s’est arrêté sur une erreur : <strong>{errorLabel(lastError.error)}</strong>. {lastError.hint ?? 'Envoie un message pour relancer la session.'}
          </div>
        )}
        {summary?.status === 'needs' && !archived && (
          <div className="banner">Une demande de permission attend ta réponse dans OpenCode.</div>
        )}
        {actionError && <div className="banner error">{actionError}</div>}

        <div
          className="thread"
          ref={thread}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
          }}
        >
          {error === 'forbidden' ? (
            <p className="thread-note">Les échanges ne sont lisibles que depuis tes appareils.</p>
          ) : error ? (
            <p className="thread-note">Impossible de charger les échanges : {error}</p>
          ) : !detail ? (
            <p className="thread-note">Chargement…</p>
          ) : (
            <>
              {detail.truncated && <p className="thread-note">Seuls les messages les plus récents sont affichés.</p>}
              {entries.map(({ m, showError }, i) => (
                <Entry key={m.id} m={m} meta={m.role === 'assistant' && entries[i + 1]?.m.role !== 'assistant'} showError={showError} />
              ))}
              {detail.messages.length === 0 && <p className="thread-note">Aucun échange pour l'instant.</p>}
            </>
          )}
        </div>

        <footer className="composer">
          {composerNote ? (
            <p className="composer-note">{composerNote}</p>
          ) : (
            <>
              <textarea
                ref={input}
                value={draft}
                rows={1}
                placeholder="Écrire à la session…"
                onChange={(e) => editDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                disabled={!canAct || sending}
              />
              <button type="button" className="send" onClick={send} disabled={!canAct || sending || !draft.trim()} aria-label="Envoyer">
                <svg viewBox="0 0 16 16" aria-hidden>
                  <path d="M2 8 L14 2 L10.5 14 L8 9 Z" />
                </svg>
              </button>
            </>
          )}
          {sendError && <p className="composer-error">{sendError}</p>}
          {!composerNote && draft.trim() && draftSaved !== null && (
            <p className={`composer-draft${draftSaved ? '' : ' failed'}`}>
              {draftSaved ? 'Brouillon gardé, même si tu fermes la fenêtre' : 'Brouillon non enregistré (serveur injoignable)'}
            </p>
          )}
        </footer>
      </section>
    </div>
  )
}
