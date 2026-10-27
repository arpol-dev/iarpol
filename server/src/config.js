import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;

export const HOST = process.env.IARPOL_HOST ?? '127.0.0.1';
export const PORT = Number(process.env.IARPOL_PORT ?? 4880);

/** Build Vite du frontend, servi tel quel (SPA). */
export const WEB_DIST = resolve(process.env.IARPOL_WEB_DIST ?? join(here, '../../web/dist'));

/**
 * Fichier d'état publié par le serveur OpenCode v2 partagé (`opencode serve --service`, unit
 * systemd `opencode-serve` sur ArPol-Brain) : `{ url, password, pid, version }`. Relu à chaque
 * connexion : l'adresse suit `~/.config/opencode/service.json` et le mot de passe peut changer.
 */
export const OPENCODE_SERVICE_FILE =
  process.env.OPENCODE_SERVICE_FILE ?? join(homedir(), '.local/state/opencode/service.json');
export const OPENCODE_USERNAME = process.env.OPENCODE_USERNAME ?? 'opencode';

/**
 * Dossier des skills des plugins d'ArPol (`~/.config/opencode/plugins/*`, cf. lib/skill-plugins.ts) :
 * seules les skills rangées ici sont modifiables depuis IArPol.
 */
export const SKILLS_DIR = resolve(process.env.OPENCODE_SKILLS_DIR ?? join(homedir(), '.config/opencode/skills'));

/** État propre à IArPol (brouillons, versions précédentes des skills). */
const STATE_DIR = resolve(process.env.IARPOL_STATE_DIR ?? join(homedir(), '.local/state/iarpol'));

/** Versions précédentes d'une skill, gardées à chaque enregistrement depuis IArPol. */
export const SKILL_BACKUPS = resolve(process.env.IARPOL_SKILL_BACKUPS ?? join(STATE_DIR, 'skill-backups'));

/** Brouillons des messages non envoyés, par session (cf. drafts.js). */
export const DRAFTS_FILE = join(STATE_DIR, 'drafts.json');
export const SKILL_BACKUPS_KEEP = 10;

/** Intervalle de sondage, en complément du flux d'événements (qui peut perdre des messages). */
export const POLL_MS = Number(process.env.IARPOL_POLL_MS ?? 2000);

/** Une session au repos n'est plus affichée après ce délai sans activité. */
export const WINDOW_DAYS = Number(process.env.IARPOL_WINDOW_DAYS ?? 7);

/**
 * Appareils autorisés à lire les échanges et à agir sur les sessions (envoyer un message, terminer),
 * par IP Netbird : WireGuard garantit qu'un pair ne peut pas emprunter l'IP d'un autre. Par défaut
 * ArPol-Station et arpol-mobile (le VPN compte aussi des serveurs, dont un chez un collègue).
 * L'IP vient de l'en-tête X-Real-IP posé par nginx ; le serveur n'écoute qu'en local.
 */
export const TRUSTED_PEERS = new Set(
  (process.env.IARPOL_TRUSTED_PEERS ?? '127.0.0.1,100.78.18.209,100.78.135.94').split(',').map((s) => s.trim()).filter(Boolean),
);
