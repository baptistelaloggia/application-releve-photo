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
│       ├── R+1.Local-TGBT/
│       │   ├── XXX_R+1.Local-TGBT_P001_2026-10-30_01.jpg
│       │   ├── XXX_R+1.Local-TGBT_P001_2027-03-15_01.jpg   (même repère, autre date)
│       │   └── XXX_R+1.Local-TGBT_P002_2026-10-30_01.jpg
│       ├── R+1.Bureau/
│       └── R+1.Hors-local/
│           └── XXX_R+1_P003_2026-10-30_01.jpg   (repère hors local)
├── 02_EXPORTS/       (rapports PDF, listes Excel)
└── _data/            (données de l'appli : un JSON par repère / photo / local)
```

Principe : une fois les noms triés par ordre alphabétique, les photos d'un même repère se suivent dans l'ordre chronologique. Tout reste lisible sans l'appli.

- **Sans numéro de local (décision du 18/11/2026, modifie la règle précédente `{Niveau}.{N°local}_{NomLocal}`)** :
  - **Noms :** le dossier d'un local est `{Niveau}.{NomLocal}`, et une photo `{Projet}_{Niveau}.{NomLocal}_{P001}_{date}_{rang}.jpg`.
  - **Nom du local :** il est nettoyé (accents, espaces et points remplacés) et coupé à 30 caractères.
    - **Numéro final conservé (24/11/2026) :** quand le nom est trop long, le numéro final est gardé (« Point-d'eau-zone-tisanerie-01 »).
    - **Bug corrigé :** avant, « … Open Space 01 » et « … 02 » donnaient le même dossier une fois coupés. La recherche d'un nom libre tournait alors sans fin, et la page se figeait à l'enregistrement de la détection.
    - **Garde-fous :** les recherches de nom libre sont bornées. Deux noms longs qui ne diffèrent qu'au-delà de 30 caractères sont numérotés à l'enregistrement.
  - **Hors local :** dossier `{Niveau}.Hors-local`, photo `{Projet}_{Niveau}_{P001}_….jpg`.
  - **Unicité :** deux locaux d'un même plan ne peuvent plus porter le même nom ; l'appli refuse et propose « … 02 ». Le numéro de repère (`P001`, unique dans le projet) garantit l'unicité des noms de photos.
  - **Projets existants :** un bandeau de l'écran Projet propose « Mettre à jour les noms ». Il fait deux choses :
    - les locaux de même nom sur un plan, distingués jusqu'ici par leur numéro, sont renommés « Open Space 01 », « 02 »… ;
    - toutes les photos sont renommées et rangées selon la nouvelle règle, et les dossiers vidés sont supprimés.
  - **Champ `numero` :** il reste dans les données (recherche, anciens projets), mais ne s'affiche ni ne se saisit plus.

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
- **Ordre dans l'Explorateur Windows** : les dossiers de niveau sous `01_PHOTOS/` portent un **numéro d'ordre à 2 chiffres** devant le code, attribué par l'appli dans l'ordre du bâtiment (du plus bas au plus haut), par exemple `00_SS2`, `01_SS1`, `02_ES`, `03_RDC`, `04_R+1`… `NN_TT`. **Seuls ces dossiers** portent ce numéro. Les noms des plans, des dossiers de locaux et des photos gardent le code seul (`XXX_R+1.Local-TGBT_P001_…jpg`).

Règles complémentaires (validées le 04/11/2026) :
- **Indices des plans** : l'indice courant est enregistré dans les données de l'appli (`_data/plans/{uuid}.json`). À chaque nouvel indice, le PDF remplacé est déplacé dans `00_PLANS/_ANCIENS/` sous le nom `{Projet}_{Niveau}_Ind-{Indice}.pdf`.
- **Ajout d'un niveau en cours de projet** : l'appli recalcule les numéros d'ordre et renomme automatiquement les dossiers de niveau.

Niveaux intermédiaires et ordre (demandés le 10/11/2026) :
- Un niveau peut avoir un **code libre** : lettres, chiffres, `+` et `-`, 16 caractères au plus. « R+4 mezzanine » donne le code `R+4-MEZZANINE` et le libellé « R+4 mezzanine ». Les caractères `_` et `.` sont interdits, car ils séparent les éléments des noms de dossiers et de photos.
- **L'ordre des niveaux est enregistré** (champ `ordre` du JSON de chaque niveau) et modifiable avec les boutons ↑ ↓. Un nouveau niveau est placé au-dessus du niveau standard qui commence son code (`R+4-MEZZANINE` au-dessus de `R+4`), sinon sous la toiture. Les dossiers `01_PHOTOS/NN_…` sont renumérotés à chaque changement.

Règles issues du lot 1 (04/11/2026) :
- **Un seul plan courant par niveau.** [À VÉRIFIER : grands bâtiments avec plusieurs feuilles (zones) par niveau.]
- **Carnets de plans** : un PDF contenant un niveau par page est découpé à l'import. Chaque page retenue devient le plan `{Projet}_{Niveau}.pdf` de son niveau, avec son contenu vectoriel. Le niveau de chaque page est reconnu d'après son titre (« PLAN DE NIVEAU - R+2 », « … - ENTRESOL », « … - TOIT »…), et l'utilisateur peut le corriger avant l'import. Le JSON du plan garde le nom du carnet d'origine et le numéro de page (`pageOrigine`).
- **Équivalences reconnues** : `R+0` → `RDC`, `ENTRESOL` → `ES`, `TOIT` / `TOITURE` → `TT`, `R1` ou `R01` → `R+1`, `R06M` → `R+6M` (niveau intermédiaire, placé au-dessus du R+6).
- **Titres reconnus** (16/11/2026, second carnet d'essai) : « PLAN DE NIVEAU - R+2 », et aussi le titre en bas de page « PLAN - R+2 MARCHE » et le cartouche « PLAN R02 ». Sur ce second carnet, les 10 niveaux ont été reconnus.

## A.6 ter Locaux (lot 2, 05/11/2026)

- Un local = un fichier `_data/locaux/{uuid}.json` : plan de rattachement (`planId`), numéro (facultatif), nom, surface (facultative), position de son étiquette (x, y relatifs 0 à 1), origine (`auto` : détecté puis validé ; `manuel` : placé à la main), auteur et date de création et de modification.
- **Détection** : l'appli lit le texte vectoriel de la page et regroupe les lignes empilées et centrées de même hauteur. Elle retient les groupes qui contiennent un numéro (lettres puis chiffres, comme `SF202`, `LT1104.B`, ou chiffres seuls s'il y a une surface) ou une surface (`33,7 m²`). Un nom seul est retenu s'il désigne un type de local (bureau, sanit., local, circ., stockage, CTA, TGBT…), s'il est en majuscules et s'il se trouve dans la zone dessinée. Les propositions sont toujours **vérifiées par l'utilisateur** avant enregistrement, et une nouvelle détection ne recrée pas les locaux déjà présents.
- Essai sur le carnet réel : 141 étiquettes complètes et 83 noms seuls sur 10 niveaux ; 47 locaux numérotés au SS1, dont le TGBT (LT1105). Quelques faux positifs restent à décocher (cartouche de la page toiture).
- **Règles complémentaires de détection** (16/11/2026, second carnet d'essai) :
  - numéros en plusieurs parties : `SDR-RDC-42`, `ACC-R01-23`, `SAN.A-R01-01`, `BR.B-R04-xx` ;
  - noms en minuscules et sur plusieurs lignes (« Salle de / réunion ») ;
  - l'altitude (« +35.95 m ») et le type d'ERP (« Type L,W ») font partie de l'étiquette, mais pas du nom ;
  - la ligne de surface termine toujours une étiquette, ce qui sépare deux étiquettes empilées ;
  - **pas de local en dessous de 4 m²** (gaines techniques, placards) ;
  - une étiquette nettement plus petite que les étiquettes avec surface est écartée (étiquettes de portes « RDC-P34 / 1UP / PF30 », annotations).
  - Résultat : sur le second carnet, la « Salle de réunion SDR-RDC-42 » et l'« ERP Espace Coupole » sont trouvées, sans gaines ni portes. Sur le premier carnet, seules des annotations ont disparu.
- **Cartouche, légende et style des étiquettes** (21/11/2026) :
  - **Cartouche :** il est repéré à son vocabulaire. Il faut au moins 4 mots groupés parmi « Phase », « Indice », « Échelle », « Dessiné par », « Vérifié par », « Maître d'ouvrage », « Architecte », « N° projet », « Titre du dessin », « Émetteur », « Bureau de contrôle »… La zone qui les entoure, prolongée jusqu'au bord de la page, ne reçoit aucun local.
  - **Légende :** sous le titre « LÉGENDE », le bloc des lignes qui le suivent ne reçoit aucun local.
  - **Style :** sur un plan, tous les noms de locaux ont la **même police, la même taille et la même casse**. La référence est celle des étiquettes sûres (avec numéro ou surface).
    - **Nom seul :** il doit suivre ce style en tout. Il peut donc être en minuscules si les noms sûrs le sont (« Open Space »). Sans référence, la majuscule reste exigée.
    - **Étiquette sûre :** elle n'est écartée que si elle diffère à la fois par la police et par la taille.
  - **Extérieur du bâtiment :** les cours et dessertes extérieures, écrites dans un autre style, sont écartées par la règle de style. Le contour réel du bâtiment n'est pas calculé (les cloisons sont des traits sans notion de pièce) : il est approché par la zone des étiquettes sûres, élargie de 10 % [À VÉRIFIER sur d'autres plans].
  - **Nombre en fin de nom :** un nombre court sous le nom, dans la même police, en fait partie (« Open Space » / « 2 » → « Open Space 2 »). Avant, il coupait l'étiquette en deux.
  - **Résultat sur les deux carnets d'essai :**
    - carnet 1 : 220 → 191 propositions. Plus de textes du cartouche ni de la légende, ni de cours extérieures ;
    - carnet 2 : 182 → 221 propositions. 39 « Open Space n » réels trouvés en plus, cartouche écarté.
- **Détection d'après un exemple** (23/11/2026) : sur certains plans, les noms de locaux sont en gras sans surface (« Open space flex office 01 »). Le mobilier y est désigné en maigre, avec une surface (« Bureau / 12,6 m² »). Le PDF ne dit pas lequel est en gras : les deux polices portent le même nom.
  - **L'encadré :** « ▭ D'après un exemple » (liste des locaux), ou « Propositions fausses ? Encadrer une étiquette de local » (pendant la détection). On trace un cadre au doigt autour du nom d'un local.
  - **Effet :** l'appli relève la police et la taille de ce texte. Elle ne propose alors que les étiquettes de même police et de même taille (à 15 % près), même sans numéro ni surface. Cartouche et légende restent exclus.
  - **Résultat sur le carnet d'essai concerné :** 31 locaux, tous les noms en gras, et plus aucune désignation de mobilier.
  - **Sur tous les plans** (24/11/2026) : dans « Détecter les locaux sur tous les plans », le bouton « ▭ D'après un exemple… » fait trois choses :
    - on choisit le plan exemple et on y encadre le nom d'un local ;
    - un aperçu donne le nombre d'étiquettes de ce style sur ce plan ;
    - « Appliquer à tous les plans » lance la détection guidée sur chaque plan. Le récapitulatif par niveau, puis l'enregistrement, sont inchangés.
  - **Mémoire de l'exemple :** il est mémorisé pour le projet, sur l'appareil, y compris quand il est tracé sur un seul plan. « Réutiliser l'exemple « … » » le relance sans nouvel encadré.
  - **Encadré :** la bascule « ✋ Déplacer / zoomer » ↔ « ▭ Encadrer » permet d'agrandir le plan avant de tracer.
  - **Reconnaissance d'un plan à l'autre :** l'appli lit le vrai nom des polices du PDF (« ABCDEF+ArialNarrow,Bold ») au lieu de l'identifiant interne de pdf.js, propre à chaque fichier. Les plans d'un même carnet, découpés à l'import, gardent le nom exact (vérifié sur un carnet d'essai).
  - **Repli :** pour un plan venu d'un autre fichier, où le préfixe diffère, la comparaison se fait sur la famille de police, la taille et la chasse. La chasse ne distingue pas toujours le gras du maigre (mesuré : 0,555 contre 0,563 pour une même famille). Sur un tel plan, il vaut mieux encadrer un exemple propre [À VÉRIFIER].
- **Supprimer et annuler** (23/11/2026) :
  - **Supprimer plusieurs locaux :** dans la liste des locaux, « ☑ Sélectionner » (cases à cocher, « Supprimer la sélection ») et « Tout supprimer ».
  - **Annuler :** « ↶ Annuler » défait la dernière action sur les locaux (détection enregistrée, suppression). Les locaux reviennent avec le même identifiant, les repères retrouvent leur local, et les photos reprennent leur rangement.
  - **Portée :** une seule action est annulable, pendant la session sur le plan.
- **Le nom seul** (décision du 17/11/2026, **modifie** la règle précédente qui gardait aussi le numéro et la surface lus sur le plan) :
  - **Lecture du plan :** le numéro et la surface servent encore à **reconnaître** une étiquette sur le plan, mais ne sont plus enregistrés. Seul le nom l'est.
  - **Doublons :** un nom porté par plusieurs locaux d'un même plan reçoit un numéro d'ordre : « LT 01 », « LT 02 »… Ils sont numérotés de haut en bas, puis de gauche à droite, en sautant les numéros déjà pris sur le plan. Un local déjà enregistré n'est jamais renommé.
  - **Nouvelle détection :** elle reconnaît « LT 02 » comme « LT » à la même place et ne le recrée pas.
  - **Surface :** elle n'est plus saisie dans la fiche du local. Une valeur déjà enregistrée est conservée dans `_data/`.
  - **Étiquettes sur le plan :** elles affichent le nom par défaut.
  - **Numéro dans les noms de fichiers :** retiré le 18/11/2026, à la demande de l'utilisateur (voir §A.6). Le numéro n'est plus attribué automatiquement à la première photo. La fiche du local ne montre plus le numéro ; elle n'a plus non plus de bouton Enregistrer ni Fermer : le nom s'enregistre en quittant le champ, et le bouton Retour du téléphone ferme la fiche (sur PC : Échap ou la croix).
- **Numéro unique** dans le projet ; nom obligatoire.
- **Numéro automatique** (10/11/2026) : à la création d'un local, l'appli propose le premier numéro libre du niveau, sous la forme `{niveau sans +}-{rang}` (`R2-01`, `RDC-03`, `SS1-12`, `R4-MEZ-01`), modifiable ou effaçable. Un local sans numéro peut en recevoir un d'un clic.
- **Étiquettes sur le plan** : placées au-dessus de l'étiquette du local dessinée sur le plan, pour la laisser lisible. Elles affichent au choix le numéro ou le nom (choix mémorisé sur l'appareil).
- **Détection sur tous les plans** : un récapitulatif par niveau (locaux sûrs, noms seuls à vérifier, déjà présents) est présenté avant l'enregistrement.
- **Recherche** : par nom, numéro et code de niveau, sans tenir compte des accents ni de la casse (« tgbt », « 012 », « cta ss1 »). Le numéro exact passe en premier.
- **Niveau lu dans le titre de la page** (23/11/2026) : jusqu'à trois mots sont admis entre « Plan » et le niveau, par exemple « Plan projet R+6 » ou « Plan état existant SS1 ».
- **Affichage des plans** : image de fond de la page entière, puis tuiles de 512 px calculées à la demande pour le zoom courant (jusqu'à 8 pixels par point PDF). Le zoom se fait à la molette, au pincement ou au double appui.
  - **Pincement sur les étiquettes** (21/11/2026) : il fonctionne même quand les doigts se posent sur des étiquettes, ce qui arrive sur un plan chargé. Avant, un doigt sur une étiquette était ignoré.
  - **Étiquette sous un doigt :** un doigt seul sur une étiquette reste un appui sur l'étiquette. Dès qu'un second doigt arrive, c'est un pincement, et l'appui sur l'étiquette est annulé.
- **Tableau des niveaux** (21/11/2026) : chaque ligne entière est un bouton qui ouvre le plan du niveau (survol, clavier). Le texte n'est plus un lien souligné, et le bouton « Ouvrir » est remplacé par un chevron ›.
- **Locaux sans numéro** : tranché le 18/11/2026. Plus aucun numéro de local dans les noms : voir §A.6.

## A.6 quater Repères et photos (lot 3, 10/11/2026)

- **Repère** : `_data/reperes/{uuid}.json` (plan, local de rattachement ou aucun, numéro `P001`… unique dans le projet, libellé facultatif, position relative). À sa création, il est rattaché au **local le plus proche**, **sans limite de distance** depuis le 18/11/2026 (avant : à moins de 6 % de la page).
  - **Fenêtre de rattachement :** « 📍 Repère P004 → Circulation B1 », ouverte à la fin des prises de vue (depuis le 19/11/2026 ; avant, dans la visée). Elle propose les autres locaux proches, « Hors local » et « Choisir sur le plan », puis OK.
  - **Sur le plan :** le local du repère sélectionné (ou en cours de prise de vue) est **entouré en rouge**.
  - **Fiche du repère :** son titre donne le nom du local après celui du repère (« Repère P004 · Circulation B1 »).
  - **Correction :** le local se corrige aussi dans la fiche du repère.
- **Photo** : `_data/photos/{uuid}.json` (repère ou panier, chemin du JPEG, miniature, date du jour, heure, auteur, rang, dimensions, taille, empreinte SHA-256, commentaire, source : appli, appareil du téléphone ou import). Miniature de 320 px dans `_data/miniatures/{uuid}.jpg`.
- **Rangement** (18/11/2026) : `01_PHOTOS/{NN}_{Niveau}/{Niveau}.{NomLocal}/{Projet}_{Niveau}.{NomLocal}_{P001}_{AAAA-MM-JJ}_{rang}.jpg`. Hors local : dossier `{Niveau}.Hors-local`, photo `{Projet}_{Niveau}_{P001}_….jpg`. Quand un local, un repère ou un niveau change, les photos concernées sont renommées et déplacées automatiquement ; un dossier de local vidé est supprimé.
- **Panier à classer** : `01_PHOTOS/_A-CLASSER/{Projet}_A-CLASSER_{date}_{heure}_{id}.jpg`. On coche une ou plusieurs photos (MAJ + clic coche toutes les photos entre deux), puis on les place d'un coup : sur l'étiquette d'un local, sur un repère existant, ou sur le plan, ce qui crée un repère. Après chaque placement, l'appli revient sur l'onglet Panier pour enchaîner.
- **Photos sur l'étiquette du local** (10/11/2026) : chaque local peut avoir un **repère d'étiquette** (`surEtiquette: true`), placé sur son étiquette et créé à la première photo. Il n'est pas dessiné comme un repère : le nombre de photos s'affiche sur l'étiquette du local. Accès : appui long sur l'étiquette (photo directe), bouton « Photo du local » dans la fiche, ou placement depuis le panier. Il suit l'étiquette si on la déplace ; si le local est supprimé, il redevient un repère ordinaire, hors local.
- **Bouton Retour du téléphone** (18/11/2026) : il ne fait plus quitter l'appli. Il ferme ce qui est ouvert, du plus récent au plus ancien, jusqu'à l'accueil :
  - l'éditeur d'annotations (confirmation s'il y a des modifications) ;
  - l'appareil photo (après la fin des prises en cours) ou la visionneuse ;
  - le mode en cours (ajout, déplacement, classement…) ;
  - la fiche du repère ou du local ;
  - le plan (retour au projet), puis le projet (retour à l'accueil).

  Sur PC, la touche Échap fait de même. Techniquement, chaque calque ajoute une entrée à l'historique du navigateur (`src/ui/retour.ts`).
- **Étiquettes** : toujours le nom du local ; le choix « Numéro / Nom » est retiré (18/11/2026).
- **Bascule photo / consultation** (19/11/2026) : le menu déroulant « Affichage » est remplacé par un bouton unique, 📷 (mode photo) ou 👁 (mode consultation) ; un appui passe de l'un à l'autre.
- **Fiche du local** (19/11/2026) : plus de bouton « Photo du local ». On photographie le local depuis son étiquette : appui en mode 📷, appui long en mode 👁.
- **Rattachement d'un nouveau repère** (19/11/2026) : la fenêtre de choix du local s'ouvre **une fois les prises de vue terminées**, à la fermeture de la visée, et non plus dans la visée.
  - **Position :** elle s'affiche en bas de l'écran, le plan restant visible avec le local associé entouré en rouge.
  - **Choix :** autres locaux proches, « Hors local », « Choisir sur le plan », OK. Le bouton Retour vaut OK.
- **Appui sur un repère ou sur l'étiquette d'un local** (bascule 📷 / 👁) : « Photo » (par défaut) ouvre l'appareil photo, et l'appui long ouvre la fiche ; « Fiche » fait l'inverse.
- **Double appui** sur un repère ou sur l'étiquette d'un local (16/11/2026) : ouvre ses photos, la plus récente en premier. Le simple appui n'est traité qu'après 0,28 s, le temps de distinguer un double appui. Le tableau des niveaux indique aussi le nombre de photos de chaque plan.
- **Rattachement rapide d'un repère à un local** : la fiche du repère propose les 3 locaux les plus proches en un appui, ou « Choisir le local sur le plan », puis un appui sur l'étiquette du local. Les photos sont alors renommées et déplacées.
- **Un local est un point, pas une surface** : sa position est celle de son étiquette. La surface en m² lue sur le plan n'est qu'une valeur, sans contour. Le rattachement automatique d'un repère se fait donc au local dont l'étiquette est la plus proche, et non au local qui le contient. [À DÉCIDER : tracé du contour des locaux, voir A.9-7]
- **Terrain, 2 appuis par photo** : appui sur un repère, la visée de l'appli s'ouvre ; appui sur le déclencheur, la photo est prise, et l'on reste en visée pour la rafale. Appui long (0,5 s) sur le plan : nouveau repère, puis visée. Chaque appui sur le déclencheur est mis en file : aucun n'est perdu, même en rafale rapide. L'appareil photo du téléphone reste accessible depuis la visée, avec une validation de plus.
- **Compression** : grand côté ramené à 3 264 px, JPEG de qualité 0,82, réduite jusqu'à 0,58 si nécessaire pour rester sous 1,5 Mo. La photo est redressée selon son orientation EXIF, et le segment **EXIF d'origine est recopié** (orientation remise à « normale »). Une photo déjà petite est gardée telle quelle. La date de prise de vue des photos importées est reprise de l'EXIF.
- **Visite** : les photos sont regroupées par jour (date de la photo), sans fichier « visite » distinct pour l'instant. Les locaux photographiés dans la journée sont en vert sur le plan.
- **Commentaire** : champ texte sur chaque photo. La dictée vocale passe par le micro du clavier du téléphone (fonction du clavier Android).
- **Validation** (test automatique, fausse caméra de Chromium) : 300 photos en mode avion sur un même repère, prises en 21 s, toutes enregistrées en 56 s, sans perte. [À VÉRIFIER sur un vrai téléphone : vraies photos de 12 Mpx, compression de 1 à 2 s chacune en arrière-plan, place disponible dans le stockage du navigateur.]
- **Temps d'ouverture** (corrigé le 13/11/2026, après un premier essai réel à plus d'une minute) : les fichiers de `_data/` sont désormais lus dossier par dossier. Chaque dossier n'est ouvert qu'une fois, et 16 fichiers sont lus en parallèle, alors qu'auparavant chaque fichier était lu seul, en repartant de la racine du projet. Le compte rendu du projet affiche la durée de lecture et le nombre de fichiers. Mesure sur le serveur réel le 13/11/2026 : encore **22,6 s pour 52 fichiers**, ce qui est anormal au regard d'une lecture unitaire d'environ 50 ms. Hypothèse [À VÉRIFIER] : le **listage des dossiers** est lent sur le lecteur réseau. Mesures en cours : les 6 lectures sont désormais lancées en même temps, le compte rendu donne la durée par dossier, et le test du serveur mesure séparément le listage d'un dossier, la lecture fichier par fichier et la lecture groupée. Si le listage est en cause, prévoir un fichier d'index regroupé, qui évite de lister les dossiers à chaque ouverture.
- **Mesure détaillée du 13/11/2026** : 22,5 s, dont 10,2 s pour le seul `projet.json`. Le projet était ouvert **sur le téléphone, dans un dossier choisi dans Téléchargements**. Sur Android, un tel dossier passe par le gestionnaire de documents du système, et chaque accès y prend plusieurs secondes [À VÉRIFIER : cause exacte côté Android]. **Correction** : sur téléphone, l'appli utilise toujours son **stockage interne** (OPFS), conformément à A.7 et à A.4-4 ; le choix d'un dossier est réservé au PC. Résultat sur téléphone après correction : 244 fichiers lus en 0,4 s.
- **PC, appli installée depuis github.io (13/11/2026)** : création, ouverture de projet et test d'écriture « ne font rien » après le choix d'un dossier du réseau. Le premier test réussi du 05/11/2026 avait été fait avec la version en fichier unique (`file://`), et non depuis l'adresse Internet. Pistes [À VÉRIFIER] : fenêtre d'autorisation « Modifier les fichiers » restée cachée ; règle d'entreprise qui interdit l'écriture dans les dossiers aux sites Internet (stratégies Edge/Chrome du type « FileSystemWrite… », à consulter dans `edge://policy`). **Résultat (13/11/2026)** : tout fonctionne dans **Edge** (onglet). Dans **Chrome** et dans l'appli installée depuis Chrome, c'est le choix du dossier lui-même qui ne rend jamais la main : aucun message, même après 90 s. Cause exacte non déterminée [À VÉRIFIER : fenêtre d'autorisation invisible, ou règle propre à Chrome dans `chrome://policy`]. **Décision : sur PC, utiliser Edge**, y compris pour installer l'appli. Test du serveur dans Edge : lectures rapides (50 fichiers en 0,12 s lus d'un coup), écritures lentes (environ 0,2 s par fichier, 10,8 s pour 50) ; les écritures groupées (détection des locaux) sont donc faites 8 à la fois. Ajouts pour le diagnostic : message au bout de 20 s si le choix du dossier ne rend pas la main, consigne affichée avant le choix du dossier, état « en cours », délai maximal de 90 s avec un message explicite, erreur ramenée à l'écran avec son nom technique, version précise en bas de page (date de construction et commit).
- **Réparation** : un fichier de données illisible (par exemple vide après une écriture interrompue) est signalé à l'ouverture, avec un bouton « Réparer ». La réparation met le fichier de côté dans `_data/illisibles/` (rien n'est effacé), puis retrouve les photos de `01_PHOTOS` inconnues de l'appli : leur nom donne le repère, la date et le rang ; à défaut, elles vont au panier. [À VÉRIFIER : cause du premier fichier illisible constaté le 13/11/2026, probablement une fermeture de l'appli ou une coupure réseau pendant un enregistrement.]

## A.6 quinquies Synchronisation par paquet .zip (lot 4, 13/11/2026)

- **Deux sens** :
  - **PC → téléphone**, avant la visite : « Préparer le paquet pour le téléphone ». Le paquet contient les plans courants, les niveaux, les locaux et les repères, sans photos.
  - **Téléphone → PC**, après la visite : « Exporter la visite pour le serveur ». Le paquet contient toutes les données, plus les photos **pas encore exportées**, que le téléphone mémorise. La case « inclure aussi les photos déjà exportées » permet de refaire un paquet perdu.
- **Contenu du paquet**, dans cet ordre : `manifeste.json` (projet, sens, auteur, date), `donnees.json`, `plans/{id}.pdf`, puis pour chaque photo `miniatures/{id}.jpg` et `photos/{id}.jpg`. Le nom du fichier est de la forme `{dossier projet}_pour-telephone_…zip` ou `…_retour-terrain_{date}_{heure}.zip`. Le paquet est écrit au fil de l'eau dans le stockage interne du navigateur, puis partagé (OneDrive, e-mail : partage Android) ou téléchargé (câble USB). L'import le lit aussi au fil de l'eau : 300 photos ne passent jamais en mémoire.
- **Import** : un aperçu chiffré (niveaux, plans, locaux, repères, photos nouvelles ou reclassées, alertes) s'affiche avant la validation. Les photos sont rangées sous leur nom normalisé, **recalculé sur l'appareil qui importe**, 4 à la fois. Un projet inconnu de l'appareil est créé à partir du paquet, avec le même identifiant de projet : sur le téléphone dans le stockage interne, sur le PC dans le dossier du serveur choisi.
- **Règles de fusion** (`src/domaine/fusion.ts`) :
  - niveaux et plans : ceux de l'appareil qui importe sont conservés. Un niveau de même code, ou le plan d'un niveau existant, est reconnu comme le même. Un plan d'indice différent est signalé, et l'indice local est gardé ;
  - locaux et repères : **la modification la plus récente l'emporte**. Un local inconnu de même numéro, au même endroit, est reconnu comme le même. Un numéro déjà pris par un autre local ou repère est renuméroté, et c'est signalé ;
  - photos : **jamais écrasées ni supprimées**. Une photo identique (même empreinte SHA-256) n'est pas importée deux fois. Le classement et le commentaire les plus récents sont repris.
- **Incident du 16/11/2026 sur le PC** : à la préparation du paquet, le stockage interne d'Edge a refusé l'écriture (`NoModificationAllowedError`). Cause non reproduite [À VÉRIFIER : réglage d'Edge, protection de Windows ou règle de l'entreprise]. Corrections : un fichier temporaire différent pour chaque export ; si ce stockage refuse, à quelque moment que ce soit, le paquet est reconstruit **en mémoire** (sans risque pour un paquet sans photos), et le compte rendu le signale ; le bouton est bloqué dès le premier clic.
- **Essai réel du 16/11/2026, réussi** : PC → téléphone, visite en mode avion, retour → PC, rangement. Le repli en mémoire a fonctionné sur le PC (paquet de 16,2 Mo pour le carnet de 10 plans), et l'ouverture du projet sur le serveur a pris 0,5 s pour 229 fichiers. Le **partage** du paquet (bouton « Partager ») a été refusé sur PC et sur Android : les navigateurs ne partagent pas les fichiers .zip [À VÉRIFIER : liste exacte des types autorisés]. Le bouton est retiré ; on télécharge le paquet, puis on le transmet par câble USB ou par l'application OneDrive.
- **Numéros de local** : jusqu'à 20 caractères (au lieu de 12), pour les numéros en plusieurs parties comme `CRC.A1-R02-01`.
- **Limites connues** [À TRAITER au lot 5] : les **suppressions ne sont pas transmises**. Un local supprimé sur le PC revient au prochain retour du téléphone s'il y existe encore. Les photos exportées restent sur le téléphone : la libération de place est à prévoir.
- **Validation** (test automatique `synchro-lot4.mjs`, deux appareils simulés) : PC → téléphone, visite de 300 photos sur le téléphone, retour → PC, rangement conforme, second import sans effet. [À VÉRIFIER sur appareils réels : durée de l'export et du transfert d'environ 350 Mo pour 300 photos de 1,2 Mo.]

## A.6 sexies Transit SharePoint (lot 5, 16/11/2026)

- **Principe** : SharePoint ne fait que **transporter les paquets .zip du lot 4**. Le serveur partagé reste la seule référence (A.4-2 et A.4-3). Une bibliothèque unique, avec un dossier par projet, `{dossier du projet}__{8 premiers caractères de l'identifiant}/` :
  - `copie-de-travail/travail.zip` et `version.json` : publiés par le PC (option A, A.4-9), récupérés par les téléphones, supprimés à la clôture ;
  - `depots/{paquet de retour}.zip` : déposés par les téléphones, **supprimés par le PC une fois tout rangé** sur le serveur.
- **PC** (carte « Transit SharePoint » de l'écran projet) : « Publier la copie de travail » ; « Collecter et ranger les visites », qui télécharge chaque dépôt, l'importe (fusion du lot 4), puis le supprime du transit ; « Clôture : supprimer du transit ».
- **Téléphone** : à l'accueil, « Projets disponibles sur le transit », qui crée le projet sur l'appareil ; dans le projet, « Mettre à jour la copie de travail », qui signale une nouvelle version, et « Envoyer la visite ». Les photos ne sont comptées comme transmises qu'une fois le dépôt terminé.
- **Connexion** : MSAL.js (version 5), application monopage, code d'autorisation + PKCE, sans secret. Permission Graph déléguée `Sites.Selected`. Fenêtre de connexion Microsoft à la première utilisation, puis renouvellement silencieux. Page de retour `msal-retour.html`. La bibliothèque MSAL n'est chargée qu'à la première utilisation.
- **Envoi** : un fichier de moins de 4 Mo part en un seul envoi ; au-delà, il passe par une session d'envoi, en morceaux de 9,4 Mo (un multiple de 320 Kio, comme l'exige Graph). Les appels sont retentés automatiquement sur les erreurs 429, 503 et 504, et en cas de coupure réseau passagère.
- **Réglages** (écran « Réglages SharePoint » de l'accueil) : identifiant du locataire, identifiant de l'application, adresse du site, nom de la bibliothèque. Ils sont saisis ou importés depuis un fichier `.json` fourni par la DSI, et **gardés sur l'appareil, jamais dans le dépôt** (qui est public).
- **Validation** (test automatique `transit-lot5.mjs`, contre une imitation de Microsoft Graph) : publication, récupération par le téléphone, visite, dépôt de 12 Mo en 2 morceaux, collecte, rangement et purge du dépôt, mise à jour de la copie après une modification sur le PC, clôture. **La connexion Microsoft réelle n'est pas testée** : elle attend la DSI (demandes 1 à 3 de `docs/NOTE_DSI.md`). [À VÉRIFIER alors : fenêtre de connexion dans l'appli installée sur Android ; prise en charge de `Sites.Selected` en délégué.]

## A.6 septies Sécurité du dépôt public et de l'appli publiée (16/11/2026)

- **Ce qui est public** : le code, les tests, la documentation, la note à la DSI (rédigée sans nom d'entreprise ni de projet), l'historique, et l'adresse e-mail de l'auteur des fusions. **Ce qui ne l'est jamais** : plans, photos, données de projet, réglages SharePoint (ils restent sur les appareils), mots de passe et jetons. Le code de l'appli ne contient aucun secret : une appli monopage n'en a pas (PKCE), et l'identifiant d'application Entra ID n'est pas un secret.
- **Risque principal** : la **chaîne de publication**. L'appli exécutée par les postes est celle que publie GitHub Pages à chaque fusion dans `main`. Une prise de contrôle du compte GitHub permettrait de publier une version piégée. Celle-ci aurait les accès que l'utilisateur a donnés à l'appli : dossiers du serveur autorisés dans Edge, et bibliothèque de transit par `Sites.Selected`. Ce risque est **le même avec un dépôt privé**. Mesures : double authentification du compte GitHub ; protection de la branche `main` (fusion par pull request seulement) ; pas d'autre collaborateur sans besoin ; à terme, hébergement interne ou Azure, la publication étant faite par la DSI (A.6, demande 4 de la note).
- **Données reçues** : un PDF ou un paquet `.zip` piégé est la seconde voie d'attaque. pdf.js (version 6.5) lit les PDF dans un worker isolé et n'exécute plus de code tiré d'un PDF (la faille de 2024 venait de là). Depuis le 16/11/2026, **toutes les données d'un paquet reçu sont contrôlées avant écriture** (identifiants, codes de niveau, numéros, dates, positions, empreintes) : un paquet non conforme est refusé en entier. Les chemins des fichiers sont de toute façon recalculés par l'appareil qui importe, et tout chemin contenant `..` est refusé (`decouperChemin`).
- **Revenir à un dépôt privé** est possible à tout moment (Settings › General › Danger Zone › Change visibility). Mais GitHub Pages ne publie un dépôt privé qu'avec une offre payante (GitHub Pro, pour un compte personnel) [À VÉRIFIER : tarif]. Sans cela, l'adresse de l'appli cesse de fonctionner. Les applis déjà installées continuent de fonctionner hors ligne, mais ne se mettent plus à jour, et la connexion SharePoint échoue, car son adresse de retour est sur github.io. Conditions pour repasser en privé : l'hébergement de l'appli est déplacé (serveur interne, ou Azure Static Web Apps, qui publie aussi depuis un dépôt privé), **l'URI de redirection est mise à jour par la DSI**, et les utilisateurs réinstallent l'appli depuis la nouvelle adresse. Ou bien : prendre GitHub Pro et ne rien changer d'autre.

## A.6 octies Vidéos, annotations dessinées et notes vocales (17/11/2026)

- **Vidéos.** Une vidéo est une prise de vue comme une photo : même repère, même date, même rang, même nommage, avec une autre extension. Exemple : `XXX_R+1.Local-TGBT_P001_2026-11-17_04.mp4`. Dans `_data/photos/{id}.json`, elle porte `type: "video"`, `extension` (`mp4` ou `webm`) et `duree` en secondes.
  - **Prise de vue :** bouton **Photo / Vidéo** dans la visée. En mode vidéo, la définition passe en 720p avec le son, à environ 2,5 Mbit/s, soit environ 20 Mo par minute [À VÉRIFIER sur téléphone].
  - **Durée :** 3 minutes au plus par vidéo.
  - **Format :** l'appli enregistre en MP4 quand le navigateur le sait, sinon en WebM.
  - **Fichiers importés :** les vidéos importées, ou filmées par l'appareil du téléphone, sont gardées telles quelles, sans recompression ; elles peuvent donc être lourdes.
  - **Miniature :** elle est tirée de la vidéo.
  - **Limite :** les vidéos ne s'annotent pas.
- **Annotations dessinées** sur une photo. Elles servent au suivi de chantier et à l'audit, pour repérer les bons et les mauvais travaux.
  - **Outils :** V vert (conforme), X rouge (non conforme), bulle (texte encadré), cercle (on glisse pour entourer), trait à main levée ; Annuler, Tout effacer.
  - **Changements du 17/11/2026 :**
    - l'outil « texte libre » est supprimé, car il faisait double emploi avec la bulle ;
    - la bulle n'a plus de pointe ;
    - **appui long sur une annotation, puis glisser : elle se déplace** (V, X, bulle, cercle, trait).
    - Les textes libres et les pointes des photos annotées avant ce changement restent lisibles (type `texte`, champs `px`, `py`).
  - **Stockage :** les annotations sont enregistrées en **vecteurs** (`annotations` dans le JSON de la photo), en coordonnées relatives 0 à 1, comme les repères.
  - **Original intact :** la photo d'origine n'est jamais modifiée et garde son EXIF.
  - **Copie annotée :** une **copie annotée** JPEG est rangée à côté, `…_01_annote.jpg`, pour rester lisible sans l'appli.
  - **Dans l'appli :** les annotations s'affichent par-dessus la photo, avec un bouton « Voir l'original ».
- **Note vocale** : un enregistrement du micro attaché à une photo ou à une vidéo, rangé à côté d'elle : `…_01_note.wav`.
  - **Format WAV (17/11/2026) :** la note est convertie sur le téléphone en WAV, PCM 16 bits, mono, 16 kHz, environ 1,9 Mo par minute.
  - **Pourquoi :** une note enregistrée sur téléphone n'était pas lue sur le PC après transfert. Le format d'origine (Opus dans un `.m4a` ou un `.webm`) n'est pas lu par tous les lecteurs Windows [À VÉRIFIER : cause exacte]. Le WAV est lu partout.
  - **Repli :** si la conversion échoue, le format d'origine est gardé.
  - **Fichier absent :** si le fichier d'une note manque sur le PC, la visionneuse le dit et indique de renvoyer la visite.
  - **Données :** `noteVocale` dans le JSON (extension, durée, date, auteur).
  - **Durée :** 2 minutes au plus.
  - **Réenregistrement :** une nouvelle note remplace la précédente.
  - **Dictée :** la dictée par le clavier (texte) reste disponible dans le commentaire.
- **Accès :**
  - **dans la visée**, après chaque prise de vue, deux raccourcis sur la dernière : « ✏️ Annoter » et « 🎤 Note vocale ». Ils sont facultatifs, ce qui préserve la règle des 2 appuis par photo ;
  - **dans la visionneuse**, les boutons « Annoter », « Note vocale » et le lecteur de la note.
- **Rangement :** les fichiers rangés à côté de la photo **suivent la photo** (reclassement, renumérotation d'un local, suppression). Triés par nom, ils viennent juste après elle (`_01.jpg`, `_01_annote.jpg`, `_01_note.wav`, `_02.jpg`). La réparation ne les prend pas pour des photos perdues.
- **Synchronisation :** les paquets `.zip` portent `annotees/{id}.jpg` et `notes/{id}.{ext}` avant le fichier de la prise de vue (`photos/{id}.jpg|mp4|webm`).
  - **Fusion :** les annotations et la note les plus récentes l'emportent (`modifieLe`).
  - **Renvoi :** une photo annotée ou dotée d'une note après son envoi repart au prochain envoi avec ses fichiers annexes.
  - **Contrôle :** les données reçues sont contrôlées : types, positions dans l'image, longueur des textes, extensions.
- **Disposition sur téléphone (17/11/2026) :** dans la fiche d'un local, et dans celle d'un repère, les photos viennent juste sous le titre (le nom). Elles se voient donc sans faire défiler ; les champs de modification sont en dessous.
- **Visionneuse :**
  - **Navigation :** le passage d'une photo à l'autre se fait par des **flèches sur les côtés gauche et droit de la photo**, par un balayage du doigt, ou par les touches ← → (Échap ferme).
  - **Position :** elle est affichée en haut (« 3/4 »).
  - **Suppression par glisser-déposer** (21/11/2026) : un appui long sur la photo la saisit, et elle suit le doigt. Une corbeille 🗑 apparaît en bas de l'écran ; relâchée dessus (la corbeille passe au rouge), la photo est supprimée après confirmation. La visionneuse reste ouverte sur la photo suivante.
- **RGPD :** les notes vocales et le son des vidéos enregistrent aussi les voix alentour. À utiliser pour décrire l'installation, sans enregistrer de conversation.

## A.6 nonies Regroupement des photos du panier (19/11/2026)

**Besoin :** des photos prises **hors de l'appli** (appareil photo du téléphone, photos d'un collègue), donc sans repère, arrivent par l'import dans le panier à classer. Les rattacher une à une est long. L'appli les **regroupe par lieu probable** ; l'utilisateur vérifie chaque groupe et le rattache d'un coup à un local.

- **Accès :** onglet Panier du plan, bascule **« Liste / Par groupes »** (dès 2 photos dans le panier).
- **Usage prévu (précisé par l'utilisateur le 19/11/2026) :** l'ajout de photos à trier se fait **uniquement sur PC**, à partir des **fichiers photo d'origine**. Le téléphone ne sert qu'aux prises de vue avec repère, dans l'appli. Conséquences : l'EXIF (date, GPS) est en principe toujours présent ; le téléchargement de la reconnaissance (26 Mo) ne concerne que le PC.
- **Indices utilisés :**
  - **l'heure de prise de vue** (EXIF) : des photos prises à quelques secondes d'intervalle sont presque toujours dans le même local. Elle n'est retenue que si elle est sûre : photo de l'appli, ou date présente dans l'EXIF. Une photo importée **sans date EXIF** (transférée par messagerie, par exemple) ne porte que la date de son fichier, celle du transfert : son heure est alors **ignorée** ;
  - **la ressemblance visuelle**, mesurée **sur l'appareil** par un petit réseau de neurones (voir ci-dessous) ;
  - **la position GPS** (EXIF), **seulement comme indice contraire** : deux photos à plus de 80 m l'une de l'autre (précision annoncée comprise) ne sont pas dans le même local. Elle ne rapproche jamais deux photos, car en sous-sol le téléphone garde souvent la dernière position captée dehors.
    - **Portée limitée (19/11/2026) :** un bâtiment dépasse rarement 80 m. Le GPS ne départage donc pas deux locaux d'un même bâtiment ; il sépare surtout les bâtiments d'un même site, ou un relevé extérieur éloigné. À l'extérieur, le GPS d'un téléphone est précis à quelques mètres ; à l'intérieur, à quelques dizaines de mètres, voire faux [À VÉRIFIER sur de vraies photos : présence et valeur de la précision enregistrée dans l'EXIF]. Un seuil plus bas (par exemple pour distinguer deux façades) n'est à envisager qu'après ces essais.
- **Calcul (règles pures, `src/domaine/regroupement.ts`, testées) :** affinité de deux photos = similarité visuelle (cosinus, de 0 à 1) + bonus de temps (0,35 × e^(−écart / 2 min)) + bonus de rafale (0,25 × e^(−écart / 15 s)) ; 1 de moins si les GPS sont incompatibles. Sans reconnaissance visuelle : e^(−écart / 225 s), soit 0,45 à 3 min d'écart. Puis **classification ascendante hiérarchique à lien moyen** : on réunit les deux groupes dont l'affinité moyenne est la plus forte, tant qu'elle dépasse le **seuil** (0,45 par défaut).
- **Réglage « Groupes plus larges ↔ plus fins » :** curseur de 0,25 à 0,70, mémorisé sur l'appareil.
- **Validation d'un groupe :** toutes ses photos sont cochées ; on **décoche les intruses**, qui restent au panier. Puis :
  - **« Vers un local… »** : recherche du local par son nom, **dans tous les niveaux** ; les photos vont sur le repère d'étiquette du local (A.6 quater), puis sont renommées et rangées ;
  - **« Placer sur le plan »** : même placement que depuis la liste (étiquette d'un local, repère existant, ou nouveau repère).
- **Reconnaissance visuelle sur l'appareil (`src/photo/reconnaissance.ts`) :**
  - **Modèle :** MobileNet V3 « large », version « image embedder » de **MediaPipe** (Google), qui transforme une image en un vecteur de 1 280 nombres. Il est calculé sur la miniature (320 px), puisque le modèle travaille en 224 px.
  - **Aucun service extérieur** (A.4-7) : le moteur (WebAssembly, 15 Mo, recopié depuis le paquet npm `@mediapipe/tasks-vision` à la construction) et le modèle (11 Mo, `public/reconnaissance/`) sont **publiés avec l'appli**. Aucune photo ne quitte l'appareil.
  - **Téléchargement à la première utilisation** du regroupement seulement, puis gardés par le Service Worker pour l'usage hors ligne. Ils ne sont pas dans le cache initial de l'appli, pour ne pas alourdir l'installation sur téléphone.
  - **Repli :** sans réseau à la première utilisation, ou si le chargement échoue, le regroupement se fait sur l'heure et le GPS seuls, avec un message.
  - **Licence :** Apache 2.0 pour la bibliothèque ; le modèle est publié par Google pour MediaPipe [À VÉRIFIER : licence exacte du modèle, annoncée Apache 2.0 sur sa fiche].
  - **Écarté :** des mesures « simples » (histogrammes de couleurs, orientation des contours), essayées d'abord : elles ne distinguaient pas un local de comptage d'un local hydraulique (deux ambiances grises sous néons).
- **Essais (19/11/2026) :**
  - **5 vraies photos** (2 au local de comptage tarif jaune, 3 au local de distribution hydraulique), **sans heure EXIF**, donc le cas le plus défavorable, où seule la reconnaissance visuelle joue. Au réglage par défaut : 3 groupes, avec le comptage complet, deux vues hydrauliques ensemble, et la vue des échangeurs à part. Un cran plus large (0,30 à 0,35) : **exactement les 2 bons groupes**. Ces photos restent hors du dépôt.
  - **Test automatique** `tests/e2e/regroupement-panier.mjs` : 7 photos fictives datées et géolocalisées, dont une sans EXIF, en 2 groupes justes en 1 s ; rattachement par la recherche ; photo décochée restée au panier ; moteur et modèle gardés hors ligne.
  - [À VÉRIFIER sur téléphone : temps de calcul (environ 0,1 s par photo sur PC), et regroupement d'une vraie visite de 100 à 300 photos.]
- **Exemples de photos par type de local (question du 19/11/2026) :** ils n'aideraient pas le **regroupement**, qui compare les photos d'une même visite entre elles. Le modèle n'est pas réentraîné : c'est disproportionné pour le besoin, et ce serait un risque de confidentialité. Des exemples serviraient en revanche à **proposer un local** pour un groupe :
  - **source la plus utile :** les photos **déjà classées du projet**, puisque c'est le même bâtiment et les mêmes équipements. Elles sont déjà disponibles, sans rien fournir ;
  - **bibliothèque de référence par type** (chaufferie, TGBT, comptage, sous-station…) : elle permettrait de suggérer un type, puis les locaux dont le nom le contient. Elle serait gardée sur le PC de l'utilisateur, **jamais dans le dépôt public**, qui ne doit contenir aucune photo réelle. Seuls les vecteurs seraient conservés [À DÉCIDER après les premiers essais réels].
- **Suites possibles :**
  - **proposer le local** d'un groupe en le comparant aux photos déjà classées du projet (« ressemble au local CTA du R+1 ») ;
  - **retrouver le niveau par l'altitude GPS** [À VÉRIFIER : peu fiable en intérieur] ;
  - **séparer ou fusionner un groupe à la main**, si l'usage le demande.

## A.6 decies Tags des photos et transcription des notes vocales (20/11/2026)

- **Tags** : chaque prise de vue (photo ou vidéo) peut porter des tags (`tags` dans son JSON : « CTA », « Non conforme », « Avant fermeture »…).
  - **Catalogue :** celui fourni par l'utilisateur, par lot technique, dans `src/domaine/tags.ts` :
    - commun : statut (Conforme, À vérifier, Non conforme) et chantier (Avant fermeture, Calorifuge, VC) ;
    - CVC ;
    - plomberie ;
    - électricité.
  - **Tags personnels :** on peut en créer depuis la liste complète.
- **Prise de vue** : le bouton « 🏷 Tags » de la visée ouvre une **barre de 6 puces**.
  - **Contenu des puces :** les tags favoris, puis les plus récents, puis les tags par défaut (statut et chantier).
  - **Effet :** les tags cochés restent **actifs** et s'appliquent à **toutes les prises suivantes** (groupe de photos). Le bouton les rappelle (« 🏷 Non conforme, Calorifuge »).
- **Liste complète** (« ＋ Tous ») : en dernier recours. On y fait une recherche par les **premières lettres** d'un mot (« cal » → Calorifuge, « va ex » → Vase d'expansion).
  - **Favoris :** l'étoile ★ en fait un favori, toujours en tête des puces.
  - **Création :** « ＋ Créer le tag » ajoute un tag personnel.
  - **Mémoire :** favoris, récents et tags personnels sont mémorisés sur l'appareil.
- **Après la prise** : la visionneuse affiche la même barre pour les tags de la photo ; la miniature porte « 🏷 n ».
- **Synchronisation :** les tags voyagent dans les paquets et par le transit (le plus récent l'emporte). Ils sont contrôlés à l'import : 30 au plus, 40 caractères au plus.
- **Transcription des notes vocales** : pendant l'enregistrement d'une note vocale, la phrase dictée est reconnue.
  - **Commentaire :** elle s'ajoute au commentaire de la photo.
  - **Tags :** les tags qu'elle cite sont ajoutés à ceux de la photo. Exemple : « VC non conforme, calorifuge absent » donne VC, Non conforme, Calorifuge.
  - **Règles de reconnaissance :**
    - comparaison sans accents ni casse, sur des mots entiers, pluriel accepté ;
    - « A / B » est reconnu par A ou par B ;
    - « Non conforme » l'emporte sur « Conforme » ;
    - les sigles qui sont aussi des mots courants (« pas », « regard »…) ne comptent que seuls.
  - **⚠️ Écart signalé par rapport à CONCEPTION §A.4 (pas de service cloud tiers)** : la reconnaissance passe par le service vocal de Chrome (serveurs Google), qui reçoit le son de la note.
    - **Accord :** elle n'est donc utilisée qu'avec l'**accord explicite** de l'utilisateur, demandé à la première note et mémorisé sur l'appareil.
    - **Sans accord ou sans réseau :** la note est enregistrée sans transcription.
    - **Mode sur l'appareil :** la reconnaissance sur l'appareil (`processLocally`) éviterait l'envoi, mais elle fait planter la page dans le Chromium des tests ; elle est désactivée [À VÉRIFIER sur un vrai téléphone].
    - **Avis à demander :** DSI et DPO.
- **Dictée et correction des sigles** (21/11/2026) : la dictée du clavier du téléphone (Gboard) ne peut pas recevoir de dictionnaire. L'appli propose donc sa propre dictée.
  - **Bouton « 🎙 Dicter » :** dans la visée (sur la dernière photo) et dans la visionneuse, à côté du commentaire. Un appui, on parle, l'écoute s'arrête à la fin de la phrase.
  - **Correcteur des sigles** (`src/domaine/dictee.ts`), appliqué à la dictée et aux notes vocales :
    - **lettres épelées :** « c t a », « cé té a » ou « c.t.a. » deviennent « CTA » ; de même « vé cé » → VC, « gé effe » → GF, « v c f t » → VCFT ;
    - **sigles en minuscules :** « tgbt » devient « TGBT », d'après les sigles du catalogue des tags et une liste du métier (CVC, plomberie, électricité) ;
    - **mots courants préservés :** « pas », « eu », « a », « de »… restent tels quels.
  - **Biais de vocabulaire :** ces sigles sont aussi proposés à la reconnaissance vocale quand Chrome le permet [À VÉRIFIER].
- **Notes vocales sans tags (constat du 21/11/2026)** : sur le téléphone, les notes vocales ne produisaient ni commentaire ni tags.
  - **Cause probable** [À VÉRIFIER] : Android n'ouvre pas le micro deux fois, une fois pour l'enregistrement et une fois pour la reconnaissance. Les erreurs de reconnaissance étaient ignorées.
  - **Corrections :**
    - la piste du micro de l'enregistrement est passée à la reconnaissance (`start(piste)`, versions récentes de Chrome) ;
    - les résultats provisoires sont gardés ;
    - l'attente de la fin passe à 8 s ;
    - la cause d'un échec est affichée (« micro indisponible », « pas de réseau »…).
  - **Repli :** la dictée « 🎙 Dicter » n'enregistre pas de son ; elle n'a donc pas ce conflit.
- **Lisibilité sans l'appli** : les tags ne sont pas dans les noms de fichiers ; ils figureront dans les exports (lot 7 : rapport PDF, liste Excel).

## A.6 undecies Stockage du téléphone (24/11/2026)

- Sur téléphone, les projets sont rangés dans le stockage interne de l'appli (OPFS), invisible dans le gestionnaire de fichiers.
- **Section « Stockage du téléphone »** (accueil, sur téléphone) : elle liste chaque dossier avec son projet, son nombre de photos et ses photos **jamais envoyées** au serveur (par paquet ou transit).
  - **Dossiers incomplets :** les restes d'une création ou d'un import interrompus sont signalés.
  - **Suppression :** le bouton « Supprimer » efface le dossier et retire le projet des projets récents. Le projet sur le serveur partagé n'est pas touché.
  - **Garde-fou :** s'il reste des photos non envoyées, une alerte en donne le nombre et une seconde confirmation est demandée.
- **Import d'un paquet quand le dossier existe déjà :**
  - **même projet** (même identifiant) : il est ouvert et le paquet le complète ;
  - **dossier incomplet** dans le stockage interne (reste d'un import interrompu) : il est remplacé ;
  - **sinon** : un message explique le conflit.

  Avant, l'import s'arrêtait sur « Un dossier … existe déjà à cet emplacement », sans moyen de supprimer ce dossier depuis le téléphone.

## A.7 Fonctions prévues

**Terrain (priorité absolue : 2 appuis maximum par photo)**
- Toucher un repère existant ouvre l'appareil photo, on prend la photo, on revient au plan. Rafale possible.
- Appui long sur le plan : nouveau repère, rattaché automatiquement au local, et ouverture de l'appareil photo.
- « Panier à classer » : photo prise sans repère, placée plus tard. Photos importées regroupées par lieu probable (heure, ressemblance, GPS), puis rattachées par groupe à un local (A.6 nonies).
- Commentaire par dictée vocale, facultatif.
- Locaux déjà photographiés pendant la visite colorés sur le plan.
- Compression des photos (autour de 1 à 1,5 Mo) en conservant les métadonnées EXIF. Stockage persistant demandé au navigateur (`navigator.storage.persist()`).

**Plans et locaux**
- Import PDF avec pdf.js, affichage par tuiles (zoom fluide, hors ligne).
- **Détection automatique des locaux** depuis le texte vectoriel des PDF (étiquettes de pièces avec leur position) [À VÉRIFIER sur de vrais plans : impossible si le PDF est scanné ou si le texte est converti en traits].
- Renommage des plans selon la convention `{Projet}_{Niveau}.pdf` (A.6 bis), éventuellement depuis un tableau Excel.
- Changement d'indice : report des repères, avec recalage par 2 points si le cadrage a changé.

**Suivi dans le temps** (lot 6, réalisé le 19/11/2026)
- **Repères de suivi** (20/11/2026) : le calque et l'avant / après ne sont proposés que sur les repères désignés par le bouton « 📌 Repère de suivi » de leur fiche (`suivi: true` dans le JSON du repère).
  - **Sur le plan :** ces repères portent un 📌 devant leur numéro.
  - **Ailleurs :** les autres repères n'ont ni calque ni comparaison, pour garder la visée et la visionneuse simples.
- **Calque** : sur un repère de suivi, une photo du repère est affichée **en transparence** dans la visée, pour refaire le même cadrage.
  - **Photo affichée d'office :** la plus récente prise un jour précédent, à défaut la plus récente du jour ; les vidéos sont écartées.
  - **Choix de la photo :** le bouton « ◐ Calque du jj/mm/aa » ouvre une bande de vignettes des photos du repère, plus « Aucun ».
  - **Transparence :** un curseur la règle de 10 à 80 % (40 % au départ).
  - **Limite :** l'image est calée comme la visée (« contain ») ; si la proportion de la photo diffère de celle de la caméra, le calque ne couvre pas exactement la visée [À VÉRIFIER sur téléphone].
- **Avant / après** (repères de suivi seulement) : bouton « ↔ Avant / après » dans la fiche du repère (s'il a des photos à au moins deux dates), et « ↔ Comparer » dans la visionneuse (avant = photo d'une date antérieure).
  - **Affichage :** **rideau** à glisser entre les deux photos, ou **côte à côte** (l'une sous l'autre sur un téléphone en portrait).
  - **Frise chronologique :** en bas, elle montre les photos du repère groupées par date ; une photo touchée remplace l'image « Avant » ou « Après ».
  - **Fermeture :** par le bouton Retour.
- **Direction de prise de vue** : bouton « 🧭 Direction de prise de vue » dans la fiche du repère, puis un appui sur le plan dans la direction où regarde l'appareil.
  - **Dessin :** un cône part du repère sur le plan.
  - **Données :** `visee` (point visé, coordonnées relatives) dans le JSON du repère ; « Effacer la direction » la supprime.
  - **Choix :** **saisie à la main**, et non par la boussole du téléphone. La boussole est peu fiable près des masses métalliques, et le nord des plans n'est pas connu de l'appli. Une saisie par boussole reste possible plus tard [À VÉRIFIER].

**Recherche et exports**
- Recherche par local (« TGBT », « 012 ») : position sur le plan et toutes les photos.
- Rapport PDF par local et par plan, liste Excel des repères.

## A.8 Plan de réalisation

| Lot | Contenu | Validation |
|---|---|---|
| 0. Cadrage | Test de lecture des locaux sur de vrais PDF, maquettes des écrans, demande à la DSI | Spécification validée |
| 1. Socle | Dépôt, PWA installable, création du projet, import des PDF, renommage, arborescence sur le serveur partagé | Projet créé sur le serveur (**réalisé le 04/11/2026**, validation sur le serveur réel à faire par l'utilisateur) |
| 2. Plans et locaux | Affichage par tuiles, détection et correction des locaux, recherche | « Je tape TGBT, je trouve le local » (**réalisé le 05/11/2026**, vérifié sur un vrai carnet : le TGBT du SS1 est trouvé) |
| 3. Terrain | Repères, photo en 2 appuis, panier à classer, hors ligne, compression | Visite de 300 photos en mode avion (**réalisé le 10/11/2026**, validé en test automatique ; essai sur téléphone à faire) |
| 4. Synchro zip | Export et import `.zip`, rangement, contrôle des doublons | **Première version utilisable de bout en bout** (**réalisé le 13/11/2026**, validé en test automatique ; essai réel à faire) |
| 5. SharePoint transit | MSAL, envoi depuis le téléphone, collecte par le PC puis purge | Deux personnes sur un même projet (**développé le 16/11/2026**, testé contre une imitation de Graph ; **en attente de la DSI** pour l'essai réel) |
| 6. Suivi dans le temps | Transparence, frise, avant/après, direction | Même cadrage à 2 dates (**réalisé le 19/11/2026**, validé en test automatique `suivi-lot6.mjs` ; essai sur téléphone à faire) |
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
6. **Note à la DSI** : **réécrite le 16/11/2026** selon l'architecture actuelle, dans `docs/NOTE_DSI.md` (à transmettre). Elle remplace une première version, qui décrivait **l'ancienne architecture** (SharePoint comme stockage définitif, un site par projet). **Elle est à refaire** selon A.4 :
   - stockage définitif sur le serveur partagé ;
   - **une seule bibliothèque SharePoint de transit**, avec permission Sites.Selected limitée à elle ;
   - durée de séjour courte, purge après collecte ;
   - questions sur les téléphones personnels (accès conditionnel, Intune MAM), l'hébergement, la passerelle Power Automate éventuelle, l'avis du DPO (RGPD : ne photographier aucune personne identifiable).

7. **Contour des locaux** (question du 10/11/2026) : aujourd'hui un local est un point (son étiquette). Pour qu'un repère soit rattaché au local qui le **contient**, il faudrait un contour (polygone) par local : soit tracé à la main par appuis successifs sur les angles, soit déduit des traits du PDF [À VÉRIFIER : faisabilité, les cloisons étant des traits sans notion de pièce]. À trancher par l'utilisateur.
8. ~~**Hébergement HTTPS pour l'essai sur téléphone**~~ **TRANCHÉ le 10/11/2026** : dépôt GitHub rendu **public** et appli publiée sur **GitHub Pages** (https://baptistelaloggia.github.io/application-releve-photo/), par le workflow `.github/workflows/publication-pages.yml` à chaque fusion dans `main`. **Écart signalé par rapport à A.4-6** (Azure ou interne) : accepté pour la phase d'essai. Seuls les fichiers de l'appli sont publiés ; aucune donnée de projet ne passe par GitHub, ce qui respecte A.4-7. La question de l'hébergement définitif reste posée à la DSI (note à la DSI, A.9-6).

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
