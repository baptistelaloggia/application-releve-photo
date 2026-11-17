import { svgAnnotations } from '../domaine/annotations';
import type { Annotation } from '../domaine/types';

/**
 * Fabrique la copie annotée d'une photo : la photo, à sa pleine résolution, avec les annotations
 * dessinées par-dessus (JPEG). L'original n'est pas modifié et garde ses métadonnées EXIF.
 */
export async function fabriquerCopieAnnotee(photo: Blob, annotations: Annotation[]): Promise<Blob> {
  const image = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(new Blob([svgAnnotations(annotations, image.width, image.height)], { type: 'image/svg+xml' }));
  try {
    const dessin = new Image();
    dessin.src = url;
    await dessin.decode();
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext('2d')!;
    g.drawImage(image, 0, 0);
    g.drawImage(dessin, 0, 0, image.width, image.height);
    return await new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('Copie annotée impossible'))), 'image/jpeg', 0.85));
  } finally {
    image.close();
    URL.revokeObjectURL(url);
  }
}
