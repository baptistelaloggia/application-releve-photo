# CLAUDE.md : règles du projet « Relevé photo sur plans »

La conception complète est dans **`docs/CONCEPTION.md`**. Lis-la avant toute proposition importante.
Ce fichier n'en est que le résumé opérationnel.

## Utilisateur et langue

- Répondre **en français**, avec un vocabulaire technique précis. Préférer la rigueur à la fluidité.
- Marquer toute incertitude par **[À VÉRIFIER]**.
- L'utilisateur est ingénieur **CVC** en BET fluides, **pas développeur** : expliquer pas à pas
  les étapes techniques (Git, installation, test, déploiement) et ce que chaque commande fait.
- Ne **jamais** remettre en cause une décision de `docs/CONCEPTION.md` §A.4 sans le signaler explicitement.

## Architecture (décisions figées, voir CONCEPTION §A.4)

- **Une seule base de code : PWA** en TypeScript avec **React** (validé le 04/11/2026).
  Installée depuis Chrome (Android) et Chrome ou Edge (PC Windows), **sans droits administrateur ni store**.
- **Hors ligne obligatoire** : Service Worker (cache de l'appli) + IndexedDB (données locales).
  Demander `navigator.storage.persist()`.
- **Stockage définitif = serveur réseau partagé uniquement**, écrit depuis le PC par la File System Access API.
- **SharePoint = transit seulement** (bibliothèque « Transit », un sous-dossier par projet, purge après collecte).
  Les plans et repères y ont une copie de travail pendant le projet (**option A**, décidée le 04/11/2026).
- Le stockage est une **interface interchangeable** : dossier local, paquet `.zip`, SharePoint transit.
  Les lots 1 à 4 ne doivent dépendre ni de SharePoint ni de la DSI.
- Authentification future : MSAL.js, Entra ID, SPA (code d'autorisation + PKCE), permission `Sites.Selected`.
- **Interdits** : serveur applicatif, base de données externe, service cloud tiers (Firebase, Supabase…).
- Replis possibles seulement si nécessaire : Capacitor (Android), Tauri (Windows sans admin).

## Modèle de données (CONCEPTION §A.5)

- Projet → Plan → Local → Repère → Prise de vue ; Campagne/visite regroupe les prises de vue d'une journée.
- Coordonnées des repères **relatives (0 à 1)** à la page du plan, jamais en pixels.
- Identifiants **UUID générés sur l'appareil**. Le numéro lisible (`P012`) n'est qu'un libellé réattribuable.
- **Un petit fichier JSON par élément** dans `_data/` (`_data/reperes/{uuid}.json`, `_data/photos/{uuid}.json`…).
- Un repère est fixe et accumule des prises de vue datées. **Un repère peut contenir plusieurs photos**,
  y compris le même jour (rang `_01`, `_02`… en fin de nom).
- **Un espace isolé par projet**, dans une seule application.
- Codes de niveau : `SS1`, `SS2`… (sous-sols toujours numérotés, même s'il n'y en a qu'un), `ES` (entresol),
  `RDC`, `R+1`, `R+2`…, `TT` (toiture), ou code libre d'un niveau intermédiaire (`R+4-MEZZANINE` : lettres,
  chiffres, `+`, `-`, jamais `_` ni `.`). L'ordre des niveaux est enregistré (`ordre`) et modifiable.
- Un carnet de plans multi-pages est découpé à l'import : une page = le plan d'un niveau.
- Locaux : `_data/locaux/{uuid}.json`, rattachés à un plan, numéro unique dans le projet. Voir CONCEPTION §A.6 ter.
- Repères `_data/reperes/`, photos `_data/photos/`, miniatures `_data/miniatures/`, panier `01_PHOTOS/_A-CLASSER/`.
  Le chemin d'une photo se déduit de son repère, de son local, de son niveau et de sa date (`cheminAttendu`) :
  après toute modification, `rangerPhotos` remet les fichiers en place. Voir CONCEPTION §A.6 quater.
- Nom des plans : `{Projet}_{Niveau}.pdf` (sans indice ni lot ; l'indice est dans `_data/`).
- Dossiers de niveau sous `01_PHOTOS/` préfixés d'un numéro d'ordre (`00_SS1`, `01_RDC`, `02_R+1`…), pour
  le tri dans l'Explorateur ; partout ailleurs, le code seul. Voir CONCEPTION §A.6 bis.

## Arborescence sur le serveur partagé (CONCEPTION §A.6)

```
2026-XXX_NomProjet/
├── 00_PLANS/       XXX_R+1.pdf
├── 01_PHOTOS/{NN}_{Niveau}/{Niveau}.{N°local}_{NomLocal}/XXX_{Niveau}.{N°local}_P001_AAAA-MM-JJ_01.jpg
├── 02_EXPORTS/
└── _data/
```

Les noms triés alphabétiquement doivent donner l'ordre chronologique par repère. Tout doit rester lisible sans l'appli.

## Priorités fonctionnelles

- Usages : **relevé d'existant, audit et suivi de chantier**.
- Terrain : **2 appuis maximum par photo**. Appui long sur le plan = nouveau repère + appareil photo.
- Photos compressées vers 1 à 1,5 Mo, **métadonnées EXIF conservées**.
- Recherche par local (« chaufferie », « TGBT », « 012 »).
- Pas de filtres par lot technique (CFO, CVC…) : jugés inutiles.

## Plan de réalisation (CONCEPTION §A.8)

Lot 0 Cadrage → 1 Socle → 2 Plans et locaux → 3 Terrain → 4 Synchro zip (1re version utilisable)
→ 5 SharePoint transit → 6 Suivi dans le temps → 7 Exports.

## Sécurité et données

- **Ne jamais committer** de plans clients, de photos réelles, de mots de passe, de jetons ni d'identifiants
  (tenant, client ID…). Les PDF de test réels restent hors du dépôt. Seuls des plans fictifs sont autorisés.
- RGPD : l'appli ne doit pas inciter à photographier des personnes identifiables.

## Code et commandes

- `src/domaine/` : règles pures (codes de niveau, nommage, types) ; `src/stockage/` : interface `Stockage`
  et ses implémentations ; `src/projet/` : logique d'un projet (`EspaceProjet`) ; `src/pdf/` : pdf.js et pdf-lib ;
  `src/ui/` : écrans React ; `src/ui/plan/` : visionneuse de plans (`MoteurVue` : zoom, tuiles, gestes)
  et écran plan (détection, fiche local). Détection des locaux : `src/domaine/locaux.ts` ; recherche :
  `src/domaine/recherche.ts`. Photos : `src/photo/` (compression, EXIF, caméra) et `src/ui/photo/`
  (visée, miniatures, visionneuse) ; panneaux terrain : `src/ui/plan/PanneauxTerrain.tsx`.
- Toute écriture dans le dossier projet passe par `EspaceProjet` et l'interface `Stockage`, jamais directement.
- `npm test` : tests unitaires. `npm run build && npm run build:test && npm run test:e2e` : parcours complet
  dans Chromium (dont `terrain-lot3.mjs` : 300 photos en mode avion, fausse caméra ; `NB_PHOTOS` pour réduire).
  `tests/e2e/plans-reels.mjs` : essai sur un vrai carnet fourni à part (variable `PLANS`).
- Les vrais plans de test se rangent dans le dossier de travail temporaire, jamais dans le dépôt.
- **Le dépôt est public** (10/11/2026) : rien de confidentiel dans le code, les tests, les messages de commit ni la
  documentation (aucun nom de client, de projet réel ou de collègue). L'appli est publiée sur GitHub Pages à chaque
  fusion dans `main` (`.github/workflows/publication-pages.yml`).

## Conventions de travail

- Travailler sur une branche ; fusion dans `main` par pull request relue par l'utilisateur.
- Messages de commit en français, clairs et descriptifs.
- Tenir `docs/CONCEPTION.md` à jour quand une décision est prise ou qu'un point ouvert (§A.9) est tranché.
