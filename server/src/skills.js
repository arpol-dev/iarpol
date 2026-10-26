import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { SKILL_BACKUPS, SKILL_BACKUPS_KEEP, SKILLS_DIR } from './config.js';
import { ocGet } from './opencode.js';

/** Identifiant de skill OpenCode : seul format accepté dans les chemins de l'API. */
export const SKILL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
export const SKILL_MAX = 512 * 1024;

/** Libellés des plugins d'ArPol (le dossier du plugin n'a pas d'accents). */
const LABELS = {
  'arpol.communications': 'Communications',
  'arpol.developpement': 'Développement',
  'arpol.documentation': 'Documentation',
  'arpol.infra-num': 'Infra num',
  'arpol.outils-internes': 'Outils internes',
};

function label(id) {
  if (LABELS[id]) return LABELS[id];
  const name = id.replace(/^arpol\./, '').replace(/[-_.]+/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Skills qu'un plugin local enregistre : `registerSkills(ctx, ["a", "b"])` dans son index.ts. */
async function localSkillIds(path) {
  const source = await readFile(path, 'utf8').catch(() => '');
  const ids = new Set();
  for (const call of source.matchAll(/registerSkills\([^,]+,\s*\[([^\]]*)\]/g)) {
    for (const quoted of call[1].matchAll(/["'`]([^"'`]+)["'`]/g)) ids.add(quoted[1]);
  }
  return ids;
}

function isInside(path, root) {
  return path.startsWith(root + sep);
}

/**
 * Plugins custom d'OpenCode (`source.type: local`, c'est-à-dire ceux d'ArPol dans
 * `~/.config/opencode/plugins`) qui apportent des skills, avec leurs skills. Les plugins intégrés
 * et les paquets npm (Superpowers, Context7…) ne sont pas listés. OpenCode ne dit pas quel plugin a
 * enregistré quelle skill : on retient les identifiants passés à `registerSkills` dans son
 * `index.ts`, ou les fichiers rangés dans son dossier.
 */
async function catalog() {
  const [{ body: plugins }, { body: skills }] = await Promise.all([ocGet('/api/plugin'), ocGet('/api/skill')]);
  const result = [];

  for (const plugin of plugins.data) {
    if (plugin.source.type !== 'local' || !plugin.source.path) continue;
    const ids = await localSkillIds(plugin.source.path);
    const dir = dirname(plugin.source.path);
    const owned = skills.data.filter((s) => ids.has(s.id) || isInside(s.path, dir));
    if (!owned.length) continue;
    result.push({
      id: plugin.id,
      label: label(plugin.id),
      active: plugin.state?.status === 'active',
      skills: owned
        .map((s) => ({ id: s.id, name: s.name, description: s.description ?? '', path: s.path, content: s.content, editable: isInside(s.path, SKILLS_DIR) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    });
  }

  return result.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

/** Liste pour la barre des plugins : sans le contenu des skills. */
export async function listPlugins() {
  const plugins = await catalog();
  return plugins.map(({ skills, ...plugin }) => ({
    ...plugin,
    skills: skills.map(({ id, name, description, editable }) => ({ id, name, description, editable })),
  }));
}

/** Corps d'une skill sans son en-tête YAML : OpenCode ne garde que lui dans `content`. */
function body(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '').trim();
}

/** Valeur d'un champ simple de l'en-tête YAML (`description: …`, guillemets facultatifs). */
function frontmatterField(text, name) {
  const head = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  return head.match(new RegExp(`^${name}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] ?? null;
}

async function findSkill(id) {
  for (const plugin of await catalog()) {
    const skill = plugin.skills.find((s) => s.id === id);
    if (skill) return { plugin, skill };
  }
  throw Object.assign(new Error('skill introuvable'), { status: 404 });
}

/**
 * Contenu d'une skill, lu sur le disque (et non dans la copie chargée par OpenCode) : c'est le
 * fichier qu'on modifie. `loaded` indique si OpenCode tourne avec ce contenu ou avec une version
 * antérieure : une skill est lue au chargement des plugins, une modification ne compte qu'au
 * prochain rechargement d'OpenCode.
 */
export async function skillDetail(id) {
  const { plugin, skill } = await findSkill(id);
  const content = await readFile(skill.path, 'utf8').catch(() => skill.content);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    plugin: { id: plugin.id, label: plugin.label },
    path: skill.path,
    editable: skill.editable,
    content,
    loaded: body(content) === body(skill.content) && (frontmatterField(content, 'description') ?? skill.description) === skill.description,
  };
}

/** Garde les dernières versions d'une skill avant chaque enregistrement (les skills ne sont pas versionnées). */
async function backup(id, previous) {
  await mkdir(SKILL_BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(SKILL_BACKUPS, `${id}.${stamp}.md`), previous);
  const versions = (await readdir(SKILL_BACKUPS)).filter((f) => f.startsWith(`${id}.`) && f.endsWith('.md')).sort();
  await Promise.all(versions.slice(0, -SKILL_BACKUPS_KEEP).map((f) => rm(join(SKILL_BACKUPS, f), { force: true })));
}

/**
 * Enregistre une skill. Seules celles rangées dans SKILLS_DIR sont modifiables (un plugin custom
 * pourrait pointer ailleurs, par exemple dans un cache). Écriture atomique sur le fichier réel (un
 * lien symbolique est suivi, pas remplacé).
 */
export async function saveSkill(id, content) {
  const { skill } = await findSkill(id);
  if (!skill.editable) throw Object.assign(new Error(`skill en lecture seule (hors de ${SKILLS_DIR})`), { status: 403 });
  const file = await realpath(skill.path);
  const previous = await readFile(file, 'utf8');
  if (previous === content) return skillDetail(id);
  await backup(id, previous);
  const tmp = join(dirname(file), `.${basename(file)}.iarpol-${process.pid}.tmp`);
  await writeFile(tmp, content);
  await rename(tmp, file);
  return skillDetail(id);
}
