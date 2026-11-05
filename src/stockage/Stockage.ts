/**
 * Interface de stockage interchangeable (CONCEPTION §A.4-4).
 *
 * Tout le reste de l'application ne connaît que cette interface. Implémentations :
 * - StockageDossier : un vrai dossier Windows (File System Access API, sur PC)
 *   ou le stockage interne du navigateur (OPFS, sur téléphone) ;
 * - StockageMemoire : en mémoire, pour les tests automatiques ;
 * - plus tard : paquet .zip (lot 4) et SharePoint transit (lot 5).
 *
 * Les chemins sont relatifs à la racine du projet, séparés par « / »
 * (par ex. « 00_PLANS/XXX_R+1.pdf »).
 */
export interface EntreeDossier {
  nom: string;
  type: 'fichier' | 'dossier';
}

export interface Stockage {
  /** Libellé lisible de l'emplacement, pour l'affichage. */
  readonly libelle: string;

  existe(chemin: string): Promise<boolean>;
  lister(cheminDossier: string): Promise<EntreeDossier[]>;
  /** Crée le dossier et ses parents s'ils n'existent pas (sans erreur s'il existe). */
  creerDossier(cheminDossier: string): Promise<void>;

  lireFichier(chemin: string): Promise<Blob>;
  /** Écrit (ou remplace) un fichier ; crée les dossiers parents si besoin. */
  ecrireFichier(chemin: string, contenu: Blob | string): Promise<void>;

  /** Supprime un fichier, ou un dossier et tout son contenu. Sans erreur s'il n'existe pas. */
  supprimer(chemin: string): Promise<void>;

  /** Déplace ou renomme un fichier ou un dossier. Échoue si la destination existe. */
  deplacer(source: string, destination: string): Promise<void>;
}

/** Erreur levée quand un chemin n'existe pas. */
export class ErreurIntrouvable extends Error {
  constructor(public readonly chemin: string) {
    super(`Introuvable : ${chemin}`);
    this.name = 'ErreurIntrouvable';
  }
}

/** Découpe un chemin « a/b/c » en morceaux, en refusant les chemins dangereux. */
export function decouperChemin(chemin: string): string[] {
  const morceaux = chemin.split('/').filter((m) => m !== '' && m !== '.');
  for (const m of morceaux) {
    if (m === '..') throw new Error(`Chemin non autorisé : ${chemin}`);
  }
  return morceaux;
}

export async function lireJson<T>(stockage: Stockage, chemin: string): Promise<T> {
  const blob = await stockage.lireFichier(chemin);
  return JSON.parse(await blob.text()) as T;
}

export async function ecrireJson(stockage: Stockage, chemin: string, valeur: unknown): Promise<void> {
  await stockage.ecrireFichier(chemin, JSON.stringify(valeur, null, 2) + '\n');
}
