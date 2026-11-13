import { describe, expect, it } from 'vitest';
import { diagnostiquer } from './diagnostic';
import { StockageMemoire } from './StockageMemoire';

describe('test du serveur', () => {
  it('passe toutes les étapes et ne laisse rien derrière lui', async () => {
    const s = new StockageMemoire();
    const etapes = await diagnostiquer(s);
    expect(etapes.map((e) => e.etape)).toEqual([
      'Créer un dossier',
      'Écrire un fichier de 1 Mo',
      'Relire et comparer',
      'Renommer un fichier',
      'Renommer un dossier',
      'Écrire 50 petits fichiers',
      'Lister le dossier (50 fichiers)',
      'Lire les 50 fichiers un par un',
      'Lire les 50 fichiers d’un coup',
      'Supprimer le dossier de test',
    ]);
    expect(etapes.every((e) => e.reussi)).toBe(true);
    expect(await s.lister('')).toEqual([]);
  });
});
