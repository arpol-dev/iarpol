import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError, getSkill, saveSkill } from './api'
import { useEmergence, type Point } from './emerge'
import { Markdown } from './Markdown'
import type { SkillDetail } from './types'

const CONFIRM_MS = 3000

function shortPath(path: string): string {
  return path.replace(/^\/home\/[^/]+/, '~')
}

/** En-tête YAML d'un SKILL.md et corps, pour l'affichage en lecture. */
function split(content: string): { description: string | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return { description: null, body: content }
  const description = match[1].match(/^description:\s*"?(.*?)"?\s*$/m)?.[1] ?? null
  return { description, body: content.slice(match[0].length) }
}

/**
 * Fenêtre d'une skill : lecture (Markdown rendu, y compris des modifications non enregistrées) et
 * édition du fichier SKILL.md complet. Une skill rangée hors de ~/.config/opencode/skills s'affiche
 * en lecture seule.
 */
export function SkillPanel({ id, origin, onClose }: { id: string; origin: Point | null; onClose: () => void }) {
  const emergence = useEmergence(origin, onClose)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const editor = useRef<HTMLTextAreaElement>(null)
  const dirty = detail !== null && draft !== detail.content
  const editable = detail?.editable === true

  useEffect(() => {
    getSkill(id)
      .then((d) => {
        setDetail(d)
        setDraft(d.content)
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 403 ? 'forbidden' : (e as Error).message))
  }, [id])

  useEffect(() => {
    if (!confirmDiscard) return
    const timer = setTimeout(() => setConfirmDiscard(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirmDiscard])

  useLayoutEffect(() => {
    if (mode === 'edit') editor.current?.focus({ preventScroll: true })
  }, [mode])

  // Modifications non enregistrées : il faut demander deux fois la fermeture pour les abandonner.
  const requestClose = useCallback(() => {
    if (dirty && !confirmDiscard) return setConfirmDiscard(true)
    emergence.close()
  }, [dirty, confirmDiscard, emergence])

  const save = useCallback(async () => {
    if (!editable || !dirty || saving) return
    setSaving(true)
    setNotice(null)
    try {
      const saved = await saveSkill(id, draft)
      setDetail(saved)
      setDraft(saved.content)
      setConfirmDiscard(false)
      setNotice({ kind: 'ok', text: saved.loaded ? 'Enregistré.' : 'Enregistré. OpenCode utilisera cette version à son prochain rechargement.' })
    } catch (e) {
      setNotice({ kind: 'error', text: `Impossible d'enregistrer : ${(e as Error).message}` })
    } finally {
      setSaving(false)
    }
  }, [editable, dirty, saving, id, draft])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [requestClose, save])

  const { description, body } = split(draft)

  return (
    <div ref={emergence.overlay} className="overlay skill-overlay" onClick={(e) => e.target === e.currentTarget && requestClose()}>
      {emergence.origin && <span className="emerge-burst" style={{ left: emergence.origin.x, top: emergence.origin.y }} aria-hidden />}
      <section ref={emergence.panel} className="panel skill-panel" role="dialog" aria-modal="true" aria-label={`Skill ${detail?.name ?? id}`}>
        <header className="panel-head">
          <div className="panel-title">
            <h2>
              {detail?.name ?? id}
              {dirty && <span className="dirty" title="Modifications non enregistrées" />}
            </h2>
            <div className="panel-meta">
              {detail && <span className="chip plugin">{detail.plugin.label}</span>}
              {detail && <span className={`chip ${editable ? 'editable' : 'locked'}`}>{editable ? 'modifiable' : 'lecture seule'}</span>}
              {detail && !detail.loaded && (
                <span className="chip pending" title="OpenCode tourne encore avec la version précédente">
                  rechargement d'OpenCode attendu
                </span>
              )}
              {detail && <span className="path">{shortPath(detail.path)}</span>}
            </div>
          </div>
          <div className="panel-actions">
            <div className="segmented" role="tablist" aria-label="Affichage">
              <button type="button" role="tab" aria-selected={mode === 'read'} className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}>
                Lecture
              </button>
              <button type="button" role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')} disabled={!detail}>
                {editable ? 'Édition' : 'Source'}
              </button>
            </div>
            {editable && (
              <button type="button" className="cta-open" onClick={save} disabled={!dirty || saving} title="Enregistrer (Ctrl+S)">
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            )}
          </div>
        </header>
        <button type="button" className="close" onClick={requestClose} aria-label="Fermer">
          ×
        </button>

        {confirmDiscard && <div className="banner">Modifications non enregistrées : ferme à nouveau pour les abandonner.</div>}
        {notice && <div className={`banner${notice.kind === 'error' ? ' error' : ' ok'}`}>{notice.text}</div>}
        {detail && !editable && mode === 'edit' && (
          <div className="banner subtle">Ce fichier est rangé hors de ~/.config/opencode/skills : lecture seule.</div>
        )}

        {error === 'forbidden' ? (
          <p className="thread-note skill-note">Les skills ne sont lisibles que depuis tes appareils.</p>
        ) : error ? (
          <p className="thread-note skill-note">Impossible de charger la skill : {error}</p>
        ) : !detail ? (
          <p className="thread-note skill-note">Chargement…</p>
        ) : mode === 'read' ? (
          <div className="skill-body">
            {description && <p className="skill-lead">{description}</p>}
            <div className="md">
              <Markdown text={body} />
            </div>
          </div>
        ) : (
          <div className="skill-editor">
            <textarea
              ref={editor}
              value={draft}
              spellCheck={false}
              readOnly={!editable}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Tabulation : deux espaces plutôt que de quitter la zone d'édition.
                if (e.key !== 'Tab' || !editable || e.shiftKey) return
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart: start, selectionEnd: end } = el
                setDraft(draft.slice(0, start) + '  ' + draft.slice(end))
                requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2))
              }}
              aria-label="Contenu de la skill (SKILL.md)"
            />
          </div>
        )}
      </section>
    </div>
  )
}
