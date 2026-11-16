# Note à la DSI : application de relevé photo sur plans, transit SharePoint

> Version du 16/11/2026. Elle remplace la première note, qui décrivait une ancienne architecture :
> SharePoint comme stockage définitif, avec un site par projet. **SharePoint ne sert plus que de transit.**
> Les points incertains sont marqués [À VÉRIFIER].

## 1. Objet

Demander les moyens techniques nécessaires au **transit des photos de chantier** entre les téléphones des ingénieurs et le **serveur réseau partagé**, au travers d'une **bibliothèque SharePoint unique**, utilisée comme boîte aux lettres temporaire.

## 2. Contexte et besoin

- Les ingénieurs du bureau d'études font des relevés d'existant, des audits et du suivi de chantier. Une visite représente de 20 à 300 photos.
- Chaque photo est **localisée sur le plan PDF** du projet, à un repère placé dans un local identifié.
- Les photos sont rangées sur le **serveur partagé**, dans une arborescence normalisée par projet, niveau et local. C'est l'**unique stockage définitif**.
- Un téléphone en visite n'a pas accès au serveur. Aujourd'hui, les échanges se font par un fichier `.zip` copié à la main, par câble USB ou par OneDrive. Le transit SharePoint doit **supprimer cette manipulation**.

## 3. Description de l'application

- **Application web installable** (PWA), sans droits administrateur ni magasin d'applications : sur PC depuis **Microsoft Edge**, sur Android depuis Chrome. Elle fonctionne **hors ligne**.
- **Aucun serveur applicatif, aucune base de données externe, aucun service cloud tiers.** Les fichiers de l'application (HTML et JavaScript) sont servis par un hébergement statique, sans aucune donnée de projet (voir §6, demande 4).
- **Sur PC**, l'application écrit directement dans le dossier du projet sur le serveur partagé. Elle utilise pour cela la *File System Access API* d'Edge, qui demande à l'utilisateur d'autoriser explicitement l'accès au dossier.
- **Sur le téléphone**, les données restent dans le **stockage privé de l'application**, invisible de la galerie, jusqu'à leur dépôt.

## 4. Architecture des échanges

```
   Téléphone (hors ligne en visite)                        PC du bureau (réseau interne)
   ────────────────────────────────                        ─────────────────────────────
   1. récupère la copie de travail  ◄──┐            ┌────  publie la copie de travail
      (plans, locaux, repères)         │            │      (plans, locaux, repères)
                                       │            │
   2. visite : photos sur plans        │  SharePoint │
                                       │  « Transit » │
   3. dépose la visite (.zip)  ────────┼──►  dépôts  ─┼──►  4. collecte : télécharge, range sur le
                                       │            │         serveur partagé, contrôle, puis
                                       └────────────┘         SUPPRIME le dépôt de SharePoint
                                                       ▼
                                             Serveur partagé (stockage définitif, sauvegardé)
```

- **Une seule bibliothèque** de documents, par exemple « Transit », dans un site dédié. Elle contient un dossier par projet en cours :
  - `copie-de-travail/` : paquet des plans, locaux et repères, de quelques Mo. Il est conservé pendant la durée du projet et **supprimé à sa clôture** ;
  - `depots/` : paquets de visite. Ils sont **supprimés dès qu'ils sont rangés** sur le serveur, après quelques heures à quelques jours.
- **Volumes** : un paquet de visite pèse jusqu'à environ 400 Mo, pour 300 photos d'environ 1,2 Mo. L'envoi se fait par session d'envoi Microsoft Graph, en morceaux de 9,4 Mo.
- **Accès** : Microsoft Graph, en délégué, au nom de l'utilisateur connecté.

## 5. Sécurité et données

- **Authentification Microsoft Entra ID** par la bibliothèque officielle MSAL.js. Le flux est celui du **code d'autorisation avec PKCE**, pour une application monopage : **aucun secret** n'est stocké dans l'application.
- **Permission Microsoft Graph déléguée `Sites.Selected`.** L'application n'accède qu'au **seul site** que la DSI lui ouvre. En délégué, l'accès effectif combine les droits de l'application sur le site et ceux de l'utilisateur.
- **Jetons** : ils sont gardés par MSAL dans le stockage du navigateur de l'appareil, et **révocables** depuis Entra ID (session, utilisateur, application).
- **Chiffrement** : HTTPS partout. Aucune donnée de projet ne transite par l'hébergement de l'application.
- **Traçabilité** : chaque photo porte son auteur, sa date et son empreinte SHA-256. Les doublons sont écartés à la collecte.
- **Durée de séjour courte** sur SharePoint, avec une purge systématique après la collecte. Le stockage définitif et sa sauvegarde restent ceux du serveur partagé existant.
- **RGPD** : l'application sert à photographier des locaux et des équipements, **pas des personnes**. Il est demandé de ne photographier aucune personne identifiable. L'avis du DPO est sollicité (§7).

## 6. Demandes

| # | Demande | Détail |
|---|---|---|
| 1 | **Enregistrement d'une application dans Entra ID** | Plateforme **« Application monopage » (SPA)**, compte de l'organisation uniquement (un seul locataire). **URI de redirection** : `https://baptistelaloggia.github.io/application-releve-photo/msal-retour.html`. Cette adresse sera à modifier si l'hébergement change (demande 4). Pas de secret, pas de certificat. |
| 2 | **Permission Microsoft Graph déléguée `Sites.Selected`**, avec consentement de l'administrateur | Accordée **sur le seul site de transit**, avec le droit **« write »** (`POST /sites/{id-du-site}/permissions`). [À VÉRIFIER : prise en charge de `Sites.Selected` en délégué dans votre configuration.] |
| 3 | **Un site dédié et sa bibliothèque « Transit »** | Accès en modification pour le groupe des ingénieurs concernés. Contrôle de version réduit (par exemple 1 version), puisque les fichiers sont temporaires. Si possible, une règle de suppression automatique des fichiers de plus de 30 jours, comme filet de sécurité. |
| 4 | **Hébergement de l'application** | L'application est actuellement hébergée sur GitHub Pages, en HTTPS. Elle n'y contient que du code, pas de données. Faut-il passer à un hébergement interne, ou à Azure Static Web Apps (offre gratuite) ? |
| 5 | **Avis sur les téléphones personnels** | Accès conditionnel, Intune MAM : quelles conditions pour qu'un téléphone personnel accède au site de transit par le navigateur ? |
| 6 (option) | **Passerelle de données locale** | Pour automatiser plus tard la collecte par Power Automate, sans PC ouvert. [À VÉRIFIER : licence.] |

**Valeurs à transmettre en retour**, à saisir dans l'application (écran « Réglages SharePoint »), ou sous forme d'un petit fichier `.json` à importer :

```json
{
  "tenantId": "identifiant du locataire Entra ID",
  "clientId": "identifiant de l'application enregistrée",
  "siteUrl": "https://<entreprise>.sharepoint.com/sites/<site-de-transit>",
  "bibliotheque": "Transit"
}
```

## 7. Questions

1. `Sites.Selected` en délégué est-il possible dans votre configuration, ou faut-il une autre permission limitée au site ?
2. Les téléphones personnels peuvent-ils se connecter au site de transit, et sous quelles conditions (MFA, accès conditionnel, MAM) ?
3. Quel hébergement retenir pour l'application (demande 4) ?
4. Avis du DPO sur les photos de chantier (absence de personnes identifiables) et sur la durée de séjour sur SharePoint.
5. Faut-il prévoir une politique de rétention ou de DLP particulière sur la bibliothèque de transit ?

## 8. Solution transitoire et calendrier

- **Aujourd'hui**, l'application est utilisable de bout en bout **sans SharePoint**. Les échanges se font par paquet `.zip`, copié par câble USB ou par OneDrive. Un essai réel a été validé le 16/11/2026.
- **Le transit SharePoint est déjà développé et testé** contre une imitation de Microsoft Graph. Il **n'attend que les valeurs de la demande 1 et les accès des demandes 2 et 3** pour être essayé sur le locataire réel.
- Calendrier proposé : enregistrement et accès (1 à 3) → essai sur un projet pilote par un ou deux ingénieurs → généralisation.
