import { describe, expect, it } from 'vitest';
import { fusionner, type DonneesProjet } from './fusion';
import type { Local, Niveau, Photo, Plan, Repere } from './types';

const t = (h: number) => `2026-11-13T${String(h).padStart(2, '0')}:00:00.000Z`;
const niveau = (id: string, code: string, ordre = 0): Niveau => ({ schema: 1, id, code, ordre, creeLe: t(1), creePar: 'A' });
const plan = (id: string, niveauId: string, empreinte = 'e1', indice = 'A'): Plan => ({
  schema: 1, id, niveauId, indice, fichier: `00_PLANS/X_${id}.pdf`, nomOrigine: 'p.pdf', pages: 1, taille: 1, empreinte,
  importeLe: t(1), importePar: 'A', historique: [],
});
const local = (id: string, planId: string, numero: string | null, nom: string, x: number, y: number, h = 2): Local => ({
  schema: 1, id, planId, numero, nom, surface: null, x, y, origine: 'auto', creeLe: t(1), creePar: 'A', modifieLe: t(h), modifiePar: 'A',
});
const repere = (id: string, planId: string, numero: string, localId: string | null, h = 2): Repere => ({
  schema: 1, id, planId, localId, numero, libelle: '', x: 0.5, y: 0.5, creeLe: t(1), creePar: 'A', modifieLe: t(h), modifiePar: 'A',
});
const photo = (id: string, repereId: string | null, empreinte: string, h = 3): Photo => ({
  schema: 1, id, repereId, fichier: `01_PHOTOS/x/${id}.jpg`, miniature: `_data/miniatures/${id}.jpg`, date: '2026-11-13',
  prisLe: t(h), prisPar: 'B', rang: 1, largeur: 1, hauteur: 1, taille: 1, empreinte, commentaire: '', source: 'appli',
});

/** Projet du serveur : RDC, son plan, deux locaux, un repère et une photo. */
function serveur(): DonneesProjet {
  return {
    niveaux: [niveau('n-rdc', 'RDC')],
    plans: [plan('p-rdc', 'n-rdc')],
    locaux: [local('l-tgbt', 'p-rdc', 'LT001', 'TGBT', 0.2, 0.2), local('l-cta', 'p-rdc', 'LT002', 'CTA', 0.6, 0.2)],
    reperes: [repere('r1', 'p-rdc', 'P001', 'l-tgbt')],
    photos: [photo('ph1', 'r1', 'h1')],
  };
}

describe('fusion de deux exemplaires d’un projet', () => {
  it('ajoute ce qui manque et ne touche pas au reste', () => {
    const cible = serveur();
    const paquet = serveur();
    paquet.niveaux.push(niveau('n-r1', 'R+1'));
    paquet.plans.push(plan('p-r1', 'n-r1', 'e2'));
    paquet.locaux.push(local('l-bur', 'p-r1', 'R1-01', 'BUREAUX', 0.5, 0.5));
    paquet.reperes.push(repere('r2', 'p-r1', 'P002', 'l-bur'));
    paquet.photos.push(photo('ph2', 'r2', 'h2'), photo('ph3', 'r1', 'h3'));
    const r = fusionner(cible, paquet);
    expect(r.niveaux.map((n) => n.code)).toEqual(['R+1']);
    expect(r.plans.map((p) => p.id)).toEqual(['p-r1']);
    expect(r.locaux.map((l) => l.numero)).toEqual(['R1-01']);
    expect(r.reperes.map((x) => x.numero)).toEqual(['P002']);
    expect(r.photosNouvelles.map((p) => p.id)).toEqual(['ph2', 'ph3']);
    expect(r.photosModifiees).toEqual([]);
  });

  it('applique la modification la plus récente d’un local, dans les deux sens', () => {
    const cible = serveur();
    const paquet = serveur();
    paquet.locaux[0] = { ...paquet.locaux[0], nom: 'TGBT principal', modifieLe: t(5) };
    cible.locaux[1] = { ...cible.locaux[1], nom: 'CTA 1 (serveur)', modifieLe: t(6) };
    paquet.locaux[1] = { ...paquet.locaux[1], nom: 'CTA (téléphone)', modifieLe: t(4) };
    const r = fusionner(cible, paquet);
    expect(r.locaux.map((l) => l.nom)).toEqual(['TGBT principal']);
  });

  it('reconnaît le même niveau et le même local créés de chaque côté', () => {
    const cible = serveur();
    const paquet: DonneesProjet = {
      niveaux: [niveau('autre-rdc', 'RDC')],
      plans: [plan('autre-plan', 'autre-rdc')],
      locaux: [local('autre-tgbt', 'autre-plan', 'LT001', 'TGBT', 0.21, 0.2, 1)],
      reperes: [repere('r9', 'autre-plan', 'P009', 'autre-tgbt')],
      photos: [photo('ph9', 'r9', 'h9')],
    };
    const r = fusionner(cible, paquet);
    expect(r.niveaux).toEqual([]);
    expect(r.plans).toEqual([]);
    expect(r.locaux).toEqual([]);
    expect(r.reperes).toEqual([expect.objectContaining({ id: 'r9', planId: 'p-rdc', localId: 'l-tgbt', numero: 'P009' })]);
    expect(r.photosNouvelles[0].repereId).toBe('r9');
  });

  it('renumérote un local ou un repère dont le numéro est pris ailleurs', () => {
    const cible = serveur();
    const paquet = serveur();
    paquet.locaux.push(local('l-autre', 'p-rdc', 'LT001', 'Local autre', 0.9, 0.9));
    paquet.reperes.push(repere('r-autre', 'p-rdc', 'P001', null));
    const r = fusionner(cible, paquet);
    expect(r.locaux.map((l) => [l.nom, l.numero])).toEqual([['Local autre', 'RDC-01']]);
    expect(r.reperes.map((x) => x.numero)).toEqual(['P002']);
    expect(r.compteRendu.join('\n')).toMatch(/LT001 déjà pris.*renuméroté RDC-01/);
  });

  it('ignore les photos en double et reprend le classement plus récent', () => {
    const cible = serveur();
    const paquet = serveur();
    paquet.photos.push({ ...photo('ph-copie', 'r1', 'h1'), prisLe: t(4) }); // même contenu que ph1
    paquet.photos[0] = { ...paquet.photos[0], commentaire: 'Plaque CTA', modifieLe: t(7) };
    const r = fusionner(cible, paquet);
    expect(r.photosNouvelles).toEqual([]);
    expect(r.photosModifiees.map((p) => p.commentaire)).toEqual(['Plaque CTA']);
    expect(r.compteRendu).toContain('1 photo déjà présente (même contenu), ignorée.');
  });

  it('garde le plan de la cible si l’autre appareil a un autre indice', () => {
    const cible = serveur();
    const paquet = serveur();
    paquet.plans[0] = plan('p-rdc', 'n-rdc', 'autre-empreinte', 'B');
    const r = fusionner(cible, paquet);
    expect(r.plans).toEqual([]);
    expect(r.compteRendu[0]).toMatch(/plan RDC différent.*indice B.*conservé \(indice A\)/);
  });
});
