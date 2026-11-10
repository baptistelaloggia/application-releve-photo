import { describe, expect, it } from 'vitest';
import { rechercher } from './recherche';

const locaux = [
  { nom: 'TGBT', numero: 'LT1105', codeNiveau: 'SS1' },
  { nom: 'LOCAL CTA 1', numero: 'LT1101', codeNiveau: 'SS1' },
  { nom: 'Chaufferie', numero: '012', codeNiveau: 'RDC' },
  { nom: 'SANIT. F', numero: 'SF202', codeNiveau: 'R+2' },
  { nom: 'BUREAUX', numero: null, codeNiveau: 'R+2' },
  { nom: 'Bureau 12', numero: '120', codeNiveau: 'R+1' },
];
const noms = (q: string) => rechercher(q, locaux).map((l) => l.nom);

describe('recherche de locaux', () => {
  it('trouve par nom, sans tenir compte de la casse ni des accents', () => {
    expect(noms('TGBT')).toEqual(['TGBT']);
    expect(noms('chauf')).toEqual(['Chaufferie']);
    expect(noms('CHAUFFÉRIE')).toEqual(['Chaufferie']);
  });
  it('trouve par numéro, le numéro exact en premier', () => {
    expect(noms('012')).toEqual(['Chaufferie']);
    expect(noms('12')).toEqual(['Bureau 12', 'Chaufferie']);
    expect(noms('sf202')).toEqual(['SANIT. F']);
    expect(noms('LT11')).toEqual(['LOCAL CTA 1', 'TGBT']);
  });
  it('combine plusieurs mots, dont le niveau', () => {
    expect(noms('cta ss1')).toEqual(['LOCAL CTA 1']);
    expect(noms('bureau R+2')).toEqual(['BUREAUX']);
    expect(noms('sanit h')).toEqual([]);
  });
});
