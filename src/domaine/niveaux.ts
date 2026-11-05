/**
 * Codes de niveau (CONCEPTION §A.6 bis) :
 *   SS1, SS2…  (sous-sols, toujours numérotés, même s'il n'y en a qu'un ; SS1 est le plus proche du RDC)
 *   ES  (entresol, entre les sous-sols et le RDC)
 *   RDC
 *   R+1, R+2, …
 *   TT  (toiture)
 */

const MOTIF_CODE = /^(SS[1-9]\d?|ES|RDC|R\+[1-9]\d?|TT)$/;

/** Indique si le code respecte la convention. */
export function estCodeNiveauValide(code: string): boolean {
  return MOTIF_CODE.test(code);
}

/** Met un code saisi au propre (majuscules, espaces retirés, « R1 » → « R+1 »). */
export function normaliserCodeNiveau(saisie: string): string {
  const c = saisie.toUpperCase().replace(/\s+/g, '');
  const etage = /^R\+?0*([1-9]\d?)$/.exec(c);
  if (etage) return `R+${etage[1]}`;
  const ss = /^SS0*([1-9]\d?)$/.exec(c);
  if (ss) return `SS${ss[1]}`;
  if (c === 'SS' || c === 'SOUS-SOL' || c === 'SOUSSOL') return 'SS1';
  if (c === 'R+0' || c === 'R0') return 'RDC';
  if (c === 'ENTRESOL') return 'ES';
  if (c === 'TOIT' || c === 'TOITURE') return 'TT';
  return c;
}

/**
 * Rang du niveau dans le bâtiment, du plus bas au plus haut.
 * SS2 < SS1 < ES < RDC < R+1 < … < TT.
 */
export function rangNiveau(code: string): number {
  if (code === 'RDC') return 0;
  if (code === 'ES') return -0.5;
  if (code === 'TT') return 1000;
  const ss = /^SS(\d+)$/.exec(code);
  if (ss) return -Number(ss[1]);
  const etage = /^R\+(\d+)$/.exec(code);
  if (etage) return Number(etage[1]);
  throw new Error(`Code de niveau non conforme : « ${code} »`);
}

/** Trie des codes dans l'ordre du bâtiment (du bas vers le haut). */
export function trierNiveaux(codes: readonly string[]): string[] {
  return [...codes].sort((a, b) => rangNiveau(a) - rangNiveau(b));
}

/**
 * Vérifie qu'une liste de codes est cohérente.
 * Renvoie la liste des problèmes (vide si tout va bien).
 */
export function controlerNiveaux(codes: readonly string[]): string[] {
  const problemes: string[] = [];
  const vus = new Set<string>();
  for (const code of codes) {
    if (!estCodeNiveauValide(code)) problemes.push(`Code de niveau non conforme : « ${code} ».`);
    if (vus.has(code)) problemes.push(`Niveau en double : « ${code} ».`);
    vus.add(code);
  }
  return problemes;
}

/**
 * Noms des dossiers de niveau sous 01_PHOTOS/ : numéro d'ordre à 2 chiffres
 * devant le code, pour que l'Explorateur Windows les affiche dans l'ordre du bâtiment.
 * Exemple : SS1, RDC, R+1 → { SS1: "00_SS1", RDC: "01_RDC", "R+1": "02_R+1" }.
 */
export function nomsDossiersNiveaux(codes: readonly string[]): Map<string, string> {
  const resultat = new Map<string, string>();
  trierNiveaux(codes).forEach((code, i) => {
    resultat.set(code, `${String(i).padStart(2, '0')}_${code}`);
  });
  return resultat;
}

/** Reconnaît un dossier de niveau (« 03_R+2 ») et renvoie son code, sinon null. */
export function codeDepuisNomDossier(nom: string): string | null {
  const m = /^\d{2}_(.+)$/.exec(nom);
  return m && estCodeNiveauValide(m[1]) ? m[1] : null;
}

/** Construit la liste type : n sous-sols, entresol éventuel, RDC, m étages, toiture éventuelle. */
export function genererNiveaux(sousSols: number, etages: number, toiture: boolean, entresol = false): string[] {
  const codes: string[] = [];
  for (let i = sousSols; i >= 1; i--) codes.push(`SS${i}`);
  if (entresol) codes.push('ES');
  codes.push('RDC');
  for (let i = 1; i <= etages; i++) codes.push(`R+${i}`);
  if (toiture) codes.push('TT');
  return codes;
}

/** Libellé en clair, pour l'affichage. */
export function libelleNiveau(code: string): string {
  if (code === 'RDC') return 'Rez-de-chaussée';
  if (code === 'ES') return 'Entresol';
  if (code === 'TT') return 'Toiture';
  const ss = /^SS(\d+)$/.exec(code);
  if (ss) return `Sous-sol ${ss[1]}`;
  const etage = /^R\+(\d+)$/.exec(code);
  if (etage) return `Étage ${etage[1]}`;
  return code;
}

/**
 * Devine le niveau depuis un nom de fichier PDF quelconque.
 * Renvoie null si rien de sûr n'est trouvé : l'utilisateur choisit alors lui-même.
 */
export function devinerNiveau(nomFichier: string): string | null {
  const n = nomFichier
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.PDF$/, '');
  const sep = '(?:^|[^A-Z0-9+])';
  const fin = '(?=$|[^A-Z0-9])';
  const essais: Array<[RegExp, (m: RegExpExecArray) => string]> = [
    [new RegExp(`${sep}R\\+?0*([1-9]\\d?)${fin}`), (m) => `R+${m[1]}`],
    [new RegExp(`${sep}SS0*([1-9]\\d?)${fin}`), (m) => `SS${m[1]}`],
    [new RegExp(`${sep}SOUS[-_ ]?SOL[-_ ]?0*([1-9])${fin}`), (m) => `SS${m[1]}`],
    [new RegExp(`${sep}(?:RDC|R\\+?0+|REZ[-_ ]DE[-_ ]CHAUSSEE)${fin}`), () => 'RDC'],
    [new RegExp(`${sep}(?:ES|ENTRESOL)${fin}`), () => 'ES'],
    [new RegExp(`${sep}(?:SS|SOUS[-_ ]?SOL)${fin}`), () => 'SS1'],
    [new RegExp(`${sep}(?:TT|TOITURE|TOIT|TERRASSE)${fin}`), () => 'TT'],
    [new RegExp(`${sep}ETAGE[-_ ]?0*([1-9]\\d?)${fin}`), (m) => `R+${m[1]}`],
  ];
  for (const [motif, conversion] of essais) {
    const m = motif.exec(n);
    if (m) return conversion(m);
  }
  return null;
}

/**
 * Devine le niveau d'une page de plan d'après son texte, en cherchant le titre
 * « PLAN DE NIVEAU - R+2 », « NIVEAU : SS1 »… Le reste du texte d'une page
 * (cartouche, légendes, « terrasse R+5 ») est trop ambigu : on ne s'y fie pas.
 */
export function devinerNiveauPage(texte: string): string | null {
  const t = texte.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const motif = /(?:PLAN (?:DE |DU )?)?NIVEAU ?[-–:]? ?((?:R ?\+ ?\d{1,2})|SS ?\d?|RDC|ES|ENTRESOL|TT|TOIT(?:URE)?|REZ[- ]DE[- ]CHAUSSEE|SOUS[- ]SOL ?\d?)(?=$|[^A-Z0-9+])/g;
  const trouves = new Set<string>();
  for (const m of t.matchAll(motif)) {
    let code = m[1].replace(/ /g, '');
    if (/^REZ/.test(code)) code = 'RDC';
    const ss = /^SOUS-?SOL(\d?)$/.exec(code);
    if (ss) code = ss[1] ? `SS${ss[1]}` : 'SS1';
    code = normaliserCodeNiveau(code);
    if (estCodeNiveauValide(code)) trouves.add(code);
  }
  // Plusieurs niveaux différents en titre : on laisse l'utilisateur choisir.
  return trouves.size === 1 ? [...trouves][0] : null;
}
