/**
 * Accès aux emplacements de stockage selon l'appareil.
 * - PC (Chrome, Edge) : choix d'un vrai dossier Windows (File System Access API).
 * - Téléphone : toujours le stockage interne privé de l'appli (OPFS). Chrome sur Android sait
 *   aussi choisir un dossier du téléphone, mais chaque accès y passe par le gestionnaire de
 *   documents d'Android et prend plusieurs secondes (mesuré le 13/11/2026 : 10 s pour lire un
 *   seul petit fichier dans Téléchargements). Les échanges avec le serveur passent par le
 *   paquet .zip (lot 4) puis SharePoint (lot 5).
 */

type FenetreAvecDossiers = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
};

type HandleAvecPermission = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

/** Téléphone ou tablette (Android, iOS). */
export function estTelephone(): boolean {
  const ua = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return ua.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

/** Choix d'un vrai dossier : sur PC seulement (voir plus haut pour le téléphone). */
export function choixDeDossierDisponible(): boolean {
  return typeof (window as FenetreAvecDossiers).showDirectoryPicker === 'function' && !estTelephone();
}

export function stockageAppareilDisponible(): boolean {
  return typeof navigator.storage?.getDirectory === 'function';
}

/** Ouvre la fenêtre Windows de choix de dossier. Renvoie null si l'utilisateur annule. */
export async function choisirDossier(idMemoire: string): Promise<FileSystemDirectoryHandle | null> {
  const f = window as FenetreAvecDossiers;
  if (!f.showDirectoryPicker) throw new Error("Ce navigateur ne permet pas de choisir un dossier. Utilisez Chrome ou Edge sur PC.");
  try {
    return await f.showDirectoryPicker({ id: idMemoire, mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/** Dossier racine des projets dans le stockage interne de l'appareil. */
export async function dossierAppareil(): Promise<FileSystemDirectoryHandle> {
  const racine = await navigator.storage.getDirectory();
  return racine.getDirectoryHandle('projets', { create: true });
}

/** Dossier d'un projet rangé dans le stockage interne de l'appareil. */
export async function dossierProjetAppareil(nom: string): Promise<FileSystemDirectoryHandle> {
  try {
    return await (await dossierAppareil()).getDirectoryHandle(nom);
  } catch {
    throw new Error(`Le projet « ${nom} » n'existe plus dans le stockage de cet appareil.`);
  }
}

/**
 * Vérifie, et redemande si besoin, l'autorisation d'écrire dans un dossier mémorisé.
 * Le navigateur l'oublie en général à sa fermeture : il faut alors un clic de l'utilisateur.
 */
export async function verifierPermission(handle: FileSystemDirectoryHandle, demander: boolean): Promise<boolean> {
  const h = handle as HandleAvecPermission;
  if (!h.queryPermission) return true; // stockage interne : toujours autorisé
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (!demander || !h.requestPermission) return false;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Demande au navigateur de ne pas effacer les données de l'appli (CONCEPTION §A.7). */
export async function demanderStockagePersistant(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
