import { ocGet, webSessionUrl } from './opencode.js';

/*
 * Page « Ouvrir la session » : un lien par session, à mettre dans les notes (Odoo) ou à suivre depuis
 * un téléphone. Sur téléphone, elle propose l'application OpenCode Mobile (lien profond
 * `opencodemobile://session/<id>?project=<dossier>`) et le navigateur. Sur ordinateur, seul le lien web
 * existe : l'application de bureau n'accepte pas de lien profond.
 * Accès : même restriction réseau que IArPol (VPN Netbird, cf. nginx).
 */

const OPEN_ROUTE = /^\/open\/(ses_[A-Za-z0-9]{10,64})$/;
const MOBILE_UA = /Android|iPhone|iPad|iPod/i;
const PUBLIC_URL = (process.env.IARPOL_PUBLIC_URL ?? 'https://iarpol.arpol.fr').replace(/\/$/, '');

/** Adresse de la page pour une session. */
export function openPageUrl(id) {
  return `${PUBLIC_URL}/open/${id}`;
}

/** Lien profond de l'application OpenCode Mobile. */
export function appLink(id, directory) {
  return `opencodemobile://session/${id}?project=${encodeURIComponent(directory)}`;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** HTML de la page. Toute donnée venant d'OpenCode est échappée. */
export function renderOpenPage({ id, title, directory, archived, mobile, webUrl }) {
  const app = mobile && !archived && directory
    ? `<a class="btn primary" href="${escapeHtml(appLink(id, directory))}">Ouvrir dans OpenCode Mobile</a>`
    : '';
  const note = archived
    ? '<p class="note">Session archivée : la restaurer dans OpenCode pour l’ouvrir dans l’application.</p>'
    : mobile
      ? '<p class="note">Si l’application ne s’ouvre pas, elle n’est pas installée ou n’est pas connectée à ce serveur.</p>'
      : '<p class="note">Sur ordinateur, la session s’ouvre dans le navigateur.</p>';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · IArPol</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b1020; color: #e6ebf5; margin: 0; padding: 24px; }
  main { max-width: 520px; margin: 0 auto; }
  h1 { font-size: 1.2rem; margin: 0 0 8px; }
  .dir { font-family: ui-monospace, monospace; font-size: .85rem; color: #9aa6c2; word-break: break-all; }
  .btn { display: block; text-align: center; padding: 14px; margin: 12px 0; border-radius: 10px;
         text-decoration: none; color: #0b1020; background: #7fd4ff; font-weight: 600; }
  .btn.secondary { background: transparent; color: #7fd4ff; border: 1px solid #7fd4ff; }
  .note { color: #9aa6c2; font-size: .9rem; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  ${directory ? `<p class="dir">${escapeHtml(directory)}</p>` : ''}
  ${app}
  <a class="btn ${app ? 'secondary' : 'primary'}" href="${escapeHtml(webUrl)}">Ouvrir dans le navigateur</a>
  ${note}
</main>
</body>
</html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

/** Routeur de `/open/<session>`. Renvoie `false` si la route ne lui appartient pas. */
export async function openRoute(req, res, pathname) {
  const match = pathname.match(OPEN_ROUTE);
  if (!match) return false;
  const id = match[1];
  try {
    const { body } = await ocGet(`/api/session/${id}`);
    const session = body?.data;
    if (!session) {
      sendHtml(res, 404, renderOpenPage({ id, title: 'Session introuvable', webUrl: '#', mobile: false, archived: false }));
      return true;
    }
    const webUrl = await webSessionUrl(id);
    sendHtml(res, 200, renderOpenPage({
      id,
      title: session.title || id,
      directory: session.location?.directory,
      archived: Boolean(session.time?.archived),
      mobile: MOBILE_UA.test(req.headers['user-agent'] ?? ''),
      webUrl: webUrl ?? '#',
    }));
  } catch (err) {
    if (err.upstream === 404) {
      sendHtml(res, 404, renderOpenPage({ id, title: 'Session introuvable', webUrl: '#', mobile: false, archived: false }));
    } else {
      console.error('[open]', err.message);
      sendHtml(res, 502, renderOpenPage({ id, title: 'OpenCode injoignable', webUrl: '#', mobile: false, archived: false }));
    }
  }
  return true;
}
