import { describe, expect, it } from 'vitest';
import { cleTag, nettoyerTag, puces, rechercherTags, tagsDansPhrase, tagsValides, tousLesTags } from './tags';

describe('tags', () => {
  const tous = tousLesTags(['Avant fermeture', 'Fuite']);

  it('rassemble le catalogue et les tags personnels sans doublon', () => {
    expect(tous).toContain('CTA');
    expect(tous).toContain('Fuite');
    expect(tous.filter((t) => cleTag(t) === 'avant fermeture')).toHaveLength(1);
  });

  it('cherche par les premières lettres d’un mot, sans accents ni casse', () => {
    expect(rechercherTags(tous, 'cal')).toEqual(['Calorifuge']);
    expect(rechercherTags(tous, 'ech')).toEqual(['Échangeur']);
    expect(rechercherTags(tous, 'cab')).toEqual(['Chemin de câbles', 'Câblage']);
    expect(rechercherTags(tous, 'va ex')).toEqual(["Vase d'expansion"]);
    expect(rechercherTags(tous, '')).toHaveLength(tous.length);
  });

  it('propose 6 puces : favoris, récents, puis tags par défaut', () => {
    expect(puces([], [])).toEqual(['Conforme', 'À vérifier', 'Non conforme', 'Avant fermeture', 'Calorifuge', 'VC']);
    expect(puces(['CTA'], ['Pompe', 'cta', 'Conforme'])).toEqual(['CTA', 'Pompe', 'Conforme', 'À vérifier', 'Non conforme', 'Avant fermeture']);
  });

  it('reconnaît les tags d’une phrase dictée', () => {
    expect(tagsDansPhrase('VC non conforme, calorifuge absent avant fermeture', tous)).toEqual([
      'Non conforme',
      'Avant fermeture',
      'Calorifuge',
      'VC',
    ]);
    expect(tagsDansPhrase('Les CTA sont conformes', tous)).toEqual(['Conforme', 'CTA']);
    expect(tagsDansPhrase('fuite sur la chute EU au niveau du regard', tous)).toEqual(['Chute EU / EV', 'Fuite']);
    // « pas » n'est pas le sigle PAS ; « vanne » seule n'est pas « Vanne 2/3 voies ».
    expect(tagsDansPhrase("il n'y a pas de vanne", tous)).toEqual([]);
    expect(tagsDansPhrase('Échangeur à plaques à vérifier', tous)).toEqual(['À vérifier', 'Échangeur']);
  });

  it('nettoie et contrôle les tags', () => {
    expect(nettoyerTag('  Avant   fermeture \n')).toBe('Avant fermeture');
    expect(tagsValides(['CTA', 'Non conforme'])).toBe(true);
    expect(tagsValides(['x'.repeat(41)])).toBe(false);
    expect(tagsValides('CTA')).toBe(false);
  });
});
