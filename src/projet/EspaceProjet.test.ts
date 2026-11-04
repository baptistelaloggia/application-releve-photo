import { describe, expect, it } from 'vitest';
import { StockageMemoire } from '../stockage/StockageMemoire';
import { EspaceProjet, ErreurPasUnProjet } from './EspaceProjet';

const infos = { annee: 2026, codeAffaire: 'XXX', nom: 'Mairie test', niveaux: ['RDC', 'R+1', 'TT'] };
const pdf = (texte: string) => new Blob([`%PDF-1.4 ${texte}`], { type: 'application/pdf' });

describe('EspaceProjet', () => {
  it("crée l'arborescence normalisée", async () => {
    const s = new StockageMemoire();
    await EspaceProjet.creer(s, infos, 'BL');
    expect(await s.arborescence()).toEqual(expect.arrayContaining([
      '00_PLANS/', '00_PLANS/_ANCIENS/', '01_PHOTOS/', '01_PHOTOS/00_RDC/', '01_PHOTOS/01_R+1/',
      '01_PHOTOS/02_TT/', '02_EXPORTS/', '_data/', '_data/projet.json',
    ]));
    const rouvert = await EspaceProjet.ouvrir(s);
    expect(rouvert.projet.dossier).toBe('2026-XXX_Mairie-test');
    expect(rouvert.niveaux.map((n) => n.code)).toEqual(['RDC', 'R+1', 'TT']);
  });

  it('refuse un dossier qui n’est pas un projet', async () => {
    await expect(EspaceProjet.ouvrir(new StockageMemoire())).rejects.toBeInstanceOf(ErreurPasUnProjet);
  });

  it('renumérote les dossiers à l’ajout d’un sous-sol, sans perdre leur contenu', async () => {
    const s = new StockageMemoire();
    const e = await EspaceProjet.creer(s, infos, 'BL');
    await s.ecrireFichier('01_PHOTOS/01_R+1/temoin.txt', 'x');
    const cr = await e.ajouterNiveau('ss', 'BL');
    expect(cr).toContain('Dossier renommé : 01_R+1 → 02_R+1');
    const photos = (await s.lister('01_PHOTOS')).map((x) => x.nom).sort();
    expect(photos).toEqual(['00_SS', '01_RDC', '02_R+1', '03_TT']);
    expect(await s.existe('01_PHOTOS/02_R+1/temoin.txt')).toBe(true);
    // Idempotent : une seconde application ne change rien.
    expect(await e.appliquerArborescence()).toEqual([]);
  });

  it('importe un plan puis archive l’ancien indice', async () => {
    const s = new StockageMemoire();
    const e = await EspaceProjet.creer(s, infos, 'BL');
    await e.importerPlan({ fichier: pdf('A'), nomOrigine: 'archi r1 ind A.pdf', codeNiveau: 'R+1', indice: 'a', pages: 1 }, 'BL');
    expect(await s.existe('00_PLANS/XXX_R+1.pdf')).toBe(true);

    expect(e.prevoirImport('R+1', 'A').erreur).toMatch(/existe déjà/);
    expect(e.prevoirImport('R+1', 'B').remplace).toBe('A');

    await e.importerPlan({ fichier: pdf('B'), nomOrigine: 'archi r1 ind B.pdf', codeNiveau: 'R+1', indice: 'B', pages: 1 }, 'BL');
    expect(await (await s.lireFichier('00_PLANS/XXX_R+1.pdf')).text()).toContain('B');
    expect(await (await s.lireFichier('00_PLANS/_ANCIENS/XXX_R+1_Ind-A.pdf')).text()).toContain('A');

    const rouvert = await EspaceProjet.ouvrir(s);
    expect(rouvert.plans).toHaveLength(1);
    expect(rouvert.plans[0].indice).toBe('B');
    expect(rouvert.plans[0].historique.map((h) => h.indice)).toEqual(['A']);
  });

  it('refuse le même fichier deux fois', async () => {
    const s = new StockageMemoire();
    const e = await EspaceProjet.creer(s, infos, 'BL');
    await e.importerPlan({ fichier: pdf('A'), nomOrigine: 'a.pdf', codeNiveau: 'RDC', indice: 'A', pages: 1 }, 'BL');
    await expect(
      e.importerPlan({ fichier: pdf('A'), nomOrigine: 'a.pdf', codeNiveau: 'RDC', indice: 'B', pages: 1 }, 'BL'),
    ).rejects.toThrow(/déjà le plan courant/);
  });

  it('crée le niveau manquant lors de l’import', async () => {
    const s = new StockageMemoire();
    const e = await EspaceProjet.creer(s, infos, 'BL');
    await e.importerPlan({ fichier: pdf('A'), nomOrigine: 'r2.pdf', codeNiveau: 'R2', indice: 'A', pages: 1 }, 'BL');
    expect(e.niveaux.map((n) => n.code)).toEqual(['RDC', 'R+1', 'R+2', 'TT']);
    expect(await s.existe('01_PHOTOS/03_TT')).toBe(true);
  });

  it('ne supprime pas un niveau qui a un plan', async () => {
    const s = new StockageMemoire();
    const e = await EspaceProjet.creer(s, infos, 'BL');
    await e.importerPlan({ fichier: pdf('A'), nomOrigine: 'a.pdf', codeNiveau: 'TT', indice: 'A', pages: 1 }, 'BL');
    await expect(e.supprimerNiveau(e.niveauParCode('TT')!.id)).rejects.toThrow(/a un plan/);
    await e.supprimerNiveau(e.niveauParCode('R+1')!.id);
    expect((await s.lister('01_PHOTOS')).map((x) => x.nom).sort()).toEqual(['00_RDC', '01_TT']);
  });
});
