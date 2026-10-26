import { readFile } from 'node:fs/promises';
import { OPENCODE_SERVICE_FILE, OPENCODE_USERNAME } from './config.js';

const REQUEST_TIMEOUT_MS = 5000;
const EVENT_RETRY_MS = 5000;

/** Lit l'URL et le mot de passe du serveur OpenCode v2. `null` si le service n'a jamais tourné. */
async function readService() {
  try {
    const { url, password, version } = JSON.parse(await readFile(OPENCODE_SERVICE_FILE, 'utf8'));
    if (typeof url !== 'string') return null;
    const auth = 'Basic ' + Buffer.from(`${OPENCODE_USERNAME}:${password ?? ''}`).toString('base64');
    return { url: url.replace(/\/$/, ''), auth, version };
  } catch {
    return null;
  }
}

/**
 * Requête JSON sur l'API OpenCode. Lève une erreur si le service est absent, injoignable ou répond
 * en erreur ; `body` vaut `null` pour une réponse sans contenu.
 */
export async function ocRequest(method, path, payload) {
  const service = await readService();
  if (!service) throw new Error('service OpenCode introuvable');
  const res = await fetch(service.url + path, {
    method,
    headers: {
      authorization: service.auth,
      accept: 'application/json',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(`OpenCode ${method} ${path} -> HTTP ${res.status}`), { upstream: res.status });
  const text = await res.text();
  return { body: text ? JSON.parse(text) : null, version: service.version };
}

/** GET JSON sur l'API OpenCode. */
export function ocGet(path) {
  return ocRequest('GET', path);
}

/**
 * Adresse d'une session dans l'interface web d'OpenCode servie par le serveur lui-même (la même
 * interface que l'application de bureau) : `/server/<base64 de l'adresse du serveur>/session/<id>`.
 * Relevé sur OpenCode 2.1.4. `null` si le service OpenCode est introuvable.
 */
export async function webSessionUrl(id) {
  const service = await readService();
  if (!service) return null;
  return `${service.url}/server/${Buffer.from(service.url).toString('base64')}/session/${id}`;
}

/**
 * S'abonne au flux d'événements natif (`/api/event`) et appelle `onEvent` à chaque morceau reçu,
 * sans l'interpréter : il sert uniquement à déclencher un rafraîchissement immédiat. Le flux est
 * volatil par contrat (événements perdus pendant une déconnexion), d'où le sondage en parallèle.
 * Se reconnecte indéfiniment ; renvoie une fonction d'arrêt.
 */
export function subscribeEvents(onEvent) {
  let stopped = false;
  let controller;

  (async () => {
    while (!stopped) {
      try {
        const service = await readService();
        if (!service) throw new Error('service OpenCode introuvable');
        controller = new AbortController();
        const res = await fetch(service.url + '/api/event', {
          headers: { authorization: service.auth, accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        for await (const _chunk of res.body) onEvent();
      } catch {
        // service arrêté, redémarré sur un autre port, ou flux coupé : on retente plus tard
      }
      if (!stopped) await new Promise((r) => setTimeout(r, EVENT_RETRY_MS));
    }
  })();

  return () => {
    stopped = true;
    controller?.abort();
  };
}
