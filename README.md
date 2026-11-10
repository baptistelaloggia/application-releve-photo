# application-releve-photo

Application, sur téléphone Android et PC Windows, qui sert à localiser des photos sur les plans PDF d'un projet. Chaque photo est rattachée à un repère placé sur un plan, dans un local identifié. L'application fonctionne hors ligne et range les photos dans une arborescence Windows normalisée sur le serveur réseau partagé.

- Conception complète : [`docs/CONCEPTION.md`](docs/CONCEPTION.md)
- Règles du projet : [`CLAUDE.md`](CLAUDE.md)

## État d'avancement

| Lot | État |
|---|---|
| 1. Socle | Réalisé : création de projet, niveaux, import et découpage des plans PDF, arborescence normalisée, test d'écriture sur le serveur |
| 2. Plans et locaux | Réalisé : affichage fluide des plans (zoom, tuiles), détection et correction des locaux, recherche |
| 3. Terrain | Réalisé : repères, photo en 2 appuis avec l'appareil photo de l'appli, rafale, panier à classer, compression (EXIF conservé), hors ligne |
| 4 à 7 | À faire |

## Tester l'application sur un PC (sans rien installer)

1. Récupérer le fichier `releve-photo-test.html` (version de test en un seul fichier).
2. Clic droit sur le fichier, puis « Ouvrir avec », puis **Microsoft Edge** ou **Google Chrome**.
3. Commencer par « Tester l'écriture sur le serveur », en choisissant un dossier du lecteur réseau.

Cette version de test ne s'installe pas et ne fonctionne pas hors ligne. La version installable doit être hébergée en HTTPS (voir CONCEPTION §A.4-6).

## Pour les développeurs

Prérequis : Node.js 22 ou plus.

```bash
npm install          # installe les dépendances
npm run dev          # lance l'appli en local (http://localhost:5173)
npm test             # tests unitaires
npm run build        # version installable (PWA) dans dist/
npm run build:test   # version de test en un seul fichier dans dist-test/index.html
npm run test:e2e     # parcours complet dans Chromium (après les deux constructions)
```

Ne jamais déposer de plans clients, de photos réelles ou d'identifiants dans le dépôt.
