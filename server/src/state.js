import { POLL_MS, WINDOW_DAYS } from './config.js';
import { ocGet, subscribeEvents } from './opencode.js';

const EVENT_DEBOUNCE_MS = 250;

/**
 * Statut d'affichage d'une session, du plus prioritaire au moins prioritaire :
 * - `needs`   : une demande de permission ou un formulaire attend une réponse humaine ;
 * - `running` : la session travaille (présente dans `/api/session/active`) ;
 * - `error`   : son dernier tour s'est arrêté sur une erreur (`outcome: failed` : quota ou limite
 *               atteints, fournisseur saturé…). Persistant, même une fois consulté, tant que la
 *               session n'est pas relancée ;
 * - `unread`  : la session a rendu la main et ce retour n'a pas encore été consulté
 *               (`time.idle` postérieur à `time.viewed`) ;
 * - `rest`    : rien à faire, réponse déjà vue.
 */
function deriveStatus(session, activeIds, pending) {
  if (pending.permissions + pending.forms > 0) return 'needs';
  if (activeIds.has(session.id)) return 'running';
  if (session.outcome === 'failed') return 'error';
  const { idle, viewed } = session.time ?? {};
  if (idle && (!viewed || viewed < idle)) return 'unread';
  return 'rest';
}

async function countPending(id) {
  const [permissions, forms] = await Promise.all([
    ocGet(`/api/session/${id}/permission`).then((r) => r.body.data.length).catch(() => 0),
    ocGet(`/api/session/${id}/form`).then((r) => r.body.data.length).catch(() => 0),
  ]);
  return { permissions, forms };
}

function basename(path) {
  return (path ?? '').split('/').filter(Boolean).pop() ?? '/';
}

async function buildSnapshot() {
  const [list, active] = await Promise.all([
    ocGet('/api/session?limit=100&order=desc&archived=false'),
    ocGet('/api/session/active'),
  ]);
  const activeIds = new Set(Object.keys(active.body.data ?? {}));
  const horizon = Date.now() - WINDOW_DAYS * 86_400_000;
  const all = list.body.data;

  // Racines : récentes, ou en cours quel que soit leur âge. Sous-sessions (sous-agents) : seulement
  // celles qui travaillent, affichées comme satellites de leur parent.
  const roots = all.filter((s) => !s.parentID && (s.time.updated >= horizon || activeIds.has(s.id)));
  const rootIds = new Set(roots.map((s) => s.id));
  const children = all.filter((s) => s.parentID && rootIds.has(s.parentID) && activeIds.has(s.id));

  const sessions = await Promise.all(
    [...roots, ...children].map(async (s) => {
      const pending = await countPending(s.id);
      return {
        id: s.id,
        parentID: s.parentID ?? null,
        title: s.title || basename(s.location?.directory),
        directory: s.location?.directory ?? null,
        status: deriveStatus(s, activeIds, pending),
        outcome: s.outcome ?? null,
        created: s.time.created,
        updated: s.time.updated,
        pending,
      };
    }),
  );

  // Un sous-agent bloqué sur une permission bloque aussi son parent : on remonte le signal.
  for (const child of sessions.filter((s) => s.parentID && s.status === 'needs')) {
    const parent = sessions.find((s) => s.id === child.parentID);
    if (parent) parent.status = 'needs';
  }

  return { online: true, version: list.version ?? null, at: Date.now(), sessions };
}

/* ── Rafraîchissement partagé entre tous les clients connectés ── */

const listeners = new Set();
let last = null;
let lastKey = '';
let inflight = null;
let queued = false;
let pollTimer = null;
let debounceTimer = null;
let stopEvents = null;

async function refresh() {
  if (inflight) {
    queued = true;
    return inflight;
  }
  inflight = (async () => {
    let snapshot;
    try {
      snapshot = await buildSnapshot();
    } catch {
      snapshot = { online: false, version: null, at: Date.now(), sessions: [] };
    }
    last = snapshot;
    const key = JSON.stringify({ ...snapshot, at: undefined });
    if (key !== lastKey) {
      lastKey = key;
      for (const listener of listeners) listener(snapshot);
    }
  })();
  try {
    await inflight;
  } finally {
    inflight = null;
  }
  if (queued) {
    queued = false;
    await refresh();
  }
}

function refreshSoon() {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    refresh();
  }, EVENT_DEBOUNCE_MS);
}

/** Rafraîchit tout de suite (après une action : message envoyé, session clôturée…). */
export function refreshNow() {
  refreshSoon();
}

/** Statut d'affichage d'une session dans le dernier instantané, `null` si elle n'y figure pas. */
export function statusOf(id) {
  return last?.sessions.find((s) => s.id === id)?.status ?? null;
}

/** Dernier instantané, rafraîchi s'il date de plus d'un intervalle de sondage. */
export async function getSnapshot() {
  if (!last || Date.now() - last.at > POLL_MS) await refresh();
  return last;
}

/**
 * Abonne un client aux changements d'état. Le sondage et l'écoute des événements OpenCode ne
 * tournent que tant qu'au moins un client est connecté.
 */
export function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    pollTimer = setInterval(refresh, POLL_MS);
    stopEvents = subscribeEvents(refreshSoon);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(pollTimer);
      stopEvents?.();
      pollTimer = stopEvents = null;
    }
  };
}
