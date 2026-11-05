# Reprise du projet : application de relevé photo sur plans

> Document de reprise, rédigé le 30/10/2026. Enregistré dans le dépôt le 04/11/2026 ; décisions ultérieures reportées en A.4 et A.9.
> **Partie A** : à donner tel quel à Claude (ou à joindre en pièce jointe) au début d'une nouvelle conversation.
> **Partie B** : guide pour l'utilisateur, pour créer son compte GitHub et le dépôt du code.

---

# PARTIE A : CONTEXTE À DONNER À CLAUDE

## A.0 Message de démarrage à coller

```
Je reprends un projet d'application dont la conception a été faite dans une conversation précédente.
Le document ci-joint (Partie A) résume tout ce qui a été décidé. Lis-le entièrement,
puis récapitule-moi en 10 lignes ce que tu as compris et les points encore ouverts (section A.9),
avant de proposer quoi que ce soit. Ne remets pas en cause les décisions de la section A.4
sans me le signaler explicitement. Réponds en français.
```

## A.1 Profil de l'utilisateur

- Ingénieur **CVC** en bureau d'études fluides (BET), en France.
- Projets de bâtiment (ERP, tertiaire, logement), phases APS à EXE.
- Préférences : réponses en français, vocabulaire technique précis, rigueur plutôt que fluidité, toute incertitude marquée **[À VÉRIFIER]**.
- Il n'est pas développeur : il faut expliquer les étapes techniques (Git, installation, déploiement) pas à pas.

## A.2 Le besoin en une phrase

Une application, à la fois **sur téléphone Android** et **sur PC Windows sans droits administrateur**, qui sert à **localiser des photos sur les plans PDF d'un projet**. Chaque photo est rattachée à un repère placé sur un plan, dans un local identifié. L'application fonctionne **hors ligne** et range les photos dans une **arborescence Windows normalisée sur le serveur réseau partagé**.

## A.3 Les réponses de l'utilisateur au cadrage

| Question | Réponse |
|---|---|
| Téléphones | **Android** surtout, téléphones **personnels et de société** |
| Utilisateurs | **Une équipe dès le départ** (plusieurs personnes sur un même projet) |
| Stockage actuel | **Serveur réseau partagé** (lecteur réseau). SharePoint est possible, la DSI sera sollicitée. |
| Stockage définitif voulu | **Serveur réseau partagé uniquement. SharePoint seulement comme transit**, jamais comme stockage définitif. |
| Format des plans | **PDF**. Nom des plans : `{Projet}_{Niveau}.pdf` (décidé le 04/11/2026, voir A.6 bis). |
| Usage principal | **Relevé d'existant, audit et suivi de chantier** (suivi de chantier ajouté le 04/11/2026) |
| Volume | **20 à 300 photos par visite** |
| Organisation | **Un espace isolé par projet dans une seule application** (confirmé le 04/11/2026) |
| Dépôt de code | **Un dépôt GitHub dédié**, à créer (voir la partie B) |
| Filtres par lot (CFO, CVC…) | **Inutiles**. Priorité : beaucoup de photos, très faciles à prendre, à retrouver et à repérer. |
| Besoins exprimés en plus | **Reprendre la même photo à plusieurs dates** et **rechercher par local** (locaux identifiés sur les plans) |

## A.4 Décisions d'architecture prises

1. **Technologie : une seule base de code, une PWA** (Progressive Web App), en TypeScript avec **React** (choix validé le 04/11/2026).
   - Installée depuis Chrome sur Android et depuis **Chrome ou Edge** sur PC Windows : pas de droits admin, pas de store.
   - Hors ligne : Service Worker (cache de l'appli) et IndexedDB (données locales).
   - Côté PC, écriture dans les vrais dossiers Windows par la *File System Access API* (Edge/Chrome).
   - Solutions de repli si besoin : Capacitor (vraie appli Android) ou Tauri (exe Windows installable par l'utilisateur seul, sans droits admin).
2. **Stockage définitif : le serveur réseau partagé.** C'est la seule référence.
3. **SharePoint ne sert que de transit** (« boîte aux lettres »), parce qu'un téléphone hors du réseau de l'entreprise ne peut pas écrire sur le serveur :
   - le téléphone dépose photos et repères dans une **bibliothèque SharePoint « Transit »**, avec un sous-dossier par projet, via Microsoft Graph ;
   - un **PC du réseau, appli ouverte, fait la collecte** : il télécharge, range sur le serveur partagé, contrôle, puis **supprime de SharePoint** ;
   - plus tard, la collecte pourra être automatisée par Power Automate avec une passerelle de données locale installée par la DSI [À VÉRIFIER : licence].
4. **Mode dégradé en attendant l'accord de la DSI** : le téléphone exporte un paquet `.zip` de la visite, transféré par câble USB (ou OneDrive pro), et le PC l'importe et le range. Le stockage est conçu comme une **interface interchangeable** (dossier local, zip, SharePoint transit), pour brancher SharePoint ensuite sans réécrire l'appli.
5. **Authentification** (quand SharePoint sera branché) : MSAL.js, Entra ID, application monopage (flux code d'autorisation + PKCE), permission **Sites.Selected**, limitée à la seule bibliothèque de transit.
6. **Hébergement de l'appli** : fichiers statiques en HTTPS (Azure Static Web Apps, offre gratuite, ou hébergement interne). Aucune donnée projet n'y passe.
7. **Pas de serveur applicatif, pas de base de données externe, pas de service cloud tiers** (Firebase, Supabase, etc. écartés).
8. **Logiciels du marché écartés** (Archipad, Finalcad, PlanRadar) : coût par utilisateur et données hébergées chez l'éditeur.
9. **Diffusion des plans vers les téléphones : option A** (décidé le 04/11/2026, voir A.9-1). Une copie de travail des plans et des repères reste dans SharePoint Transit pendant toute la durée du projet ; chaque téléphone la télécharge seul ; elle est supprimée à la clôture du projet. Le serveur partagé reste la seule référence. En mode dégradé (avant SharePoint), les plans sont chargés par paquet `.zip`.

## A.5 Modèle de données

```
Projet
 ├─ Plan (niveau, indice, PDF source, pages)
 │   └─ Local (numéro, nom, contour ou étiquette sur le plan)
 │        └─ Repère (x, y RELATIFS entre 0 et 1, n°, libellé, direction de prise de vue)
 │             └─ Prise de vue (date, auteur, fichier photo, commentaire, empreinte) : PLUSIEURS par repère
 └─ Campagne / visite (date, équipe) : regroupe les prises de vue d'une journée
```

Règles :
- **Coordonnées relatives** (0 à 1) à la page du plan, jamais en pixels.
- **Identifiants UUID** générés sur l'appareil, pour créer des repères hors ligne sans collision. Le numéro lisible (`P012`) n'est qu'un libellé, réattribuable.
- **Un petit fichier JSON par élément** (`_data/reperes/{uuid}.json`, `_data/photos/{uuid}.json`…) plutôt qu'un gros fichier unique, pour éviter les conflits d'écriture à plusieurs.
- Le **repère est fixe** ; il accumule des **prises de vue datées**, ce qui permet le suivi dans le temps.
- **Un repère peut contenir plusieurs photos**, y compris plusieurs le même jour : elles sont numérotées par un rang (`_01`, `_02`…) en fin de nom (voir A.6).

## A.6 Arborescence sur le serveur partagé

```
2026-XXX_NomProjet/
├── 00_PLANS/
│   └── XXX_R+1.pdf
├── 01_PHOTOS/
│   └── 02_R+1/       (numéro d'ordre du niveau devant le code : voir A.6 bis)
│       ├── R+1.012_Local-TGBT/
│       │   ├── XXX_R+1.012_P001_2026-10-30_01.jpg
│       │   ├── XXX_R+1.012_P001_2027-03-15_01.jpg   (même repère, autre date)
│       │   └── XXX_R+1.012_P002_2026-10-30_01.jpg
│       └── R+1.013_Bureau/
├── 02_EXPORTS/       (rapports PDF, listes Excel)
└── _data/            (données de l'appli : un JSON par repère / photo / local)
```

Principe : une fois les noms triés par ordre alphabétique, les photos d'un même repère se suivent dans l'ordre chronologique. Tout reste lisible sans l'appli.

## A.6 bis Codes de niveau (décidé le 04/11/2026)

| Code | Niveau |
|---|---|
| `SS1`, `SS2`, … | Sous-sols, **toujours numérotés**, même s'il n'y en a qu'un (`SS1` est le plus proche du RDC) |
| `ES` | Entresol, entre les sous-sols et le RDC (ajouté et confirmé le 04/11/2026) |
| `RDC` | Rez-de-chaussée |
| `R+1`, `R+2`, … | Étages courants |
| `TT` | Toiture |

Règles (validées le 04/11/2026) :
- **Sous-sols** : `SS1`, `SS2`… (`SS1` étant le plus proche du RDC). **Un seul sous-sol : `SS1`** (décidé le 04/11/2026 ; le code `SS` seul n'est plus utilisé, une saisie « SS » devient `SS1`).
- **Nom des plans** : `{Projet}_{Niveau}.pdf`, par exemple `XXX_R+1.pdf`. Ni indice ni lot dans le nom.
- **Ordre dans l'Explorateur Windows** : les dossiers de niveau sous `01_PHOTOS/` portent un **numéro d'ordre à 2 chiffres** devant le code, attribué par l'appli dans l'ordre du bâtiment (du plus bas au plus haut), par exemple `00_SS2`, `01_SS1`, `02_ES`, `03_RDC`, `04_R+1`… `NN_TT`. **Seuls ces dossiers** portent ce numéro. Les noms des plans, des dossiers de locaux et des photos gardent le code seul (`XXX_R+1.012_P001_…jpg`).

Règles complémentaires (validées le 04/11/2026) :
- **Indices des plans** : l'indice courant est enregistré dans les données de l'appli (`_data/plans/{uuid}.json`). À chaque nouvel indice, le PDF remplacé est déplacé dans `00_PLANS/_ANCIENS/` sous le nom `{Projet}_{Niveau}_Ind-{Indice}.pdf`.
- **Ajout d'un niveau en cours de projet** : l'appli recalcule les numéros d'ordre et renomme automatiquement les dossiers de niveau.

Règles issues du lot 1 (04/11/2026) :
- **Un seul plan courant par niveau.** [À VÉRIFIER : grands bâtiments avec plusieurs feuilles (zones) par niveau.]
- **Carnets de plans** : un PDF contenant un niveau par page est découpé à l'import. Chaque page retenue devient le plan `{Projet}_{Niveau}.pdf` de son niveau, avec son contenu vectoriel. Le niveau de chaque page est reconnu d'après son titre (« PLAN DE NIVEAU - R+2 », « … - ENTRESOL », « … - TOIT »…), et l'utilisateur peut le corriger avant l'import. Le JSON du plan garde le nom du carnet d'origine et le numéro de page (`pageOrigine`).
- **Équivalences reconnues** : `R+0` → `RDC`, `ENTRESOL` → `ES`, `TOIT` / `TOITURE` → `TT`, `R1` → `R+1`.

## A.6 ter Locaux (lot 2, 05/11/2026)

- Un local = un fichier `_data/locaux/{uuid}.json` : plan de rattachement (`planId`), numéro (facultatif), nom, surface (facultative), position de son étiquette (x, y relatifs 0 à 1), origine (`auto` : détecté puis validé ; `manuel` : placé à la main), auteur et date de création et de modification.
- **Détection** : l'appli lit le texte vectoriel de la page et regroupe les lignes empilées et centrées de même hauteur. Elle retient les groupes qui contiennent un numéro (lettres puis chiffres, comme `SF202`, `LT1104.B`, ou chiffres seuls s'il y a une surface) ou une surface (`33,7 m²`). Un nom seul est retenu s'il désigne un type de local (bureau, sanit., local, circ., stockage, CTA, TGBT…), s'il est en majuscules et s'il se trouve dans la zone dessinée. Les propositions sont toujours **vérifiées par l'utilisateur** avant enregistrement, et une nouvelle détection ne recrée pas les locaux déjà présents.
- Essai sur le carnet réel : 141 étiquettes complètes et 83 noms seuls sur 10 niveaux ; 47 locaux numérotés au SS1, dont le TGBT (LT1105). Quelques faux positifs restent à décocher (cartouche de la page toiture).
- **Numéro unique** dans le projet ; nom obligatoire.
- **Recherche** : par nom, numéro et code de niveau, sans tenir compte des accents ni de la casse (« tgbt », « 012 », « cta ss1 »). Le numéro exact passe en premier.
- **Affichage des plans** : image de fond de la page entière, puis tuiles de 512 px calculées à la demande pour le zoom courant (jusqu'à 8 pixels par point PDF). Le zoom se fait à la molette, au pincement ou au double appui.
- [À VÉRIFIER, à trancher avant le lot 3] **Locaux sans numéro** (par ex. « BUREAUX » en plateau) : le dossier photos prévu est `{Niveau}.{N°local}_{NomLocal}`. Il faut décider comment nommer le dossier d'un local sans numéro.

## A.7 Fonctions prévues

**Terrain (priorité absolue : 2 appuis maximum par photo)**
- Toucher un repère existant ouvre l'appareil photo, on prend la photo, on revient au plan. Rafale possible.
- Appui long sur le plan : nouveau repère, rattaché automatiquement au local, et ouverture de l'appareil photo.
- « Panier à classer » : photo prise sans repère, placée plus tard.
- Commentaire par dictée vocale, facultatif.
- Locaux déjà photographiés pendant la visite colorés sur le plan.
- Compression des photos (autour de 1 à 1,5 Mo) en conservant les métadonnées EXIF. Stockage persistant demandé au navigateur (`navigator.storage.persist()`).

**Plans et locaux**
- Import PDF avec pdf.js, affichage par tuiles (zoom fluide, hors ligne).
- **Détection automatique des locaux** depuis le texte vectoriel des PDF (étiquettes de pièces avec leur position) [À VÉRIFIER sur de vrais plans : impossible si le PDF est scanné ou si le texte est converti en traits].
- Renommage des plans selon la convention `{Projet}_{Niveau}.pdf` (A.6 bis), éventuellement depuis un tableau Excel.
- Changement d'indice : report des repères, avec recalage par 2 points si le cadrage a changé.

**Suivi dans le temps**
- Photo précédente affichée **en transparence** dans la visée, pour refaire le même cadrage.
- Frise chronologique par repère, comparaison avant/après.
- Direction de prise de vue (flèche sur le plan) [À VÉRIFIER : boussole peu fiable près des masses métalliques].

**Recherche et exports**
- Recherche par local (« TGBT », « 012 ») : position sur le plan et toutes les photos.
- Rapport PDF par local et par plan, liste Excel des repères.

## A.8 Plan de réalisation

| Lot | Contenu | Validation |
|---|---|---|
| 0. Cadrage | Test de lecture des locaux sur de vrais PDF, maquettes des écrans, demande à la DSI | Spécification validée |
| 1. Socle | Dépôt, PWA installable, création du projet, import des PDF, renommage, arborescence sur le serveur partagé | Projet créé sur le serveur (**réalisé le 04/11/2026**, validation sur le serveur réel à faire par l'utilisateur) |
| 2. Plans et locaux | Affichage par tuiles, détection et correction des locaux, recherche | « Je tape TGBT, je trouve le local » (**réalisé le 05/11/2026**, vérifié sur un vrai carnet : le TGBT du SS1 est trouvé) |
| 3. Terrain | Repères, photo en 2 appuis, panier à classer, hors ligne, compression | Visite de 300 photos en mode avion |
| 4. Synchro zip | Export et import `.zip`, rangement, contrôle des doublons | **Première version utilisable de bout en bout** |
| 5. SharePoint transit | MSAL, envoi depuis le téléphone, collecte par le PC puis purge | Deux personnes sur un même projet |
| 6. Suivi dans le temps | Transparence, frise, avant/après, direction | Même cadrage à 2 dates |
| 7. Exports | Rapport PDF, liste Excel | Livrable d'audit |

Les lots 1 à 4 ne dépendent pas de la DSI.

## A.9 Points encore ouverts

1. ~~**Comment les plans arrivent sur les téléphones**~~ **TRANCHÉ le 04/11/2026 : option A** (voir A.4-9). Rappel des options :
   - **A (recommandé)** : une copie de travail des plans et des repères reste dans SharePoint Transit pendant le projet. Chaque téléphone la télécharge seul. La copie est supprimée à la clôture du projet.
   - **B** : seules les photos transitent. Les plans sont chargés sur chaque téléphone par câble USB, à refaire à chaque nouvel indice.
2. ~~**Convention de nommage des plans**~~ **TRANCHÉ le 04/11/2026** (A.6 bis) : `{Projet}_{Niveau}.pdf`, sous-sols toujours numérotés `SS1`, `SS2`… (y compris un sous-sol unique), entresol `ES`, numéro d'ordre devant les dossiers de niveau. Archivage des anciens indices dans `00_PLANS/_ANCIENS/` et renumérotation automatique des dossiers de niveau.
3. **Plans PDF de test** : 2 ou 3 vrais plans (anonymisés) pour vérifier la détection des locaux. **Ne pas les mettre dans le dépôt Git si ce sont des plans clients.**
   - 04/11/2026 : un premier carnet reçu (11 pages, A1, une page par niveau, texte vectoriel), utilisé hors dépôt. Les 10 niveaux ont été reconnus automatiquement. Les noms de locaux sont présents en texte (« BUREAUX », « COUR CENTRALE », « SANIT. F », « LOCAL VELOS »…), ce qui est favorable au lot 2. [À VÉRIFIER au lot 2 : présence de numéros de locaux, et lecture correcte des étiquettes sur plusieurs lignes.]
4. ~~**Écriture sur un lecteur réseau mappé**~~ **VALIDÉ le 05/11/2026** par l'utilisateur sur le serveur réel, avec l'écran « Tester l'écriture sur le serveur » : toutes les étapes réussies (écriture de 1 Mo en 0,5 s, renommage de dossier en 0,6 s).
5. ~~**« Une appli par projet »**~~ **TRANCHÉ le 04/11/2026** : un espace isolé par projet dans une seule application.
6. **Note à la DSI** : une première version a été rédigée, mais elle décrit **l'ancienne architecture** (SharePoint comme stockage définitif, un site par projet). **Elle est à refaire** selon A.4 :
   - stockage définitif sur le serveur partagé ;
   - **une seule bibliothèque SharePoint de transit**, avec permission Sites.Selected limitée à elle ;
   - durée de séjour courte, purge après collecte ;
   - questions sur les téléphones personnels (accès conditionnel, Intune MAM), l'hébergement, la passerelle Power Automate éventuelle, l'avis du DPO (RGPD : ne photographier aucune personne identifiable).

## A.10 Contenu de la note à la DSI (à reprendre et corriger)

Sections prévues : objet et contexte, description fonctionnelle, architecture technique (avec schéma), demandes précises, sécurité et données, solution transitoire, questions et calendrier.

Demandes à formuler (version corrigée) :

| # | Demande | Détail |
|---|---|---|
| 1 | Enregistrement d'une application dans Entra ID | Application monopage (SPA), MSAL, code d'autorisation + PKCE, sans secret |
| 2 | Permission Graph **Sites.Selected** déléguée | Limitée à la seule bibliothèque de transit [À VÉRIFIER : support délégué de Sites.Selected dans leur configuration] |
| 3 | **Une bibliothèque SharePoint « Transit »** | Un sous-dossier par projet, contenu purgé après collecte |
| 4 | Hébergement statique de l'appli | Azure Static Web Apps ou interne, HTTPS |
| 5 | Avis sur les téléphones personnels | Accès conditionnel / Intune MAM |
| 6 (option) | Passerelle de données locale | Pour automatiser la collecte par Power Automate plus tard |

Mesures de sécurité : HTTPS partout ; photos stockées dans le navigateur du téléphone (invisibles de la galerie) et effacées après envoi confirmé ; jetons MSAL révocables ; traçabilité (auteur et date de chaque photo) ; stockage définitif et sauvegarde sur le serveur partagé existant.

---

# PARTIE B : GUIDE POUR L'UTILISATEUR (GitHub et reprise avec Claude)

## B.1 Pourquoi GitHub ?

GitHub est un site qui **stocke le code source** et garde l'**historique de chaque modification**. Claude (version Claude Code) travaille directement dans un dépôt GitHub : il lit le code, le modifie et enregistre ses changements (des « commits »). Le code est ainsi conservé même quand la conversation se termine.

## B.2 Créer un compte GitHub (gratuit)

1. Aller sur **https://github.com/signup**.
2. Saisir une adresse e-mail, un mot de passe et un nom d'utilisateur (par exemple `prenom-nom`).
3. Valider l'e-mail avec le code reçu.
4. Choisir l'offre **Free** : elle suffit, et les dépôts privés y sont illimités.
5. Recommandé : activer la **double authentification** (Settings > Password and authentication).

> Faut-il un compte personnel ou un compte de la société ? Si le code est développé pour l'entreprise, demander à la DSI s'il existe une **organisation GitHub** de la société. Sinon, un compte personnel convient pour démarrer, et le dépôt pourra être transféré plus tard (Settings > Danger Zone > Transfer ownership).

## B.3 Créer le dépôt du projet

1. Une fois connecté, cliquer sur le **« + »** en haut à droite, puis **New repository**.
2. Remplir :
   - **Repository name** : par exemple `releve-photo-plans` (sans espace ni accent) ;
   - **Description** : « Application de relevé photo localisé sur plans PDF » ;
   - **Visibilité : Private** (indispensable, des plans clients pourront servir aux tests) ;
   - cocher **Add a README file** ;
   - **.gitignore** : choisir le modèle **Node** ;
   - **License** : aucune (usage interne).
3. Cliquer sur **Create repository**.

## B.4 Relier GitHub à Claude

1. Se connecter au compte Claude qui va reprendre le projet, sur **https://claude.ai**.
2. Ouvrir **https://claude.ai/connect-github** et autoriser la connexion au compte GitHub.
3. Installer l'**application GitHub de Claude** sur le dépôt, depuis cette même page. Choisir **Only select repositories**, puis sélectionner `releve-photo-plans`. Il est inutile de donner accès à tous les dépôts.
4. Aller sur **https://claude.ai/code**, démarrer une nouvelle session et **sélectionner le dépôt `releve-photo-plans`** au lancement. Les dépôts d'une session se choisissent à son démarrage.

## B.5 Démarrer la reprise

1. Dans cette nouvelle session, joindre ce fichier (ou coller la **Partie A**) avec le message de démarrage de la section A.0.
2. Lui demander d'abord d'**enregistrer ce document dans le dépôt**, par exemple sous `docs/CONCEPTION.md`. Toute session future le retrouvera ainsi automatiquement.
3. Lui demander ensuite de créer un fichier **`CLAUDE.md`** à la racine du dépôt, qui résume les règles du projet (langue, architecture, conventions). Claude le lit au début de chaque session.
4. Trancher les points ouverts de la section A.9, au moins le point 1 (plans A ou B), puis lancer le **lot 1**.

## B.6 Bonnes pratiques

- **Ne jamais déposer dans le dépôt** de plans clients, de photos réelles, de mots de passe ou d'identifiants. Pour les tests, utiliser des plans anonymisés ou fictifs, ou les transmettre à Claude en pièce jointe sans les enregistrer dans le dépôt.
- Claude travaille sur une **branche** (une copie de travail du code). On fusionne ses changements dans la branche principale (`main`) par une **pull request**, que l'on relit et accepte sur GitHub.
- **Travailler à plusieurs** : sur la page du dépôt, Settings > Collaborators > **Add people**, avec le nom GitHub du collègue. Chacun peut ensuite relier son propre compte Claude au même dépôt.
- **La note à la DSI** rédigée dans la conversation précédente est un document Claude lié à l'ancien compte. Pour la récupérer, l'exporter (Word ou PDF) depuis ce compte, ou la faire réécrire par Claude à partir de la section A.10. **Dans tous les cas, elle est à corriger** (point A.9-6).
