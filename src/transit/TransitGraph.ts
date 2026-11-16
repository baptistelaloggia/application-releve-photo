/**
 * Accès à la bibliothèque SharePoint « Transit » par Microsoft Graph (lot 5).
 * Seules quelques opérations sont utilisées : lister un dossier, télécharger, déposer, supprimer.
 * Les chemins sont relatifs à la racine de la bibliothèque, séparés par « / ».
 */
import type { ConfigTransit } from './config';
import { obtenirJeton } from './connexion';

export interface ElementTransit {
  nom: string;
  dossier: boolean;
  taille: number;
  modifieLe: string;
}

/** Taille des morceaux d'envoi : multiple de 320 Kio exigé par Graph ; 10 Mio au plus conseillés. */
const MORCEAU = 320 * 1024 * 30; // 9,4 Mio
/** Au-delà, l'envoi se fait par « session d'envoi », en morceaux (limite Graph de l'envoi simple : 4 Mo). */
const ENVOI_SIMPLE_MAX = 4 * 1000 * 1000;

export class ErreurTransit extends Error {
  constructor(
    message: string,
    readonly statut: number,
  ) {
    super(message);
    this.name = 'ErreurTransit';
  }
}

const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const encoderChemin = (chemin: string) => chemin.split('/').filter(Boolean).map(encodeURIComponent).join('/');

export class TransitGraph {
  private readonly base: string;
  private lecteur: Promise<string> | null = null;

  constructor(private readonly config: ConfigTransit) {
    this.base = config.test?.baseGraph ?? 'https://graph.microsoft.com/v1.0';
  }

  get libelle() {
    return `${this.config.siteUrl} › ${this.config.bibliotheque}`;
  }

  /**
   * Appel à Graph avec le jeton ; nouvel essai automatique si le service demande d'attendre
   * (429, 503) ou en cas de coupure réseau passagère.
   */
  private async appel(url: string, init: RequestInit = {}, avecJeton = true): Promise<Response> {
    for (let essai = 0; ; essai++) {
      let r: Response;
      try {
        const entetes = new Headers(init.headers);
        if (avecJeton) entetes.set('Authorization', `Bearer ${await obtenirJeton(this.config)}`);
        r = await fetch(url, { ...init, headers: entetes });
      } catch (e) {
        if (essai < 3) {
          await attendre(1000 * 2 ** essai);
          continue;
        }
        throw new ErreurTransit(`SharePoint injoignable (${e instanceof Error ? e.message : String(e)}). Vérifiez la connexion Internet.`, 0);
      }
      if ((r.status === 429 || r.status === 503 || r.status === 504) && essai < 4) {
        const delai = Number(r.headers.get('Retry-After') ?? 0) * 1000 || 1000 * 2 ** essai;
        await attendre(Math.min(delai, 30_000));
        continue;
      }
      return r;
    }
  }

  private async verifier(r: Response, quoi: string): Promise<Response> {
    if (r.ok) return r;
    let detail = '';
    try {
      detail = ((await r.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* corps illisible */
    }
    const message =
      r.status === 401
        ? 'Connexion Microsoft refusée ou expirée : reconnectez-vous.'
        : r.status === 403
          ? "Accès refusé : l'application n'a pas (encore) le droit d'accéder à ce site SharePoint (permission Sites.Selected à accorder par la DSI)."
          : `${quoi} : erreur ${r.status}${detail ? ` (${detail})` : ''}`;
    throw new ErreurTransit(message, r.status);
  }

  /** Identifiant de la bibliothèque (« drive ») : site d'après son adresse, puis bibliothèque d'après son nom. */
  private idLecteur(): Promise<string> {
    this.lecteur ??= (async () => {
      const url = new URL(this.config.siteUrl.trim());
      const chemin = url.pathname.replace(/\/+$/, '');
      const site = (await (await this.verifier(await this.appel(`${this.base}/sites/${url.hostname}:${chemin}`), 'Site SharePoint')).json()) as { id: string };
      const lecteurs = (await (await this.verifier(await this.appel(`${this.base}/sites/${site.id}/drives`), 'Bibliothèques du site')).json()) as {
        value: Array<{ id: string; name: string }>;
      };
      const voulu = this.config.bibliotheque.trim().toLowerCase();
      const trouve = lecteurs.value.find((d) => d.name.toLowerCase() === voulu);
      if (!trouve) {
        throw new ErreurTransit(
          `Bibliothèque « ${this.config.bibliotheque} » introuvable sur le site (bibliothèques : ${lecteurs.value.map((d) => d.name).join(', ') || 'aucune'}).`,
          404,
        );
      }
      return trouve.id;
    })().catch((e) => {
      this.lecteur = null;
      throw e;
    });
    return this.lecteur;
  }

  private async url(chemin: string, suite = '') {
    const c = encoderChemin(chemin);
    // Forme documentée par Graph : « root:/chemin » pour l'élément, « root:/chemin:/action » pour une action.
    const racine = `${this.base}/drives/${await this.idLecteur()}/root`;
    if (!c) return `${racine}${suite}`;
    return suite ? `${racine}:/${c}:${suite}` : `${racine}:/${c}`;
  }

  /** Vérifie l'accès (connexion, site, bibliothèque). */
  async tester(): Promise<void> {
    await this.idLecteur();
    await this.lister('');
  }

  /** Contenu d'un dossier ; [] si le dossier n'existe pas. */
  async lister(dossier: string): Promise<ElementTransit[]> {
    const elements: ElementTransit[] = [];
    let suivant: string | null = `${await this.url(dossier, '/children')}?$top=200&$select=name,size,lastModifiedDateTime,folder,file`;
    while (suivant) {
      const r = await this.appel(suivant);
      if (r.status === 404) return [];
      const page = (await (await this.verifier(r, 'Liste du transit')).json()) as {
        value: Array<{ name: string; size?: number; lastModifiedDateTime?: string; folder?: unknown }>;
        '@odata.nextLink'?: string;
      };
      for (const e of page.value) {
        elements.push({ nom: e.name, dossier: !!e.folder, taille: e.size ?? 0, modifieLe: e.lastModifiedDateTime ?? '' });
      }
      suivant = page['@odata.nextLink'] ?? null;
    }
    return elements;
  }

  /** Télécharge un fichier ; null s'il n'existe pas. */
  async telecharger(chemin: string): Promise<Blob | null> {
    const r = await this.appel(await this.url(chemin, '/content'));
    if (r.status === 404) return null;
    return (await this.verifier(r, `Téléchargement de ${chemin}`)).blob();
  }

  /** Dépose (ou remplace) un fichier ; les dossiers intermédiaires sont créés par Graph. */
  async deposer(chemin: string, contenu: Blob, progression: (fait: number, total: number) => void = () => undefined): Promise<void> {
    if (contenu.size <= ENVOI_SIMPLE_MAX) {
      await this.verifier(
        await this.appel(await this.url(chemin, '/content'), { method: 'PUT', body: contenu, headers: { 'Content-Type': 'application/octet-stream' } }),
        `Dépôt de ${chemin}`,
      );
      progression(contenu.size, contenu.size);
      return;
    }
    const session = (await (
      await this.verifier(
        await this.appel(await this.url(chemin, '/createUploadSession'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
        }),
        `Dépôt de ${chemin}`,
      )
    ).json()) as { uploadUrl: string };
    for (let debut = 0; debut < contenu.size; ) {
      const fin = Math.min(debut + MORCEAU, contenu.size);
      // L'adresse de session est déjà autorisée : pas de jeton (exigence de Graph).
      const r = await this.appel(
        session.uploadUrl,
        { method: 'PUT', body: contenu.slice(debut, fin), headers: { 'Content-Range': `bytes ${debut}-${fin - 1}/${contenu.size}` } },
        false,
      );
      await this.verifier(r, `Dépôt de ${chemin}`);
      progression(fin, contenu.size);
      if (r.status === 200 || r.status === 201) break;
      const attendu = ((await r.json()) as { nextExpectedRanges?: string[] }).nextExpectedRanges?.[0];
      debut = attendu ? Number(attendu.split('-')[0]) : fin;
    }
  }

  /** Supprime un fichier ou un dossier (et son contenu). Sans erreur s'il n'existe pas. */
  async supprimer(chemin: string): Promise<void> {
    const r = await this.appel(await this.url(chemin), { method: 'DELETE' });
    if (r.status === 404) return;
    await this.verifier(r, `Suppression de ${chemin}`);
  }
}
