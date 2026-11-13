import { exifOrientationNormale, extraireExif, insererExif, lireInfosExif } from './exif';

/**
 * Compression des photos (CONCEPTION §A.7) : environ 1 à 1,5 Mo par photo, EXIF conservé.
 * Une photo de téléphone de 12 Mpx (4 000 × 3 000) pèse 3 à 6 Mo ; ramenée à 3 264 px
 * de grand côté (≈ 8 Mpx) en JPEG de qualité 0,82, elle pèse en général 1 à 1,5 Mo,
 * ce qui reste largement suffisant pour lire une plaque signalétique. [À VÉRIFIER sur vos photos]
 */

const GRAND_COTE_MAX = 3264;
const TAILLE_CIBLE = 1.5 * 1024 * 1024;
const QUALITES = [0.82, 0.74, 0.66, 0.58];
const COTE_MINIATURE = 320;

export interface PhotoCompressee {
  jpeg: Blob;
  miniature: Blob;
  largeur: number;
  hauteur: number;
  /** Date de prise de vue lue dans l'EXIF de l'original, s'il y en a une. */
  dateExif: Date | null;
}

async function versJpeg(source: CanvasImageSource, largeur: number, hauteur: number, qualite: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(largeur, hauteur);
    c.getContext('2d')!.drawImage(source, 0, 0, largeur, hauteur);
    return c.convertToBlob({ type: 'image/jpeg', quality: qualite });
  }
  const c = document.createElement('canvas');
  c.width = largeur;
  c.height = hauteur;
  c.getContext('2d')!.drawImage(source, 0, 0, largeur, hauteur);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('Encodage JPEG impossible'))), 'image/jpeg', qualite));
}

/** Compresse une photo (JPEG, PNG, WebP…) et prépare sa miniature. */
export async function compresserPhoto(original: Blob): Promise<PhotoCompressee> {
  const octets = new Uint8Array(await original.arrayBuffer());
  const exif = original.type === 'image/jpeg' || (octets[0] === 0xff && octets[1] === 0xd8) ? extraireExif(octets) : null;
  const infos = exif ? lireInfosExif(exif) : { orientation: null, dateOriginale: null };

  // createImageBitmap applique l'orientation EXIF : l'image est redressée.
  const image = await createImageBitmap(original, { imageOrientation: 'from-image' });
  try {
    const echelle = Math.min(1, GRAND_COTE_MAX / Math.max(image.width, image.height));
    const largeur = Math.round(image.width * echelle);
    const hauteur = Math.round(image.height * echelle);

    let jpeg: Blob;
    const dejaBien = echelle === 1 && original.size <= TAILLE_CIBLE && original.type === 'image/jpeg' && (infos.orientation ?? 1) === 1;
    if (dejaBien) {
      jpeg = original; // déjà à la bonne taille : on garde le fichier d'origine, intact
    } else {
      jpeg = await versJpeg(image, largeur, hauteur, QUALITES[0]);
      for (const q of QUALITES.slice(1)) {
        if (jpeg.size <= TAILLE_CIBLE) break;
        jpeg = await versJpeg(image, largeur, hauteur, q);
      }
      if (exif) {
        const avecExif = insererExif(new Uint8Array(await jpeg.arrayBuffer()), exifOrientationNormale(exif));
        jpeg = new Blob([avecExif as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
      }
    }

    const em = Math.min(1, COTE_MINIATURE / Math.max(image.width, image.height));
    const miniature = await versJpeg(image, Math.round(image.width * em), Math.round(image.height * em), 0.7);
    return { jpeg, miniature, largeur, hauteur, dateExif: infos.dateOriginale };
  } finally {
    image.close();
  }
}

/** Miniature et dimensions d'une photo déjà enregistrée (réparation d'un projet). */
export async function preparerMiniature(jpeg: Blob): Promise<{ miniature: Blob; largeur: number; hauteur: number }> {
  const image = await createImageBitmap(jpeg, { imageOrientation: 'from-image' });
  try {
    const em = Math.min(1, COTE_MINIATURE / Math.max(image.width, image.height));
    const miniature = await versJpeg(image, Math.round(image.width * em), Math.round(image.height * em), 0.7);
    return { miniature, largeur: image.width, hauteur: image.height };
  } finally {
    image.close();
  }
}
