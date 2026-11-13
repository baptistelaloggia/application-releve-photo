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
