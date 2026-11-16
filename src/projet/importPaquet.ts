/**
 * Import d'un paquet .zip dans un projet : contrôle, fusion, rangement des photos.
 * Partagé par l'import manuel (écran Échanges) et la collecte du transit SharePoint (lot 5).
 */
import { controlerDonnees, fusionner, type ResultatFusion } from '../domaine/fusion';
import { estCodeNiveauAutorise } from '../domaine/niveaux';
import type { EspaceProjet } from './EspaceProjet';
import { lireEnTete, lirePhotos, type EnTetePaquet } from './paquet';

export interface ImportPrepare {
  entete: EnTetePaquet;
  fusion: ResultatFusion;
  /** Rien à importer : tout le contenu du paquet est déjà présent. */
  rien: boolean;
}

/** Erreur en cours d'import : ce qui a déjà été rangé est conservé (compte rendu partiel). */
export class ErreurImport extends Error {
  constructor(
    message: string,
    readonly compteRendu: string[],
  ) {
    super(message);
    this.name = 'ErreurImport';
  }
}

/** Lit l'en-tête du paquet, vérifie qu'il concerne ce projet et calcule la fusion (sans rien écrire). */
export async function preparerImport(espace: EspaceProjet, paquet: Blob): Promise<ImportPrepare> {
  const entete = await lireEnTete(paquet);
  if (entete.manifeste.projet.id !== espace.projet.id) {
    throw new Error(`Ce paquet concerne un autre projet : « ${entete.manifeste.projet.nom} » (${entete.manifeste.projet.dossier}).`);
  }
  const problemes = controlerDonnees(entete.donnees, estCodeNiveauAutorise);
  if (problemes.length) {
    throw new Error(`Paquet refusé : données non conformes (${problemes.slice(0, 5).join(' ; ')}${problemes.length > 5 ? '…' : ''}). Rien n'a été importé.`);
  }
  const fusion = fusionner(espace.donnees(), entete.donnees);
  const rien =
    fusion.niveaux.length + fusion.plans.length + fusion.locaux.length + fusion.reperes.length +
      fusion.photosNouvelles.length + fusion.photosModifiees.length === 0;
  return { entete, fusion, rien };
}

/** Applique la fusion et range les photos du paquet. Renvoie le compte rendu. */
export async function executerImport(
  espace: EspaceProjet,
  paquet: Blob,
  nomPaquet: string,
  prepare: ImportPrepare,
  auteur: string,
  progression: (texte: string) => void,
): Promise<string[]> {
  const { entete, fusion } = prepare;
  const compteRendu: string[] = [];
  try {
    progression('Mise à jour des plans, locaux et repères…');
    compteRendu.push(...(await espace.appliquerFusion(fusion, (id) => entete.pdfs.get(id), auteur)));
    const voulues = new Map(fusion.photosNouvelles.map((p) => [p.id, p]));
    let faites = 0;
    const debut = performance.now();
    if (voulues.size) {
      await lirePhotos(paquet, new Set(voulues.keys()), async (id, jpeg, miniature) => {
        await espace.ajouterPhotoImportee(voulues.get(id)!, jpeg, miniature);
        voulues.delete(id);
        faites++;
        progression(`Photos rangées : ${faites}/${fusion.photosNouvelles.length}`);
      });
    }
    if (faites) {
      compteRendu.unshift(
        `${faites} photo${faites > 1 ? 's' : ''} rangée${faites > 1 ? 's' : ''} en ${((performance.now() - debut) / 1000).toFixed(0)} s`,
      );
    }
    if (voulues.size) {
      compteRendu.push(
        `Attention : ${voulues.size} photo(s) décrite(s) dans le paquet sans leur fichier (déjà transmises dans un paquet précédent non importé ?). Sur le téléphone, réexportez en cochant « inclure aussi les photos déjà exportées ».`,
      );
    }
    compteRendu.unshift(`Paquet importé : ${nomPaquet}`);
    return compteRendu;
  } catch (e) {
    throw new ErreurImport(e instanceof Error ? e.message : String(e), compteRendu);
  }
}
