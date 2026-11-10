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
    const photos = (await s.lister('01_PHOTOS')).map((x) => x.nom).filter((n) => n !== '_A-CLASSER').sort();
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
    expect((await s.lister('01_PHOTOS')).map((x) => x.nom).filter((n) => n !== '_A-CLASSER').sort()).toEqual(['00_RDC', '01_TT']);
  });
});

describe('ordre des niveaux', () => {
  it('insère un niveau intermédiaire au bon endroit, puis le déplace', async () => {
    const s = new StockageMemoire();
    const e = await EspaceProjet.creer(s, { ...infos, niveaux: ['RDC', 'R+4', 'R+5', 'TT'] }, 'BL');
    await e.ajouterNiveau('R+4 mezzanine', 'BL');
    expect(e.niveaux.map((n) => n.code)).toEqual(['RDC', 'R+4', 'R+4-MEZZANINE', 'R+5', 'TT']);
    expect(e.libelle(e.niveauParCode('R+4-MEZZANINE')!)).toBe('R+4 mezzanine');
    expect((await s.lister('01_PHOTOS')).map((x) => x.nom).filter((n) => n !== '_A-CLASSER').sort()).toEqual([
      '00_RDC', '01_R+4', '02_R+4-MEZZANINE', '03_R+5', '04_TT',
    ]);

    await s.ecrireFichier('01_PHOTOS/03_R+5/temoin.txt', 'x');
    const cr = await e.deplacerNiveau(e.niveauParCode('R+4-MEZZANINE')!.id, 1);
    expect(cr).toContain('Dossier renommé : 03_R+5 → 02_R+5');
    expect(await s.existe('01_PHOTOS/02_R+5/temoin.txt')).toBe(true);
    expect(await s.existe('01_PHOTOS/03_R+4-MEZZANINE')).toBe(true);

    // L'ordre est enregistré : il est retrouvé à la réouverture.
    const rouvert = await EspaceProjet.ouvrir(s);
    expect(rouvert.niveaux.map((n) => n.code)).toEqual(['RDC', 'R+4', 'R+5', 'R+4-MEZZANINE', 'TT']);
    expect(await rouvert.appliquerArborescence()).toEqual([]);
  });

  it('ne déplace pas au-delà des extrémités', async () => {
    const e = await EspaceProjet.creer(new StockageMemoire(), infos, 'BL');
    expect(await e.deplacerNiveau(e.niveauParCode('RDC')!.id, -1)).toEqual([]);
    expect(e.niveaux.map((n) => n.code)).toEqual(['RDC', 'R+1', 'TT']);
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

  it('numérote automatiquement les locaux sans numéro', async () => {
    const { e, planId } = await projetAvecPlan();
    await e.creerLocal(planId, { nom: 'BUREAUX', numero: null, surface: null, x: 0.6, y: 0.5 }, 'BL');
    await e.creerLocal(planId, { nom: 'BUREAUX', numero: null, surface: null, x: 0.2, y: 0.5 }, 'BL');
    await e.creerLocal(planId, { nom: 'TGBT', numero: 'R1-01', surface: null, x: 0.1, y: 0.1 }, 'BL');
    expect(await e.numeroterLocauxSansNumero('BL')).toEqual(['2 locaux numérotés automatiquement']);
    expect(e.locauxDuPlan(planId).map((l) => `${l.numero} ${l.x}`)).toEqual(['R1-01 0.1', 'R1-02 0.2', 'R1-03 0.6']);
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

describe('repères et photos', () => {
  const jpeg = (t: string) => new Blob([`JPEG ${t}`], { type: 'image/jpeg' });
  const entree = (repereId: string | null, t: string, prisLe = new Date(2026, 9, 30, 10, 0, 0)) => ({
    repereId, jpeg: jpeg(t), miniature: jpeg(`m${t}`), largeur: 4, hauteur: 3, source: 'appli' as const, prisLe,
  });

  async function projet() {
    const s = new StockageMemoire();
    const e = await EspaceProjet.creer(s, { ...infos, codeAffaire: 'XXX' }, 'BL');
    await e.importerPlan({ fichier: pdf('A'), nomOrigine: 'a.pdf', codeNiveau: 'R+1', indice: 'A', pages: 1 }, 'BL');
    const planId = e.plans[0].id;
    const tgbt = await e.creerLocal(planId, { nom: 'Local TGBT', numero: '012', surface: null, x: 0.5, y: 0.5 }, 'BL');
    return { s, e, planId, tgbt };
  }

  it('nomme et range les photos selon CONCEPTION §A.6', async () => {
    const { s, e, planId, tgbt } = await projet();
    const r = await e.creerRepere(planId, 0.51, 0.52, 'BL');
    expect(r.numero).toBe('P001');
    expect(r.localId).toBe(tgbt.id); // rattaché au local le plus proche
    await e.ajouterPhoto(entree(r.id, '1'), 'BL');
    await e.ajouterPhoto(entree(r.id, '2'), 'BL');
    await e.ajouterPhoto(entree(r.id, '3', new Date(2027, 2, 15, 9, 0, 0)), 'BL');
    const dossier = '01_PHOTOS/01_R+1/R+1.012_Local-TGBT';
    expect((await s.lister(dossier)).map((x) => x.nom).sort()).toEqual([
      'XXX_R+1.012_P001_2026-10-30_01.jpg',
      'XXX_R+1.012_P001_2026-10-30_02.jpg',
      'XXX_R+1.012_P001_2027-03-15_01.jpg',
    ]);
    const rouvert = await EspaceProjet.ouvrir(s);
    expect(rouvert.photosDuRepere(r.id).map((p) => p.rang)).toEqual([1, 2, 1]);
  });

  it('rattache hors local un repère éloigné, et numérote un local sans numéro à la 1re photo', async () => {
    const { s, e, planId } = await projet();
    const loin = await e.creerRepere(planId, 0.05, 0.05, 'BL');
    expect(loin.localId).toBeNull();
    await e.ajouterPhoto(entree(loin.id, 'a'), 'BL');
    expect(await s.existe('01_PHOTOS/01_R+1/R+1.000_Hors-local/XXX_R+1.000_P001_2026-10-30_01.jpg')).toBe(true);

    const bureaux = await e.creerLocal(planId, { nom: 'BUREAUX', numero: null, surface: null, x: 0.9, y: 0.9 }, 'BL');
    const r = await e.creerRepere(planId, 0.9, 0.9, 'BL');
    await e.ajouterPhoto(entree(r.id, 'b'), 'BL');
    expect(e.locaux.find((l) => l.id === bureaux.id)!.numero).toBe('R1-01');
    expect(await s.existe('01_PHOTOS/01_R+1/R+1.R1-01_BUREAUX/XXX_R+1.R1-01_P002_2026-10-30_01.jpg')).toBe(true);
  });

  it('classe une photo du panier, puis la renvoie au panier', async () => {
    const { s, e, planId } = await projet();
    const p = await e.ajouterPhoto(entree(null, 'x'), 'BL');
    expect(p.fichier).toMatch(/^01_PHOTOS\/_A-CLASSER\/XXX_A-CLASSER_2026-10-30_100000_.{4}\.jpg$/);
    expect(e.photosAClasser()).toHaveLength(1);
    const r = await e.creerRepere(planId, 0.5, 0.5, 'BL');
    const classee = await e.classerPhoto(p.id, r.id, 'BL');
    expect(classee.fichier).toBe('01_PHOTOS/01_R+1/R+1.012_Local-TGBT/XXX_R+1.012_P001_2026-10-30_01.jpg');
    expect(await s.existe(p.fichier)).toBe(false);
    expect(e.photosAClasser()).toHaveLength(0);
    const retour = await e.classerPhoto(p.id, null, 'BL');
    expect(retour.fichier.startsWith('01_PHOTOS/_A-CLASSER/')).toBe(true);
    // Le dossier du local, devenu vide, est supprimé.
    expect(await s.existe('01_PHOTOS/01_R+1/R+1.012_Local-TGBT')).toBe(false);
  });

  it('renomme les photos quand le local change de numéro ou de nom, ou le niveau de place', async () => {
    const { s, e, planId, tgbt } = await projet();
    const r = await e.creerRepere(planId, 0.5, 0.5, 'BL');
    await e.ajouterPhoto(entree(r.id, '1'), 'BL');
    await e.modifierLocal(tgbt.id, { ...tgbt, numero: '013', nom: 'TGBT principal' }, 'BL');
    expect(await s.existe('01_PHOTOS/01_R+1/R+1.013_TGBT-principal/XXX_R+1.013_P001_2026-10-30_01.jpg')).toBe(true);
    expect(await s.existe('01_PHOTOS/01_R+1/R+1.012_Local-TGBT')).toBe(false);

    await e.ajouterNiveau('SS1', 'BL'); // les dossiers de niveau sont renumérotés
    const photo = e.photos[0];
    expect(photo.fichier).toBe('01_PHOTOS/02_R+1/R+1.013_TGBT-principal/XXX_R+1.013_P001_2026-10-30_01.jpg');
    expect(await s.existe(photo.fichier)).toBe(true);
    const rouvert = await EspaceProjet.ouvrir(s);
    expect(await rouvert.rangerPhotos()).toEqual([]);
  });

  it('ne supprime pas un repère qui a des photos', async () => {
    const { e, planId } = await projet();
    const r = await e.creerRepere(planId, 0.5, 0.5, 'BL');
    const p = await e.ajouterPhoto(entree(r.id, '1'), 'BL');
    await expect(e.supprimerRepere(r.id)).rejects.toThrow(/a des photos/);
    await e.supprimerPhoto(p.id);
    await e.supprimerRepere(r.id);
    expect(e.reperes).toHaveLength(0);
  });

  it('colore les locaux photographiés dans la journée', async () => {
    const { e, planId, tgbt } = await projet();
    const r = await e.creerRepere(planId, 0.5, 0.5, 'BL');
    await e.ajouterPhoto(entree(r.id, '1'), 'BL');
    expect([...e.locauxPhotographies('2026-10-30')]).toEqual([tgbt.id]);
    expect([...e.locauxPhotographies('2026-10-31')]).toEqual([]);
  });
});

describe('photos sur l’étiquette du local', () => {
  it('crée un seul repère d’étiquette par local, qui suit l’étiquette', async () => {
    const s = new StockageMemoire();
    const e = await EspaceProjet.creer(s, { ...infos, codeAffaire: 'XXX' }, 'BL');
    await e.importerPlan({ fichier: pdf('A'), nomOrigine: 'a.pdf', codeNiveau: 'R+1', indice: 'A', pages: 1 }, 'BL');
    const planId = e.plans[0].id;
    const l = await e.creerLocal(planId, { nom: 'CTA', numero: 'LT002', surface: null, x: 0.3, y: 0.3 }, 'BL');
    const jpeg = new Blob(['j']);
    const p1 = await e.ajouterPhoto({ repereId: null, jpeg, miniature: jpeg, largeur: 1, hauteur: 1, source: 'import' }, 'BL');
    const p2 = await e.ajouterPhoto({ repereId: null, jpeg, miniature: jpeg, largeur: 1, hauteur: 1, source: 'import' }, 'BL');

    const r = await e.repereEtiquette(l.id, 'BL');
    expect(r.surEtiquette).toBe(true);
    expect((await e.repereEtiquette(l.id, 'BL')).id).toBe(r.id);
    await e.classerPhotos([p1.id, p2.id], r.id, 'BL');
    expect(e.photosDuLocal(l.id).map((p) => p.rang)).toEqual([1, 2]);
    expect(e.photosAClasser()).toHaveLength(0);

    await e.modifierLocal(l.id, { ...l, x: 0.35, y: 0.4 }, 'BL');
    expect(e.reperes.find((x) => x.id === r.id)).toMatchObject({ x: 0.35, y: 0.4 });
    expect(e.locauxProches(planId, 0.34, 0.41, 3).map((x) => x.numero)).toEqual(['LT002']);

    await e.supprimerLocal(l.id, 'BL');
    const apres = e.reperes.find((x) => x.id === r.id)!;
    expect(apres.surEtiquette).toBeUndefined();
    expect(apres.localId).toBeNull();
  });
});
