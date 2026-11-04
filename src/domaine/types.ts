/**
 * Modèle de données (CONCEPTION §A.5) : lot 1, partie « projet, niveaux, plans ».
 * Chaque élément est un petit fichier JSON dans _data/ du dossier projet.
 * Les identifiants sont des UUID générés sur l'appareil.
 */

export const VERSION_SCHEMA = 1;

/** _data/projet.json */
export interface Projet {
  schema: number;
  id: string;
  annee: number;
  /** Code d'affaire, le « XXX » des noms de fichiers. */
  codeAffaire: string;
  nom: string;
  /** Nom du dossier racine, par ex. « 2026-XXX_NomProjet ». */
  dossier: string;
  creeLe: string;
  creePar: string;
}

/** _data/niveaux/{id}.json */
export interface Niveau {
  schema: number;
  id: string;
  /** SS, SS1, RDC, R+1, TT… */
  code: string;
  creeLe: string;
  creePar: string;
}

/** Un ancien indice d'un plan, archivé dans 00_PLANS/_ANCIENS/. */
export interface IndiceArchive {
  indice: string;
  fichier: string;
  nomOrigine: string;
  pageOrigine?: number;
  empreinte: string;
  importeLe: string;
  importePar: string;
  archiveLe: string;
  archivePar: string;
}

/**
 * _data/plans/{id}.json : un plan par niveau. Il garde le même identifiant
 * d'un indice à l'autre, pour que les repères (lot 3) lui restent rattachés.
 */
export interface Plan {
  schema: number;
  id: string;
  niveauId: string;
  indice: string;
  /** Chemin dans le projet, par ex. « 00_PLANS/XXX_R+1.pdf ». */
  fichier: string;
  /** Nom du fichier PDF tel qu'il a été importé. */
  nomOrigine: string;
  /** Numéro de la page d'origine, quand le plan a été extrait d'un carnet de plans multi-pages. */
  pageOrigine?: number;
  pages: number;
  taille: number;
  /**
   * Empreinte SHA-256 du PDF importé : sert à repérer les doublons.
   * Pour une page extraite d'un carnet : empreinte du carnet suivie de « #p » et du numéro de page.
   */
  empreinte: string;
  importeLe: string;
  importePar: string;
  historique: IndiceArchive[];
}
