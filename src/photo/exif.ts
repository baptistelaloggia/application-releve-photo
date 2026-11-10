/**
 * Métadonnées EXIF des photos JPEG (CONCEPTION §A.7 : compression en conservant l'EXIF).
 *
 * Une photo de téléphone contient un segment APP1 « Exif » (date, appareil, réglages,
 * parfois position GPS). La compression passe par un canevas, qui perd ce segment :
 * on le recopie donc tel quel dans le JPEG compressé. Seule l'orientation est remise
 * à « normale », puisque l'image a déjà été redressée avant compression.
 */

const SOI = 0xd8;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;

interface Segment {
  marqueur: number;
  debut: number;
  fin: number;
}

/** Segments d'en-tête d'un JPEG, jusqu'au début des données d'image (SOS). */
function segments(octets: Uint8Array): Segment[] {
  if (octets[0] !== 0xff || octets[1] !== SOI) return [];
  const liste: Segment[] = [];
  let i = 2;
  while (i + 4 <= octets.length && octets[i] === 0xff) {
    const marqueur = octets[i + 1];
    if (marqueur === SOS) break;
    const longueur = (octets[i + 2] << 8) | octets[i + 3];
    liste.push({ marqueur, debut: i, fin: i + 2 + longueur });
    i += 2 + longueur;
  }
  return liste;
}

function estExif(octets: Uint8Array, s: Segment) {
  return (
    s.marqueur === APP1 &&
    String.fromCharCode(...octets.subarray(s.debut + 4, s.debut + 10)) === 'Exif\u0000\u0000'
  );
}

/** Segment APP1 Exif complet (marqueur et longueur compris), ou null. */
export function extraireExif(jpeg: Uint8Array): Uint8Array | null {
  const s = segments(jpeg).find((x) => estExif(jpeg, x));
  return s ? jpeg.slice(s.debut, s.fin) : null;
}

/** Lecteur de la structure TIFF contenue dans le segment Exif. */
class Tiff {
  readonly base = 10; // FF E1, longueur (2), « Exif\0\0 » (6)
  readonly le: boolean;
  readonly o: Uint8Array;
  constructor(o: Uint8Array) {
    this.o = o;
    this.le = o[this.base] === 0x49; // « II » : petit-boutiste ; « MM » : gros-boutiste
  }
  u16(p: number) {
    const a = this.o[this.base + p];
    const b = this.o[this.base + p + 1];
    return this.le ? a | (b << 8) : (a << 8) | b;
  }
  u32(p: number) {
    const v = [0, 1, 2, 3].map((k) => this.o[this.base + p + k]);
    return this.le ? (v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24)) >>> 0 : ((v[0] << 24) | (v[1] << 16) | (v[2] << 8) | v[3]) >>> 0;
  }
  /** Entrées d'un IFD : position de chaque entrée de 12 octets. */
  entrees(ifd: number): Array<{ tag: number; position: number }> {
    if (ifd <= 0 || this.base + ifd + 2 > this.o.length) return [];
    const n = this.u16(ifd);
    const liste = [];
    for (let k = 0; k < n; k++) {
      const position = ifd + 2 + k * 12;
      if (this.base + position + 12 > this.o.length) break;
      liste.push({ tag: this.u16(position), position });
    }
    return liste;
  }
}

const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_ORIGINALE = 0x9003;

export interface InfosExif {
  /** 1 = normale ; 6 = tournée de 90° ; etc. */
  orientation: number | null;
  /** Date de prise de vue, heure locale de l'appareil. */
  dateOriginale: Date | null;
}

export function lireInfosExif(app1: Uint8Array): InfosExif {
  try {
    const t = new Tiff(app1);
    const ifd0 = t.u32(4);
    let orientation: number | null = null;
    let dateOriginale: Date | null = null;
    for (const e of t.entrees(ifd0)) {
      if (e.tag === TAG_ORIENTATION) orientation = t.u16(e.position + 8);
      if (e.tag === TAG_EXIF_IFD) {
        for (const s of t.entrees(t.u32(e.position + 8))) {
          if (s.tag !== TAG_DATE_ORIGINALE) continue;
          const decalage = t.u32(s.position + 8);
          const texte = String.fromCharCode(...app1.subarray(t.base + decalage, t.base + decalage + 19));
          const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(texte);
          if (m) dateOriginale = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        }
      }
    }
    return { orientation, dateOriginale };
  } catch {
    return { orientation: null, dateOriginale: null };
  }
}

/** Copie du segment Exif avec l'orientation remise à 1 (image déjà redressée). */
export function exifOrientationNormale(app1: Uint8Array): Uint8Array {
  const copie = app1.slice();
  const t = new Tiff(copie);
  for (const e of t.entrees(t.u32(4))) {
    if (e.tag !== TAG_ORIENTATION) continue;
    const p = t.base + e.position + 8;
    copie[p] = t.le ? 1 : 0;
    copie[p + 1] = t.le ? 0 : 1;
  }
  return copie;
}

/** Insère un segment Exif dans un JPEG (juste après SOI), en retirant l'en-tête JFIF et tout Exif existant. */
export function insererExif(jpeg: Uint8Array, app1: Uint8Array): Uint8Array {
  const aRetirer = segments(jpeg).filter((s) => s.marqueur === APP0 || estExif(jpeg, s));
  const morceaux: Uint8Array[] = [jpeg.subarray(0, 2), app1];
  let i = 2;
  for (const s of aRetirer) {
    morceaux.push(jpeg.subarray(i, s.debut));
    i = s.fin;
  }
  morceaux.push(jpeg.subarray(i));
  const total = morceaux.reduce((n, m) => n + m.length, 0);
  const sortie = new Uint8Array(total);
  let p = 0;
  for (const m of morceaux) {
    sortie.set(m, p);
    p += m.length;
  }
  return sortie;
}
