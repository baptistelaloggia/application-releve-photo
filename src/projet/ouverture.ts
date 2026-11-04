import { EspaceProjet, type InfosNouveauProjet } from './EspaceProjet';
import { StockageDossier } from '../stockage/StockageDossier';
import { memoriserProjet, type ProjetConnu, type TypeEmplacement } from '../stockage/registre';
import { DOSSIERS, nomDossierProjet } from '../domaine/nommage';

function libelle(type: TypeEmplacement, nom: string) {
  return type === 'dossier' ? `Dossier « ${nom} »` : `Stockage interne de l'appareil (« ${nom} »)`;
}

async function memoriser(espace: EspaceProjet, handle: FileSystemDirectoryHandle, type: TypeEmplacement) {
  const connu: ProjetConnu = {
    id: espace.projet.id,
    nom: espace.projet.nom,
    dossier: handle.name,
    type,
    handle: type === 'dossier' ? handle : undefined,
    dernierAcces: new Date().toISOString(),
  };
  try {
    await memoriserProjet(connu);
  } catch (e) {
    // La liste des projets récents n'est qu'une commodité : on continue sans elle.
    console.warn('Projet non mémorisé dans la liste des récents', e);
  }
  return connu;
}

/** Ouvre le projet contenu dans un dossier, et le mémorise dans la liste des projets récents. */
export async function ouvrirProjet(handle: FileSystemDirectoryHandle, type: TypeEmplacement) {
  const espace = await EspaceProjet.ouvrir(new StockageDossier(handle, libelle(type, handle.name)));
  const connu = await memoriser(espace, handle, type);
  return { espace, connu };
}

/** Crée le dossier « 2026-XXX_NomProjet » dans le dossier parent, puis le projet dedans. */
export async function creerProjet(
  parent: FileSystemDirectoryHandle,
  type: TypeEmplacement,
  infos: InfosNouveauProjet,
  auteur: string,
) {
  const nom = nomDossierProjet(infos.annee, infos.codeAffaire, infos.nom);
  let existant: FileSystemDirectoryHandle | null = null;
  try {
    existant = await parent.getDirectoryHandle(nom);
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
  }
  if (existant) {
    const stockage = new StockageDossier(existant, libelle(type, nom));
    if (await stockage.existe(`${DOSSIERS.donnees}/projet.json`)) {
      throw new Error(`Le projet « ${nom} » existe déjà à cet emplacement : utilisez « Ouvrir un projet existant ».`);
    }
    if ((await stockage.lister('')).length > 0) {
      throw new Error(`Un dossier « ${nom} » existe déjà et n'est pas vide. Choisissez un autre emplacement ou renommez-le.`);
    }
  }
  const handle = existant ?? (await parent.getDirectoryHandle(nom, { create: true }));
  const espace = await EspaceProjet.creer(new StockageDossier(handle, libelle(type, nom)), infos, auteur);
  const connu = await memoriser(espace, handle, type);
  return { espace, connu };
}
