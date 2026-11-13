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

/** Détecte les locaux d'une page. largeurPage et hauteurPage : taille de la page affichée, en points. */
export function detecterLocaux(textes: TextePlace[], largeurPage: number, hauteurPage: number): LocalDetecte[] {
  const lignes: Ligne[] = textes
    .filter((t) => Math.abs(t.angle) < 5 && t.texte.trim() !== '' && t.hauteur > 0)
    .map((t) => ({
      texte: t.texte.trim().replace(/\s+/g, ' '),
      cx: t.x + t.largeur / 2,
      cy: t.y - t.hauteur * 0.35,
      h: t.hauteur,
    }))
    .filter((l) => !estBruit(l.texte) || estSurface(l.texte) || MOTIF_NUMERO_CHIFFRES.test(l.texte));

  const candidats: Array<LocalDetecte & { h: number }> = [];
  for (const groupe of regrouper(lignes)) {
    const avecSurface = groupe.some((l) => estSurface(l.texte));
    let surface: number | null = null;
    // S'il y a plusieurs lignes en forme de numéro (« ESC.3 » puis « ESC203 »), le numéro est
    // la dernière, juste au-dessus de la surface ; les précédentes font partie du nom.
    const indexNumero = groupe.findLastIndex((l) => estNumero(l.texte, avecSurface) && !contientMotLocal(l.texte));
    const numero = indexNumero >= 0 ? groupe[indexNumero].texte : null;
    const noms: string[] = [];
    groupe.forEach((l, i) => {
      if (i === indexNumero) return;
      if (surface === null && estSurface(l.texte)) surface = lireSurface(l.texte);
      else if (!estBruit(l.texte) && !estMention(l.texte)) noms.push(l.texte);
    });
    if (noms.length === 0 || noms.length > 3) continue;
    // Gaines techniques, placards… : pas de local en dessous de SURFACE_MINIMALE.
    if (surface !== null && surface < SURFACE_MINIMALE) continue;
    const nom = noms.join(' ');
    // Nom seul : il doit désigner un local, être en majuscules et rester court
    // (« Bureau de Contrôle » dans le cartouche, longues légendes : écartés).
    const nomPlausible = contientMotLocal(nom) && nom === nom.toUpperCase() && nom.length <= 30;
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
  const hauteursFortes = candidats.filter((c) => c.confiance === 'forte').map((c) => c.h).sort((a, b) => a - b);
  const reference = hauteursFortes.length ? hauteursFortes[Math.floor(hauteursFortes.length / 2)] : null;
  // Elles doivent aussi se trouver dans la zone dessinée, c'est-à-dire près des étiquettes sûres,
  // et non dans le cartouche ou la légende, en général en marge du dessin.
  const fortes = candidats.filter((c) => c.confiance === 'forte');
  const zone = fortes.length >= 3
    ? {
        x1: Math.min(...fortes.map((c) => c.x)) - 0.1,
        x2: Math.max(...fortes.map((c) => c.x)) + 0.1,
        y1: Math.min(...fortes.map((c) => c.y)) - 0.1,
        y2: Math.max(...fortes.map((c) => c.y)) + 0.1,
      }
    : null;
  return candidats
    .filter(
      (c) =>
        c.confiance === 'forte' ||
        ((reference === null || (c.h >= 0.7 * reference && c.h <= 1.6 * reference)) &&
          (zone === null || (c.x >= zone.x1 && c.x <= zone.x2 && c.y >= zone.y1 && c.y <= zone.y2))),
    )
    .map(({ h: _h, ...c }) => c);
}

function arrondir(v: number) {
  return Math.round(v * 100000) / 100000;
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
