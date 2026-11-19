import { describe, expect, it } from 'vitest';
import { affinite, distanceGps, regrouperPhotos, type PhotoARegrouper } from './regroupement';

const DIM = 32;
/**
 * Vecteur visuel fictif : une part commune au « lieu » (axe du lieu), une part propre à la photo
 * (axe unique), et une petite part commune à tous les locaux techniques. Deux photos d'un même lieu
 * ont une similarité d'environ 0,5 ; de deux lieux différents, d'environ 0,1 (ordres de grandeur
 * mesurés sur de vraies photos de locaux techniques).
 */
function vecteur(lieu: number, unique: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[0] = Math.sqrt(0.1); // commun à tous
  v[1 + lieu] = Math.sqrt(0.4);
  v[8 + unique] = Math.sqrt(0.5);
  return v;
}
const min = (m: number) => m * 60_000;
let compteur = 0;
function photo(id: string, instant: number | null, lieu: number | null, gps?: PhotoARegrouper['gps']): PhotoARegrouper {
  return { id, instant, vecteur: lieu === null ? null : vecteur(lieu, compteur++ % 24), gps };
}

describe('Regroupement des photos du panier', () => {
  it('sépare deux locaux visités l’un après l’autre', () => {
    const photos = [
      photo('a1', 0, 0), photo('a2', 20_000, 0), photo('a3', 45_000, 0), photo('a4', min(1), 0),
      photo('b1', min(6), 1), photo('b2', min(6.5), 1), photo('b3', min(7), 1),
    ];
    expect(regrouperPhotos(photos)).toEqual([['a1', 'a2', 'a3', 'a4'], ['b1', 'b2', 'b3']]);
  });

  it('sans reconnaissance visuelle, regroupe par l’heure seule', () => {
    const photos = [
      photo('a1', 0, null), photo('a2', 30_000, null), photo('a3', min(1), null),
      photo('b1', min(8), null), photo('b2', min(8.2), null),
      photo('c1', min(20), null),
    ];
    expect(regrouperPhotos(photos)).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2'], ['c1']]);
  });

  it('réunit les photos d’un local où l’on est revenu plus tard', () => {
    const photos = [
      photo('a1', 0, 0), photo('a2', 30_000, 0),
      photo('b1', min(5), 1), photo('b2', min(5.5), 1),
      photo('a3', min(15), 0), photo('a4', min(15.3), 0),
    ];
    expect(regrouperPhotos(photos)).toEqual([['a1', 'a2', 'a3', 'a4'], ['b1', 'b2']]);
  });

  it('garde ensemble deux vues très différentes prises à quelques secondes d’intervalle', () => {
    // Vue d'ensemble puis gros plan sur une plaque : peu de ressemblance, mais 10 s d'écart.
    const photos = [photo('a1', 0, 0), photo('a2', 10_000, 3), photo('b1', min(10), 1), photo('b2', min(10.2), 1)];
    expect(regrouperPhotos(photos)).toEqual([['a1', 'a2'], ['b1', 'b2']]);
  });

  it('sépare deux photos semblables trop éloignées d’après le GPS', () => {
    const ici = { lat: 48.85, lon: 2.35, precision: 10 };
    const loin = { lat: 48.855, lon: 2.35, precision: 10 }; // 556 m plus au nord
    const photos = [photo('a1', 0, 0, ici), photo('a2', 30_000, 0, loin)];
    expect(regrouperPhotos(photos)).toEqual([['a1'], ['a2']]);
    // Une précision médiocre (téléphone en intérieur) ne permet pas de conclure.
    const flou = { ...loin, precision: 600 };
    expect(regrouperPhotos([photo('a1', 0, 0, ici), photo('a2', 30_000, 0, flou)])).toEqual([['a1', 'a2']]);
  });

  it('le seuil règle la finesse des groupes', () => {
    const photos = [photo('a1', 0, 0), photo('a2', 30_000, 0), photo('b1', min(30), 1), photo('b2', min(30.5), 1)];
    expect(regrouperPhotos(photos, { seuil: 0.05 })).toHaveLength(1);
    expect(regrouperPhotos(photos)).toHaveLength(2);
    expect(regrouperPhotos(photos, { seuil: 0.95 })).toHaveLength(4);
  });

  it('trie les groupes et leurs photos dans l’ordre chronologique', () => {
    const photos = [photo('b2', min(9), 1), photo('a2', 15_000, 0), photo('b1', min(8.8), 1), photo('a1', 0, 0)];
    expect(regrouperPhotos(photos)).toEqual([['a1', 'a2'], ['b1', 'b2']]);
    expect(regrouperPhotos([])).toEqual([]);
  });

  it('ignore l’heure des photos importées sans date EXIF', () => {
    // Transférées ensemble : même date de fichier, mais aucune raison d'être du même local.
    const photos = [photo('a1', null, 0), photo('b1', null, 1), photo('a2', null, 0), photo('b2', null, 1)];
    expect(regrouperPhotos(photos)).toEqual([['a1', 'a2'], ['b1', 'b2']]);
    // Ni heure ni reconnaissance : rien ne permet de regrouper.
    expect(regrouperPhotos([photo('x', null, null), photo('y', null, null)])).toEqual([['x'], ['y']]);
  });

  it('calcule distances et affinités', () => {
    expect(distanceGps({ lat: 48, lon: 2 }, { lat: 49, lon: 2 })).toBeCloseTo(111_195, -1);
    const a = photo('a', 0, null);
    expect(affinite(a, photo('b', 0, null))).toBeCloseTo(1);
    expect(affinite(a, photo('b', min(3), null))).toBeCloseTo(Math.exp(-180 / 225));
  });

  it('reste rapide pour 400 photos', () => {
    const photos = Array.from({ length: 400 }, (_, i) => photo(`p${i}`, i * 20_000, Math.floor(i / 25) % 6));
    const debut = performance.now();
    const groupes = regrouperPhotos(photos);
    expect(performance.now() - debut).toBeLessThan(3000);
    expect(groupes.flat()).toHaveLength(400);
  });
});
