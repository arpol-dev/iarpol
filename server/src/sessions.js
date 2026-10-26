import { ocGet, ocRequest, webSessionUrl } from './opencode.js';
import { getSnapshot, refreshNow, statusOf } from './state.js';

/** Identifiant de session OpenCode : seul format accepté dans les chemins de l'API. */
export const SESSION_ID_RE = /^ses_[A-Za-z0-9]{10,64}$/;

const PAGE = 200;
/** Au-delà, seuls les messages les plus récents sont renvoyés (avec `truncated: true`). */
const MAX_MESSAGES = 2000;
const SYSTEM_MAX = 160;

function cut(text, max) {
  if (typeof text !== 'string') return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

const ERROR_BODY_MAX = 600;

/**
 * Erreur structurée d'OpenCode (fournisseur saturé, quota ou limite de débit atteints…), réduite à
 * ce qui s'affiche. `retryAfterMs` : délai indiqué par le fournisseur avant de pouvoir réessayer.
 */
function errorInfo(error) {
  if (!error || typeof error !== 'object') return null;
  let detail = null;
  try {
    const parsed = JSON.parse(error.response?.body ?? '');
    detail = parsed?.error?.message ?? parsed?.message ?? null;
  } catch {
    detail = error.response?.body ? cut(error.response.body.trim(), ERROR_BODY_MAX) : null;
  }
  const message = cut(error.message ?? '', ERROR_BODY_MAX);
  return {
    type: error.type ?? 'unknown',
    message,
    status: error.status ?? null,
    retryAfterMs: error.retryAfterMs ?? null,
    detail: detail && !message.includes(detail) ? cut(detail, ERROR_BODY_MAX) : null,
  };
}

/**
 * Historique allégé pour l'affichage : messages, texte des réponses et erreurs, sans appels d'outils
 * ni raisonnements, instructions système réduites à une mention. Un historique brut pèse plusieurs
 * centaines de Ko.
 */
function normalize(message) {
  const time = message.time?.created ?? null;
  switch (message.type) {
    case 'user':
      return { id: message.id, role: 'user', time, text: message.text ?? '', files: (message.files ?? []).length };
    case 'assistant':
      return {
        id: message.id,
        role: 'assistant',
        time,
        completed: message.time?.completed ?? null,
        agent: message.agent ?? null,
        model: message.model?.id ?? null,
        error: errorInfo(message.error),
        retry: message.retry ? { attempt: message.retry.attempt, at: message.retry.at ?? null, error: errorInfo(message.retry.error) } : null,
        // Seulement le texte de la réponse : les appels d'outils et les raisonnements se consultent
        // dans OpenCode (bouton « Ouvrir »).
        text: (message.content ?? [])
          .filter((part) => part.type === 'text' && part.text?.trim())
          .map((part) => part.text)
          .join('\n\n'),
      };
    case 'idle':
      return { id: message.id, role: 'idle', time, outcome: message.outcome ?? null, error: errorInfo(message.error) };
    case 'compaction':
      return { id: message.id, role: 'compaction', time, status: message.status ?? null, error: errorInfo(message.error) };
    case 'system':
      return { id: message.id, role: 'system', time, notice: message.metadata?.notice ?? null, text: cut((message.text ?? '').split('\n')[0], SYSTEM_MAX) };
    default:
      return { id: message.id, role: 'other', time, type: message.type ?? null };
  }
}

/** Messages les plus récents (jusqu'à MAX_MESSAGES), du plus ancien au plus récent. */
async function recentMessages(id) {
  const collected = [];
  let cursor = null;
  do {
    const query = cursor ? `cursor=${encodeURIComponent(cursor)}` : `order=desc&limit=${PAGE}`;
    const { body } = await ocGet(`/api/session/${id}/message?${query}${cursor ? `&limit=${PAGE}` : ''}`);
    collected.push(...body.data);
    cursor = body.data.length === PAGE ? body.cursor?.next : null;
  } while (cursor && collected.length < MAX_MESSAGES);
  return { messages: collected.slice(0, MAX_MESSAGES).reverse(), truncated: Boolean(cursor) };
}

export async function sessionDetail(id) {
  // getSnapshot : le statut affiché par le tableau de bord doit exister avant d'être lu.
  const [{ body: info }, history, , openUrl] = await Promise.all([
    ocGet(`/api/session/${id}`),
    recentMessages(id),
    getSnapshot(),
    webSessionUrl(id),
  ]);
  const s = info.data;
  return {
    session: {
      id: s.id,
      title: s.title || s.location?.directory || s.id,
      directory: s.location?.directory ?? null,
      agent: s.agent ?? null,
      model: s.model?.id ?? null,
      cost: s.cost ?? 0,
      tokens: s.tokens ?? null,
      outcome: s.outcome ?? null,
      time: s.time ?? {},
      archived: Boolean(s.time?.archived),
      // Statut calculé par le tableau de bord (null si la session n'y figure pas).
      status: statusOf(s.id),
      // Bouton « Ouvrir » : la session dans l'interface d'OpenCode.
      openUrl,
    },
    messages: history.messages.map(normalize),
    truncated: history.truncated,
  };
}

export async function sendPrompt(id, text) {
  const { body: info } = await ocGet(`/api/session/${id}`);
  if (info.data.time?.archived) throw Object.assign(new Error('session clôturée'), { status: 409 });
  await ocRequest('POST', `/api/session/${id}/prompt`, { text });
  refreshNow();
}

/** « Clôturer » : interrompt le travail en cours éventuel, puis archive la session (historique conservé). */
export async function finishSession(id) {
  await ocRequest('POST', `/api/session/${id}/interrupt`).catch(() => {});
  await ocRequest('PATCH', `/api/session/${id}`, { archived: true });
  refreshNow();
}

/** Ouvrir la fenêtre d'une session vaut lecture : le retour non consulté passe en « au repos ». */
export async function markViewed(id) {
  const { body: info } = await ocGet(`/api/session/${id}`);
  const idle = info.data.time?.idle;
  if (!idle || (info.data.time?.viewed ?? 0) >= idle) return;
  await ocRequest('POST', `/api/session/${id}/view`, { idle });
  refreshNow();
}
