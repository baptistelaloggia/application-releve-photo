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

/**
 * Nom d'un local tel qu'il figure dans les noms de dossiers et de fichiers : « Local TGBT » →
 * « Local-TGBT », « SANIT. F » → « SANIT-F », 30 caractères au plus.
 * Depuis le 18/11/2026, le numéro du local n'y figure plus (CONCEPTION §A.6).
 */
export function nomLocalPourFichier(nom: string): string {
  return nettoyerPourNom(nom.replace(/\./g, ' ')).slice(0, 30).replace(/-+$/, '') || 'Local';
}

/** Dossier des photos hors local, sous le dossier du niveau. */
export const DOSSIER_HORS_LOCAL = 'Hors-local';

/**
 * Dossier d'un local sous le dossier de son niveau : « R+1.Local-TGBT », ou « R+1.Hors-local »
 * pour un repère qui n'est rattaché à aucun local.
 */
export function nomDossierLocal(codeNiveau: string, local: { nom: string } | null): string {
  return `${codeNiveau}.${local ? nomLocalPourFichier(local.nom) : DOSSIER_HORS_LOCAL}`;
}

/**
 * Nom d'une photo : « XXX_R+1.Local-TGBT_P001_2026-10-30_01.jpg » ; hors local :
 * « XXX_R+1_P001_2026-10-30_01.jpg ».
 * Triés par ordre alphabétique, les noms d'un même repère se suivent dans l'ordre chronologique.
 */
export function nomFichierPhoto(
  codeAffaire: string,
  codeNiveau: string,
  nomLocal: string | null,
  numeroRepere: string,
  date: string,
  rang: number,
  extension = 'jpg',
): string {
  const lieu = nomLocal === null ? codeNiveau : `${codeNiveau}.${nomLocalPourFichier(nomLocal)}`;
  return `${codeAffaire}_${lieu}_${numeroRepere}_${date}_${String(rang).padStart(2, '0')}.${extension}`;
}

/** Nom d'une photo du panier : « XXX_A-CLASSER_2026-10-30_143512_3f2a.jpg » (unique, triable). */
export function nomFichierPhotoAClasser(codeAffaire: string, prisLe: Date, id: string, extension = 'jpg'): string {
  const d = dateLocale(prisLe);
  const h = [prisLe.getHours(), prisLe.getMinutes(), prisLe.getSeconds()].map((v) => String(v).padStart(2, '0')).join('');
  return `${codeAffaire}_A-CLASSER_${d}_${h}_${id.slice(0, 4)}.${extension}`;
}

/**
 * Fichiers rangés à côté d'une prise de vue, de même nom suivi d'un suffixe :
 * « …_P001_2026-11-17_01.jpg », puis « …_01_annote.jpg » (copie annotée) et « …_01_note.m4a »
 * (note vocale). Triés par nom, ils suivent la photo et précèdent la suivante (« . » < « _ »).
 */
export function cheminAnnotee(fichierPhoto: string): string {
  return fichierPhoto.replace(/\.[^./]+$/, '') + '_annote.jpg';
}

export function cheminNoteVocale(fichierPhoto: string, extension: string): string {
  return fichierPhoto.replace(/\.[^./]+$/, '') + `_note.${extension}`;
}

/** Vrai pour un fichier rangé à côté d'une prise de vue (copie annotée, note vocale). */
export function estFichierAnnexe(chemin: string): boolean {
  return /_(annote\.jpg|note\.(wav|m4a|webm|ogg))$/i.test(chemin);
}

/** Date locale au format AAAA-MM-JJ. */
export function dateLocale(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Numéro de repère : « P001 », « P042 », « P1234 ». */
export function numeroRepere(rang: number): string {
  return `P${String(rang).padStart(3, '0')}`;
}
