import { useEffect, useRef, useState, type PointerEvent as EvenementPointeur } from 'react';
import { annotationTouchee, deplacerAnnotation, elementsSvg, POINTS_MAX, TEXTE_MAX } from '../../domaine/annotations';
import type { Annotation, Photo } from '../../domaine/types';
import type { EspaceProjet } from '../../projet/EspaceProjet';
import { fabriquerCopieAnnotee } from '../../photo/annotation';
import { texteErreur } from '../commun';
import { useRetour } from '../retour';

type Outil = 'ok' | 'nok' | 'bulle' | 'cercle' | 'trait';

const OUTILS: Array<{ outil: Outil; libelle: string; titre: string }> = [
  { outil: 'ok', libelle: '✔', titre: 'V vert : travaux conformes' },
  { outil: 'nok', libelle: '✖', titre: 'X rouge : travaux non conformes' },
  { outil: 'bulle', libelle: '💬', titre: 'Bulle : texte encadré' },
  { outil: 'cercle', libelle: '◯', titre: 'Cercle : glisser pour entourer' },
  { outil: 'trait', libelle: '✎', titre: 'Trait à main levée' },
];

/** Durée de l'appui long qui saisit une annotation pour la déplacer. */
const APPUI_LONG_MS = 450;
/** Au-delà de ce glissement (pixels écran) avant la fin de l'appui long, c'est un tracé, pas un déplacement. */
const TOLERANCE_PX = 10;

interface Props {
  espace: EspaceProjet;
  photo: Photo;
  surFermer: () => void;
  /** Après l'enregistrement (la photo modifiée est passée). */
  surEnregistre: (photo: Photo) => void;
}

/**
 * Annotation d'une photo : on choisit un outil, puis on touche la photo.
 * V, X : un appui. Bulle : un appui à l'endroit voulu, puis le texte. Cercle, trait : on glisse.
 * Appui long sur une annotation existante, puis glisser : elle se déplace.
 */
export function EditeurAnnotations({ espace, photo, surFermer, surEnregistre }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [taille, setTaille] = useState<{ l: number; h: number } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>(photo.annotations ?? []);
  const [outil, setOutil] = useState<Outil>('ok');
  const [enCours, setEnCours] = useState<Annotation | null>(null);
  const [saisie, setSaisie] = useState<{ x: number; y: number; texte: string } | null>(null);
  /** Rang de l'annotation en cours de déplacement. */
  const [deplacee, setDeplacee] = useState<number | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  /** Appui en cours : point de départ (relatif et écran), annotation visée, minuteur de l'appui long. */
  const geste = useRef<{
    x: number;
    y: number;
    ex: number;
    ey: number;
    visee: number;
    minuteur: number;
    mode: 'attente' | 'trace' | 'deplacement';
    dernier: { x: number; y: number };
  } | null>(null);
  const original = useRef<Blob | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let annule = false;
    espace
      .lirePhoto(photo)
      .then((b) => {
        if (annule) return;
        original.current = b;
        url = URL.createObjectURL(b);
        const img = new Image();
        img.onload = () => !annule && setTaille({ l: img.naturalWidth, h: img.naturalHeight });
        img.src = url;
        setSrc(url);
      })
      .catch((e) => setErreur(texteErreur(e)));
    return () => {
      annule = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [espace, photo]);

  /** Position du doigt, relative à l'image (0 à 1). */
  function position(e: EvenementPointeur): { x: number; y: number } | null {
    const s = svg.current;
    const m = s?.getScreenCTM();
    if (!s || !m || !taille) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.min(1, Math.max(0, p.x / taille.l)), y: Math.min(1, Math.max(0, p.y / taille.h)) };
  }

  function commencerTrace(p: { x: number; y: number }) {
    if (outil === 'trait') setEnCours({ type: 'trait', points: [[p.x, p.y]] });
    if (outil === 'cercle') setEnCours({ type: 'cercle', x: p.x, y: p.y, rx: 0, ry: 0 });
  }

  function appui(e: EvenementPointeur) {
    if (saisie || occupe || !taille) return;
    const p = position(e);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const visee = annotationTouchee(annotations, p.x, p.y, taille.l, taille.h);
    const g = { ...p, ex: e.clientX, ey: e.clientY, visee, minuteur: 0, mode: 'attente' as const, dernier: p };
    if (visee >= 0) {
      // Appui long sur une annotation : elle est saisie et suit le doigt.
      g.minuteur = window.setTimeout(() => {
        const courant = geste.current;
        if (!courant || courant.mode !== 'attente') return;
        courant.mode = 'deplacement';
        setDeplacee(courant.visee);
        navigator.vibrate?.(40);
      }, APPUI_LONG_MS);
      geste.current = g;
    } else {
      geste.current = { ...g, mode: 'trace' };
      commencerTrace(p);
    }
  }

  function glisse(e: EvenementPointeur) {
    const g = geste.current;
    if (!g) return;
    const p = position(e);
    if (!p) return;
    if (g.mode === 'attente') {
      if (Math.hypot(e.clientX - g.ex, e.clientY - g.ey) <= TOLERANCE_PX) return;
      // Le doigt a bougé avant l'appui long : tracé ordinaire.
      window.clearTimeout(g.minuteur);
      g.mode = 'trace';
      commencerTrace({ x: g.x, y: g.y });
      return;
    }
    if (g.mode === 'deplacement') {
      const dx = p.x - g.dernier.x;
      const dy = p.y - g.dernier.y;
      g.dernier = p;
      setAnnotations((l) => l.map((a, i) => (i === g.visee ? deplacerAnnotation(a, dx, dy) : a)));
      return;
    }
    setEnCours((c) => {
      if (!c) return c;
      if (c.type === 'trait' && c.points.length < POINTS_MAX) {
        const [px, py] = c.points[c.points.length - 1];
        return Math.hypot(p.x - px, p.y - py) > 0.003 ? { type: 'trait', points: [...c.points, [p.x, p.y]] } : c;
      }
      if (c.type === 'cercle') return { type: 'cercle', x: (g.x + p.x) / 2, y: (g.y + p.y) / 2, rx: Math.abs(p.x - g.x) / 2, ry: Math.abs(p.y - g.y) / 2 };
      return c;
    });
  }

  function relache(e: EvenementPointeur) {
    const g = geste.current;
    geste.current = null;
    if (!g || !taille) return;
    window.clearTimeout(g.minuteur);
    if (g.mode === 'deplacement') {
      setDeplacee(null);
      return;
    }
    const p = position(e) ?? g;
    const a = enCours;
    setEnCours(null);
    const ajouter = (x: Annotation) => setAnnotations((l) => [...l, x]);
    switch (outil) {
      case 'ok':
      case 'nok':
        ajouter({ type: outil, x: p.x, y: p.y });
        break;
      case 'bulle':
        setSaisie({ x: p.x, y: p.y, texte: '' });
        break;
      case 'cercle': {
        // Un simple appui fait un cercle de taille moyenne.
        const petit = !a || a.type !== 'cercle' || (a.rx * taille.l < 12 && a.ry * taille.h < 12);
        const r = 0.08 * Math.min(taille.l, taille.h);
        ajouter(petit ? { type: 'cercle', x: p.x, y: p.y, rx: r / taille.l, ry: r / taille.h } : a);
        break;
      }
      case 'trait':
        if (a?.type === 'trait' && a.points.length > 1) ajouter(a);
        break;
    }
  }

  function annulerGeste() {
    if (geste.current) window.clearTimeout(geste.current.minuteur);
    geste.current = null;
    setEnCours(null);
    setDeplacee(null);
  }

  function validerSaisie() {
    if (!saisie) return;
    const texte = saisie.texte.trim().slice(0, TEXTE_MAX);
    // Bulle sans pointe : px, py confondus avec la position (compatibilité des données).
    if (texte) setAnnotations((l) => [...l, { type: 'bulle', x: saisie.x, y: saisie.y, px: saisie.x, py: saisie.y, texte }]);
    setSaisie(null);
  }

  async function enregistrer() {
    if (!original.current) return;
    setOccupe(true);
    setErreur(null);
    try {
      const copie = annotations.length ? await fabriquerCopieAnnotee(original.current, annotations) : null;
      surEnregistre(await espace.annoterPhoto(photo.id, annotations, copie));
    } catch (e) {
      setErreur(texteErreur(e));
      setOccupe(false);
    }
  }

  const modifie = JSON.stringify(annotations) !== JSON.stringify(photo.annotations ?? []);
  // Bouton Retour du téléphone : ferme l'éditeur (après confirmation s'il y a des modifications).
  useRetour(
    true,
    () => {
      if (modifie && !confirm('Abandonner les modifications ?')) return false;
      surFermer();
    },
    4,
  );
  const dessin = taille ? elementsSvg(enCours ? [...annotations, enCours] : annotations, taille.l, taille.h) : '';

  return (
    <div className="editeur-annotations" role="dialog" aria-label="Annoter la photo">
      <div className="annot-outils" role="toolbar" aria-label="Outils d'annotation">
        {OUTILS.map((o) => (
          <button
            key={o.outil}
            className={`annot-outil annot-${o.outil}${outil === o.outil ? ' actif' : ''}`}
            title={o.titre}
            aria-label={o.titre}
            aria-pressed={outil === o.outil}
            onClick={() => setOutil(o.outil)}
          >
            {o.libelle}
          </button>
        ))}
        <span className="annot-espace" />
        <button className="petit" disabled={!annotations.length || occupe} onClick={() => setAnnotations((l) => l.slice(0, -1))}>
          ↶ Annuler
        </button>
        <button
          className="petit"
          disabled={!annotations.length || occupe}
          onClick={() => confirm('Effacer toutes les annotations ?') && setAnnotations([])}
        >
          Tout effacer
        </button>
      </div>
      <div className="annot-zone">
        {src && taille ? (
          <svg
            ref={svg}
            className={`annot-svg${deplacee !== null ? ' deplacement' : ''}`}
            viewBox={`0 0 ${taille.l} ${taille.h}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={appui}
            onPointerMove={glisse}
            onPointerUp={relache}
            onPointerCancel={annulerGeste}
            onContextMenu={(e) => e.preventDefault()}
          >
            <image href={src} width={taille.l} height={taille.h} />
            <g dangerouslySetInnerHTML={{ __html: dessin }} />
          </svg>
        ) : (
          <span className="discret">Chargement…</span>
        )}
      </div>
      {saisie && (
        <form
          className="annot-saisie"
          onSubmit={(e) => {
            e.preventDefault();
            validerSaisie();
          }}
        >
          <label>
            Texte de la bulle
            <input
              autoFocus
              value={saisie.texte}
              maxLength={TEXTE_MAX}
              onChange={(e) => setSaisie({ ...saisie, texte: e.target.value })}
              placeholder="ex. : calorifuge manquant"
            />
          </label>
          <button type="submit" className="principal">
            OK
          </button>
          <button type="button" onClick={() => setSaisie(null)}>
            Annuler
          </button>
        </form>
      )}
      <div className="annot-bas">
        <span className="discret">
          {deplacee !== null
            ? 'Déplacement : glissez, puis relâchez.'
            : `${OUTILS.find((o) => o.outil === outil)?.titre} · appui long sur une annotation pour la déplacer`}
        </span>
        {erreur && <span className="texte-erreur">{erreur}</span>}
        <span className="annot-espace" />
        <button disabled={occupe} onClick={() => (!modifie || confirm('Abandonner les modifications ?')) && surFermer()}>
          Fermer
        </button>
        <button className="principal" disabled={occupe || !modifie || !taille} onClick={() => void enregistrer()}>
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
