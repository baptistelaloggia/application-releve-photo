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
    expect(photos).toEqual(['00_SS1', '01_RDC', '02_R+1', '03_TT']);
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

describe('locaux', () => {
  async function projetAvecPlan() {
    const s = new StockageMemoire();
    const e = await EspaceProjet.creer(s, infos, 'BL');
    await e.importerPlan({ fichier: pdf('A'), nomOrigine: 'a.pdf', codeNiveau: 'R+1', indice: 'A', pages: 1 }, 'BL');
    return { s, e, planId: e.plans[0].id };
  }

  it('enregistre la détection sans doublons, puis relit les locaux', async () => {
    const { s, e, planId } = await projetAvecPlan();
    const detectes = [
      { nom: 'TGBT', numero: 'LT1105', surface: 30.4, x: 0.3, y: 0.8, confiance: 'forte' as const, lignes: [] },
      { nom: 'BUREAUX', numero: null, surface: null, x: 0.2, y: 0.5, confiance: 'moyenne' as const, lignes: [] },
    ];
    await e.enregistrerDetection(planId, detectes, 'BL');
    const cr = await e.enregistrerDetection(planId, detectes, 'BL');
    expect(cr[0]).toMatch(/^0 local/);
    expect(e.locaux).toHaveLength(2);
    expect((await s.lister('_data/locaux')).length).toBe(2);
    const rouvert = await EspaceProjet.ouvrir(s);
    expect(rouvert.locauxDuPlan(planId).map((l) => l.nom)).toEqual(['BUREAUX', 'TGBT']);
  });

  it('trouve le TGBT par la recherche', async () => {
    const { e, planId } = await projetAvecPlan();
    await e.creerLocal(planId, { nom: 'TGBT', numero: 'lt1105', surface: null, x: 0.5, y: 0.5 }, 'BL');
    await e.creerLocal(planId, { nom: 'Chaufferie', numero: null, surface: 40, x: 0.6, y: 0.5 }, 'BL');
    const r = e.rechercherLocaux('tgbt');
    expect(r.map((x) => [x.local.numero, x.niveau.code])).toEqual([['LT1105', 'R+1']]);
  });

  it('refuse un numéro en double et un nom vide, modifie et supprime', async () => {
    const { e, planId } = await projetAvecPlan();
    const l = await e.creerLocal(planId, { nom: 'Bureau', numero: '101', surface: null, x: 0.1, y: 0.1 }, 'BL');
    await expect(e.creerLocal(planId, { nom: 'Autre', numero: '101', surface: null, x: 0.2, y: 0.2 }, 'BL')).rejects.toThrow(/déjà utilisé/);
    await expect(e.creerLocal(planId, { nom: ' ', numero: null, surface: null, x: 0.2, y: 0.2 }, 'BL')).rejects.toThrow(/obligatoire/);
    await e.modifierLocal(l.id, { nom: 'Bureau direction', numero: '101', surface: 18, x: 0.12, y: 0.1 }, 'BL');
    expect(e.locaux[0].nom).toBe('Bureau direction');
    await e.supprimerLocal(l.id);
    expect(e.locaux).toHaveLength(0);
  });
});
