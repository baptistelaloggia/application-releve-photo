import { decouperChemin, ErreurIntrouvable, type EntreeDossier, type Stockage } from './Stockage';

type Noeud = { type: 'dossier'; enfants: Map<string, Noeud> } | { type: 'fichier'; contenu: Blob };

/** Stockage en mémoire, utilisé par les tests automatiques. */
export class StockageMemoire implements Stockage {
  readonly libelle = 'Mémoire (test)';
  private racine: Noeud = { type: 'dossier', enfants: new Map() };

  private trouver(chemin: string): Noeud | undefined {
    let noeud: Noeud = this.racine;
    for (const m of decouperChemin(chemin)) {
      if (noeud.type !== 'dossier') return undefined;
      const suivant = noeud.enfants.get(m);
      if (!suivant) return undefined;
      noeud = suivant;
    }
    return noeud;
  }

  private dossier(chemin: string, creer: boolean): Map<string, Noeud> {
    let noeud: Noeud = this.racine;
    for (const m of decouperChemin(chemin)) {
      if (noeud.type !== 'dossier') throw new Error(`Pas un dossier : ${chemin}`);
      let suivant = noeud.enfants.get(m);
      if (!suivant) {
        if (!creer) throw new ErreurIntrouvable(chemin);
        suivant = { type: 'dossier', enfants: new Map() };
        noeud.enfants.set(m, suivant);
      }
      noeud = suivant;
    }
    if (noeud.type !== 'dossier') throw new Error(`Pas un dossier : ${chemin}`);
    return noeud.enfants;
  }

  private parent(chemin: string): [string, string] {
    const morceaux = decouperChemin(chemin);
    const nom = morceaux.pop();
    if (!nom) throw new Error('Chemin vide');
    return [morceaux.join('/'), nom];
  }

  async existe(chemin: string) {
    return this.trouver(chemin) !== undefined;
  }

  async lister(cheminDossier: string): Promise<EntreeDossier[]> {
    const enfants = this.dossier(cheminDossier, false);
    return [...enfants].map(([nom, n]) => ({ nom, type: n.type }));
  }

  async creerDossier(cheminDossier: string) {
    this.dossier(cheminDossier, true);
  }

  async lireFichier(chemin: string) {
    const n = this.trouver(chemin);
    if (!n || n.type !== 'fichier') throw new ErreurIntrouvable(chemin);
    return n.contenu;
  }

  async ecrireFichier(chemin: string, contenu: Blob | string) {
    const [p, nom] = this.parent(chemin);
    const blob = typeof contenu === 'string' ? new Blob([contenu]) : contenu;
    this.dossier(p, true).set(nom, { type: 'fichier', contenu: blob });
  }

  async supprimer(chemin: string) {
    const [p, nom] = this.parent(chemin);
    if (!this.trouver(p)) return;
    this.dossier(p, false).delete(nom);
  }

  async deplacer(source: string, destination: string) {
    const n = this.trouver(source);
    if (!n) throw new ErreurIntrouvable(source);
    if (this.trouver(destination)) throw new Error(`La destination existe déjà : ${destination}`);
    const [ps, ns] = this.parent(source);
    const [pd, nd] = this.parent(destination);
    this.dossier(pd, true).set(nd, n);
    this.dossier(ps, false).delete(ns);
  }

  /** Arborescence complète, pour les tests (« dossier/ » pour les dossiers). */
  async arborescence(chemin = ''): Promise<string[]> {
    const lignes: string[] = [];
    for (const e of (await this.lister(chemin)).sort((a, b) => a.nom.localeCompare(b.nom))) {
      const c = chemin ? `${chemin}/${e.nom}` : e.nom;
      if (e.type === 'dossier') {
        lignes.push(`${c}/`);
        lignes.push(...(await this.arborescence(c)));
      } else lignes.push(c);
    }
    return lignes;
  }
}
