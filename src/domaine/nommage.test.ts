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
