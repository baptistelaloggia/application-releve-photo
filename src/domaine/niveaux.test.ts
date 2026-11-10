import { describe, expect, it } from 'vitest';
import {
  codeDepuisNomDossier,
  controlerNiveaux,
  devinerNiveau,
  genererNiveaux,
  nomsDossiersNiveaux,
  devinerNiveauPage,
  normaliserCodeNiveau,
  trierNiveaux,
} from './niveaux';

describe('codes de niveau', () => {
  it("trie dans l'ordre du bâtiment", () => {
    expect(trierNiveaux(['TT', 'R+10', 'RDC', 'R+2', 'SS1', 'SS2', 'R+1'])).toEqual([
      'SS2', 'SS1', 'RDC', 'R+1', 'R+2', 'R+10', 'TT',
    ]);
  });

  it('numérote les dossiers pour l’Explorateur Windows', () => {
    const noms = nomsDossiersNiveaux(trierNiveaux(['RDC', 'TT', 'SS1', 'R+1']));
    expect([...noms.values()]).toEqual(['00_SS1', '01_RDC', '02_R+1', '03_TT']);
    // Le tri alphabétique des noms de dossier donne bien l'ordre du bâtiment.
    const beaucoup = [...nomsDossiersNiveaux(trierNiveaux(genererNiveaux(2, 11, true))).values()];
    expect([...beaucoup].sort()).toEqual(beaucoup);
  });

  it('normalise les saisies', () => {
    expect(normaliserCodeNiveau('r1')).toBe('R+1');
    expect(normaliserCodeNiveau(' r+02 ')).toBe('R+2');
    expect(normaliserCodeNiveau('ss2')).toBe('SS2');
    expect(normaliserCodeNiveau('rdc')).toBe('RDC');
    expect(normaliserCodeNiveau('ss')).toBe('SS1');
  });

  it('refuse les codes non conformes et les doublons', () => {
    expect(controlerNiveaux(['R_1'])).toHaveLength(1);
    expect(controlerNiveaux(['R+4.MEZZ'])).toHaveLength(1); // « . » réservé aux noms de photos
    expect(controlerNiveaux(['RDC', 'RDC'])).toHaveLength(1);
    expect(controlerNiveaux(['R+4-MEZZANINE'])).toEqual([]);
    expect(controlerNiveaux(['SS2', 'SS1', 'RDC', 'R+1', 'TT'])).toEqual([]);
  });

  it("place l'entresol entre les sous-sols et le RDC", () => {
    expect(trierNiveaux(['RDC', 'ES', 'SS1', 'SS2', 'R+1'])).toEqual(['SS2', 'SS1', 'ES', 'RDC', 'R+1']);
    expect(normaliserCodeNiveau('entresol')).toBe('ES');
    expect(controlerNiveaux(['SS1', 'ES', 'RDC'])).toEqual([]);
  });

  it("devine le niveau d'une page d'après son titre", () => {
    expect(devinerNiveauPage('PLAN DE REPÉRAGE PLAN DE NIVEAU - R+0 EXUTOIRE')).toBe('RDC');
    expect(devinerNiveauPage('toiture DAS PLAN DE NIVEAU - R+1 Phase Emetteur Lot Niveau')).toBe('R+1');
    expect(devinerNiveauPage('TERRASSE R+5 TERRASSE R+4 PLAN DE NIVEAU - TOIT')).toBe('TT');
    expect(devinerNiveauPage('PLAN DE NIVEAU - ENTRESOL')).toBe('ES');
    expect(devinerNiveauPage('PLAN DE NIVEAU - SS1')).toBe('SS1');
    expect(devinerNiveauPage('CARNET DE PLANS DE NIVEAUX Phase Emetteur Lot Niveau Zone')).toBeNull();
  });

  it('accepte les niveaux intermédiaires à code libre', () => {
    expect(normaliserCodeNiveau('R+4 mezzanine')).toBe('R+4-MEZZANINE');
    expect(normaliserCodeNiveau('Mezzanine Hall')).toBe('MEZZANINE-HALL');
    expect(normaliserCodeNiveau('ss')).toBe('SS1');
    expect(trierNiveaux(['TT', 'R+4-MEZZANINE', 'R+5', 'R+4'])).toEqual(['R+4', 'R+4-MEZZANINE', 'R+5', 'TT']);
    expect(trierNiveaux(['TT', 'COMBLES', 'R+5'])).toEqual(['R+5', 'COMBLES', 'TT']);
  });

  it('génère une liste type', () => {
    expect(trierNiveaux(genererNiveaux(1, 2, true))).toEqual(['SS1', 'RDC', 'R+1', 'R+2', 'TT']);
    expect(trierNiveaux(genererNiveaux(2, 0, false))).toEqual(['SS2', 'SS1', 'RDC']);
  });

  it('relit le code depuis un nom de dossier', () => {
    expect(codeDepuisNomDossier('03_R+2')).toBe('R+2');
    expect(codeDepuisNomDossier('R+2')).toBeNull();
    expect(codeDepuisNomDossier('03_divers')).toBeNull();
  });

  it('devine le niveau depuis un nom de PDF', () => {
    expect(devinerNiveau('ARCHI_PLAN_R+1_IndB.pdf')).toBe('R+1');
    expect(devinerNiveau('EXE-CVC-R02-ind-C.pdf')).toBe('R+2');
    expect(devinerNiveau('Plan RDC.pdf')).toBe('RDC');
    expect(devinerNiveau('plan sous-sol.pdf')).toBe('SS1');
    expect(devinerNiveau('XX_SS2_A.pdf')).toBe('SS2');
    expect(devinerNiveau('Toiture terrasse.pdf')).toBe('TT');
    expect(devinerNiveau('PLAN_R+0.pdf')).toBe('RDC');
    expect(devinerNiveau('plan masse.pdf')).toBeNull();
  });
});
