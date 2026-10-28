# IArPol

Tableau de bord graphique des activités IA d'ArPol, sous forme de PWA. Chaque session
[OpenCode](https://opencode.ai) d'ArPol-Brain est un neurone relié au cœur ArPol, et sa couleur
donne son état :

| Couleur | Statut serveur | Signification |
|---|---|---|
| cyan, pulsation + signal reçu du cœur | `running` | la session travaille |
| or, onde rapide | `needs` | une permission ou un formulaire attend ta réponse |
| rouge, anneau rompu | `error` | le dernier tour s'est arrêté sur une erreur (quota, limite de débit, fournisseur saturé…). **Persistant**, même consulté, tant que la session n'est pas relancée |
| or, respiration lente | `unread` | la session a rendu la main, retour pas encore consulté |
| éteint | `rest` | rien à faire |

Les sous-agents qui travaillent apparaissent en petits satellites de leur session parente. Un
sous-agent bloqué sur une permission fait passer son parent en `needs`.

Le nom des sessions n'est pas affiché sur le réseau (ni étiquette, ni infobulle) : il n'apparaît que
dans la fenêtre de la session.

### Signaux (`web/src/Network.tsx`)

Le signal part **du cœur vers la session** qui travaille, le long d'un axone à peine courbe (ligne de
champ : il quitte perpendiculairement la sphère, en un point décalé de ±7° au plus de la direction
de la session, puis s'infléchit vers elle). La courbure reste de quelques % de la longueur, jamais
nulle, pour éviter des tracés rectilignes sans dessiner d'arcs prononcés.

- **Charge**, flou électrique sur une sphère vue en 3D : sur une sphère invisible autour du logo
  (rayon 62 × échelle du cœur), le point d'émission est un pôle tourné de 25° vers l'observateur.
  Sept vagues irrégulières (anneaux ondulés vus en perspective) se resserrent sur lui, de plus en
  plus serrées et vives, dans un voile lumineux qui se contracte avec elles ; quelques étincelles y
  crépitent ; la lueur du pôle grandit jusqu'à l'émission. Le tout passe par le filtre SVG
  `#fElectric` (turbulence qui scintille à 12 images/s, déformation, double flou). Projection
  orthographique dans `Network.tsx` (`onSphere`, `wavePath`) ; la zone chargée s'étend à 38° du pôle
  pour ne pas recouvrir le logo.
- **Envoi** : la charge se libère en comète le long de l'axone ; éclair à l'arrivée sur la session.
- **Désynchronisé** : période (3 à 5,6 s) et phase tirées de l'id de chaque session.
- Animé en SMIL (figé par `pauseAnimations()` en pause). En fond d'écran économe : pointillés qui
  filent vers la session et lueur au point d'émission, recalculés par `useWallpaperTicker`.
- Un sous-agent reçoit son signal de son parent, sans phase de charge.

Il n'y a plus de liaison en pointillés entre sessions voisines, ni de compteurs en bas à gauche.
Sur un téléphone, le grand anneau qui tourne est réduit (proportions gardées) pour rester dans
l'écran quelle que soit sa rotation (`layout.ts`, `orbit`).

`/?demo` affiche des données simulées pour voir tous les états et leurs transitions.

## Fenêtre d'une session

Un clic sur un neurone ouvre la fenêtre de la session (`web/src/SessionPanel.tsx`). Elle **sort de
son neurone** (point lumineux qui s'en détache puis se déploie, `web/src/emerge.ts`, Web Animations)
et y retourne à la fermeture.

- **Apparence** : verre bleu nuit translucide, sans barre de titre. La marge reste significative tout
  autour (zone réservée comprise), avec une largeur maximale de 1040 px (×1,25 au plus sur grand
  écran). On ferme par un clic dans la marge, la croix ou Échap.
- **En-tête** :
  - titre, statut, dossier, agent et modèle, dernière activité, jetons ;
  - bouton **Ouvrir** : la session dans OpenCode, puis la fenêtre IArPol « s'envole » (liseré cyan,
    agrandissement, flou, fondu en 0,55 s), comme si elle devenait la fenêtre OpenCode. Voir
    « Ouvrir dans OpenCode » ci-dessous ;
  - bouton **Clôturer**, à confirmer par un second clic dans les 3 s : il interrompt le travail en
    cours puis **archive** la session (historique conservé). La fenêtre se referme alors dans son
    neurone, qui disparaît du réseau.
- **Erreurs** : une session en `error` affiche un bandeau rouge qui dit pourquoi (libellé, et l'heure
  à laquelle le fournisseur permet de réessayer si elle est annoncée). Dans le fil, chaque erreur
  de tour est une carte rouge : libellé, code HTTP, type OpenCode (`provider.rate-limit`…), message.
  Les nouvelles tentatives en cours et les compactions échouées sont aussi signalées. Les erreurs
  viennent du message `idle` (`outcome: failed`, champ `error`) et du message assistant (`error`,
  `retry`) d'OpenCode.
- **Fil** : toute la conversation.
  - Messages en bulles, réponses en Markdown (liens ouverts hors de la page, pas d'images distantes).
  - Ni appels d'outils (commandes, fichiers lus…) ni raisonnements : on les consulte dans OpenCode
    (bouton **Ouvrir**). Une réponse qui n'a fait qu'appeler des outils n'apparaît pas.
  - Séparateur de fin de tour ; heure et modèle sous la dernière réponse d'une suite.
  - Rechargé à chaque changement signalé par le flux SSE, sans sondage propre.
- **Saisie** en bas. Au clavier physique, Entrée envoie et Maj+Entrée va à la ligne. Sur écran
  tactile (`pointer: coarse`), Entrée va à la ligne comme dans les messageries mobiles, et seul le
  bouton envoie. Elle est désactivée si la session est
  clôturée ou si l'appareil n'est pas autorisé.
- **Brouillon** (sans indicateur à l'écran) : un message écrit et pas encore envoyé est gardé par le serveur IArPol, par
  session (`server/src/drafts.js`, `~/.local/state/iarpol/drafts.json`, lisible par l'utilisateur
  seul). Il survit à la fermeture de la fenêtre et suit d'un appareil à l'autre (téléphone, fond
  d'écran). Enregistré 0,6 s après la dernière frappe, et tout de suite à la fermeture de la fenêtre
  ou de l'application. Effacé quand le message part ou que la session est clôturée.
  - Pas de partage avec OpenCode : il n'a pas d'API de brouillon, son interface ne lit aucun
    paramètre d'adresse pour pré-remplir la saisie, et ses brouillons restent dans le stockage du
    navigateur qui l'affiche (IndexedDB `opencode-drafts`, relevé sur OpenCode 2.1.4).
- **Lecture** : ouvrir la fenêtre marque la session comme lue (« réponse à lire » → « au repos »).

### Ouvrir dans OpenCode

La cible est l'interface web d'OpenCode servie par le serveur lui-même, la même que l'application de
bureau : `http://100.78.13.93:4096/server/<base64 de l'adresse du serveur>/session/<id>`. Format
relevé sur OpenCode 2.1.4 ; `openUrl` est fourni par le détail de session. OpenCode Desktop ne sait
pas ouvrir une session depuis l'extérieur : le lien profond `opencode://session/<id>` a été demandé
puis fermé « not planned » (anomalyco/opencode#6232).

- **Navigateur ou PWA** (téléphone, PC) : `window.open`, donc nouvel onglet ou nouvelle fenêtre.
- **Fond d'écran** : le moteur de Hidamari ne sait pas ouvrir de fenêtre. La page appelle le
  service local d'ArPol-Station `station/iarpol-open` (127.0.0.1:4891), qui lance
  `google-chrome --app=<adresse>`, c'est-à-dire une vraie fenêtre sans onglets.
  - Le service n'accepte **que** des adresses de session du serveur OpenCode configuré.
  - Il répond en CORS et en Private Network Access à `https://iarpol.arpol.fr`, et refuse une autre
    origine.
  - Sa réponse est un PNG, ce qui permet un repli par `<img>` si `fetch` vers `http://127.0.0.1` est
    refusé par le moteur.
- Si OpenCode n'est pas connecté au serveur ou n'a pas accès à la session, c'est l'interface
  OpenCode qui l'affiche : authentification Basic `opencode` / mot de passe du service, ou appairage
  par `opencode pair`, dont le lien `…/auth/connect/<jeton>` est à usage unique et valable 5 min.

## Fichiers d'ArPol-Station (`station/`)

Installés dans l'espace utilisateur de la station (`~/.local/bin`, `~/.config/systemd/user`), sans
root ; installés le 2026-10-25.

- `iarpol-wallpaper` : lanceur du fond d'écran.
  - Il est lancé par `~/.config/autostart/iarpol-wallpaper.desktop` à l'ouverture de session.
  - Il attend que le VPN soit monté, choisit `fps=60` (mode PRIME nvidia) ou `fps=6` (on-demand),
    ajoute la zone de l'écran principal (cf. « Plusieurs écrans »), écrit l'URL dans la
    configuration de Hidamari, arrête les instances existantes, puis lance Hidamari sans
    compositing accéléré.
- `iarpol-open` et son unit : service d'ouverture des sessions dans OpenCode (voir plus haut).
- `iarpol-wallpaper-watch` et son unit : **relance le fond d'écran quand les écrans changent**
  (signal `MonitorsChanged` de GNOME, regroupé sur 5 s). Pourquoi : quand un écran disparaît (capot
  refermé), Hidamari l'oublie sans fermer sa fenêtre, qui reste par-dessus le fond d'écran. Vu le
  2026-10-25 : une fenêtre 1920×1080 de l'écran du portable restait sur l'écran externe.

Mise à jour depuis la station :

```bash
scp arpol-brain:'dev/iarpol/station/iarpol-*' ~/.local/bin/ && mv ~/.local/bin/iarpol-*.service ~/.config/systemd/user/ \
 && systemctl --user daemon-reload && systemctl --user enable --now iarpol-open iarpol-wallpaper-watch
```

### Accès

La lecture des échanges et les actions sont réservées aux appareils d'Armand : un agent piloté
depuis cette fenêtre exécute des commandes sur ArPol-Brain, et les échanges peuvent contenir des
secrets.

- **nginx** : `/etc/nginx/sites-available/iarpol.arpol.fr` n'accepte qu'ArPol-Station
  (`100.78.18.209`), arpol-mobile (`100.78.135.94`) et ArPol-Brain. Il pose `X-Real-IP`, qu'il
  réécrit à chaque requête.
- **Serveur** : `IARPOL_TRUSTED_PEERS` vaut par défaut `127.0.0.1,100.78.18.209,100.78.135.94`. Les
  autres reçoivent un 403, et l'interface passe en lecture seule.
- Pourquoi c'est fiable : WireGuard empêche un pair du VPN d'emprunter l'IP d'un autre. Pour ajouter
  un appareil, il faut le déclarer aux deux endroits.

Routes : `GET /api/me`, `GET /api/plugins` (sans le contenu des skills, ouvert à tous),
`GET` et `PUT /api/skills/:id` (`{content}`, appareils de confiance), `GET /api/sessions/:id` (historique allégé : messages, texte des réponses et
erreurs, sans appels d'outils ni raisonnements, 2000 messages au plus),
`POST /api/sessions/:id/prompt` (`{text}`), `/finish`, `/view`, `GET` et `PUT
/api/sessions/:id/draft` (`{text}`, vide pour effacer).

## Plugins custom en lunes (`web/src/PluginMoons.tsx`)

Les plugins **custom** d'OpenCode qui apportent des skills, c'est-à-dire ceux d'ArPol
(`~/.config/opencode/plugins/*`, `source.type: "local"` dans `GET /api/plugin`), sont des **lunes**
sur une orbite plus large que celle des sessions, **à gauche de l'écran seulement**. Les plugins
intégrés (`builtin`) et les paquets npm (Superpowers, Context7, claude-auth…) ne sont pas listés.

- **Placement** (`layout.ts`, `moonOrbit`) : arc gauche, 22° entre deux lunes (110° au plus), par
  ordre alphabétique de haut en bas, sans tracé d'orbite entre elles.
- **Lune** : éclairée du côté du cœur, comme par un soleil, avec quelques cratères et un halo qui
  respire. Sa taille croît un peu avec le nombre de skills. Nom à gauche.
- **Téléphone** (largeur utile < 600 px, `layout.narrow`) : les lunes forment une rangée en haut de
  l'écran, sous la marque, légèrement incurvée ; leurs noms alternent dessous et dessus pour ne pas
  se chevaucher, et les skills s'affichent sous la rangée. L'orbite des sessions y est réduite
  (27 % de la zone utile au lieu de 31-32 %) et descend de 26 px.
- **Clic** : les skills apparaissent **en surimpression sur le fond**, sans fenêtre, à droite de la
  lune et reliées à elle. Le reste de la scène s'estompe. Un clic ailleurs ou Échap referme. Un clic
  sur une skill ouvre sa fenêtre (`web/src/SkillPanel.tsx`), qui sort de la skill choisie.
- **Dynamique** : `GET /api/plugin` et `GET /api/skill` d'OpenCode, relus à chaque ouverture d'un
  plugin, toutes les minutes et au retour sur l'application. Un plugin sans skill n'apparaît pas.
- **Rattachement** (`server/src/skills.js`) : OpenCode ne dit pas quel plugin a enregistré quelle
  skill. On retient les identifiants passés à `registerSkills(ctx, [...])` dans son `index.ts`, ou
  les fichiers rangés dans son dossier.
- **Fenêtre** : Lecture (Markdown rendu, description en tête, reflète aussi les modifications non
  enregistrées) ou Édition du `SKILL.md` complet ; Ctrl+S enregistre ; fermer avec des
  modifications non enregistrées demande confirmation.
- **Modifiable** : les skills rangées dans `~/.config/opencode/skills` (une skill rangée ailleurs
  s'affiche en lecture seule). Écriture atomique sur le fichier réel ; les 10 versions précédentes
  de chaque skill sont gardées dans `~/.local/state/iarpol/skill-backups/`.
- **Prise en compte** : OpenCode lit les skills au chargement des plugins. Une skill enregistrée
  affiche « rechargement d'OpenCode attendu » tant qu'OpenCode tourne avec l'ancienne version.
  IArPol ne recharge pas OpenCode lui-même (`POST /api/location/reload` annule les permissions et
  formulaires en attente).

## Fond tramé

Les dégradés de fond et la lueur du cœur ne sont pas des dégradés CSS. Ils sont dessinés dans un
canevas par `web/src/backdrop.ts`, avec une précision complète, puis **tramés au moment de
l'arrondi** sur 256 niveaux (seuil « interleaved gradient noise »).

- Pourquoi : ces dégradés sont très sombres et très étalés, donc ils ne parcourent qu'une dizaine de
  niveaux par couleur sur 3440 px. WebKitGTK (Hidamari) arrondit les dégradés CSS sans tramage, ce
  qui montrait des disques concentriques bien délimités.
- Résultat : jamais plus d'un niveau d'écart avec la valeur exacte, donc invisible. Un grain ajouté
  par-dessus le fond déjà arrondi avait été essayé puis abandonné : il devait être trop fort pour
  masquer les marches, et il se voyait.

Le canevas n'est redessiné que si la taille, la position du cœur ou son intensité (pause, cœur
éteint) changent.

## Mode fond d'écran (`/?wallpaper`)

Mode utilisé par Hidamari sur ArPol-Station (`https://iarpol.arpol.fr/?wallpaper`).

- **Basse consommation.** Aucune animation CSS ni SMIL : un minuteur JS
  (`web/src/useWallpaperTicker.ts`) recalcule les mouvements à 6 images/s quand une session
  travaille ou attend, et à 2 images/s au repos. Entre deux images, rien n'est repeint. Les signaux
  qui voyagent sont remplacés par un flux en pointillés vers la session et une lueur au point
  d'émission ; le grand anneau ne tourne plus ;
  12 particules au lieu de 26 ; pas de filtres.
  - Pourquoi : sur ArPol-Station, chaque image affichée coûte une copie de tout l'écran
    (3440×1440) par Xorg entre la carte AMD et la carte NVIDIA qui porte l'écran externe, quelle que
    soit la taille de la zone modifiée. Ralentir les animations avec `steps()` ne réduit pas le nombre
    d'images.
  - Mesures en 3440×1440 (WebKit / Xorg) : 32 % / 23 % avant contre **3 % / 3 %** au repos ; 40 % /
    35 % avant contre **15 % / 7 %** avec des sessions actives (démo).
- **Zone réservée.** La barre des tâches est évitée automatiquement grâce à `screen.availLeft` et
  ses équivalents (zone de travail du bureau). On peut forcer la valeur avec `&left=`, `&top=`,
  `&right=` et `&bottom=` (en px). Le réseau, les lunes des plugins et la marque se placent dans la
  zone utile.
- **Grands écrans.** L'interface est agrandie de ×1 à ×1,5 selon la zone utile.
- `&fps=N` règle la cadence active. **À partir de 30, animations natives** (CSS/SMIL à la cadence
  de l'écran, identiques au mode normal : signaux, grand anneau, 26 particules) ; la zone réservée,
  l'agrandissement, la pause et l'absence de service worker restent ceux du mode fond d'écran. Sur
  ArPol-Station, le lanceur choisit `fps=60` en mode PRIME nvidia et `fps=6` en on-demand.
- **Bouton pause** : à la place du logo IArPol (en haut à droite), visible seulement au survol de
  celui-ci. Il libère autant de
  ressources qu'une page vierge (mesuré sur ArPol-Station) :
  - animations figées (minuteur arrêté en mode économe, `animation-play-state` et
    `pauseAnimations()` en mode natif) et transitions coupées ;
  - **flux SSE fermé** : plus de mise à jour des sessions, et le serveur cesse d'interroger OpenCode
    s'il n'a plus d'autre client ;
  - les sessions (neurones, axones) et les lunes des plugins disparaissent. Il ne reste que le fond
    de l'interface, atténué (cœur, particules figées, titre), et le bouton de reprise (au survol du
    logo).

  L'état est mémorisé (`localStorage`), donc une pause survit au redémarrage. Il ne s'applique qu'au
  mode fond d'écran.
- **Plusieurs écrans** : l'interface ne s'affiche que sur l'écran principal ; les autres montrent
  seulement le cœur (logo, lueur, anneaux), fixe, sans flux de données ni animation.
  - Pourquoi côté page : en mode page web, Hidamari charge la même adresse dans une fenêtre par
    écran (`data_source["Default"]`, `player/web_player.py`) ; seul son mode vidéo gère une source
    par écran.
  - Le lanceur lit l'écran principal dans GNOME (`org.gnome.Mutter.DisplayConfig.GetCurrentState`)
    et ajoute sa zone à l'adresse : `&primary=x,y,largeur,hauteur`. Chaque fenêtre compare son
    centre (`screenX`/`screenY`, exacts sous X11 dans WebKitGTK) à cette zone
    (`mode.ts`, `onSecondaryScreen`). Sans réponse de GNOME : l'interface partout, comme avant.
  - `?logo` force l'affichage du logo seul. En fond d'écran, `/api/me` reçoit aussi
    `&s=x,y,LxH` : les journaux de nginx disent sur quel écran tourne chaque fenêtre.
  - Un changement d'écrans relance le fond d'écran (`iarpol-wallpaper-watch`), donc la zone suit.
- **Pas de service worker** : il n'est pas enregistré, et un éventuel ancien est retiré, sinon
  Hidamari afficherait l'ancienne version après chaque déploiement.

## Architecture

```
navigateur (PWA) ──HTTPS──▶ nginx ArPol-Brain ──▶ server/ (Node) ──HTTP──▶ opencode serve --service
https://iarpol.arpol.fr     :443, Netbird seul    127.0.0.1:4880           100.78.13.93:4096
```

- **`server/`** : lit l'adresse et le mot de passe du serveur OpenCode v2 dans
  `~/.local/state/opencode/service.json`, relu à chaque appel parce que l'adresse suit la
  configuration du service et peut changer. Il construit un instantané en lecture seule et le pousse
  aux clients en SSE. Les
  données viennent d'un sondage toutes les 2 s, accéléré par le flux `/api/event` d'OpenCode. Le
  sondage ne tourne que tant qu'un client est connecté. Les identifiants OpenCode ne quittent
  jamais le serveur, et seul `GET` est accepté.
- **`web/`** : Vite + React + TypeScript, PWA via `vite-plugin-pwa`. Charte ArPol, direction
  Cortex sombre.
  - **Mise à jour de la PWA** : `skipWaiting` et `clientsClaim` sont posés explicitement dans
    `vite.config.ts`. `registerType: 'autoUpdate'` ne les ajoute que si le plugin injecte lui-même
    l'enregistrement, or ici `injectRegister: false` (pas de service worker en fond d'écran). Sans
    eux, une nouvelle version restait en attente tant que la PWA n'était pas entièrement fermée :
    le téléphone gardait l'ancienne version (constaté le 2026-10-26).
- **`deploy/iarpol.service`** : unit systemd utilisateur.

Le calcul du statut se trouve dans `server/src/state.js` (`deriveStatus`), à partir de
`/api/session`, `/api/session/active`, et `/api/session/{id}/permission` et `/form`.

## Développement

```bash
cd server && npm run dev            # http://127.0.0.1:4880
cd web && npm install && npm run dev  # http://127.0.0.1:5173, proxy /api vers 4880
```

## Déploiement (ArPol-Brain)

```bash
npm --prefix web run build
ln -sf ~/dev/iarpol/deploy/iarpol.service ~/.config/systemd/user/iarpol.service
systemctl --user daemon-reload && systemctl --user enable --now iarpol
```

URL : **https://iarpol.arpol.fr** (DNS vers l'IP Netbird `100.78.13.93`, donc joignable uniquement
depuis le VPN).

- TLS par le nginx d'ArPol-Brain : `/etc/nginx/sites-available/iarpol.arpol.fr`, écoute sur 443 et
  n'accepte que `100.78.0.0/16`. Il n'est volontairement pas lié à l'IP Netbird, pour que nginx
  démarre même si le VPN n'est pas encore monté.
- Certificat : wildcard `*.arpol.fr` géré par acme.sh sur le CT 101 (`nginx-proxy`, Tardis).
  `/root/.acme.sh/deploy_certs.sh` (étape « CT 103 ») le pousse dans `/etc/nginx/ssl/` via `pct` à
  chaque renouvellement.
