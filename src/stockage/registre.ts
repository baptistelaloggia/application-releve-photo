import { openDB, type IDBPDatabase } from 'idb';

/**
 * Mémoire locale de l'appareil (IndexedDB) : liste des projets déjà ouverts,
 * avec l'accès à leur dossier, et réglages de l'utilisateur.
 * Aucune donnée de projet n'y est copiée : la référence reste le dossier du projet.
 */

export type TypeEmplacement = 'dossier' | 'appareil';

export interface ProjetConnu {
  id: string;
  nom: string;
  dossier: string;
  type: TypeEmplacement;
  /**
   * Accès au dossier Windows (type « dossier » seulement). Pour le stockage interne
   * de l'appareil, on ne le mémorise pas : il est retrouvé par son nom (voir acces.ts).
   */
  handle?: FileSystemDirectoryHandle;
  dernierAcces: string;
}

let base: Promise<IDBPDatabase> | null = null;
function ouvrirBase() {
  base ??= openDB('releve-photo', 1, {
    upgrade(db) {
      db.createObjectStore('projets', { keyPath: 'id' });
      db.createObjectStore('reglages');
    },
  });
  return base;
}

export async function listerProjetsConnus(): Promise<ProjetConnu[]> {
  const tous = (await (await ouvrirBase()).getAll('projets')) as ProjetConnu[];
  return tous.sort((a, b) => b.dernierAcces.localeCompare(a.dernierAcces));
}

export async function memoriserProjet(p: ProjetConnu): Promise<void> {
  await (await ouvrirBase()).put('projets', p);
}

export async function oublierProjet(id: string): Promise<void> {
  await (await ouvrirBase()).delete('projets', id);
}

export async function lireReglage<T>(cle: string): Promise<T | undefined> {
  return (await (await ouvrirBase()).get('reglages', cle)) as T | undefined;
}

export async function ecrireReglage(cle: string, valeur: unknown): Promise<void> {
  await (await ouvrirBase()).put('reglages', valeur, cle);
}

/** Photos déjà exportées depuis cet appareil (pour ne transmettre que les nouvelles). */
export async function photosExportees(projetId: string): Promise<Set<string>> {
  return new Set((await lireReglage<string[]>(`photosExportees:${projetId}`)) ?? []);
}

export async function marquerPhotosExportees(projetId: string, ids: Iterable<string>): Promise<void> {
  const deja = await photosExportees(projetId);
  for (const id of ids) deja.add(id);
  await ecrireReglage(`photosExportees:${projetId}`, [...deja]);
}

/**
 * Une photo annotée ou dotée d'une note vocale après son envoi doit repartir au prochain envoi :
 * ses fichiers annexes ne sont transmis qu'avec elle.
 */
export async function retirerPhotosExportees(projetId: string, ids: Iterable<string>): Promise<void> {
  const deja = await photosExportees(projetId);
  let change = false;
  for (const id of ids) change = deja.delete(id) || change;
  if (change) await ecrireReglage(`photosExportees:${projetId}`, [...deja]);
}

/**
 * Tags (20/11/2026) : favoris, tags récents et tags personnels, mémorisés sur l'appareil.
 * Les tags eux-mêmes sont enregistrés dans le JSON de chaque photo.
 */
export interface MemoireTags {
  favoris: string[];
  recents: string[];
  perso: string[];
}

const RECENTS_MAX = 30;

export async function lireMemoireTags(): Promise<MemoireTags> {
  return (await lireReglage<MemoireTags>('tags')) ?? { favoris: [], recents: [], perso: [] };
}

async function ecrireMemoireTags(m: MemoireTags): Promise<MemoireTags> {
  await ecrireReglage('tags', m);
  return m;
}

/** Tags utilisés : ils passent en tête des récents. */
export async function noterTagsUtilises(tags: string[]): Promise<MemoireTags> {
  const m = await lireMemoireTags();
  const recents = [...tags, ...m.recents.filter((t) => !tags.includes(t))].slice(0, RECENTS_MAX);
  return ecrireMemoireTags({ ...m, recents });
}

export async function basculerTagFavori(tag: string): Promise<MemoireTags> {
  const m = await lireMemoireTags();
  const favoris = m.favoris.includes(tag) ? m.favoris.filter((t) => t !== tag) : [...m.favoris, tag];
  return ecrireMemoireTags({ ...m, favoris });
}

export async function ajouterTagPerso(tag: string): Promise<MemoireTags> {
  const m = await lireMemoireTags();
  return m.perso.includes(tag) ? m : ecrireMemoireTags({ ...m, perso: [...m.perso, tag] });
}
