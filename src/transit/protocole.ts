/**
 * Protocole d'échange par la bibliothèque SharePoint « Transit » (lot 5, CONCEPTION §A.6 sexies).
 * SharePoint ne fait que transporter les paquets .zip du lot 4 : le serveur partagé reste la référence.
 *
 *   {dossier du projet}__{8 premiers caractères de l'identifiant}/
 *     copie-de-travail/travail.zip    plans, locaux, repères : publié par le PC (option A, §A.4-9)
 *     copie-de-travail/version.json   date et auteur de la publication, projet
 *     depots/{paquet de retour}.zip   visites déposées par les téléphones, supprimées après collecte
 */
import type { Photo, Projet } from '../domaine/types';
import type { EspaceProjet } from '../projet/EspaceProjet';
import { exporterPaquet } from '../projet/paquet';
import type { ElementTransit, TransitGraph } from './TransitGraph';

export interface VersionCopie {
  format: 'releve-photo-copie';
  projet: Pick<Projet, 'id' | 'nom' | 'dossier' | 'codeAffaire'>;
  publieLe: string;
  publiePar: string;
  taille: number;
}

export function dossierTransit(projet: Pick<Projet, 'id' | 'dossier'>): string {
  return `${projet.dossier}__${projet.id.slice(0, 8)}`;
}

const COPIE = 'copie-de-travail/travail.zip';
const VERSION = 'copie-de-travail/version.json';
const DEPOTS = 'depots';

const pourcent = (fait: number, total: number) => `${Math.round((100 * fait) / Math.max(total, 1))} %`;

/** PC : publie (ou remplace) la copie de travail du projet sur le transit. */
export async function publierCopie(
  transit: TransitGraph,
  espace: EspaceProjet,
  auteur: string,
  progression: (texte: string) => void,
): Promise<VersionCopie> {
  const { fichier } = await exporterPaquet(espace, 'vers-telephone', auteur, [], progression);
  const d = dossierTransit(espace.projet);
  await transit.deposer(`${d}/${COPIE}`, fichier, (f, t) => progression(`Envoi de la copie de travail : ${pourcent(f, t)}`));
  const { id, nom, dossier, codeAffaire } = espace.projet;
  const version: VersionCopie = {
    format: 'releve-photo-copie',
    projet: { id, nom, dossier, codeAffaire },
    publieLe: new Date().toISOString(),
    publiePar: auteur,
    taille: fichier.size,
  };
  await transit.deposer(`${d}/${VERSION}`, new Blob([JSON.stringify(version, null, 2)], { type: 'application/json' }));
  return version;
}

async function lireVersion(transit: TransitGraph, dossier: string): Promise<VersionCopie | null> {
  const b = await transit.telecharger(`${dossier}/${VERSION}`);
  if (!b) return null;
  try {
    const v = JSON.parse(await b.text()) as VersionCopie;
    return v.format === 'releve-photo-copie' ? v : null;
  } catch {
    return null;
  }
}

export function versionCopie(transit: TransitGraph, projet: Pick<Projet, 'id' | 'dossier'>): Promise<VersionCopie | null> {
  return lireVersion(transit, dossierTransit(projet));
}

/** Téléphone : télécharge la copie de travail d'un projet. */
export async function telechargerCopie(transit: TransitGraph, projet: Pick<Projet, 'id' | 'dossier'>): Promise<File> {
  const b = await transit.telecharger(`${dossierTransit(projet)}/${COPIE}`);
  if (!b) throw new Error("Pas de copie de travail de ce projet sur le transit : publiez-la d'abord depuis le PC.");
  return new File([b], `${projet.dossier}_copie-de-travail.zip`, { type: 'application/zip' });
}

/** Téléphone : liste des projets dont une copie de travail est publiée sur le transit. */
export async function listerProjetsTransit(transit: TransitGraph): Promise<VersionCopie[]> {
  const dossiers = (await transit.lister('')).filter((e) => e.dossier && /__[0-9a-f]{8}$/.test(e.nom));
  const versions = await Promise.all(dossiers.map((d) => lireVersion(transit, d.nom).catch(() => null)));
  return versions.filter((v): v is VersionCopie => v !== null).sort((a, b) => a.projet.dossier.localeCompare(b.projet.dossier));
}

/** Téléphone : dépose la visite (données et photos pas encore transmises) sur le transit. */
export async function deposerVisite(
  transit: TransitGraph,
  espace: EspaceProjet,
  auteur: string,
  photos: Photo[],
  progression: (texte: string) => void,
): Promise<{ nom: string; taille: number }> {
  const { fichier, nom } = await exporterPaquet(espace, 'vers-serveur', auteur, photos, progression);
  await transit.deposer(`${dossierTransit(espace.projet)}/${DEPOTS}/${nom}`, fichier, (f, t) =>
    progression(`Envoi de la visite : ${pourcent(f, t)} (${(t / 1024 / 1024).toFixed(1).replace('.', ',')} Mo)`),
  );
  return { nom, taille: fichier.size };
}

/** PC : dépôts en attente de collecte, du plus ancien au plus récent. */
export async function listerDepots(transit: TransitGraph, projet: Pick<Projet, 'id' | 'dossier'>): Promise<ElementTransit[]> {
  return (await transit.lister(`${dossierTransit(projet)}/${DEPOTS}`))
    .filter((e) => !e.dossier && e.nom.endsWith('.zip'))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

export async function telechargerDepot(transit: TransitGraph, projet: Pick<Projet, 'id' | 'dossier'>, nom: string): Promise<File> {
  const b = await transit.telecharger(`${dossierTransit(projet)}/${DEPOTS}/${nom}`);
  if (!b) throw new Error(`Dépôt introuvable sur le transit : ${nom}`);
  return new File([b], nom, { type: 'application/zip' });
}

/** PC : supprime un dépôt après collecte réussie (purge, CONCEPTION §A.4-3). */
export function supprimerDepot(transit: TransitGraph, projet: Pick<Projet, 'id' | 'dossier'>, nom: string): Promise<void> {
  return transit.supprimer(`${dossierTransit(projet)}/${DEPOTS}/${nom}`);
}

/** PC, à la clôture du projet : supprime tout le dossier du projet sur le transit. */
export function purgerProjet(transit: TransitGraph, projet: Pick<Projet, 'id' | 'dossier'>): Promise<void> {
  return transit.supprimer(dossierTransit(projet));
}
