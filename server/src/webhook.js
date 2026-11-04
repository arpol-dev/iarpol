import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ocGet, ocRequest, webSessionUrl } from './opencode.js';
import { openPageUrl } from './openpage.js';

/*
 * Point d'entrée des appelants externes (Odoo) pour lancer une session OpenCode dans IArPol.
 * L'appelant ne suit plus la session : il crée la session, puis IArPol la gère. Deux routes :
 *   POST /api/webhook/sessions   crée une session et envoie le premier prompt
 *   GET  /api/webhook/models     liste les modèles disponibles (sélection côté appelant)
 * Accès : en-tête `X-Webhook-Token`. Hors VPN : cf. la route publique de nginx (deploy/).
 */

const WEBHOOK_FILE = process.env.IARPOL_WEBHOOK_FILE ?? join(homedir(), '.config/iarpol/webhook.json');
const MAX_BODY = 64 * 1024;
const PROMPT_MAX = 20_000;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const PERMISSIONS = new Set(['allow', 'ask', 'deny']);
const DEFAULT_PERMISSION = 'allow';

const ROUTE = /^\/api\/webhook\/(sessions|models)$/;

/** `{ token, allowedRoots, modelAliases }` depuis le fichier de config, ou `null` si absent. */
async function loadConfig() {
  try {
    const cfg = JSON.parse(await readFile(WEBHOOK_FILE, 'utf8'));
    if (typeof cfg.token !== 'string' || !cfg.token) return null;
    return {
      token: cfg.token,
      allowedRoots: Array.isArray(cfg.allowedRoots) ? cfg.allowedRoots : [],
      modelAliases: cfg.modelAliases && typeof cfg.modelAliases === 'object' ? cfg.modelAliases : {},
    };
  } catch {
    return null;
  }
}

/** Crée le fichier de config avec un jeton neuf si absent. */
export function ensureWebhookConfig() {
  if (existsSync(WEBHOOK_FILE)) return;
  mkdirSync(dirname(WEBHOOK_FILE), { recursive: true });
  const cfg = { token: randomBytes(24).toString('base64url'), allowedRoots: [homedir()], modelAliases: {} };
  writeFileSync(WEBHOOK_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  console.log(`[webhook] configuration créée : ${WEBHOOK_FILE} (jeton à reporter côté appelant)`);
}

export function isValidToken(given, expected) {
  if (typeof given !== 'string' || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAllowedCwd(cwd, roots) {
  const resolved = resolve(cwd);
  return roots.some((root) => {
    const r = resolve(root);
    return resolved === r || resolved.startsWith(`${r}/`);
  });
}

/**
 * `providerID/modelID` vers la forme `Model.Ref` de l'API. Un alias (ex. `sonnet`) passe par
 * `modelAliases` de la config. `null` pour une valeur vide : OpenCode prend son modèle par défaut.
 */
export function parseModel(value, aliases = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw httpError(400, 'model invalide');
  const target = aliases[value] ?? value;
  const [providerID, ...rest] = target.split('/');
  const id = rest.join('/');
  if (!providerID || !id) {
    throw httpError(400, `modèle inconnu « ${value} » : indiquer providerID/modelID (voir GET /api/webhook/models)`);
  }
  return { providerID, id };
}

/**
 * Règles de permission de la session. Une seule règle, sur toutes les actions et ressources :
 * `allow` (défaut) exécute sans demander, `ask` met la session en attente d'une réponse, `deny`
 * refuse tout. Sémantique des wildcards à vérifier sur un test réel avant mise en production.
 */
export function permissionRuleset(permission) {
  return [{ action: '*', resource: '*', effect: permission }];
}

/** Modèles activés, au format `providerID/modelID`, pour la sélection côté appelant. */
export function summarizeModels(models) {
  const byId = new Map();
  for (const m of models) {
    if (m.enabled === false || (m.status !== 'active' && m.status !== 'beta')) continue;
    const id = `${m.providerID}/${m.modelID ?? m.id}`;
    if (!byId.has(id)) {
      byId.set(id, { id, name: m.name, provider: m.providerID, variants: (m.variants ?? []).map((v) => v.id), status: m.status });
    }
  }
  return [...byId.values()];
}

const recent = new Map();

function checkIdempotency(key) {
  const entry = recent.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    recent.delete(key);
    return null;
  }
  return entry.id;
}

function rememberIdempotency(key, id) {
  recent.set(key, { id, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, 'requête trop volumineuse');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw httpError(400, 'JSON invalide');
  }
}

async function createSession(body, cfg) {
  const { cwd, prompt, model, permission, label, idempotencyKey, permissionMode } = body;

  if (typeof idempotencyKey === 'string' && idempotencyKey) {
    const existing = checkIdempotency(idempotencyKey);
    if (existing) return { name: existing, deduplicated: true };
  }

  if (!cfg.allowedRoots.length) throw httpError(403, 'aucun répertoire autorisé — configurer allowedRoots');
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) throw httpError(400, 'cwd invalide');
  if (!isAllowedCwd(cwd, cfg.allowedRoots)) throw httpError(403, 'cwd hors de la liste autorisée');
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw httpError(400, "ce dossier n'existe pas");
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > PROMPT_MAX) throw httpError(400, 'prompt requis');
  if (permissionMode !== undefined && permissionMode !== null) throw httpError(400, 'permissionMode remplacé par permission (allow, ask, deny)');
  const mode = permission ?? DEFAULT_PERMISSION;
  if (!PERMISSIONS.has(mode)) throw httpError(400, 'permission invalide (allow, ask ou deny)');

  const sessionLabel = typeof label === 'string' && label.trim() ? label.trim() : basename(cwd);
  const modelRef = parseModel(model, cfg.modelAliases);

  const { body: created } = await ocRequest('POST', '/api/session', {
    title: sessionLabel,
    location: { directory: cwd },
    ...(modelRef ? { model: modelRef } : {}),
    permissions: permissionRuleset(mode),
  });
  const id = created.data.id;

  try {
    await ocRequest('POST', `/api/session/${id}/prompt`, { text: prompt });
  } catch (err) {
    await ocRequest('DELETE', `/api/session/${id}`).catch(() => {});
    throw err;
  }

  if (typeof idempotencyKey === 'string' && idempotencyKey) rememberIdempotency(idempotencyKey, id);
  return { name: id, label: sessionLabel, permission: mode, model: modelRef ? `${modelRef.providerID}/${modelRef.id}` : null, url: await webSessionUrl(id), openUrl: openPageUrl(id) };
}

async function listModels() {
  const { body } = await ocGet('/api/model');
  return { models: summarizeModels(body?.data ?? []) };
}

async function dispatch(req, res, route, cfg) {
  if (route === 'models') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'méthode non permise' });
    return sendJson(res, 200, await listModels());
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'méthode non permise' });
  return sendJson(res, 200, await createSession(await readBody(req), cfg));
}

/** Routeur de `/api/webhook/...`. Renvoie `false` si la route ne lui appartient pas. */
export async function webhookRoute(req, res, pathname) {
  const match = pathname.match(ROUTE);
  if (!match) return false;

  try {
    const cfg = await loadConfig();
    if (!cfg) {
      sendJson(res, 503, { error: 'webhook non configuré (fichier de configuration absent)' });
      return true;
    }
    if (!isValidToken(req.headers['x-webhook-token'], cfg.token)) {
      sendJson(res, 401, { error: 'jeton invalide' });
      return true;
    }
    await dispatch(req, res, match[1], cfg);
  } catch (err) {
    if (err.status) sendJson(res, err.status, { error: err.message });
    else if (err.upstream === 404) sendJson(res, 404, { error: 'introuvable côté OpenCode' });
    else {
      console.error('[webhook]', err);
      sendJson(res, err.upstream ? 502 : 500, { error: err.upstream ? 'OpenCode a refusé la requête' : 'erreur interne' });
    }
  }
  return true;
}
