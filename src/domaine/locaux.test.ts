import { describe, expect, it } from 'vitest';
import { detecterLocaux, type TextePlace } from './locaux';

/** Étiquette fictive centrée en (cx, y), lignes de hauteur h espacées de h. */
function etiquette(cx: number, y: number, lignes: string[], h = 6.6): TextePlace[] {
  return lignes.map((texte, i) => {
    const largeur = texte.length * h * 0.6;
    return { texte, x: cx - largeur / 2, y: y + i * h * 1.05, largeur, hauteur: h, angle: 0 };
  });
}

const L = 2384;
const H = 1684;

describe('détection des locaux', () => {
  it('lit les étiquettes nom / numéro / surface', () => {
    const textes = [
      ...etiquette(1000, 300, ['SANIT. F', 'SF202', '33,7 m²']),
      ...etiquette(1060, 300, ['SANIT. H', 'SH202', '25,3 m²']),
      ...etiquette(400, 600, ['LOCAL GSM +', 'OPE 2', 'LT1115', '19 m²']),
      ...etiquette(1500, 900, ['TGBT', '012', '12,5 m²']),
      ...etiquette(1800, 300, ['403', 'MENAGE', 'ME1101', '9,7 m²']),
      ...etiquette(1800, 900, ['SAS CPCU', 'LT1104.B', '3,5 m²']),
    ];
    const locaux = detecterLocaux(textes, L, H);
    expect(locaux.map((l) => [l.nom, l.numero, l.surface, l.confiance])).toEqual(
      expect.arrayContaining([
        ['SANIT. F', 'SF202', 33.7, 'forte'],
        ['SANIT. H', 'SH202', 25.3, 'forte'],
        ['LOCAL GSM + OPE 2', 'LT1115', 19, 'forte'],
        ['TGBT', '012', 12.5, 'forte'],
        ['MENAGE', 'ME1101', 9.7, 'forte'],
        ['SAS CPCU', 'LT1104.B', 3.5, 'forte'],
      ]),
    );
    expect(locaux).toHaveLength(6);
    const f = locaux.find((l) => l.numero === 'SF202')!;
    expect(f.x).toBeCloseTo(1000 / L, 2);
    expect(f.y).toBeGreaterThan(290 / H);
    expect(f.y).toBeLessThan(320 / H);
  });

  it('garde un nom seul s’il désigne un local, et écarte le reste', () => {
    const textes = [
      ...etiquette(500, 900, ['SANIT. F', 'SF201', '18,8 m²']),
      ...etiquette(800, 900, ['BUREAUX']),
      ...etiquette(800, 1200, ['COURETTE', 'ST HONORÉ'], 9.9),
      ...etiquette(300, 300, ['Ai flocage poutre 33.32', 'As sol 28.17', 'Ht libre 5.15m']),
      ...etiquette(300, 500, ['2UP', 'Esc.2s']),
      ...etiquette(1200, 500, ['MESURES CONSERVATOIRES', 'LOCAL VDI'], 3.9), // petite annotation
      { texte: '1 018', x: 700, y: 700, largeur: 20, hauteur: 6.5, angle: 0 },
      { texte: '285', x: 900, y: 700, largeur: 15, hauteur: 8.2, angle: -90 },
      { texte: 'C', x: 1900, y: 400, largeur: 5, hauteur: 8.1, angle: 0 },
    ];
    const noms = detecterLocaux(textes, L, H).map((l) => `${l.nom}|${l.confiance}`);
    expect(noms.sort()).toEqual(['BUREAUX|moyenne', 'COURETTE ST HONORÉ|moyenne', 'SANIT. F|forte']);
  });

  it('prend la dernière ligne en forme de numéro comme numéro', () => {
    const l = detecterLocaux([...etiquette(1000, 300, ['ESC.3', 'ESC203'])], L, H);
    expect(l.map((x) => [x.nom, x.numero])).toEqual([['ESC.3', 'ESC203']]);
  });

  it('écarte les noms seuls situés loin du dessin (cartouche, légende)', () => {
    const textes = [
      ...etiquette(400, 400, ['SANIT. F', 'SF201', '18,8 m²']),
      ...etiquette(700, 500, ['RESERVE', 'RES01', '8 m²']),
      ...etiquette(1000, 700, ['CIRC.', 'CI01', '20 m²']),
      ...etiquette(800, 600, ['BUREAUX']),
      ...etiquette(2200, 1000, ['TECHNICAL SAS']),
      ...etiquette(2250, 1100, ['Bureau de Contrôle']),
    ];
    expect(detecterLocaux(textes, L, H).filter((x) => x.confiance === 'moyenne').map((x) => x.nom)).toEqual(['BUREAUX']);
  });

  it('ne fusionne pas deux étiquettes voisines', () => {
    const textes = [...etiquette(1000, 300, ['RESERVE', 'REST003', '8,8 m²']), ...etiquette(1000, 360, ['CIRC.', 'CI003', '56,3 m²'])];
    expect(detecterLocaux(textes, L, H).map((l) => l.numero)).toEqual(['REST003', 'CI003']);
  });
});
