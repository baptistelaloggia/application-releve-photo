import { describe, expect, it } from 'vitest';
import { exifOrientationNormale, extraireExif, insererExif, lireInfosExif } from './exif';

/** Segment Exif minimal (petit-boutiste) : orientation 6 et date de prise de vue. */
function exifFictif(): Uint8Array {
  const date = '2026:10:30 14:05:09\u0000';
  const tiff: number[] = [];
  const u16 = (v: number) => tiff.push(v & 0xff, v >> 8);
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24);
  tiff.push(0x49, 0x49); u16(42); u32(8); // en-tête, IFD0 en 8
  u16(2); // IFD0 : 2 entrées
  u16(0x0112); u16(3); u32(1); u16(6); u16(0); // orientation = 6
  u16(0x8769); u16(4); u32(1); u32(38); // pointeur vers l'IFD Exif
  u32(0); // fin IFD0 (position 34)
  u16(1); // IFD Exif en 38 : 1 entrée
  u16(0x9003); u16(2); u32(20); u32(56); // DateTimeOriginal en 56
  u32(0);
  for (const c of date) tiff.push(c.charCodeAt(0));
  const charge = [...'Exif\u0000\u0000'].map((c) => c.charCodeAt(0)).concat(tiff);
  const longueur = charge.length + 2;
  return new Uint8Array([0xff, 0xe1, longueur >> 8, longueur & 0xff, ...charge]);
}

/** JPEG fictif : SOI, APP0 JFIF, puis SOS et quelques octets. */
const jpegCanevas = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]);

describe('EXIF', () => {
  it('lit orientation et date, puis les recopie dans le JPEG compressé', () => {
    const app1 = exifFictif();
    const original = insererExif(jpegCanevas, app1);
    expect(extraireExif(original)).toEqual(app1);
    expect(lireInfosExif(app1)).toEqual({ orientation: 6, dateOriginale: new Date(2026, 9, 30, 14, 5, 9) });

    const corrige = exifOrientationNormale(app1);
    expect(lireInfosExif(corrige).orientation).toBe(1);
    const sortie = insererExif(jpegCanevas, corrige);
    // SOI, puis Exif, l'en-tête JFIF retiré, les données d'image intactes.
    expect([...sortie.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect([...sortie.subarray(sortie.length - 9)]).toEqual([...jpegCanevas.subarray(jpegCanevas.length - 9)]);
    expect(sortie.length).toBe(jpegCanevas.length - 6 + corrige.length);
    expect(lireInfosExif(extraireExif(sortie)!).dateOriginale).toEqual(new Date(2026, 9, 30, 14, 5, 9));
  });

  it('ne trouve rien dans un JPEG sans Exif', () => {
    expect(extraireExif(jpegCanevas)).toBeNull();
    expect(lireInfosExif(new Uint8Array([1, 2, 3]))).toEqual({ orientation: null, dateOriginale: null });
  });
});
