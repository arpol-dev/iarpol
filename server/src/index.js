import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { HOST, PORT, TRUSTED_PEERS, WEB_DIST } from './config.js';
import { getDraft, setDraft } from './drafts.js';
import { finishSession, markViewed, sendPrompt, sessionDetail, SESSION_ID_RE } from './sessions.js';
import { listPlugins, saveSkill, skillDetail, SKILL_ID_RE, SKILL_MAX } from './skills.js';
import { getSnapshot, subscribe } from './state.js';

const SSE_HEARTBEAT_MS = 25_000;
const MAX_BODY = 64 * 1024;
const PROMPT_MAX = 20_000;
const SESSION_ROUTE = /^\/api\/sessions\/([^/]+)(?:\/(prompt|finish|view|draft))?$/;
const SKILL_ROUTE = /^\/api\/skills\/([^/]+)$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Flux SSE : l'instantané courant tout de suite, puis un message à chaque changement d'état. */
async function stream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (snapshot) => res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  const unsubscribe = subscribe(send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), SSE_HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  send(await getSnapshot());
}

/**
 * Version à jour de l'interface : nom du script principal référencé par index.html (empreinte Vite).
 * Un client qui tourne avec une autre version se met à jour (cf. web/src/App.tsx).
 */
let buildCache = { mtime: 0, name: null };
async function currentBuild() {
  const file = join(WEB_DIST, 'index.html');
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  if (info.mtimeMs !== buildCache.mtime) {
    const html = await readFile(file, 'utf8');
    buildCache = { mtime: info.mtimeMs, name: html.match(/\/assets\/(index-[^"]+\.js)/)?.[1] ?? null };
  }
  return buildCache.name;
}

/** IP du client : X-Real-IP posé (et réécrit) par nginx, sinon l'adresse de la connexion locale. */
function clientIp(req) {
  return req.headers['x-real-ip'] ?? req.socket.remoteAddress?.replace(/^::ffff:/, '');
}

function trusted(req) {
  return TRUSTED_PEERS.has(clientIp(req));
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readJson(req, max = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw httpError(413, 'requête trop volumineuse');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw httpError(400, 'JSON invalide');
  }
}

/**
 * Détail d'une session et actions. Réservé aux appareils de confiance : les échanges peuvent
 * contenir des secrets, et un message envoyé fait agir un agent capable d'exécuter des commandes.
 */
async function sessionRoute(req, res, id, action) {
  if (!SESSION_ID_RE.test(id)) return sendJson(res, 400, { error: 'identifiant de session invalide' });
  if (!trusted(req)) return sendJson(res, 403, { error: 'appareil non autorisé' });

  if (!action) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'méthode non permise' });
    return sendJson(res, 200, await sessionDetail(id));
  }
  if (action === 'draft') {
    if (req.method === 'GET') return sendJson(res, 200, { draft: await getDraft(id) });
    if (req.method !== 'PUT') return sendJson(res, 405, { error: 'méthode non permise' });
    const { text } = await readJson(req);
    if (typeof text !== 'string' || text.length > PROMPT_MAX) return sendJson(res, 400, { error: 'brouillon invalide ou trop long' });
    return sendJson(res, 200, { draft: await setDraft(id, text) });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'méthode non permise' });
  if (action === 'prompt') {
    const { text } = await readJson(req);
    if (typeof text !== 'string' || !text.trim() || text.length > PROMPT_MAX) {
      return sendJson(res, 400, { error: 'message vide ou trop long' });
    }
    await sendPrompt(id, text);
    await setDraft(id, '');
    return sendJson(res, 202, { ok: true });
  }
  if (action === 'finish') {
    await finishSession(id);
    await setDraft(id, '');
  } else await markViewed(id);
  return sendJson(res, 200, { ok: true });
}

/**
 * Contenu d'une skill (lecture) et enregistrement (PUT). Réservé aux appareils de confiance : une
 * skill guide le comportement des agents, et son contenu peut décrire l'infrastructure.
 */
async function skillRoute(req, res, id) {
  if (!SKILL_ID_RE.test(id)) return sendJson(res, 400, { error: 'identifiant de skill invalide' });
  if (!trusted(req)) return sendJson(res, 403, { error: 'appareil non autorisé' });
  if (req.method === 'GET') return sendJson(res, 200, await skillDetail(id));
  if (req.method !== 'PUT') return sendJson(res, 405, { error: 'méthode non permise' });
  const { content } = await readJson(req, SKILL_MAX * 2);
  if (typeof content !== 'string' || !content.trim() || content.length > SKILL_MAX) {
    return sendJson(res, 400, { error: 'contenu vide ou trop long' });
  }
  return sendJson(res, 200, await saveSkill(id, content));
}

/** Fichiers du build Vite ; toute route inconnue retombe sur index.html (SPA). */
async function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const candidate = normalize(join(WEB_DIST, pathname));
  if (candidate !== WEB_DIST && !candidate.startsWith(WEB_DIST + sep)) {
    return sendJson(res, 400, { error: 'chemin invalide' });
  }

  let file = candidate;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) file = join(WEB_DIST, 'index.html');

  const name = file.slice(WEB_DIST.length);
  // Les fichiers fingerprintés de Vite sont immuables ; le reste (index, service worker,
  // manifest) doit être revalidé pour que les mises à jour de la PWA arrivent.
  const cache = name.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    const session = pathname.match(SESSION_ROUTE);
    if (session) return await sessionRoute(req, res, session[1], session[2]);
    const skill = pathname.match(SKILL_ROUTE);
    if (skill) return await skillRoute(req, res, decodeURIComponent(skill[1]));

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'méthode non permise' });
    if (pathname === '/api/state') return sendJson(res, 200, await getSnapshot());
    if (pathname === '/api/stream') return await stream(req, res);
    if (pathname === '/api/plugins') return sendJson(res, 200, { plugins: await listPlugins() });
    if (pathname === '/api/me') return sendJson(res, 200, { trusted: trusted(req), build: await currentBuild() });
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'inconnu' });
    return await serveStatic(req, res);
  } catch (err) {
    if (err.status) return sendJson(res, err.status, { error: err.message });
    // Erreur renvoyée par OpenCode : session inconnue (404) ou autre (502).
    if (err.upstream === 404) return sendJson(res, 404, { error: 'session introuvable' });
    console.error('[iarpol]', err);
    if (!res.headersSent) sendJson(res, err.upstream ? 502 : 500, { error: err.upstream ? 'OpenCode a refusé la requête' : 'erreur interne' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`IArPol en écoute sur http://${HOST}:${PORT}`));
