/**
 * Paquets .zip d'échange entre appareils (lot 4, CONCEPTION §A.4-4 et §A.6 quinquies).
 *
 * Contenu, dans cet ordre (l'import lit le paquet en continu, sans le charger en mémoire) :
 *   manifeste.json            projet, sens, auteur, date
 *   donnees.json              niveaux, plans, locaux, repères (+ photos pour un retour de terrain)
 *   plans/{id}.pdf            plan courant de chaque niveau
 *   miniatures/{id}.jpg       pour chaque photo transmise, sa miniature…
 *   photos/{id}.jpg           …puis la photo elle-même
 *
 * Le paquet est écrit au fil de l'eau dans le stockage interne du navigateur, puis proposé
 * au téléchargement ou au partage : 300 photos (environ 400 Mo) ne passent jamais en mémoire.
 */
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { dateLocale } from '../domaine/nommage';
import type { DonneesProjet } from '../domaine/fusion';
import type { Photo, Projet } from '../domaine/types';
import type { EspaceProjet } from './EspaceProjet';

export const FORMAT_PAQUET = 'releve-photo-paquet';
export const VERSION_PAQUET = 1;

/** « vers-telephone » : plans, locaux et repères pour une visite ; « vers-serveur » : retour de terrain, avec les photos. */
export type SensPaquet = 'vers-telephone' | 'vers-serveur';

export interface Manifeste {
  format: typeof FORMAT_PAQUET;
  version: number;
  sens: SensPaquet;
  projet: Projet;
  creeLe: string;
  creePar: string;
  nbPhotos: number;
}

export interface EnTetePaquet {
  manifeste: Manifeste;
  donnees: DonneesProjet;
  pdfs: Map<string, Blob>;
}

const encodeur = new TextEncoder();

/** Nom du fichier : « 2026-XXX_Nom_retour-terrain_2026-11-13_1430.zip ». */
function nomPaquet(projet: Projet, sens: SensPaquet, d = new Date()) {
  const heure = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${projet.dossier}_${sens === 'vers-telephone' ? 'pour-telephone' : 'retour-terrain'}_${dateLocale(d)}_${heure}.zip`;
}

/** Destination du paquet en cours d'écriture. */
interface Sortie {
  ecrire(morceau: Uint8Array): Promise<void>;
  terminer(): Promise<File>;
  abandonner(): Promise<void>;
}

/**
 * Écriture dans le stockage interne du navigateur (sans limite de mémoire). Chaque export a son
 * propre fichier temporaire : un fichier resté verrouillé par un essai précédent (double clic,
 * export interrompu) ne bloque plus le suivant (« NoModificationAllowedError », 16/11/2026).
 * Renvoie null si ce stockage est indisponible.
 */
async function sortieInterne(nom: string): Promise<Sortie | null> {
  try {
    const dossier = await (await navigator.storage.getDirectory()).getDirectoryHandle('paquets', { create: true });
    for await (const ancien of dossier.keys()) await dossier.removeEntry(ancien).catch(() => undefined);
    const handle = await dossier.getFileHandle(`${Date.now()}-${crypto.randomUUID().slice(0, 8)}.zip`, { create: true });
    const flux = await handle.createWritable();
    return {
      ecrire: (m) => flux.write(m as Uint8Array<ArrayBuffer>),
      terminer: async () => {
        await flux.close();
        return new File([await handle.getFile()], nom, { type: 'application/zip' });
      },
      abandonner: () => flux.abort().catch(() => undefined),
    };
  } catch {
    return null;
  }
}

/** Repli : paquet construit en mémoire (sans risque pour un paquet sans photos). */
function sortieMemoire(nom: string): Sortie {
  const morceaux: Uint8Array[] = [];
  return {
    ecrire: async (m) => void morceaux.push(m),
    terminer: async () => new File(morceaux as Uint8Array<ArrayBuffer>[], nom, { type: 'application/zip' }),
    abandonner: async () => void (morceaux.length = 0),
  };
}

/**
 * Prépare un paquet. photosATransmettre : pour un retour de terrain, les photos dont le JPEG est
 * joint (les autres ne sont transmises que par leurs données : classement, commentaire).
 */
export async function exporterPaquet(
  espace: EspaceProjet,
  sens: SensPaquet,
  auteur: string,
  photosATransmettre: Photo[],
  progression: (texte: string) => void,
): Promise<{ fichier: File; nom: string; enMemoire: boolean; incident?: string }> {
  const nom = nomPaquet(espace.projet, sens);
  progression('Préparation du paquet…');
  const interne = await sortieInterne(nom);
  if (interne) {
    try {
      return { ...(await construirePaquet(espace, sens, auteur, photosATransmettre, progression, interne, nom)), enMemoire: false };
    } catch (e) {
      // Le stockage interne du navigateur a refusé l'écriture (constaté le 16/11/2026 sur un PC :
      // « NoModificationAllowedError ») : nouvel essai, le paquet étant construit en mémoire.
      if (!(e instanceof DOMException)) throw e;
      progression('Nouvel essai, en mémoire…');
      const r = await construirePaquet(espace, sens, auteur, photosATransmettre, progression, sortieMemoire(nom), nom);
      return { ...r, enMemoire: true, incident: `${e.name} : ${e.message}` };
    }
  }
  return { ...(await construirePaquet(espace, sens, auteur, photosATransmettre, progression, sortieMemoire(nom), nom)), enMemoire: true };
}

async function construirePaquet(
  espace: EspaceProjet,
  sens: SensPaquet,
  auteur: string,
  photosATransmettre: Photo[],
  progression: (texte: string) => void,
  sortie: Sortie,
  nom: string,
): Promise<{ fichier: File; nom: string }> {

  // Le zip produit ses morceaux au fil de l'eau ; on les écrit dans l'ordre, et l'on attend
  // l'écriture après chaque fichier pour ne pas accumuler les données en mémoire.
  let ecritures: Promise<void> = Promise.resolve();
  let erreur: unknown = null;
  const zip = new Zip((e, morceau) => {
    if (e) erreur = e;
    else ecritures = ecritures.then(() => sortie.ecrire(morceau));
  });
  const ajouter = async (chemin: string, contenu: Uint8Array, compresser: boolean) => {
    const f = compresser ? new ZipDeflate(chemin, { level: 6 }) : new ZipPassThrough(chemin);
    zip.add(f);
    f.push(contenu, true);
    await ecritures;
    if (erreur) throw erreur;
  };

  try {
    const avecPhotos = sens === 'vers-serveur';
    const donnees: DonneesProjet = { ...espace.donnees(), photos: avecPhotos ? espace.photos : [] };
    const manifeste: Manifeste = {
      format: FORMAT_PAQUET,
      version: VERSION_PAQUET,
      sens,
      projet: espace.projet,
      creeLe: new Date().toISOString(),
      creePar: auteur,
      nbPhotos: avecPhotos ? photosATransmettre.length : 0,
    };
    await ajouter('manifeste.json', encodeur.encode(JSON.stringify(manifeste, null, 2)), true);
    await ajouter('donnees.json', encodeur.encode(JSON.stringify(donnees)), true);
    for (const [i, plan] of espace.plans.entries()) {
      progression(`Plans : ${i + 1}/${espace.plans.length}`);
      await ajouter(`plans/${plan.id}.pdf`, new Uint8Array(await (await espace.lirePlan(plan)).arrayBuffer()), false);
    }
    if (avecPhotos) {
      for (const [i, photo] of photosATransmettre.entries()) {
        progression(`Photos : ${i + 1}/${photosATransmettre.length}`);
        const miniature = await espace.lireMiniature(photo).catch(() => null);
        if (miniature) await ajouter(`miniatures/${photo.id}.jpg`, new Uint8Array(await miniature.arrayBuffer()), false);
        await ajouter(`photos/${photo.id}.jpg`, new Uint8Array(await (await espace.lirePhoto(photo)).arrayBuffer()), false);
      }
    }
    zip.end();
    await ecritures;
    if (erreur) throw erreur;
    return { fichier: await sortie.terminer(), nom };
  } catch (e) {
    await sortie.abandonner();
    throw e;
  }
}

/**
 * Lit le paquet en continu et appelle surFichier pour chaque fichier, une fois complet.
 * surFichier peut renvoyer false pour arrêter la lecture.
 */
async function parcourir(
  paquet: Blob,
  surFichier: (nom: string, contenu: Blob) => Promise<boolean | void> | boolean | void,
  surNom?: (nom: string) => boolean,
) {
  // finLecture : un fichier non voulu a commencé (surNom) ; les fichiers déjà complets sont
  // tout de même traités avant d'arrêter. arret : surFichier a demandé l'arrêt immédiat.
  let finLecture = false;
  let arret = false;
  let erreur: unknown = null;
  const termines: Array<{ nom: string; contenu: Blob }> = [];
  const unzip = new Unzip((f) => {
    if (finLecture || (surNom && !surNom(f.name))) {
      finLecture = true;
      return;
    }
    const morceaux: Uint8Array[] = [];
    f.ondata = (e, d, final) => {
      if (e) erreur = e;
      morceaux.push(d);
      if (final) termines.push({ nom: f.name, contenu: new Blob(morceaux as Uint8Array<ArrayBuffer>[]) });
    };
    f.start();
  });
  unzip.register(UnzipInflate);
  const lecteur = paquet.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      unzip.push(value ?? new Uint8Array(0), done);
      if (erreur) throw erreur;
      while (termines.length && !arret) {
        const { nom, contenu } = termines.shift()!;
        if ((await surFichier(nom, contenu)) === false) arret = true;
      }
      if (done || arret || finLecture) break;
    }
  } finally {
    await lecteur.cancel().catch(() => undefined);
  }
}

/** Lit l'en-tête du paquet (manifeste, données, plans), sans lire les photos. */
export async function lireEnTete(paquet: Blob): Promise<EnTetePaquet> {
  let manifeste: Manifeste | null = null;
  let donnees: DonneesProjet | null = null;
  const pdfs = new Map<string, Blob>();
  await parcourir(
    paquet,
    async (nom, contenu) => {
      if (nom === 'manifeste.json') manifeste = JSON.parse(await contenu.text());
      else if (nom === 'donnees.json') donnees = JSON.parse(await contenu.text());
      else if (nom.startsWith('plans/')) pdfs.set(nom.slice(6, -4), new Blob([contenu], { type: 'application/pdf' }));
    },
    (nom) => !nom.startsWith('miniatures/') && !nom.startsWith('photos/'),
  );
  const m = manifeste as Manifeste | null;
  if (!m || m.format !== FORMAT_PAQUET || !donnees) {
    throw new Error("Ce fichier n'est pas un paquet de l'application Relevé photo.");
  }
  if (m.version > VERSION_PAQUET) {
    throw new Error("Ce paquet vient d'une version plus récente de l'application : mettez l'application à jour.");
  }
  return { manifeste: m, donnees, pdfs };
}

/**
 * Lit les photos du paquet et appelle surPhoto pour chaque photo voulue (avec sa miniature),
 * avec au plus `simultanees` enregistrements en cours.
 */
export async function lirePhotos(
  paquet: Blob,
  voulues: Set<string>,
  surPhoto: (id: string, jpeg: Blob, miniature: Blob | null) => Promise<void>,
  simultanees = 4,
): Promise<void> {
  const miniatures = new Map<string, Blob>();
  const enCours = new Set<Promise<void>>();
  let erreur: unknown = null;
  await parcourir(paquet, async (nom, contenu) => {
    if (nom.startsWith('miniatures/')) {
      const id = nom.slice(11, -4);
      if (voulues.has(id)) miniatures.set(id, new Blob([contenu], { type: 'image/jpeg' }));
      return;
    }
    if (!nom.startsWith('photos/')) return;
    const id = nom.slice(7, -4);
    if (!voulues.has(id)) return;
    const tache = surPhoto(id, new Blob([contenu], { type: 'image/jpeg' }), miniatures.get(id) ?? null)
      .catch((e) => {
        erreur ??= e;
      })
      .finally(() => {
        miniatures.delete(id);
        enCours.delete(tache);
      });
    enCours.add(tache);
    while (enCours.size >= simultanees) await Promise.race(enCours);
    if (erreur) return false;
  });
  await Promise.all(enCours);
  if (erreur) throw erreur;
}

/** Propose le paquet : partage (téléphone : OneDrive, e-mail…) ou téléchargement. */
export async function partagerPaquet(fichier: File): Promise<'partage' | 'annule'> {
  const n = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!n.canShare?.({ files: [fichier] })) throw new Error('Partage impossible sur cet appareil : utilisez « Télécharger ».');
  try {
    await navigator.share({ files: [fichier], title: fichier.name });
    return 'partage';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'annule';
    throw e;
  }
}

export function partageDisponible(fichier: File): boolean {
  const n = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  return !!n.canShare?.({ files: [fichier] });
}

export function telechargerPaquet(fichier: File, nom: string) {
  const url = URL.createObjectURL(fichier);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
