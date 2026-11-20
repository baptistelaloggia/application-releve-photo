import { describe, expect, it } from 'vitest';
import { ajouterAuCommentaire } from './transcription';

describe('transcription', () => {
  it('ajoute la phrase au commentaire, sans doublon', () => {
    expect(ajouterAuCommentaire('', 'calorifuge absent')).toBe('Calorifuge absent');
    expect(ajouterAuCommentaire('Plaque CTA', 'vc non conforme')).toBe('Plaque CTA — Vc non conforme');
    expect(ajouterAuCommentaire('Plaque CTA — Vc non conforme', 'vc non conforme')).toBe('Plaque CTA — Vc non conforme');
    expect(ajouterAuCommentaire('Plaque', '  ')).toBe('Plaque');
  });
});
