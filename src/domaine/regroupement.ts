/**
 * Regroupement des photos du panier par lieu probable (CONCEPTION §A.6 nonies, 19/11/2026).
 *
 * Les photos prises hors de l'appli (appareil photo du téléphone, importées ensuite) n'ont pas de
 * repère. Pour les rattacher vite à un local, on les regroupe d'après trois indices :
 * - l'heure de prise de vue (EXIF) : des photos prises à quelques secondes d'intervalle sont
 *   presque toujours dans le même local ;
 * - la ressemblance visuelle : vecteur calculé sur l'appareil par un petit réseau de neurones
 *   (src/photo/reconnaissance.ts), comparé par similarité cosinus ;
 * - la position GPS (EXIF), seulement comme indice contraire : deux photos à plus de 80 m l'une de
 *   l'autre ne sont pas dans le même local. Elle ne rapproche jamais deux photos, car en sous-sol le
 *   téléphone garde souvent la dernière position captée dehors.
 *
 * Méthode : classification ascendante hiérarchique à « lien moyen ». On part d'un groupe par photo,
 * puis on réunit tant qu'il le faut les deux groupes dont l'affinité moyenne (moyenne sur toutes les
 * paires de photos) est la plus forte, jusqu'à ce qu'elle passe sous le seuil. Un seuil haut donne des
 * groupes plus fins, un seuil bas des groupes plus larges. Règles pures, sans navigateur : testées.
 */

export interface PositionGps {
  lat: number;
  lon: number;
  /** Incertitude horizontale en mètres, si le téléphone l'a enregistrée. */
  precision?: number;
}

export interface PhotoARegrouper {
  id: string;
  /**
   * Instant de prise de vue, en millisecondes (Date.getTime()), ou null s'il n'est pas sûr (photo
   * importée sans date EXIF : la date du fichier est celle du transfert, pas de la prise de vue).
   */
  instant: number | null;
  gps?: PositionGps | null;
  /** Vecteur visuel normé (longueur 1), ou null si la reconnaissance n'est pas disponible. */
  vecteur?: ArrayLike<number> | null;
}

export interface ReglagesRegroupement {
  /** Affinité moyenne minimale pour réunir deux groupes (0,25 : groupes larges ; 0,70 : groupes fins). */
  seuil: number;
  /** Bonus d'affinité de deux photos prises au même instant ; il décroît ensuite avec l'écart de temps. */
  bonusTemps: number;
  /** Constante de temps du bonus, en secondes (bonus divisé par e à chaque tranche). */
  constanteTemps: number;
  /** Bonus supplémentaire des photos prises en rafale (quelques secondes d'écart : même endroit). */
  bonusRafale: number;
  constanteRafale: number;
  /** Sans vecteur visuel : constante de temps de l'affinité, qui ne repose plus que sur l'heure. */
  constanteTempsSeul: number;
  /** Au-delà de cette distance (en mètres, précision comprise), deux photos sont dans deux lieux différents. */
  distanceGpsMax: number;
}

export const REGLAGES_REGROUPEMENT: ReglagesRegroupement = {
  seuil: 0.45,
  bonusTemps: 0.35,
  constanteTemps: 120,
  bonusRafale: 0.25,
  constanteRafale: 15,
  // exp(-180 / 225) ≈ 0,45 : sans reconnaissance, deux photos à 3 min d'intervalle sont à la limite.
  constanteTempsSeul: 225,
  distanceGpsMax: 80,
};

/** Bornes du réglage « Groupes plus larges ↔ plus fins » proposé à l'écran. */
export const SEUIL_MIN = 0.25;
export const SEUIL_MAX = 0.7;

/** Distance entre deux positions GPS, en mètres (formule de haversine). */
export function distanceGps(a: PositionGps, b: PositionGps): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Similarité cosinus de deux vecteurs normés (produit scalaire), de -1 à 1. */
export function similarite(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let k = 0; k < n; k++) s += a[k] * b[k];
  return s;
}

/** Deux positions GPS assez précises et trop éloignées pour être dans le même local. */
export function gpsIncompatibles(a: PositionGps | null | undefined, b: PositionGps | null | undefined, distanceMax: number): boolean {
  if (!a || !b) return false;
  const marge = (a.precision ?? 0) + (b.precision ?? 0);
  return distanceGps(a, b) > distanceMax + marge;
}

/**
 * Affinité de deux photos : plus elle est grande, plus elles ont de chances d'être dans le même local.
 * - avec les deux vecteurs : similarité visuelle + bonus de proximité dans le temps (sur quelques
 *   minutes) + bonus de rafale (sur quelques secondes) ;
 * - sinon : proximité dans le temps seule (1 au même instant, 0,45 à 3 min d'intervalle) ;
 * - heure inconnue (pour l'une des deux) : ressemblance seule, ou 0 sans reconnaissance ;
 * - GPS incompatibles : 1 de moins, ce qui empêche en pratique de les réunir.
 */
export function affinite(a: PhotoARegrouper, b: PhotoARegrouper, r: ReglagesRegroupement = REGLAGES_REGROUPEMENT): number {
  // Heure inconnue : écart infini, aucun bonus de temps.
  const ecart = a.instant === null || b.instant === null ? Infinity : Math.abs(a.instant - b.instant) / 1000;
  const valeur =
    a.vecteur && b.vecteur
      ? similarite(a.vecteur, b.vecteur) +
        r.bonusTemps * Math.exp(-ecart / r.constanteTemps) +
        r.bonusRafale * Math.exp(-ecart / r.constanteRafale)
      : Math.exp(-ecart / r.constanteTempsSeul);
  return gpsIncompatibles(a.gps, b.gps, r.distanceGpsMax) ? valeur - 1 : valeur;
}

/**
 * Regroupe les photos. Rend des groupes d'identifiants, chacun trié du plus ancien au plus récent ;
 * les groupes sont triés par l'heure de leur première photo (heure inconnue : à la fin).
 */
export function regrouperPhotos(photos: readonly PhotoARegrouper[], reglages: Partial<ReglagesRegroupement> = {}): string[][] {
  const r = { ...REGLAGES_REGROUPEMENT, ...reglages };
  const n = photos.length;
  if (n === 0) return [];
  // somme[i][j] : somme des affinités entre toutes les photos du groupe i et celles du groupe j.
  const somme: Float64Array[] = [];
  for (let i = 0; i < n; i++) somme.push(new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = affinite(photos[i], photos[j], r);
      somme[i][j] = v;
      somme[j][i] = v;
    }
  }
  const membres: number[][] = photos.map((_, i) => [i]);
  const actif = new Array<boolean>(n).fill(true);
  for (;;) {
    let meilleur = -Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i++) {
      if (!actif[i]) continue;
      const ligne = somme[i];
      const ni = membres[i].length;
      for (let j = i + 1; j < n; j++) {
        if (!actif[j]) continue;
        const moyenne = ligne[j] / (ni * membres[j].length);
        if (moyenne > meilleur) {
          meilleur = moyenne;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || meilleur < r.seuil) break;
    // Le groupe bj rejoint le groupe bi.
    for (let k = 0; k < n; k++) {
      if (!actif[k] || k === bi || k === bj) continue;
      somme[bi][k] += somme[bj][k];
      somme[k][bi] = somme[bi][k];
    }
    membres[bi] = membres[bi].concat(membres[bj]);
    membres[bj] = [];
    actif[bj] = false;
  }
  // Ordre chronologique ; les photos d'heure inconnue après les autres, dans l'ordre reçu.
  const cle = (i: number) => photos[i].instant ?? Infinity;
  const ordre = (x: number, y: number) => (cle(x) === cle(y) ? x - y : cle(x) < cle(y) ? -1 : 1);
  return membres
    .filter((m) => m.length > 0)
    .map((m) => m.sort(ordre))
    .sort((x, y) => ordre(x[0], y[0]))
    .map((m) => m.map((i) => photos[i].id));
}
