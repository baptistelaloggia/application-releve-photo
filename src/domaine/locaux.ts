/**
 * Détection des locaux à partir du texte vectoriel d'une page de plan (CONCEPTION §A.7).
 *
 * Les logiciels de dessin (Revit, Autocad…) placent dans chaque local une étiquette centrée,
 * en général sur plusieurs lignes de même hauteur :
 *     SANIT. F        ← nom (1 ou 2 lignes)
 *     SF202           ← numéro
 *     33,7 m²         ← surface
 * On regroupe donc les lignes de texte empilées et centrées, puis on garde les groupes
 * qui ressemblent à une étiquette de local. Le résultat est une proposition, que
 * l'utilisateur vérifie et corrige avant enregistrement.
 * [À VÉRIFIER] Impossible sur un PDF scanné ou dont le texte a été converti en traits.
 */

/** Morceau de texte d'une page, en points PDF, page affichée (rotation appliquée), origine en haut à gauche. */
export interface TextePlace {
  texte: string;
  /** Début de la ligne de base. */
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  /** Angle en degrés (0 = horizontal, lisible). */
  angle: number;
  /** Police (identifiant du PDF) : les noms de locaux d'un plan partagent la même (21/11/2026). */
  police?: string;
}

export type Confiance = 'forte' | 'moyenne';

export interface LocalDetecte {
  nom: string;
  numero: string | null;
  surface: number | null;
  /** Centre de l'étiquette, relatif à la page (0 à 1). */
  x: number;
  y: number;
  confiance: Confiance;
  /** Lignes d'origine, pour contrôle. */
  lignes: string[];
}

const MOTIF_SURFACE = /^(\d{1,5}(?:[  ]\d{3})*(?:[,.]\d{1,2})?)\s*m(?:²|2)$/i;
/**
 * Numéro de local : lettres puis chiffres (SF202, REST002, LT1115, LT1104.B), ou numéro en plusieurs
 * parties séparées par « - » ou « . » (SDR-RDC-42, ACC-R01-23, SAN.A-R01-01, BR.B-R04-xx),
 * toujours avec au moins un chiffre ; ou chiffres seuls (012) si l'étiquette a une surface.
 */
const MOTIF_NUMERO_LETTRES = /^(?=[^ ]*\d)(?:[A-Z]{1,5}[.-]?\d{1,5}(?:\.?[A-Z])?|[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)+(?:[.-][a-z]{1,3})?)$/;
/** Altitude (« +35.95 m », « -3,20 m NGF ») et type d'ERP (« Type L,W ») : pas des noms de local. */
const MOTIF_ALTITUDE = /^[+-]?\d+(?:[.,]\d+)?\s*m(?:\s*NGF)?$/i;
const MOTIF_TYPE_ERP = /^Type\s+[A-Z]{1,3}(?:\s*[,/]\s*[A-Z]{1,3})*$/;
/** En dessous de cette surface (m²), l'étiquette désigne une gaine ou un placard : pas de local créé. */
export const SURFACE_MINIMALE = 4;
const MOTIF_NUMERO_CHIFFRES = /^\d{2,4}[A-Z]?$/;

/** Mots qui désignent des locaux (comparés sans accents, en majuscules, en début de mot). */
const MOTS_LOCAUX = [
  'ACCUEIL', 'ARCHIVE', 'ATELIER', 'BUREAU', 'CAFETERIA', 'CHAMBRE', 'CHAUFFERIE', 'CIRC', 'CLASSE', 'COUR',
  'COURETTE', 'CTA', 'CUISINE', 'DEGAGEMENT', 'DGT', 'DOUCHE', 'ELEC', 'ENTRETIEN', 'ESCALIER', 'FOYER', 'GAINE',
  'HALL', 'INFIRMERIE', 'LINGERIE', 'LOCAL', 'LOGE', 'LOGEMENT', 'MENAGE', 'OFFICE', 'ONDULEUR', 'OPEN', 'PALIER',
  'PARKING', 'PLATEAU', 'POUBELLE', 'RANGEMENT', 'RECEPTION', 'REPROGRAPHIE', 'RESERVE', 'RESTAURANT', 'REUNION',
  'SALLE', 'SANIT', 'SAS', 'SEJOUR', 'SERVEUR', 'SOUS-STATION', 'SPRINKLER', 'STOCKAGE', 'SURPRESSEUR', 'TD',
  'TECHNIQUE', 'TERRASSE', 'TGBT', 'TISANERIE', 'TRANSFO', 'VDI', 'VELO', 'VESTIAIRE', 'WC',
];

const sansAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

function estSurface(t: string) {
  return MOTIF_SURFACE.test(t.trim());
}
function lireSurface(t: string): number | null {
  const m = MOTIF_SURFACE.exec(t.trim());
  return m ? Number(m[1].replace(/[  ]/g, '').replace(',', '.')) : null;
}
/** Les numéros de local sont en majuscules : « Esc.2s » (annotation) n'en est pas un. */
function estNumero(t: string, avecSurface: boolean) {
  const c = t.trim();
  return MOTIF_NUMERO_LETTRES.test(c) || (avecSurface && MOTIF_NUMERO_CHIFFRES.test(c));
}
function contientMotLocal(t: string) {
  const mots = sansAccents(t).toUpperCase().split(/[^A-Z0-9-]+/);
  return mots.some((m) => MOTS_LOCAUX.some((cle) => m.startsWith(cle)));
}
/** Texte sans intérêt : cotes, repères d'axes, nombres seuls. */
function estBruit(t: string) {
  const c = t.trim();
  return c === '' || /^[\d\s,.\-+/x×]+$/.test(c) || /^[A-Z]$/.test(c) || !/[A-Za-z]/.test(c);
}
/** Mention qui fait partie de l'étiquette (et la garde d'un seul tenant), mais pas du nom. */
function estMention(t: string) {
  const c = t.trim();
  return MOTIF_ALTITUDE.test(c) || MOTIF_TYPE_ERP.test(c);
}

interface Ligne {
  texte: string;
  cx: number;
  cy: number;
  h: number;
  police?: string;
}

/**
 * Regroupe les lignes empilées : même hauteur de texte (à 20 % près), centres alignés,
 * et interligne d'au plus 1,9 fois la hauteur.
 */
function regrouper(lignes: Ligne[]): Ligne[][] {
  const triees = [...lignes].sort((a, b) => a.cy - b.cy);
  const groupes: Ligne[][] = [];
  const utilisee = new Set<Ligne>();
  for (const l of triees) {
    if (utilisee.has(l)) continue;
    const groupe = [l];
    utilisee.add(l);
    let derniere = l;
    for (const s of triees) {
      if (utilisee.has(s) || s.cy <= derniere.cy) continue;
      if (s.cy - derniere.cy > 1.9 * derniere.h) continue;
      // La surface est la dernière ligne d'une étiquette : ce qui suit appartient à l'étiquette suivante.
      if (estSurface(derniere.texte)) break;
      const memeTaille = Math.abs(s.h - l.h) <= 0.2 * l.h;
      const aligne = Math.abs(s.cx - derniere.cx) <= 2.2 * l.h;
      if (memeTaille && aligne) {
        groupe.push(s);
        utilisee.add(s);
        derniere = s;
      }
    }
    groupes.push(groupe);
  }
  return groupes;
}

/**
 * Style d'une étiquette de local montrée par l'utilisateur (encadré tracé sur le plan, 23/11/2026) :
 * police et hauteur du texte du nom.
 */
export interface StyleEtiquette {
  police?: string;
  hauteur: number;
  /**
   * Pour retrouver le style sur un autre plan (24/11/2026), dont la police peut porter un autre
   * préfixe de sous-ensemble (« ABCDEF+Poppins ») : famille de la police (« Poppins ») et chasse
   * (largeur moyenne d'un caractère rapportée à la hauteur), qui distingue le gras du maigre.
   */
  famille?: string;
  chasse?: number;
  /** Texte encadré, pour le rappeler à l'utilisateur. */
  texte?: string;
}

/** Famille d'une police, sans le préfixe de sous-ensemble : « WLGMLB+Poppins » → « Poppins ». */
export const famillePolice = (police?: string) => police?.replace(/^[A-Z]{6}\+/, '');

const chasseDe = (t: { texte: string; largeur: number; hauteur: number }) => {
  const n = t.texte.trim().length;
  return n && t.hauteur > 0 && t.largeur > 0 ? t.largeur / (n * t.hauteur) : undefined;
};

/**
 * Style du nom de local encadré par l'utilisateur : le texte le plus long dans le cadre (coordonnées
 * relatives 0 à 1), hors surfaces, numéros et cotes. null si le cadre ne contient pas de nom.
 */
export function styleDansCadre(
  textes: TextePlace[],
  largeurPage: number,
  hauteurPage: number,
  cadre: { x1: number; y1: number; x2: number; y2: number },
): StyleEtiquette | null {
  const dedans = textes.filter((t) => {
    if (Math.abs(t.angle) >= 5 || !t.texte.trim() || t.hauteur <= 0) return false;
    const x = (t.x + t.largeur / 2) / largeurPage;
    const y = (t.y - t.hauteur * 0.35) / hauteurPage;
    return x >= cadre.x1 && x <= cadre.x2 && y >= cadre.y1 && y <= cadre.y2;
  });
  const noms = dedans.filter((t) => !estBruit(t.texte) && !estSurface(t.texte) && !MOTIF_NUMERO_LETTRES.test(t.texte.trim()));
  const choisi = [...(noms.length ? noms : dedans)].sort((a, b) => b.texte.trim().length - a.texte.trim().length)[0];
  if (!choisi) return null;
  const chasse = chasseDe(choisi);
  return {
    ...(choisi.police ? { police: choisi.police, famille: famillePolice(choisi.police) } : {}),
    hauteur: choisi.hauteur,
    ...(chasse ? { chasse: Math.round(chasse * 1000) / 1000 } : {}),
    texte: choisi.texte.trim(),
  };
}

/**
 * Même style que l'exemple : hauteur à 15 % près, et même police. Si la police exacte de l'exemple
 * existe sur le plan (même carnet), elle seule compte ; sinon (autre fichier), même famille de
 * police et chasse à 10 % près.
 */
function memeStyle(l: { police?: string; h: number; chasse?: number }, exemple: StyleEtiquette, policeExacte: boolean) {
  if (Math.abs(l.h - exemple.hauteur) > 0.15 * exemple.hauteur) return false;
  if (exemple.police === undefined || l.police === undefined) return true;
  if (policeExacte) return l.police === exemple.police;
  if (famillePolice(l.police) !== (exemple.famille ?? famillePolice(exemple.police))) return false;
  return exemple.chasse === undefined || l.chasse === undefined || Math.abs(l.chasse - exemple.chasse) <= 0.1 * exemple.chasse;
}

/**
 * Détecte les locaux d'une page. largeurPage et hauteurPage : taille de la page affichée, en points.
 * exemple : style d'une étiquette montrée par l'utilisateur. Seules les étiquettes dont le nom a ce
 * style sont alors retenues, même sans numéro ni surface (« Open space flex office 01 »), et les
 * autres textes (désignations de mobilier « Bureau 12,6 m² » d'un autre style…) sont écartés.
 */
export function detecterLocaux(textes: TextePlace[], largeurPage: number, hauteurPage: number, exemple?: StyleEtiquette): LocalDetecte[] {
  if (exemple) return detecterSelonExemple(textes, largeurPage, hauteurPage, exemple);
  const lignes: Ligne[] = textes
    .filter((t) => Math.abs(t.angle) < 5 && t.texte.trim() !== '' && t.hauteur > 0)
    .map((t) => ({
      texte: t.texte.trim().replace(/\s+/g, ' '),
      cx: t.x + t.largeur / 2,
      cy: t.y - t.hauteur * 0.35,
      h: t.hauteur,
      ...(t.police ? { police: t.police } : {}),
    }))
    // Les nombres courts restent : « Open Space » / « 2 » / « BR.A-R02-02 » / « 41.5 m² » (21/11/2026).
    .filter((l) => !estBruit(l.texte) || estSurface(l.texte) || MOTIF_NUMERO_CHIFFRES.test(l.texte) || /^\d{1,3}$/.test(l.texte));

  const candidats: Array<LocalDetecte & { h: number; hNom: number; police?: string; majuscules: boolean }> = [];
  for (const groupe of regrouper(lignes)) {
    const avecSurface = groupe.some((l) => estSurface(l.texte));
    let surface: number | null = null;
    // S'il y a plusieurs lignes en forme de numéro (« ESC.3 » puis « ESC203 »), le numéro est
    // la dernière, juste au-dessus de la surface ; les précédentes font partie du nom.
    const indexNumero = groupe.findLastIndex((l) => estNumero(l.texte, avecSurface) && !contientMotLocal(l.texte));
    const numero = indexNumero >= 0 ? groupe[indexNumero].texte : null;
    const noms: string[] = [];
    let policeNom: string | undefined;
    // Nombre court sous le nom, dans la même police : il termine le nom (« Open Space 2 »), sauf
    // si une autre ligne du nom le suit (« TECHNIQUE / 100 / ORANGE » : 100 est une cote).
    let chiffre: string | null = null;
    groupe.forEach((l, i) => {
      if (i === indexNumero) return;
      if (surface === null && estSurface(l.texte)) surface = lireSurface(l.texte);
      else if (!estBruit(l.texte) && !estMention(l.texte)) {
        noms.push(l.texte);
        policeNom ??= l.police;
        chiffre = null;
      } else if (/^\d{1,3}$/.test(l.texte) && noms.length > 0 && l.police === policeNom) chiffre = l.texte;
    });
    if (chiffre && noms.length < 3) noms.push(chiffre);
    if (noms.length === 0 || noms.length > 3) continue;
    // Gaines techniques, placards… : pas de local en dessous de SURFACE_MINIMALE.
    if (surface !== null && surface < SURFACE_MINIMALE) continue;
    const nom = noms.join(' ');
    // Nom seul : il doit désigner un local et rester court (longues légendes écartées). La casse
    // (majuscules ou non) est comparée plus bas à celle des étiquettes sûres du plan.
    const nomPlausible = contientMotLocal(nom) && nom.length <= 30;
    const confiance: Confiance | null = numero !== null || surface !== null ? 'forte' : nomPlausible ? 'moyenne' : null;
    if (!confiance) continue;
    const cx = groupe.reduce((s, l) => s + l.cx, 0) / groupe.length;
    const cy = (groupe[0].cy + groupe[groupe.length - 1].cy) / 2;
    candidats.push({
      nom,
      numero,
      surface,
      x: arrondir(cx / largeurPage),
      y: arrondir(cy / hauteurPage),
      confiance,
      lignes: groupe.map((l) => l.texte),
      h: groupe[0].h,
      // Style du nom : police et hauteur de sa première ligne.
      hNom: groupe.find((l) => noms.includes(l.texte))?.h ?? groupe[0].h,
      police: groupe.find((l) => noms.includes(l.texte))?.police,
      majuscules: nom === nom.toUpperCase(),
    });
  }

  // Les étiquettes « moyennes » doivent avoir une taille de texte comparable aux étiquettes sûres :
  // cela écarte les annotations en petit texte et les titres en gros caractères.
  // Référence : les étiquettes avec surface, les plus sûres. Toute étiquette nettement plus petite
  // (étiquettes de portes « RDC-P34 / 1UP / PF30 », annotations) est écartée, même avec un numéro.
  const hauteursSurfaces = candidats.filter((c) => c.surface !== null).map((c) => c.h).sort((a, b) => a - b);
  const refSurfaces = hauteursSurfaces.length >= 3 ? hauteursSurfaces[Math.floor(hauteursSurfaces.length / 2)] : null;
  if (refSurfaces !== null) {
    for (let i = candidats.length - 1; i >= 0; i--) if (candidats[i].h < 0.6 * refSurfaces) candidats.splice(i, 1);
  }

  // Zones sans locaux (21/11/2026) : cartouche et légende, reconnus à leur vocabulaire.
  const exclues = zonesExclues(lignes, largeurPage, hauteurPage);
  const horsZones = (c: { x: number; y: number }) => !exclues.some((z) => c.x >= z.x1 && c.x <= z.x2 && c.y >= z.y1 && c.y <= z.y2);
  for (let i = candidats.length - 1; i >= 0; i--) if (!horsZones(candidats[i])) candidats.splice(i, 1);

  // Style des noms de locaux (21/11/2026) : sur un plan, ils sont tous écrits avec la même police,
  // la même hauteur et la même casse. La référence est celle des étiquettes sûres (numéro ou surface).
  const fortes = candidats.filter((c) => c.confiance === 'forte');
  const style = styleDeReference(fortes);
  const conformeAuStyle = (c: (typeof candidats)[number]) =>
    !style ||
    ((style.police === undefined || c.police === undefined || c.police === style.police) &&
      c.hNom >= 0.8 * style.hauteur &&
      c.hNom <= 1.25 * style.hauteur);
  // Une étiquette sûre n'est écartée que si elle diffère à la fois par la police et par la taille
  // (titres, textes du cartouche) ; une étiquette réduite au nom doit suivre le style en tout.
  const forteAberrante = (c: (typeof candidats)[number]) =>
    !!style &&
    style.part >= 0.7 &&
    fortes.length >= 5 &&
    c.police !== undefined &&
    style.police !== undefined &&
    c.police !== style.police &&
    (c.hNom < 0.75 * style.hauteur || c.hNom > 1.35 * style.hauteur);

  const hauteursFortes = fortes.map((c) => c.h).sort((a, b) => a - b);
  const reference = hauteursFortes.length ? hauteursFortes[Math.floor(hauteursFortes.length / 2)] : null;
  // Elles doivent aussi se trouver dans la zone dessinée, c'est-à-dire près des étiquettes sûres,
  // et non dans le cartouche ou la légende, en général en marge du dessin.
  const zone = fortes.length >= 3
    ? {
        x1: Math.min(...fortes.map((c) => c.x)) - 0.1,
        x2: Math.max(...fortes.map((c) => c.x)) + 0.1,
        y1: Math.min(...fortes.map((c) => c.y)) - 0.1,
        y2: Math.max(...fortes.map((c) => c.y)) + 0.1,
      }
    : null;
  // Casse : sans référence, ou si les noms sûrs sont en majuscules, un nom seul doit l'être aussi.
  const majusculesExigees = !style || style.majuscules;
  return candidats
    .filter((c) =>
      c.confiance === 'forte'
        ? !forteAberrante(c)
        : (reference === null || (c.h >= 0.7 * reference && c.h <= 1.6 * reference)) &&
          (zone === null || (c.x >= zone.x1 && c.x <= zone.x2 && c.y >= zone.y1 && c.y <= zone.y2)) &&
          conformeAuStyle(c) &&
          (!majusculesExigees || c.majuscules),
    )
    .map(({ h: _h, hNom: _hNom, police: _police, majuscules: _majuscules, ...c }) => c);
}

/** Détection guidée par une étiquette exemple (voir detecterLocaux). */
function detecterSelonExemple(textes: TextePlace[], largeurPage: number, hauteurPage: number, exemple: StyleEtiquette): LocalDetecte[] {
  const toutes: Array<Ligne & { chasse?: number }> = textes
    .filter((t) => Math.abs(t.angle) < 5 && t.texte.trim() !== '' && t.hauteur > 0)
    .map((t) => ({
      texte: t.texte.trim().replace(/\s+/g, ' '),
      cx: t.x + t.largeur / 2,
      cy: t.y - t.hauteur * 0.35,
      h: t.hauteur,
      ...(t.police ? { police: t.police } : {}),
      chasse: chasseDe(t),
    }));
  const exclues = zonesExclues(toutes, largeurPage, hauteurPage);
  const policeExacte = exemple.police !== undefined && toutes.some((l) => l.police === exemple.police);
  const style = (l: Ligne & { chasse?: number }) => memeStyle(l, exemple, policeExacte);
  // Lignes retenues : celles du style de l'exemple (le nom), et les numéros et surfaces voisins.
  const lignes = toutes.filter(
    (l) => style(l) || estSurface(l.texte) || MOTIF_NUMERO_LETTRES.test(l.texte) || /^\d{1,3}$/.test(l.texte),
  );
  const resultat: LocalDetecte[] = [];
  for (const groupe of regrouper(lignes)) {
    const noms = groupe.filter((l) => style(l) && !estSurface(l.texte) && (!estBruit(l.texte) || /^\d{1,3}$/.test(l.texte)));
    if (!noms.some((l) => !estBruit(l.texte)) || noms.length > 4) continue;
    const surfaceLigne = groupe.find((l) => estSurface(l.texte));
    const surface = surfaceLigne ? lireSurface(surfaceLigne.texte) : null;
    if (surface !== null && surface < SURFACE_MINIMALE) continue;
    const numeroLigne = groupe.find((l) => !noms.includes(l) && MOTIF_NUMERO_LETTRES.test(l.texte));
    const cx = noms.reduce((s, l) => s + l.cx, 0) / noms.length;
    const cy = (groupe[0].cy + groupe[groupe.length - 1].cy) / 2;
    const c = { x: arrondir(cx / largeurPage), y: arrondir(cy / hauteurPage) };
    if (exclues.some((z) => c.x >= z.x1 && c.x <= z.x2 && c.y >= z.y1 && c.y <= z.y2)) continue;
    resultat.push({
      nom: noms.map((l) => l.texte).join(' '),
      numero: numeroLigne?.texte ?? null,
      surface,
      ...c,
      confiance: 'forte',
      lignes: groupe.map((l) => l.texte),
    });
  }
  return resultat;
}

/**
 * Style des noms des étiquettes sûres : police la plus fréquente (et sa part), hauteur médiane,
 * casse dominante. null s'il y a moins de 2 étiquettes sûres.
 */
function styleDeReference(fortes: Array<{ hNom: number; police?: string; majuscules: boolean }>) {
  if (fortes.length < 2) return null;
  const compte = new Map<string | undefined, number>();
  for (const c of fortes) compte.set(c.police, (compte.get(c.police) ?? 0) + 1);
  const [police, n] = [...compte].sort((a, b) => b[1] - a[1])[0];
  const memes = fortes.filter((c) => c.police === police);
  const hauteurs = memes.map((c) => c.hNom).sort((a, b) => a - b);
  return {
    police,
    part: n / fortes.length,
    hauteur: hauteurs[Math.floor(hauteurs.length / 2)],
    majuscules: memes.filter((c) => c.majuscules).length >= 0.7 * memes.length,
  };
}

/** Mots du cartouche (comparés sans accents ni casse, en début de ligne). */
const MOTS_CARTOUCHE = [
  'phase', 'indice', 'echelle', 'scale', 'dessine par', 'drawn by', 'verifie par', 'checked by', 'maitre d ouvrage',
  'maitrise d ouvrage', 'architecte', 'n projet', 'nprojet', 'project no', 'titre du dessin', 'emetteur', 'issued by',
  'copyright', 'nom de fichier', 'file name', 'bureau de controle', 'economiste', 'preventionniste', 'paysagiste',
  'amo ', 'bet ', 'maitre d oeuvre', 'moe ', 'date de creation', 'revision', 'modifications', 'n plan', 'numero de plan',
];

interface Zone {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Zones du plan où il n'y a pas de locaux, en coordonnées relatives (0 à 1) :
 * - le cartouche : au moins 4 mots du cartouche (« Phase », « Indice », « Échelle », « Dessiné par »…)
 *   groupés ; la zone qui les entoure est prolongée jusqu'au bord de la page le plus proche ;
 * - la légende : sous le titre « LÉGENDE », le bloc des lignes qui le suivent.
 * [À VÉRIFIER sur d'autres modèles de cartouche]
 */
export function zonesExclues(lignes: Array<{ texte: string; cx: number; cy: number }>, largeurPage: number, hauteurPage: number): Zone[] {
  const cle = (t: string) =>
    sansAccents(t)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const pts = lignes.map((l) => ({ ...l, x: l.cx / largeurPage, y: l.cy / hauteurPage, k: `${cle(l.texte)} ` }));
  const zones: Zone[] = [];

  // Cartouche.
  const mots = pts.filter((p) => MOTS_CARTOUCHE.some((m) => p.k.startsWith(m.endsWith(' ') ? m : `${m} `)));
  if (mots.length >= 4) {
    const mx = mots.map((p) => p.x).sort((a, b) => a - b)[Math.floor(mots.length / 2)];
    const my = mots.map((p) => p.y).sort((a, b) => a - b)[Math.floor(mots.length / 2)];
    const proches = mots.filter((p) => Math.abs(p.x - mx) <= 0.25 && Math.abs(p.y - my) <= 0.35);
    if (proches.length >= 4) {
      const z = {
        x1: Math.min(...proches.map((p) => p.x)) - 0.015,
        x2: Math.max(...proches.map((p) => p.x)) + 0.015,
        y1: Math.min(...proches.map((p) => p.y)) - 0.02,
        y2: Math.max(...proches.map((p) => p.y)) + 0.02,
      };
      // Le cartouche touche un bord de la page : la zone y est prolongée.
      if (z.x2 > 0.75) z.x2 = 1;
      if (z.x1 < 0.25) z.x1 = 0;
      if (z.y2 > 0.75) z.y2 = 1;
      if (z.y1 < 0.25) z.y1 = 0;
      zones.push(z);
    }
  }

  // Légende : le titre, puis les lignes situées dessous, à sa droite, jusqu'à un vide.
  for (const titre of pts.filter((p) => /^(legende|legend)$/.test(cle(p.texte)))) {
    const z = { x1: titre.x - 0.015, x2: titre.x + 0.02, y1: titre.y - 0.015, y2: titre.y + 0.015 };
    const dessous = pts
      .filter((p) => p !== titre && p.y > titre.y && p.y < titre.y + 0.25 && p.x >= titre.x - 0.02 && p.x <= titre.x + 0.4)
      .sort((a, b) => a.y - b.y);
    for (const p of dessous) {
      if (p.y - z.y2 > 0.05) break; // vide : fin de la légende
      z.x2 = Math.max(z.x2, p.x + 0.02);
      z.y2 = Math.max(z.y2, p.y + 0.015);
    }
    zones.push(z);
  }
  return zones;
}

function arrondir(v: number) {
  return Math.round(v * 100000) / 100000;
}

/** Nom sans son numéro d'ordre final (« LT 02 » → « LT ») : sert à reconnaître un local déjà enregistré. */
export const nomDeBase = (nom: string) => nom.trim().replace(/\s+/g, ' ').replace(/ \d{2,3}$/, '');

/**
 * Noms des locaux détectés sur un plan (17/11/2026) : seul le nom est gardé. Un nom porté par
 * plusieurs locaux du plan reçoit un numéro d'ordre : « LT 01 », « LT 02 »… (de haut en bas, puis
 * de gauche à droite). Les numéros déjà pris sur le plan sont sautés ; un local déjà enregistré
 * n'est jamais renommé.
 */
export function numeroterNomsEnDouble<T extends { nom: string; x: number; y: number }>(detectes: T[], nomsExistants: string[]): T[] {
  const cle = (n: string) => n.trim().replace(/\s+/g, ' ').toUpperCase();
  const existants = nomsExistants.map(cle);
  const groupes = new Map<string, T[]>();
  for (const d of detectes) {
    const k = cle(d.nom);
    groupes.set(k, [...(groupes.get(k) ?? []), d]);
  }
  const renommes = new Map<T, string>();
  for (const [k, groupe] of groupes) {
    const pris = new Set<number>();
    let dejaSurLePlan = false;
    for (const e of existants) {
      if (e === k) dejaSurLePlan = true;
      const m = e.startsWith(`${k} `) ? /^ (\d{2,3})$/.exec(e.slice(k.length)) : null;
      if (m) {
        pris.add(Number(m[1]));
        dejaSurLePlan = true;
      }
    }
    if (groupe.length === 1 && !dejaSurLePlan) continue;
    const tries = [...groupe].sort((a, b) => Math.round((a.y - b.y) * 50) || a.x - b.x);
    let rang = 1;
    for (const d of tries) {
      while (pris.has(rang)) rang++;
      pris.add(rang);
      renommes.set(d, `${d.nom.trim().replace(/\s+/g, ' ')} ${String(rang).padStart(2, '0')}`);
    }
  }
  return detectes.map((d) => (renommes.has(d) ? { ...d, nom: renommes.get(d)! } : d));
}

/**
 * Numéro automatique d'un local, unique dans le projet : préfixe du niveau, puis
 * rang à 2 chiffres (3 au-delà de 99). Exemples : R+2 → « R2-01 », RDC → « RDC-03 »,
 * SS1 → « SS1-12 », R+4-MEZZANINE → « R4-MEZ-01 ».
 */
export function proposerNumeroLocal(codeNiveau: string, numerosExistants: Iterable<string>): string {
  const prefixe = codeNiveau.replace(/\+/g, '').slice(0, 6).replace(/-+$/, '');
  const pris = new Set([...numerosExistants].map((n) => n.toUpperCase()));
  for (let rang = 1; ; rang++) {
    const numero = `${prefixe}-${String(rang).padStart(2, '0')}`;
    if (!pris.has(numero)) return numero;
  }
}
