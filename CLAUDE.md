# CLAUDE.md : règles du projet « Relevé photo sur plans »

La conception complète est dans **`docs/CONCEPTION.md`**. Lis-la avant toute proposition importante.
Ce fichier n'en est que le résumé opérationnel.

## Utilisateur et langue

- Répondre **en français**, avec un vocabulaire technique précis. Préférer la rigueur à la fluidité.
- Marquer toute incertitude par **[À VÉRIFIER]**.
- L'utilisateur est ingénieur électricité en BET fluides, **pas développeur** : expliquer pas à pas
  les étapes techniques (Git, installation, test, déploiement) et ce que chaque commande fait.
- Ne **jamais** remettre en cause une décision de `docs/CONCEPTION.md` §A.4 sans le signaler explicitement.

## Architecture (décisions figées, voir CONCEPTION §A.4)

- **Une seule base de code : PWA** en TypeScript (React ou Svelte, choix à acter au lot 1).
  Installée depuis Chrome (Android) et Edge (Windows), **sans droits administrateur ni store**.
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
- Un repère est fixe et accumule des prises de vue datées.

## Arborescence sur le serveur partagé (CONCEPTION §A.6)

```
2026-XXX_NomProjet/
├── 00_PLANS/       XXX_R+1_Ind-B.pdf
├── 01_PHOTOS/{Niveau}/{Niveau}.{N°local}_{NomLocal}/XXX_{Niveau}.{N°local}_P001_AAAA-MM-JJ_01.jpg
├── 02_EXPORTS/
└── _data/
```

Les noms triés alphabétiquement doivent donner l'ordre chronologique par repère. Tout doit rester lisible sans l'appli.

## Priorités fonctionnelles

- Terrain : **2 appuis maximum par photo**. Appui long sur le plan = nouveau repère + appareil photo.
- Photos compressées vers 1 à 1,5 Mo, **métadonnées EXIF conservées**.
- Recherche par local (« TGBT », « 012 »).
- Pas de filtres par lot technique (CFO, CVC…) : jugés inutiles.

## Plan de réalisation (CONCEPTION §A.8)

Lot 0 Cadrage → 1 Socle → 2 Plans et locaux → 3 Terrain → 4 Synchro zip (1re version utilisable)
→ 5 SharePoint transit → 6 Suivi dans le temps → 7 Exports.

## Sécurité et données

- **Ne jamais committer** de plans clients, de photos réelles, de mots de passe, de jetons ni d'identifiants
  (tenant, client ID…). Les PDF de test réels restent hors du dépôt. Seuls des plans fictifs sont autorisés.
- RGPD : l'appli ne doit pas inciter à photographier des personnes identifiables.

## Conventions de travail

- Travailler sur une branche ; fusion dans `main` par pull request relue par l'utilisateur.
- Messages de commit en français, clairs et descriptifs.
- Tenir `docs/CONCEPTION.md` à jour quand une décision est prise ou qu'un point ouvert (§A.9) est tranché.
