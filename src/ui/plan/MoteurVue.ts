import type { PagePdf } from '../../pdf/pdf';

/**
 * Moteur d'affichage d'un plan : déplacement et zoom fluides (souris, molette, doigts),
 * rendu net à tous les zooms grâce à des tuiles calculées à la demande.
 *
 * Repère « monde » : la page du plan, en points PDF (rotation de la page appliquée).
 * Écran = monde × zoom + décalage.
 *
 * Couches, de bas en haut :
 *  - une image de fond de toute la page, rendue une fois (affichage immédiat à faible zoom) ;
 *  - des tuiles de 512 px, rendues au niveau de zoom courant, pour les zones visibles ;
 *  - les marqueurs (locaux, plus tard repères), qui gardent une taille constante à l'écran.
 */

const TUILE = 512;
const MAX_TUILES_EN_CACHE = 60;
/** Taille maximale de l'image de fond, en pixels (limite mémoire des téléphones). */
const MAX_FOND = 4096;
/** Résolution maximale des tuiles, en pixels par point PDF. */
const ECHELLE_MAX = 8;
/** Demi-hauteur typique d'une étiquette de local sur un plan (3 à 4 lignes de texte), en points PDF. */
const DEMI_HAUTEUR_ETIQUETTE = 16;

export interface EvenementsMoteur {
  /** Appui court sur le plan (hors marqueur), en coordonnées relatives 0 à 1. */
  surAppui?: (x: number, y: number) => void;
  /** Appui long (0,5 s sans bouger) sur le plan : nouveau repère. */
  surAppuiLong?: (x: number, y: number) => void;
  /** Le zoom a changé (pour l'affichage du pourcentage, par exemple). */
  surVue?: (zoom: number, zoomAjuste: number) => void;
}

interface Tuile {
  canevas: HTMLCanvasElement;
  pret: boolean;
}

export class MoteurVue {
  readonly largeur: number;
  readonly hauteur: number;
  private zoom = 1;
  private tx = 0;
  private ty = 0;
  private zoomAjuste = 1;
  private readonly monde: HTMLDivElement;
  private readonly coucheTuiles: HTMLDivElement;
  private readonly tuiles = new Map<string, Tuile>();
  private file: string[] = [];
  private renduEnCours = false;
  private minuterieTuiles = 0;
  private detruit = false;
  private readonly pointeurs = new Map<number, { x: number; y: number }>();
  private geste: null | {
    debut: number;
    deplace: boolean;
    depart: { x: number; y: number };
    zoom: number;
    tx: number;
    ty: number;
    distance?: number;
    milieu?: { x: number; y: number };
    long?: boolean;
  } = null;
  private minuterieLong = 0;
  private readonly observateur: ResizeObserver;
  private dejaAjuste = false;

  constructor(
    private readonly conteneur: HTMLElement,
    private readonly coucheMarqueurs: HTMLElement,
    private readonly page: PagePdf,
    private readonly evenements: EvenementsMoteur,
  ) {
    const vue = page.getViewport({ scale: 1 });
    this.largeur = vue.width;
    this.hauteur = vue.height;

    this.monde = document.createElement('div');
    this.monde.className = 'vue-monde';
    Object.assign(this.monde.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${this.largeur}px`,
      height: `${this.hauteur}px`,
      transformOrigin: '0 0',
      background: '#fff',
    });
    this.coucheTuiles = document.createElement('div');
    Object.assign(this.coucheTuiles.style, { position: 'absolute', inset: '0' });
    this.monde.appendChild(this.coucheTuiles);
    conteneur.prepend(this.monde);

    conteneur.addEventListener('wheel', this.surMolette, { passive: false });
    conteneur.addEventListener('pointerdown', this.surPointeurBas);
    conteneur.addEventListener('pointermove', this.surPointeurDeplace);
    conteneur.addEventListener('pointerup', this.surPointeurHaut);
    conteneur.addEventListener('pointercancel', this.surPointeurHaut);
    conteneur.addEventListener('dblclick', this.surDoubleClic);
    conteneur.addEventListener('contextmenu', this.surMenuContextuel);
    this.observateur = new ResizeObserver(() => {
      if (!this.dejaAjuste) this.ajuster();
      else this.appliquer();
    });
    this.observateur.observe(conteneur);
    this.ajuster();
    void this.rendreFond();
  }

  detruire() {
    this.detruit = true;
    this.observateur.disconnect();
    this.conteneur.removeEventListener('wheel', this.surMolette);
    this.conteneur.removeEventListener('pointerdown', this.surPointeurBas);
    this.conteneur.removeEventListener('pointermove', this.surPointeurDeplace);
    this.conteneur.removeEventListener('pointerup', this.surPointeurHaut);
    this.conteneur.removeEventListener('pointercancel', this.surPointeurHaut);
    this.conteneur.removeEventListener('dblclick', this.surDoubleClic);
    this.conteneur.removeEventListener('contextmenu', this.surMenuContextuel);
    window.clearTimeout(this.minuterieTuiles);
    window.clearTimeout(this.minuterieLong);
    this.monde.remove();
    this.tuiles.clear();
  }

  // ------------------------------------------------------------ vue

  /** Affiche la page entière, centrée. */
  ajuster() {
    const { clientWidth: l, clientHeight: h } = this.conteneur;
    if (l === 0 || h === 0) return;
    this.dejaAjuste = true;
    this.zoomAjuste = Math.min(l / this.largeur, h / this.hauteur);
    this.zoom = this.zoomAjuste;
    this.tx = (l - this.largeur * this.zoom) / 2;
    this.ty = (h - this.hauteur * this.zoom) / 2;
    this.appliquer();
  }

  /** Centre la vue sur un point relatif (0 à 1), avec un zoom exprimé en multiple du zoom « page entière ». */
  centrerSur(x: number, y: number, facteurZoom = 6) {
    const { clientWidth: l, clientHeight: h } = this.conteneur;
    if (!this.dejaAjuste) this.ajuster();
    this.zoom = this.borner(this.zoomAjuste * facteurZoom);
    this.tx = l / 2 - x * this.largeur * this.zoom;
    this.ty = h / 2 - y * this.hauteur * this.zoom;
    this.appliquer();
  }

  /** Zoom avant ou arrière autour du centre de l'écran. */
  zoomer(facteur: number) {
    const { clientWidth: l, clientHeight: h } = this.conteneur;
    this.zoomerAutour(l / 2, h / 2, facteur);
  }

  private borner(z: number) {
    return Math.min(Math.max(z, this.zoomAjuste * 0.5), ECHELLE_MAX);
  }

  private zoomerAutour(sx: number, sy: number, facteur: number) {
    const nouveau = this.borner(this.zoom * facteur);
    const k = nouveau / this.zoom;
    this.tx = sx - (sx - this.tx) * k;
    this.ty = sy - (sy - this.ty) * k;
    this.zoom = nouveau;
    this.appliquer();
  }

  /** Coordonnées relatives (0 à 1) d'un point de l'écran (relatif au conteneur). */
  versRelatif(sx: number, sy: number) {
    return { x: (sx - this.tx) / this.zoom / this.largeur, y: (sy - this.ty) / this.zoom / this.hauteur };
  }

  /** Met à jour l'affichage : transformation du plan et position des marqueurs. */
  appliquer() {
    this.monde.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom})`;
    // Hauteur de la tige des marqueurs : l'étiquette passe au-dessus de l'étiquette du local
    // dessinée sur le plan (environ 16 points de haut au-dessus de son centre).
    this.conteneur.style.setProperty('--decalage', `${Math.round(Math.max(14, DEMI_HAUTEUR_ETIQUETTE * this.zoom + 6))}px`);
    this.placerMarqueurs();
    this.evenements.surVue?.(this.zoom, this.zoomAjuste);
    window.clearTimeout(this.minuterieTuiles);
    this.minuterieTuiles = window.setTimeout(() => this.planifierTuiles(), 120);
  }

  /** Place les marqueurs (éléments enfants portant data-x et data-y relatifs) à leur position écran. */
  placerMarqueurs() {
    for (const el of this.coucheMarqueurs.children) {
      const e = el as HTMLElement;
      const x = Number(e.dataset.x);
      const y = Number(e.dataset.y);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      e.style.transform = `translate(${x * this.largeur * this.zoom + this.tx}px, ${y * this.hauteur * this.zoom + this.ty}px)`;
    }
  }

  // ------------------------------------------------------------ rendu

  private async rendreFond() {
    const echelle = Math.min(MAX_FOND / this.largeur, MAX_FOND / this.hauteur, 2);
    const vue = this.page.getViewport({ scale: echelle });
    const canevas = document.createElement('canvas');
    canevas.width = Math.floor(vue.width);
    canevas.height = Math.floor(vue.height);
    Object.assign(canevas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
    await this.page.render({ canvas: canevas, viewport: vue }).promise;
    if (this.detruit) return;
    this.monde.insertBefore(canevas, this.coucheTuiles);
    this.conteneur.dataset.fondPret = 'oui';
    this.planifierTuiles();
  }

  /** Échelle de rendu des tuiles pour le zoom courant (puissance de 2), ou null si le fond suffit. */
  private echelleTuiles(): number | null {
    const besoin = this.zoom * (window.devicePixelRatio || 1);
    const fond = Math.min(MAX_FOND / this.largeur, MAX_FOND / this.hauteur, 2);
    if (besoin <= fond * 1.15) return null;
    return Math.min(2 ** Math.ceil(Math.log2(besoin)), ECHELLE_MAX);
  }

  private planifierTuiles() {
    if (this.detruit) return;
    const echelle = this.echelleTuiles();
    // N'afficher que les tuiles du niveau courant.
    for (const [cle, t] of this.tuiles) {
      t.canevas.style.display = echelle !== null && cle.startsWith(`${echelle}:`) ? '' : 'none';
    }
    if (echelle === null) {
      this.file = [];
      return;
    }
    const { clientWidth: l, clientHeight: h } = this.conteneur;
    const cote = TUILE / echelle; // côté d'une tuile, en points PDF
    const x1 = Math.max(0, -this.tx / this.zoom);
    const y1 = Math.max(0, -this.ty / this.zoom);
    const x2 = Math.min(this.largeur, (l - this.tx) / this.zoom);
    const y2 = Math.min(this.hauteur, (h - this.ty) / this.zoom);
    if (x2 <= x1 || y2 <= y1) return;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const voulues: Array<{ cle: string; d: number }> = [];
    for (let i = Math.floor(x1 / cote); i <= Math.floor((x2 - 0.001) / cote); i++) {
      for (let j = Math.floor(y1 / cote); j <= Math.floor((y2 - 0.001) / cote); j++) {
        const cle = `${echelle}:${i}:${j}`;
        if (this.tuiles.get(cle)?.pret) continue;
        voulues.push({ cle, d: Math.hypot((i + 0.5) * cote - cx, (j + 0.5) * cote - cy) });
      }
    }
    // Les tuiles du centre de l'écran d'abord.
    this.file = voulues.sort((a, b) => a.d - b.d).map((v) => v.cle);
    void this.rendreFile();
  }

  private async rendreFile() {
    if (this.renduEnCours) return;
    this.renduEnCours = true;
    try {
      while (this.file.length > 0 && !this.detruit) {
        const cle = this.file.shift()!;
        if (this.tuiles.get(cle)?.pret) continue;
        await this.rendreTuile(cle);
      }
    } finally {
      this.renduEnCours = false;
    }
  }

  private async rendreTuile(cle: string) {
    const [echelle, i, j] = cle.split(':').map(Number);
    const vue = this.page.getViewport({ scale: echelle });
    const largeur = Math.min(TUILE, Math.ceil(vue.width - i * TUILE));
    const hauteur = Math.min(TUILE, Math.ceil(vue.height - j * TUILE));
    if (largeur <= 0 || hauteur <= 0) return;
    const canevas = document.createElement('canvas');
    canevas.width = largeur;
    canevas.height = hauteur;
    Object.assign(canevas.style, {
      position: 'absolute',
      left: `${(i * TUILE) / echelle}px`,
      top: `${(j * TUILE) / echelle}px`,
      width: `${largeur / echelle}px`,
      height: `${hauteur / echelle}px`,
    });
    const tuile: Tuile = { canevas, pret: false };
    this.tuiles.set(cle, tuile);
    try {
      await this.page.render({ canvas: canevas, viewport: vue, transform: [1, 0, 0, 1, -i * TUILE, -j * TUILE] }).promise;
    } catch {
      this.tuiles.delete(cle);
      return;
    }
    if (this.detruit) return;
    tuile.pret = true;
    canevas.style.display = this.echelleTuiles() === echelle ? '' : 'none';
    this.coucheTuiles.appendChild(canevas);
    this.purgerCache();
  }

  private purgerCache() {
    while (this.tuiles.size > MAX_TUILES_EN_CACHE) {
      const [cle, t] = this.tuiles.entries().next().value!;
      this.tuiles.delete(cle);
      t.canevas.remove();
      t.canevas.width = 0; // libère la mémoire tout de suite
    }
  }

  // ------------------------------------------------------------ gestes

  private positionLocale(e: { clientX: number; clientY: number }) {
    const r = this.conteneur.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private surMolette = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.positionLocale(e);
    // Pincement du pavé tactile (ctrlKey) : plus sensible.
    const facteur = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    this.zoomerAutour(p.x, p.y, facteur);
  };

  private surDoubleClic = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-marqueur]')) return;
    const p = this.positionLocale(e);
    this.zoomerAutour(p.x, p.y, 2);
  };

  private surPointeurBas = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-marqueur], button, input')) return;
    this.conteneur.setPointerCapture(e.pointerId);
    this.pointeurs.set(e.pointerId, this.positionLocale(e));
    this.demarrerGeste();
    window.clearTimeout(this.minuterieLong);
    if (this.pointeurs.size === 1 && this.evenements.surAppuiLong) {
      const depart = this.positionLocale(e);
      this.minuterieLong = window.setTimeout(() => {
        const g = this.geste;
        if (!g || g.deplace || this.pointeurs.size !== 1) return;
        g.long = true;
        const r = this.versRelatif(depart.x, depart.y);
        if (r.x >= 0 && r.x <= 1 && r.y >= 0 && r.y <= 1) {
          navigator.vibrate?.(40);
          this.evenements.surAppuiLong?.(r.x, r.y);
        }
      }, 500);
    }
  };

  /** Le menu contextuel (appui long sur téléphone, clic droit) laisserait place à l'appui long. */
  private surMenuContextuel = (e: Event) => e.preventDefault();

  private demarrerGeste() {
    const points = [...this.pointeurs.values()];
    const base = { debut: performance.now(), deplace: this.geste?.deplace ?? false, zoom: this.zoom, tx: this.tx, ty: this.ty };
    if (points.length === 1) this.geste = { ...base, depart: points[0] };
    else if (points.length >= 2) {
      const [a, b] = points;
      this.geste = {
        ...base,
        deplace: true,
        depart: a,
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        milieu: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
  }

  private surPointeurDeplace = (e: PointerEvent) => {
    if (!this.pointeurs.has(e.pointerId) || !this.geste) return;
    this.pointeurs.set(e.pointerId, this.positionLocale(e));
    const points = [...this.pointeurs.values()];
    const g = this.geste;
    if (points.length === 1) {
      const dx = points[0].x - g.depart.x;
      const dy = points[0].y - g.depart.y;
      if (!g.deplace && Math.hypot(dx, dy) < 6) return;
      g.deplace = true;
      window.clearTimeout(this.minuterieLong);
      this.tx = g.tx + dx;
      this.ty = g.ty + dy;
      this.appliquer();
    } else if (points.length >= 2 && g.distance && g.milieu) {
      const [a, b] = points;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const milieu = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoom = this.borner(g.zoom * (distance / g.distance));
      const k = zoom / g.zoom;
      this.zoom = zoom;
      this.tx = milieu.x - (g.milieu.x - g.tx) * k;
      this.ty = milieu.y - (g.milieu.y - g.ty) * k;
      this.appliquer();
    }
  };

  private surPointeurHaut = (e: PointerEvent) => {
    if (!this.pointeurs.has(e.pointerId)) return;
    this.pointeurs.delete(e.pointerId);
    const g = this.geste;
    window.clearTimeout(this.minuterieLong);
    if (this.pointeurs.size === 0) {
      this.geste = null;
      if (g && !g.deplace && !g.long && performance.now() - g.debut < 500 && e.type === 'pointerup') {
        const p = this.positionLocale(e);
        const r = this.versRelatif(p.x, p.y);
        if (r.x >= 0 && r.x <= 1 && r.y >= 0 && r.y <= 1) this.evenements.surAppui?.(r.x, r.y);
      }
    } else {
      // Un doigt levé pendant un pincement : on repart d'un geste à un doigt.
      this.demarrerGeste();
    }
  };
}
