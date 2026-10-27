import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DRAFTS_FILE } from './config.js';

/** Au-delà, les brouillons les plus anciens sont oubliés. */
const MAX_DRAFTS = 200;

let drafts = null;
let writing = Promise.resolve();

async function load() {
  if (drafts) return drafts;
  try {
    drafts = JSON.parse(await readFile(DRAFTS_FILE, 'utf8'));
  } catch {
    drafts = {};
  }
  return drafts;
}

/** Écriture atomique, réservée à l'utilisateur (un brouillon peut contenir un secret), une à la fois. */
function persist() {
  const snapshot = JSON.stringify(drafts);
  writing = writing
    .then(async () => {
      await mkdir(dirname(DRAFTS_FILE), { recursive: true });
      const tmp = `${DRAFTS_FILE}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, DRAFTS_FILE);
    })
    .catch((err) => console.error('[iarpol] brouillons non enregistrés', err));
  return writing;
}

/**
 * Brouillon du message d'une session : texte saisi dans la fenêtre de session et pas encore envoyé.
 * Gardé par le serveur pour survivre à la fermeture de la fenêtre et suivre d'un appareil à l'autre.
 * OpenCode n'offre pas d'équivalent partageable : ses brouillons restent dans le stockage du
 * navigateur qui affiche son interface.
 */
export async function getDraft(id) {
  return (await load())[id] ?? null;
}

/** Enregistre (ou efface, si vide) le brouillon d'une session. */
export async function setDraft(id, text) {
  const all = await load();
  if (!text.trim()) {
    if (!(id in all)) return null;
    delete all[id];
  } else {
    all[id] = { text, updated: Date.now() };
    const ids = Object.keys(all);
    if (ids.length > MAX_DRAFTS) {
      ids.sort((a, b) => all[a].updated - all[b].updated);
      for (const old of ids.slice(0, ids.length - MAX_DRAFTS)) delete all[old];
    }
  }
  await persist();
  return all[id] ?? null;
}
