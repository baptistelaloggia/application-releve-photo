import { describe, expect, it } from 'vitest';
import { devinerIndice, nettoyerPourNom, nomDossierProjet, nomFichierPlan, nomFichierPlanArchive } from './nommage';

describe('nommage', () => {
  it('nettoie un nom de projet', () => {
    expect(nettoyerPourNom('  Lycée Jean_Moulin : bât. A ')).toBe('Lycee-Jean-Moulin-bat.-A');
  });
  it('construit les noms normalisés', () => {
    expect(nomDossierProjet(2026, 'XXX', 'Mairie de Lyon')).toBe('2026-XXX_Mairie-de-Lyon');
    expect(nomFichierPlan('XXX', 'R+1')).toBe('XXX_R+1.pdf');
    expect(nomFichierPlanArchive('XXX', 'R+1', 'A')).toBe('XXX_R+1_Ind-A.pdf');
  });
  it("devine l'indice", () => {
    expect(devinerIndice('PLAN_R+1_Ind-B.pdf')).toBe('B');
    expect(devinerIndice('plan_r1_IND_c.pdf')).toBe('C');
    expect(devinerIndice('plan R+1 indice 02.pdf')).toBe('02');
    expect(devinerIndice('plan R+1.pdf')).toBeNull();
  });
});

import { dateLocale, nomDossierLocal, nomFichierPhoto, nomFichierPhotoAClasser, numeroRepere } from './nommage';
describe('nommage des photos', () => {
  it('suit CONCEPTION §A.6', () => {
    expect(nomDossierLocal('R+1', { numero: '012', nom: 'Local TGBT' })).toBe('R+1.012_Local-TGBT');
    expect(nomDossierLocal('R+2', { numero: 'SF202', nom: 'SANIT. F' })).toBe('R+2.SF202_SANIT-F');
    expect(nomDossierLocal('RDC', null)).toBe('RDC.000_Hors-local');
    expect(nomFichierPhoto('XXX', 'R+1', '012', 'P001', '2026-10-30', 1)).toBe('XXX_R+1.012_P001_2026-10-30_01.jpg');
    expect(numeroRepere(7)).toBe('P007');
    expect(numeroRepere(1234)).toBe('P1234');
  });
  it('trie les photos d’un repère dans l’ordre chronologique', () => {
    const noms = [
      nomFichierPhoto('XXX', 'R+1', '012', 'P001', '2027-03-15', 1),
      nomFichierPhoto('XXX', 'R+1', '012', 'P002', '2026-10-30', 1),
      nomFichierPhoto('XXX', 'R+1', '012', 'P001', '2026-10-30', 2),
      nomFichierPhoto('XXX', 'R+1', '012', 'P001', '2026-10-30', 1),
    ];
    expect([...noms].sort()).toEqual([noms[3], noms[2], noms[0], noms[1]]);
  });
  it('nomme les photos du panier', () => {
    const d = new Date(2026, 9, 30, 14, 5, 9);
    expect(dateLocale(d)).toBe('2026-10-30');
    expect(nomFichierPhotoAClasser('XXX', d, 'abcdef')).toBe('XXX_A-CLASSER_2026-10-30_140509_abcd.jpg');
  });
});
