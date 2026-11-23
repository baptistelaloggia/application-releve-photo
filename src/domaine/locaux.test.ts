import { describe, expect, it } from 'vitest';
import { detecterLocaux, styleDansCadre, type TextePlace } from './locaux';
import { nomDeBase, numeroterNomsEnDouble } from './locaux';

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
      ...etiquette(1800, 900, ['SAS CPCU', 'LT1104.B', '5,5 m²']),
    ];
    const locaux = detecterLocaux(textes, L, H);
    expect(locaux.map((l) => [l.nom, l.numero, l.surface, l.confiance])).toEqual(
      expect.arrayContaining([
        ['SANIT. F', 'SF202', 33.7, 'forte'],
        ['SANIT. H', 'SH202', 25.3, 'forte'],
        ['LOCAL GSM + OPE 2', 'LT1115', 19, 'forte'],
        ['TGBT', '012', 12.5, 'forte'],
        ['MENAGE', 'ME1101', 9.7, 'forte'],
        ['SAS CPCU', 'LT1104.B', 5.5, 'forte'],
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

  it('lit les numéros en plusieurs parties, sans altitude ni type ERP dans le nom', () => {
    const textes = [
      ...etiquette(400, 400, ['Salle de', 'réunion', 'SDR-RDC-42', '90.8 m²']),
      { texte: '+35.95 m', x: 380, y: 400 + 4 * 6.9, largeur: 40, hauteur: 6.9, angle: 0 },
      ...etiquette(800, 400, ['ERP Espace', 'Coupole', 'Type L,W', 'ACC-R01-23', '200.2 m²']),
      ...etiquette(1200, 400, ['Bureau', 'BR.B-R04-xx', '18.2 m²']),
      ...etiquette(1600, 400, ['Sanitaires', 'SAN.A-R01-01', '12 m²']),
    ];
    expect(detecterLocaux(textes, L, H).map((l) => [l.nom, l.numero, l.surface])).toEqual([
      ['Salle de réunion', 'SDR-RDC-42', 90.8],
      ['ERP Espace Coupole', 'ACC-R01-23', 200.2],
      ['Bureau', 'BR.B-R04-xx', 18.2],
      ['Sanitaires', 'SAN.A-R01-01', 12],
    ]);
  });

  it('écarte les étiquettes de portes, écrites en petit', () => {
    const textes = [
      ...etiquette(400, 400, ['Salle de', 'réunion', 'SDR-RDC-42', '90.8 m²'], 10.5),
      ...etiquette(800, 400, ['Lobby', 'ACC-RDC-30', '82.6 m²'], 10.5),
      ...etiquette(1200, 400, ['Palier', 'PLR-RDC-20', '20.8 m²'], 10.5),
      ...etiquette(600, 600, ['RDC-P34', 'PF30'], 3.9),
      ...etiquette(900, 600, ['RDC-P86', '1UP'], 3.9),
    ];
    expect(detecterLocaux(textes, L, H).map((l) => l.numero)).toEqual(['SDR-RDC-42', 'ACC-RDC-30', 'PLR-RDC-20']);
  });

  it('ne crée pas de local en dessous de 4 m² (gaines, placards)', () => {
    const textes = [
      ...etiquette(400, 400, ['GN', 'GN-R01-12', '0.6 m²']),
      ...etiquette(800, 400, ['Placard', 'PLR-R01-03', '3.9 m²']),
      ...etiquette(1200, 400, ['Local ménage', 'ME-R01-02', '4 m²']),
    ];
    expect(detecterLocaux(textes, L, H).map((l) => l.numero)).toEqual(['ME-R01-02']);
  });

  it('sépare deux étiquettes empilées sans espace : la surface termine l’étiquette', () => {
    const textes = etiquette(1000, 300, ['Open Space', 'BR.B-R01-05', '12.8 m²', 'Bureau', 'BR.B-R01-06', '9.6 m²']);
    expect(detecterLocaux(textes, L, H).map((l) => [l.nom, l.numero])).toEqual([
      ['Open Space', 'BR.B-R01-05'],
      ['Bureau', 'BR.B-R01-06'],
    ]);
  });

  it('ne fusionne pas deux étiquettes voisines', () => {
    const textes = [...etiquette(1000, 300, ['RESERVE', 'REST003', '8,8 m²']), ...etiquette(1000, 360, ['CIRC.', 'CI003', '56,3 m²'])];
    expect(detecterLocaux(textes, L, H).map((l) => l.numero)).toEqual(['REST003', 'CI003']);
  });
});

import { proposerNumeroLocal } from './locaux';
describe('numéro automatique', () => {
  it('propose le premier numéro libre du niveau', () => {
    expect(proposerNumeroLocal('R+2', [])).toBe('R2-01');
    expect(proposerNumeroLocal('R+2', ['R2-01', 'r2-02', 'SF202'])).toBe('R2-03');
    expect(proposerNumeroLocal('RDC', ['R2-01'])).toBe('RDC-01');
    expect(proposerNumeroLocal('R+4-MEZZANINE', [])).toBe('R4-MEZ-01');
  });
});

describe('noms des locaux détectés (17/11/2026)', () => {
  const d = (nom: string, x: number, y: number) => ({ nom, x, y });
  it('numérote les noms en double, de haut en bas puis de gauche à droite', () => {
    const r = numeroterNomsEnDouble([d('LT', 0.8, 0.2), d('TGBT', 0.5, 0.5), d('LT', 0.2, 0.2), d('LT', 0.5, 0.7)], []);
    expect(r.map((x) => x.nom)).toEqual(['LT 02', 'TGBT', 'LT 01', 'LT 03']);
  });
  it('tient compte des locaux déjà enregistrés sur le plan, sans les renommer', () => {
    expect(numeroterNomsEnDouble([d('LT', 0.1, 0.1)], ['LT 01', 'Bureau']).map((x) => x.nom)).toEqual(['LT 02']);
    expect(numeroterNomsEnDouble([d('Bureau', 0.1, 0.1)], ['BUREAU']).map((x) => x.nom)).toEqual(['Bureau 01']);
    expect(numeroterNomsEnDouble([d('Sanitaires', 0.1, 0.1)], ['LT 01']).map((x) => x.nom)).toEqual(['Sanitaires']);
  });
  it('reconnaît le nom de base', () => {
    expect(nomDeBase('LT 02')).toBe('LT');
    expect(nomDeBase('  Local   CTA ')).toBe('Local CTA');
  });
});

describe('détection : cartouche, légende et style des étiquettes (21/11/2026)', () => {
  /** Étiquette dont chaque ligne a sa police. */
  const avecPolice = (cx: number, y: number, lignes: Array<[string, string]>, h = 6.6): TextePlace[] =>
    etiquette(cx, y, lignes.map(([t]) => t), h).map((t, i) => ({ ...t, police: lignes[i][1] }));
  const salle = (cx: number, y: number, nom: string, num: string, surf: string) =>
    avecPolice(cx, y, [[nom, 'nom'], [num, 'autre'], [surf, 'autre']]);
  const plan = [
    ...salle(500, 300, 'Bureau', 'BR-01', '12.5 m²'),
    ...salle(800, 300, 'Sanitaires F.', 'SAN-01', '16.7 m²'),
    ...salle(500, 700, 'Circulation A', 'CRC-01', '108.2 m²'),
    ...salle(800, 700, 'Palier D', 'PLR-01', '10.9 m²'),
  ];

  it('écarte le texte du cartouche, repéré à son vocabulaire', () => {
    const cartouche = [
      ...etiquette(2150, 800, ['Phase'], 6.9), ...etiquette(2250, 800, ['Indice'], 6.9), ...etiquette(2150, 900, ['Echelle'], 6.9),
      ...etiquette(2250, 900, ['Dessiné par'], 6.9), ...etiquette(2150, 1000, ["Maître d'ouvrage"], 6.9),
      ...avecPolice(2150, 1010, [['BUREAU DE CONTROLE', 'nom']]),
    ];
    const noms = detecterLocaux([...plan, ...cartouche], L, H).map((l) => l.nom);
    expect(noms).not.toContain('BUREAU DE CONTROLE');
    expect(noms).toHaveLength(4);
  });

  it('écarte les lignes de la légende', () => {
    const legende = [...etiquette(60, 1450, ['LÉGENDE'], 9.9), ...avecPolice(160, 1480, [['EXUTOIRE ESCALIER', 'nom']])];
    expect(detecterLocaux([...plan, ...legende], L, H).map((l) => l.nom)).not.toContain('EXUTOIRE ESCALIER');
  });

  it('garde un nom seul s’il suit le style des étiquettes sûres (police, taille), même en minuscules', () => {
    const noms = detecterLocaux(
      [...plan, ...avecPolice(650, 500, [['Open Space', 'nom']]), ...avecPolice(650, 560, [['COUR CENTRALE', 'autre']], 9)],
      L,
      H,
    ).map((l) => l.nom);
    expect(noms).toContain('Open Space');
    expect(noms).not.toContain('COUR CENTRALE');
  });

  it('ajoute au nom le nombre qui le termine (« Open Space 2 »)', () => {
    const t = avecPolice(650, 500, [['Open Space', 'nom'], ['2', 'nom'], ['BR.A-R02-02', 'autre'], ['41.5 m²', 'autre']]);
    expect(detecterLocaux([...plan, ...t], L, H).find((l) => l.numero === 'BR.A-R02-02')?.nom).toBe('Open Space 2');
  });
});

describe('détection d’après une étiquette encadrée (23/11/2026)', () => {
  const ligne = (texte: string, x: number, y: number, police: string, h = 6) => ({ texte, x: x - texte.length * h * 0.3, y, largeur: texte.length * h * 0.6, hauteur: h, angle: 0, police });
  // Noms en gras (police « gras ») sans surface ; mobilier en maigre (« maigre ») avec surface.
  const textes: TextePlace[] = [
    ligne('Open space flex office 01', 600, 300, 'gras'),
    ligne('CTA 01', 900, 300, 'gras'),
    ligne('Terrasse accessible R+6', 1200, 900, 'gras'),
    ...[0, 1, 2, 3].flatMap((i) => [ligne('Bureau', 400 + i * 120, 600, 'maigre'), ligne('12,6m²', 400 + i * 120, 606.3, 'maigre')]),
  ];

  it('lit le style du texte encadré', () => {
    expect(styleDansCadre(textes, L, H, { x1: 520 / L, y1: 280 / H, x2: 680 / L, y2: 310 / H })).toEqual({ police: 'gras', hauteur: 6 });
    expect(styleDansCadre(textes, L, H, { x1: 0, y1: 0, x2: 0.01, y2: 0.01 })).toBeNull();
  });

  it('ne garde que les étiquettes du style de l’exemple, même sans surface', () => {
    const auto = detecterLocaux(textes, L, H).map((l) => l.nom);
    expect(auto).toContain('Bureau');
    const guidee = detecterLocaux(textes, L, H, { police: 'gras', hauteur: 6 }).map((l) => l.nom);
    expect(guidee.sort()).toEqual(['CTA 01', 'Open space flex office 01', 'Terrasse accessible R+6']);
  });
});
