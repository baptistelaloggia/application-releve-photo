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
  /** SS1, ES, RDC, R+1, TT… ou code libre d'un niveau intermédiaire (R+4-MEZZANINE). */
  code: string;
  /** Libellé saisi pour un niveau intermédiaire (« R+4 mezzanine »). */
  libelle?: string;
  /** Position dans le bâtiment, du bas vers le haut (0, 10, 20…). Modifiable par l'utilisateur. */
  ordre?: number;
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

/**
 * _data/locaux/{id}.json : un local identifié sur un plan.
 * Sa position est celle de son étiquette, relative à la page du plan (0 à 1).
 */
export interface Local {
  schema: number;
  id: string;
  planId: string;
  /** Numéro du plan (« SF202 », « 012 ») ; null si le plan n'en donne pas. */
  numero: string | null;
  nom: string;
  /** Surface en m², si elle figure sur le plan. */
  surface: number | null;
  x: number;
  y: number;
  /** « auto » : détecté sur le plan puis validé ; « manuel » : placé à la main. */
  origine: 'auto' | 'manuel';
  creeLe: string;
  creePar: string;
  modifieLe: string;
  modifiePar: string;
}

/**
 * _data/reperes/{id}.json : un point de prise de vue, fixe, placé sur un plan.
 * Il accumule des photos datées (suivi dans le temps).
 */
export interface Repere {
  schema: number;
  id: string;
  planId: string;
  /** Local de rattachement ; null : hors local. */
  localId: string | null;
  /** Numéro lisible, unique dans le projet (« P012 »). Simple libellé, réattribuable. */
  numero: string;
  libelle: string;
  x: number;
  y: number;
  /**
   * Repère « d'étiquette » : celui du local lui-même, placé sur son étiquette.
   * Il n'est pas dessiné comme un repère : ses photos s'affichent sur l'étiquette du local.
   */
  surEtiquette?: boolean;
  creeLe: string;
  creePar: string;
  modifieLe: string;
  modifiePar: string;
}

/** _data/photos/{id}.json : une photo. Sans repère (repereId null), elle est dans le panier à classer. */
export interface Photo {
  schema: number;
  id: string;
  repereId: string | null;
  /** Chemin du JPEG dans le projet (01_PHOTOS/…). */
  fichier: string;
  /** Chemin de la miniature (_data/miniatures/{id}.jpg). */
  miniature: string;
  /** Jour de la prise de vue, heure locale (AAAA-MM-JJ). */
  date: string;
  prisLe: string;
  prisPar: string;
  /** Rang de la photo pour ce repère et ce jour (1, 2…), repris dans le nom du fichier. */
  rang: number;
  largeur: number;
  hauteur: number;
  taille: number;
  empreinte: string;
  commentaire: string;
  /** appli : appareil photo de l'appli ; appareil : appareil photo du téléphone ; import : fichier importé. */
  source: 'appli' | 'appareil' | 'import';
  nomOrigine?: string;
}
