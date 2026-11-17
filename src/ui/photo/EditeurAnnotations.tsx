import { useEffect, useRef, useState, type PointerEvent as EvenementPointeur } from 'react';
import { elementsSvg, positionBulle, POINTS_MAX, TEXTE_MAX } from '../../domaine/annotations';
import type { Annotation, Photo } from '../../domaine/types';
import type { EspaceProjet } from '../../projet/EspaceProjet';
import { fabriquerCopieAnnotee } from '../../photo/annotation';
import { texteErreur } from '../commun';

type Outil = 'ok' | 'nok' | 'bulle' | 'texte' | 'cercle' | 'trait';

const OUTILS: Array<{ outil: Outil; libelle: string; titre: string }> = [
  { outil: 'ok', libelle: '✔', titre: 'V vert : travaux conformes' },
  { outil: 'nok', libelle: '✖', titre: 'X rouge : travaux non conformes' },
  { outil: 'bulle', libelle: '💬', titre: 'Bulle : texte relié à un point' },
  { outil: 'texte', libelle: 'T', titre: 'Texte' },
  { outil: 'cercle', libelle: '◯', titre: 'Cercle : glisser pour entourer' },
  { outil: 'trait', libelle: '✎', titre: 'Trait à main levée' },
];

interface Props {
  espace: EspaceProjet;
  photo: Photo;
  surFermer: () => void;
  /** Après l'enregistrement (la photo modifiée est passée). */
  surEnregistre: (photo: Photo) => void;
}

/**
 * Annotation d'une photo : on choisit un outil, puis on touche la photo.
 * V, X : un appui. Bulle : un appui sur le point visé, puis le texte. Cercle, trait : on glisse.
 */
export function EditeurAnnotations({ espace, photo, surFermer, surEnregistre }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [taille, setTaille] = useState<{ l: number; h: number } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>(photo.annotations ?? []);
  const [outil, setOutil] = useState<Outil>('ok');
  const [enCours, setEnCours] = useState<Annotation | null>(null);
  const [saisie, setSaisie] = useState<{ type: 'texte' | 'bulle'; x: number; y: number; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const depart = useRef<{ x: number; y: number } | null>(null);
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

  function appui(e: EvenementPointeur) {
    if (saisie || occupe) return;
    const p = position(e);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    depart.current = p;
    if (outil === 'trait') setEnCours({ type: 'trait', points: [[p.x, p.y]] });
    if (outil === 'cercle') setEnCours({ type: 'cercle', x: p.x, y: p.y, rx: 0, ry: 0 });
  }

  function glisse(e: EvenementPointeur) {
    const d = depart.current;
    if (!d || !enCours) return;
    const p = position(e);
    if (!p) return;
    if (enCours.type === 'trait' && enCours.points.length < POINTS_MAX) {
      const [px, py] = enCours.points[enCours.points.length - 1];
      if (Math.hypot(p.x - px, p.y - py) > 0.003) setEnCours({ type: 'trait', points: [...enCours.points, [p.x, p.y]] });
    } else if (enCours.type === 'cercle') {
      setEnCours({ type: 'cercle', x: (d.x + p.x) / 2, y: (d.y + p.y) / 2, rx: Math.abs(p.x - d.x) / 2, ry: Math.abs(p.y - d.y) / 2 });
    }
  }

  function relache(e: EvenementPointeur) {
    const d = depart.current;
    depart.current = null;
    if (!d || !taille) return;
    const p = position(e) ?? d;
    const a = enCours;
    setEnCours(null);
    const ajouter = (x: Annotation) => setAnnotations((l) => [...l, x]);
    switch (outil) {
      case 'ok':
      case 'nok':
        ajouter({ type: outil, x: p.x, y: p.y });
        break;
      case 'texte':
      case 'bulle':
        setSaisie({ type: outil, x: p.x, y: p.y, texte: '' });
        break;
      case 'cercle': {
        // Un simple appui fait un cercle de taille moyenne.
        const petit = !a || a.type !== 'cercle' || (a.rx * taille.l < 12 && a.ry * taille.h < 12);
        const r = (0.08 * Math.min(taille.l, taille.h));
        ajouter(petit ? { type: 'cercle', x: p.x, y: p.y, rx: r / taille.l, ry: r / taille.h } : a);
        break;
      }
      case 'trait':
        if (a?.type === 'trait' && a.points.length > 1) ajouter(a);
        break;
    }
  }

  function validerSaisie() {
    if (!saisie || !taille) return;
    const texte = saisie.texte.trim().slice(0, TEXTE_MAX);
    if (texte) {
      if (saisie.type === 'texte') setAnnotations((l) => [...l, { type: 'texte', x: saisie.x, y: saisie.y, texte }]);
      else {
        const pos = positionBulle(saisie.x, saisie.y, taille.l, taille.h);
        setAnnotations((l) => [...l, { type: 'bulle', ...pos, px: saisie.x, py: saisie.y, texte }]);
      }
    }
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
            className="annot-svg"
            viewBox={`0 0 ${taille.l} ${taille.h}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={appui}
            onPointerMove={glisse}
            onPointerUp={relache}
            onPointerCancel={() => {
              depart.current = null;
              setEnCours(null);
            }}
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
            {saisie.type === 'bulle' ? 'Texte de la bulle' : 'Texte'}
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
        <span className="discret">{OUTILS.find((o) => o.outil === outil)?.titre}</span>
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
