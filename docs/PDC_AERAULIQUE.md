# Estimateur de pertes de charge aérauliques

Outil autonome, indépendant de l'appli de relevé photo, rangé dans `outils/pertes-de-charge/`.
Il donne, pour un ventilateur (CTA double flux, caisson simple flux, VMC, désenfumage), une **fourchette de pertes
de charge en Pa** et la **pression disponible à demander**, à partir de quelques données : débit, longueur du circuit
le plus défavorisé, nombre de CCF, PAS, BDV, MR, type de terminal.

## Fichiers

| Fichier | Rôle |
|---|---|
| `moteur.js` | Calcul pur, sans dépendance : pertes linéiques (Colebrook, Huebscher), ratios, fourchette. |
| `page.html` | Interface (saisie, résultats, matrice Pa/ml, hypothèses). |
| `construire.mjs` | Assemble `moteur.js` et `page.html` en un seul fichier `pertes-de-charge.html`. |
| `pertes-de-charge.html` | **Fichier à utiliser** : s'ouvre par double-clic dans Chrome ou Edge, fonctionne hors ligne. |
| `references.json` | 81 réseaux de référence **anonymisés** (débit, longueur, pertes linéaires, singulières, particulières). |
| `verif.mjs` | Recalcule les références et échoue si la couverture de la fourchette tombe sous 85 %. |

Commandes (depuis la racine du dépôt) :

```bash
node outils/pertes-de-charge/verif.mjs
```

```bash
node outils/pertes-de-charge/construire.mjs
```

La première vérifie le calage ; la seconde régénère `pertes-de-charge.html` après une modification de `moteur.js`
ou de `page.html`.

## Méthode

Pour le circuit le plus défavorisé de chaque réseau :

```
ΔP = L × j × (1 + kr)        gaines + accidents de forme répartis
   + ζb × Pd tronc           accidents de forme concentrés près du ventilateur
   + Σ pertes particulières  CCF, PAS, BDV, MR, batteries, terminal, grilles, volets
```

- `j` : perte linéique de dimensionnement moyenne (Pa/ml), ou celle du tronc en désenfumage.
- `kr`, `ζb` : calés par moindres écarts sur les réseaux de référence (bas / probable / haut).
- Fourchette : écarts des postes combinés quadratiquement (postes supposés indépendants). L'enveloppe
  « tout au plus défavorable » reste affichée.
- Pression à demander : probable × (1 + marge 10 %), arrondie à la dizaine supérieure.
- CTA : soufflage = air neuf + soufflage ; reprise = reprise + rejet. Les composants internes (filtres, batteries,
  récupérateur) ne sont pas comptés.

## Sources et calage

- **Source A** : outil de calcul d'une entreprise de désenfumage (onglet « PDC particulières », deux réseaux).
- **Source B** : note de calcul DOE d'une entreprise CVC, 23 CTA d'un immeuble de bureaux (79 réseaux).

Résultats (`verif.mjs`) : pertes linéiques à ± 5 % des deux notes ; valeur réelle dans la fourchette pour 75 réseaux
sur 81 (93 %) ; écart moyen de la valeur probable 12 %. Les réseaux hors fourchette sont surestimés.

Les noms des entreprises, du projet et des intervenants ne figurent pas dans le dépôt (dépôt public).

## Points à vérifier

- [À VÉRIFIER] VMC, simple flux et désenfumage : peu de données de référence, coefficients extrapolés des CTA.
- [À VÉRIFIER] Pertes des bouches autoréglables, poutres froides, volets de désenfumage : dépendent du fabricant.
- [À VÉRIFIER] Fuites des volets de désenfumage fermés : 5 % par défaut (valeur de la source A).

## Suite envisagée

Le format de saisie (bouton « Copier la saisie (JSON) ») est prévu pour être rempli automatiquement :
longueur du circuit le plus défavorisé et comptage des CCF, PAS, BDV… mesurés sur les plans de réseaux
(polylignes d'un plan minute, ou analyse des plans tous niveaux). `moteur.js` est un module pur réutilisable
par l'appli de relevé si cette fonction y est intégrée un jour.
