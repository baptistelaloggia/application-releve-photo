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
  exports: '02_EXPORTS',
  donnees: '_data',
} as const;
