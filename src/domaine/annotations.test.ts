import { describe, expect, it } from 'vitest';
import { annotationTouchee, annotationValide, couperLignes, deplacerAnnotation, resumeAnnotations, svgAnnotations } from './annotations';
import { cheminAnnotee, cheminNoteVocale, estFichierAnnexe } from './nommage';
import type { Annotation } from './types';

describe('annotations', () => {
  const toutes: Annotation[] = [
    { type: 'ok', x: 0.2, y: 0.2 },
    { type: 'nok', x: 0.8, y: 0.2 },
    { type: 'texte', x: 0.5, y: 0.9, texte: 'Gaine non calorifugée <à reprendre>' },
    { type: 'bulle', x: 0.5, y: 0.3, px: 0.5, py: 0.5, texte: 'Fuite' },
    { type: 'cercle', x: 0.5, y: 0.5, rx: 0.1, ry: 0.1 },
    { type: 'trait', points: [[0.1, 0.1], [0.2, 0.3]] },
  ];

  it('dessine chaque annotation, en pixels de l’image, avec le texte échappé', () => {
    const svg = svgAnnotations(toutes, 4000, 3000);
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 4000 3000"/);
    expect(svg).toContain('&lt;à');
    expect(svg).toContain('reprendre&gt;');
    expect(svg).not.toContain('<à');
    expect(svg).toContain('<ellipse cx="2000" cy="1500" rx="400" ry="300"');
    expect(svg).toContain('<polyline points="400,300 800,900"');
    expect((svg.match(/<rect /g) ?? []).length).toBe(1);
  });

  it('coupe les textes longs ; la bulle n’a pas de pointe', () => {
    expect(couperLignes('Absence de calorifuge sur le réseau eau glacée du local CTA', 28)).toEqual([
      'Absence de calorifuge sur le',
      'réseau eau glacée du local',
      'CTA',
    ]);
    expect(svgAnnotations(toutes, 4000, 3000)).not.toContain('<polygon');
  });

  it('trouve l’annotation touchée (la plus haute d’abord) et la déplace sans la faire sortir de l’image', () => {
    // Le cercle (rang 4) et la bulle (rang 3) se chevauchent au centre : le cercle, dessiné après, l’emporte.
    expect(annotationTouchee(toutes, 0.5, 0.5, 4000, 3000)).toBe(4);
    expect(annotationTouchee(toutes, 0.21, 0.21, 4000, 3000)).toBe(0);
    expect(annotationTouchee(toutes, 0.5, 0.3, 4000, 3000)).toBe(3);
    expect(annotationTouchee(toutes, 0.95, 0.95, 4000, 3000)).toBe(-1);
    expect(deplacerAnnotation(toutes[0], 0.1, -0.5)).toEqual({ type: 'ok', x: 0.30000000000000004, y: 0 });
    const trait = deplacerAnnotation(toutes[5], -0.5, 0) as { points: Array<[number, number]> };
    expect(trait.points).toEqual([[0, 0.1], [0.1, 0.3]]);
  });

  it('contrôle les annotations reçues', () => {
    for (const a of toutes) expect(annotationValide(a)).toBe(true);
    expect(annotationValide({ type: 'ok', x: 2, y: 0 })).toBe(false);
    expect(annotationValide({ type: 'script', x: 0, y: 0 })).toBe(false);
    expect(annotationValide({ type: 'texte', x: 0, y: 0, texte: 'x'.repeat(500) })).toBe(false);
    expect(annotationValide({ type: 'trait', points: [[0, 'a']] })).toBe(false);
  });

  it('résume les annotations', () => {
    expect(resumeAnnotations([toutes[0], toutes[0], toutes[1], toutes[3]])).toBe('2 V, 1 X, 1 bulle');
  });

  it('nomme les fichiers rangés à côté de la photo', () => {
    const f = '01_PHOTOS/01_R+1/R+1.012_TGBT/XXX_R+1.012_P001_2026-11-17_01.jpg';
    expect(cheminAnnotee(f)).toBe('01_PHOTOS/01_R+1/R+1.012_TGBT/XXX_R+1.012_P001_2026-11-17_01_annote.jpg');
    expect(cheminNoteVocale(f, 'm4a')).toBe('01_PHOTOS/01_R+1/R+1.012_TGBT/XXX_R+1.012_P001_2026-11-17_01_note.m4a');
    expect(estFichierAnnexe(cheminAnnotee(f))).toBe(true);
    expect(estFichierAnnexe(f)).toBe(false);
    // Tri alphabétique : la photo, ses annexes, puis la photo suivante.
    const noms = [f.replace('_01.jpg', '_02.jpg'), cheminNoteVocale(f, 'm4a'), cheminAnnotee(f), f].sort();
    expect(noms).toEqual([f, cheminAnnotee(f), cheminNoteVocale(f, 'm4a'), f.replace('_01.jpg', '_02.jpg')]);
  });
});
