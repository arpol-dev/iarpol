import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'iarpol-open-'));
const sessions = new Map([
  ['ses_aaaaaaaaaaaa1', { id: 'ses_aaaaaaaaaaaa1', title: 'Analyse <ticket> & "test"', location: { directory: '/home/armand/mon projet' }, time: { archived: null } }],
  ['ses_bbbbbbbbbbbb2', { id: 'ses_bbbbbbbbbbbb2', title: 'Ancienne', location: { directory: '/home/armand' }, time: { archived: 123 } }],
]);
let mock;
let base;
let app;

before(async () => {
  mock = createServer((req, res) => {
    const id = new URL(req.url, 'http://x').pathname.split('/').pop();
    const s = sessions.get(id);
    res.writeHead(s ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(s ? { data: s } : { error: 'introuvable' }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const svc = join(dir, 'service.json');
  writeFileSync(svc, JSON.stringify({ url: `http://127.0.0.1:${mock.address().port}`, password: 'mdp', version: '2.1.4' }));
  process.env.OPENCODE_SERVICE_FILE = svc;
  const { openRoute } = await import('../src/openpage.js');
  app = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (!(await openRoute(req, res, pathname))) { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
});

after(() => {
  mock?.close();
  app?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('lien profond encodé avec le dossier', async () => {
  const { appLink } = await import('../src/openpage.js');
  assert.equal(
    appLink('ses_aaaaaaaaaaaa1', '/home/armand/mon projet'),
    'opencodemobile://session/ses_aaaaaaaaaaaa1?project=%2Fhome%2Farmand%2Fmon%20projet',
  );
});

test('la page échappe titre et dossier', async () => {
  const { escapeHtml } = await import('../src/openpage.js');
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('sur téléphone : bouton application et bouton navigateur', async () => {
  const res = await fetch(`${base}/open/ses_aaaaaaaaaaaa1`, {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /href="opencodemobile:\/\/session\/ses_aaaaaaaaaaaa1\?project=%2Fhome%2Farmand%2Fmon%20projet"/);
  assert.match(html, /Ouvrir dans le navigateur/);
  assert.match(html, /Analyse &lt;ticket&gt; &amp; &quot;test&quot;/);
  assert.doesNotMatch(html, /<ticket>/);
});

test('sur ordinateur : seulement le lien web', async () => {
  const res = await fetch(`${base}/open/ses_aaaaaaaaaaaa1`, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' } });
  const html = await res.text();
  assert.doesNotMatch(html, /opencodemobile:/);
  assert.match(html, /Ouvrir dans le navigateur/);
});

test('session archivée : pas de lien application, message explicite', async () => {
  const res = await fetch(`${base}/open/ses_bbbbbbbbbbbb2`, { headers: { 'user-agent': 'Android' } });
  const html = await res.text();
  assert.doesNotMatch(html, /opencodemobile:/);
  assert.match(html, /Session archivée/);
});

test('session inconnue : 404', async () => {
  const res = await fetch(`${base}/open/ses_cccccccccccc3`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Session introuvable/);
});

test('identifiant invalide : pas gérée par la route', async () => {
  const res = await fetch(`${base}/open/../secret`);
  assert.equal(res.status, 404);
});
