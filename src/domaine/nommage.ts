/**
 * Règles de nommage des dossiers et fichiers (CONCEPTION §A.6 et §A.6 bis).
 * Les noms produits doivent rester valides sous Windows, dans un zip et dans SharePoint.
 */

/** Caractères interdits sous Windows ou gênants dans SharePoint. */
const INTERDITS = /[<>:"/\\|?*#%&{}~\u0000-\u001f]/g;

/**
 * Nettoie un texte libre pour en faire un morceau de nom de fichier :
 * accents retirés, espaces remplacés par des tirets, caractères interdits supprimés.
 * Exemple : « Lycée Jean Moulin » → « Lycee-Jean-Moulin ».
 */
export function nettoyerPourNom(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(INTERDITS, '')
    .replace(/_/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/** Code d'affaire (le « XXX » des noms) : lettres et chiffres, en majuscules. */
export function normaliserCodeAffaire(saisie: string): string {
  return saisie
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
}

/** Indice de plan : lettres et chiffres en majuscules (« b » → « B »). */
export function normaliserIndice(saisie: string): string {
  return saisie.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function estIndiceValide(indice: string): boolean {
  return /^[A-Z0-9]{1,4}$/.test(indice);
}

/** Dossier racine du projet : « 2026-XXX_NomProjet ». */
export function nomDossierProjet(annee: number, codeAffaire: string, nomProjet: string): string {
  return `${annee}-${codeAffaire}_${nettoyerPourNom(nomProjet)}`;
}

/** Plan courant dans 00_PLANS : « XXX_R+1.pdf ». */
export function nomFichierPlan(codeAffaire: string, codeNiveau: string): string {
  return `${codeAffaire}_${codeNiveau}.pdf`;
}

/** Ancien indice archivé dans 00_PLANS/_ANCIENS : « XXX_R+1_Ind-A.pdf ». */
export function nomFichierPlanArchive(codeAffaire: string, codeNiveau: string, indice: string): string {
  return `${codeAffaire}_${codeNiveau}_Ind-${indice}.pdf`;
}

/** Devine l'indice depuis un nom de fichier (« …_Ind-B.pdf », « …_IND_C.pdf »). */
export function devinerIndice(nomFichier: string): string | null {
  const m = /(?:^|[^A-Z])IND(?:ICE)?[-_ .]?([A-Z0-9]{1,2})(?=$|[^A-Z0-9])/i.exec(nomFichier.replace(/\.pdf$/i, ''));
  return m ? m[1].toUpperCase() : null;
}

/** Noms des dossiers de premier niveau du projet. */
export const DOSSIERS = {
  plans: '00_PLANS',
  plansAnciens: '_ANCIENS',
  photos: '01_PHOTOS',
  /** Sous 01_PHOTOS : photos prises sans repère, en attente de classement. */
  aClasser: '_A-CLASSER',
  exports: '02_EXPORTS',
  donnees: '_data',
} as const;

/** Numéro de local utilisé dans les noms quand le repère est hors local. */
export const NUMERO_HORS_LOCAL = '000';

/**
 * Dossier d'un local sous le dossier de son niveau : « R+1.012_Local-TGBT »,
 * ou « R+1.000_Hors-local » pour un repère qui n'est rattaché à aucun local.
 */
export function nomDossierLocal(codeNiveau: string, local: { numero: string | null; nom: string } | null): string {
  if (!local) return `${codeNiveau}.${NUMERO_HORS_LOCAL}_Hors-local`;
  return `${codeNiveau}.${local.numero ?? NUMERO_HORS_LOCAL}_${nettoyerPourNom(local.nom.replace(/\./g, ' ')).slice(0, 40) || 'Local'}`;
}

/**
 * Nom d'une photo : « XXX_R+1.012_P001_2026-10-30_01.jpg ».
 * Triés par ordre alphabétique, les noms d'un même repère se suivent dans l'ordre chronologique.
 */
export function nomFichierPhoto(
  codeAffaire: string,
  codeNiveau: string,
  numeroLocal: string | null,
  numeroRepere: string,
  date: string,
  rang: number,
): string {
  return `${codeAffaire}_${codeNiveau}.${numeroLocal ?? NUMERO_HORS_LOCAL}_${numeroRepere}_${date}_${String(rang).padStart(2, '0')}.jpg`;
}

/** Nom d'une photo du panier : « XXX_A-CLASSER_2026-10-30_143512_3f2a.jpg » (unique, triable). */
export function nomFichierPhotoAClasser(codeAffaire: string, prisLe: Date, id: string): string {
  const d = dateLocale(prisLe);
  const h = [prisLe.getHours(), prisLe.getMinutes(), prisLe.getSeconds()].map((v) => String(v).padStart(2, '0')).join('');
  return `${codeAffaire}_A-CLASSER_${d}_${h}_${id.slice(0, 4)}.jpg`;
}

/** Date locale au format AAAA-MM-JJ. */
export function dateLocale(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Numéro de repère : « P001 », « P042 », « P1234 ». */
export function numeroRepere(rang: number): string {
  return `P${String(rang).padStart(3, '0')}`;
}
