import { decouperChemin, ErreurIntrouvable, type EntreeDossier, type Stockage } from './Stockage';

/**
 * Stockage dans un dossier accessible par un « handle » de dossier :
 * - sur PC : un vrai dossier Windows choisi par l'utilisateur (File System Access API,
 *   Chrome et Edge), y compris sur le serveur partagé [À VÉRIFIER : lecteur réseau mappé] ;
 * - sur téléphone : le stockage interne et privé du navigateur (OPFS).
 * Les deux offrent exactement la même interface, d'où une seule implémentation.
 */
export class StockageDossier implements Stockage {
  constructor(
    private readonly racine: FileSystemDirectoryHandle,
    readonly libelle: string,
  ) {}

  private async dossier(morceaux: string[], creer: boolean): Promise<FileSystemDirectoryHandle> {
    let d = this.racine;
    for (const m of morceaux) {
      try {
        d = await d.getDirectoryHandle(m, { create: creer });
      } catch (e) {
        if (estIntrouvable(e)) throw new ErreurIntrouvable(morceaux.join('/'));
        throw e;
      }
    }
    return d;
  }

  private separer(chemin: string): [string[], string] {
    const morceaux = decouperChemin(chemin);
    const nom = morceaux.pop();
    if (!nom) throw new Error('Chemin vide');
    return [morceaux, nom];
  }

  private async entree(chemin: string): Promise<FileSystemHandle | null> {
    const morceaux = decouperChemin(chemin);
    if (morceaux.length === 0) return this.racine;
    const [parents, nom] = this.separer(chemin);
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await this.dossier(parents, false);
    } catch (e) {
      if (e instanceof ErreurIntrouvable || estIntrouvable(e) || estMauvaisType(e)) return null;
      throw e;
    }
    for (const essai of [() => parent.getFileHandle(nom), () => parent.getDirectoryHandle(nom)]) {
      try {
        return await essai();
      } catch (e) {
        if (!estIntrouvable(e) && !estMauvaisType(e)) throw e;
      }
    }
    return null;
  }

  async existe(chemin: string) {
    return (await this.entree(chemin)) !== null;
  }

  async lister(cheminDossier: string): Promise<EntreeDossier[]> {
    const d = await this.dossier(decouperChemin(cheminDossier), false);
    const resultat: EntreeDossier[] = [];
    for await (const [nom, h] of d.entries()) {
      resultat.push({ nom, type: h.kind === 'directory' ? 'dossier' : 'fichier' });
    }
    return resultat;
  }

  async creerDossier(cheminDossier: string) {
    await this.dossier(decouperChemin(cheminDossier), true);
  }

  async lireFichier(chemin: string): Promise<Blob> {
    const [parents, nom] = this.separer(chemin);
    const d = await this.dossier(parents, false);
    try {
      return await (await d.getFileHandle(nom)).getFile();
    } catch (e) {
      if (estIntrouvable(e) || estMauvaisType(e)) throw new ErreurIntrouvable(chemin);
      throw e;
    }
  }

  async ecrireFichier(chemin: string, contenu: Blob | string) {
    const [parents, nom] = this.separer(chemin);
    const d = await this.dossier(parents, true);
    const f = await d.getFileHandle(nom, { create: true });
    // createWritable écrit dans un fichier temporaire, remplacé seulement à la fermeture :
    // un fichier n'est jamais laissé à moitié écrit.
    const flux = await f.createWritable();
    try {
      await flux.write(contenu);
      await flux.close();
    } catch (e) {
      await flux.abort().catch(() => undefined);
      throw e;
    }
  }

  async supprimer(chemin: string) {
    const [parents, nom] = this.separer(chemin);
    let d: FileSystemDirectoryHandle;
    try {
      d = await this.dossier(parents, false);
    } catch (e) {
      if (e instanceof ErreurIntrouvable) return;
      throw e;
    }
    try {
      await d.removeEntry(nom, { recursive: true });
    } catch (e) {
      if (!estIntrouvable(e)) throw e;
    }
  }

  async deplacer(source: string, destination: string) {
    const h = await this.entree(source);
    if (!h) throw new ErreurIntrouvable(source);
    if (await this.existe(destination)) throw new Error(`La destination existe déjà : ${destination}`);
    const [parentsDest, nomDest] = this.separer(destination);
    const dossierDest = await this.dossier(parentsDest, true);

    // Déplacement natif quand le navigateur le permet (Chromium récent).
    const deplacable = h as FileSystemHandle & {
      move?: (dossier: FileSystemDirectoryHandle, nom: string) => Promise<void>;
    };
    if (typeof deplacable.move === 'function') {
      try {
        await deplacable.move(dossierDest, nomDest);
        return;
      } catch {
        // Non pris en charge pour ce type d'emplacement : on passe à la copie.
      }
    }
    // Sinon : copie complète, vérifiée, puis suppression de l'original.
    await this.copier(source, destination);
    await this.supprimer(source);
  }

  private async copier(source: string, destination: string) {
    const h = await this.entree(source);
    if (!h) throw new ErreurIntrouvable(source);
    if (h.kind === 'file') {
      const blob = await (h as FileSystemFileHandle).getFile();
      await this.ecrireFichier(destination, blob);
      const copie = await this.lireFichier(destination);
      if (copie.size !== blob.size) throw new Error(`Copie incomplète : ${destination}`);
      return;
    }
    await this.creerDossier(destination);
    for (const e of await this.lister(source)) {
      await this.copier(`${source}/${e.nom}`, `${destination}/${e.nom}`);
    }
  }
}

function estIntrouvable(e: unknown) {
  return e instanceof DOMException && e.name === 'NotFoundError';
}
function estMauvaisType(e: unknown) {
  return e instanceof DOMException && (e.name === 'TypeMismatchError' || e.name === 'TypeError');
}
