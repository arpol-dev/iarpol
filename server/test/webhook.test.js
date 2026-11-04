import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Faux serveur OpenCode : OPENCODE_SERVICE_FILE est lu à chaque appel, il suffit de le pointer dessus.
const dir = mkdtempSync(join(tmpdir(), 'iarpol-webhook-'));
const workdir = join(dir, 'projet');
mkdirSync(workdir);
const TOKEN = 'jeton-de-test';
const CONFIG = join(dir, 'webhook.json');
writeFileSync(CONFIG, JSON.stringify({ token: TOKEN, allowedRoots: [dir], modelAliases: { sonnet: 'anthropic/claude-sonnet-5' } }));
process.env.IARPOL_WEBHOOK_FILE = CONFIG;

const fake = { requests: [], sessions: new Map(), counter: 0, models: [] };
let mockServer;
let iarpolServer;
let base;

function startMock() {
  return new Promise((resolve) => {
    mockServer = createServer(async (req, res) => {
      let body = '';
      for await (const c of req) body += c;
      const payload = body ? JSON.parse(body) : undefined;
      fake.requests.push({ method: req.method, url: req.url, payload });
      const send = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(data === undefined ? '' : JSON.stringify(data));
      };
      if (req.headers.authorization !== 'Basic ' + Buffer.from('opencode:mdp').toString('base64')) return send(401, {});
      if (req.method === 'POST' && req.url === '/api/session') {
        const id = `ses_${String(++fake.counter).padStart(12, '0')}`;
        const s = { id, title: payload.title, model: payload.model, permissions: payload.permissions };
        fake.sessions.set(id, s);
        return send(200, { data: s });
      }
      if (req.method === 'GET' && req.url === '/api/model') return send(200, { location: {}, data: fake.models });
      const m = req.url.match(/^\/api\/session\/(ses_[0-9]+)(\/prompt)?$/);
      if (m && req.method === 'POST' && m[2]) return send(200, { ok: true });
      if (m && req.method === 'DELETE') { fake.sessions.delete(m[1]); return send(204); }
      send(404, { error: 'inconnu' });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      const svc = join(dir, 'service.json');
      writeFileSync(svc, JSON.stringify({ url: `http://127.0.0.1:${mockServer.address().port}`, password: 'mdp', version: '2.1.4' }));
      process.env.OPENCODE_SERVICE_FILE = svc;
      resolve();
    });
  });
}

before(async () => {
  await startMock();
  const { webhookRoute } = await import('../src/webhook.js');
  iarpolServer = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (!(await webhookRoute(req, res, pathname))) { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => iarpolServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${iarpolServer.address().port}`;
});

after(() => {
  mockServer?.close();
  iarpolServer?.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fake.requests.length = 0;
  fake.models = [];
});

const hook = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-webhook-token': TOKEN, ...(init.headers ?? {}) },
  });

const create = (extra) =>
  hook('/api/webhook/sessions', { method: 'POST', body: JSON.stringify({ cwd: workdir, prompt: 'Bonjour', label: 'Test Odoo', ...extra }) });

test('refuse un jeton absent ou faux, y compris sur la liste des modèles', async () => {
  assert.equal((await fetch(base + '/api/webhook/sessions', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(base + '/api/webhook/models')).status, 401);
  const bad = await hook('/api/webhook/models', { headers: { 'x-webhook-token': 'nope' } });
  assert.equal(bad.status, 401);
});

test('crée une session dans le dossier demandé, permission allow par défaut', async () => {
  const res = await create({ model: 'sonnet' });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.match(out.name, /^ses_[0-9]+$/);
  assert.equal(out.label, 'Test Odoo');
  assert.equal(out.permission, 'allow');
  assert.equal(out.model, 'anthropic/claude-sonnet-5');
  const created = fake.requests.find((r) => r.method === 'POST' && r.url === '/api/session').payload;
  assert.deepEqual(created.location, { directory: workdir });
  assert.deepEqual(created.model, { providerID: 'anthropic', id: 'claude-sonnet-5' });
  assert.deepEqual(created.permissions, [{ action: '*', resource: '*', effect: 'allow' }]);
  const prompt = fake.requests.find((r) => r.url.endsWith('/prompt')).payload;
  assert.deepEqual(prompt, { text: 'Bonjour' });
});

test('permission ask ou deny est transmise à la règle de la session', async () => {
  const ask = await (await create({ permission: 'ask' })).json();
  assert.equal(ask.permission, 'ask');
  const created = fake.requests.findLast((r) => r.url === '/api/session').payload;
  assert.deepEqual(created.permissions, [{ action: '*', resource: '*', effect: 'ask' }]);
});

test('refuse une permission inconnue et l’ancien champ permissionMode', async () => {
  const bad = await create({ permission: 'bypassPermissions' });
  assert.equal(bad.status, 400);
  const old = await create({ permissionMode: 'acceptEdits' });
  assert.equal(old.status, 400);
  assert.match((await old.json()).error, /permission/);
});

test('idempotencyKey : un second appel renvoie la même session sans en recréer', async () => {
  const first = await (await create({ idempotencyKey: 'odoo-1' })).json();
  const again = await (await create({ idempotencyKey: 'odoo-1' })).json();
  assert.equal(again.name, first.name);
  assert.equal(again.deduplicated, true);
  assert.equal(fake.requests.filter((r) => r.url === '/api/session').length, 1);
});

test('refuse un dossier hors liste, un dossier absent et un modèle mal formé', async () => {
  assert.equal((await hook('/api/webhook/sessions', { method: 'POST', body: JSON.stringify({ cwd: '/etc', prompt: 'x' }) })).status, 403);
  assert.equal((await create({ cwd: join(workdir, 'absent') })).status, 400);
  assert.equal((await create({ model: 'gpt' })).status, 400);
});

test('liste les modèles activés au format providerID/modelID', async () => {
  fake.models = [
    { id: 'claude-sonnet-5', modelID: 'claude-sonnet-5', providerID: 'anthropic', name: 'Claude Sonnet 5', variants: [{ id: 'high' }], status: 'active' },
    { id: 'old', modelID: 'old', providerID: 'anthropic', name: 'Ancien', variants: [], status: 'deprecated' },
    { id: 'off', modelID: 'off', providerID: 'opencode', name: 'Désactivé', variants: [], status: 'active', enabled: false },
  ];
  const res = await hook('/api/webhook/models');
  assert.equal(res.status, 200);
  const { models } = await res.json();
  assert.deepEqual(models, [
    { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic', variants: ['high'], status: 'active' },
  ]);
});

test('méthodes non prévues et routes inconnues', async () => {
  assert.equal((await hook('/api/webhook/models', { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await hook('/api/webhook/sessions/ses_000000000001/message', { method: 'POST', body: '{}' })).status, 404);
});

test('fichier de configuration absent : 503', async () => {
  const { readFileSync, renameSync, writeFileSync: write } = await import('node:fs');
  const saved = readFileSync(CONFIG, 'utf8');
  renameSync(CONFIG, `${CONFIG}.off`);
  try {
    assert.equal((await hook('/api/webhook/models')).status, 503);
  } finally {
    renameSync(`${CONFIG}.off`, CONFIG);
    write(CONFIG, saved);
  }
});
