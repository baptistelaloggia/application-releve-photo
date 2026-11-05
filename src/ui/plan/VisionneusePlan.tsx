import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ouvrirPagePlan } from '../../pdf/pdf';
import { texteErreur } from '../commun';
import { MoteurVue } from './MoteurVue';

export type StyleMarqueur = 'local' | 'local-auto' | 'selection' | 'candidat' | 'candidat-ecarte' | 'brouillon';

export interface Marqueur {
  id: string;
  x: number;
  y: number;
  libelle: string;
  titre?: string;
  style: StyleMarqueur;
}

export interface CommandesVisionneuse {
  centrerSur(x: number, y: number, facteurZoom?: number): void;
  ajuster(): void;
}

interface Props {
  /** Identifiant stable du contenu du plan (empreinte), pour le cache. */
  cle: string;
  fichier: Blob;
  marqueurs: Marqueur[];
  /** Point à centrer à l'ouverture (par ex. le local trouvé par la recherche). */
  focus?: { x: number; y: number } | null;
  /** Curseur en croix quand un appui place quelque chose. */
  modePlacement?: boolean;
  surAppuiPlan?: (x: number, y: number) => void;
  surAppuiMarqueur?: (id: string) => void;
}

export const VisionneusePlan = forwardRef<CommandesVisionneuse, Props>(function VisionneusePlan(
  { cle, fichier, marqueurs, focus, modePlacement, surAppuiPlan, surAppuiMarqueur },
  ref,
) {
  const conteneur = useRef<HTMLDivElement>(null);
  const couche = useRef<HTMLDivElement>(null);
  const moteur = useRef<MoteurVue | null>(null);
  const appuiPlan = useRef(surAppuiPlan);
  appuiPlan.current = surAppuiPlan;
  const [etat, setEtat] = useState<'chargement' | 'pret' | string>('chargement');
  const [zoom, setZoom] = useState(100);

  useImperativeHandle(ref, () => ({
    centrerSur: (x, y, f) => moteur.current?.centrerSur(x, y, f),
    ajuster: () => moteur.current?.ajuster(),
  }));

  useEffect(() => {
    let annule = false;
    setEtat('chargement');
    ouvrirPagePlan(cle, fichier)
      .then((page) => {
        if (annule || !conteneur.current || !couche.current) return;
        moteur.current = new MoteurVue(conteneur.current, couche.current, page, {
          surAppui: (x, y) => appuiPlan.current?.(x, y),
          surVue: (z, ajuste) => setZoom(Math.round((z / ajuste) * 100)),
        });
        if (focus) moteur.current.centrerSur(focus.x, focus.y);
        setEtat('pret');
      })
      .catch((e) => !annule && setEtat(texteErreur(e)));
    return () => {
      annule = true;
      moteur.current?.detruire();
      moteur.current = null;
    };
    // Le focus initial n'est lu qu'à l'ouverture ; ensuite on passe par centrerSur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, fichier]);

  // Les marqueurs sont des éléments React ; le moteur les place après chaque rendu.
  useLayoutEffect(() => {
    moteur.current?.placerMarqueurs();
  });

  return (
    <div className={`visionneuse${modePlacement ? ' placement' : ''}`} ref={conteneur} data-zoom={zoom}>
      <div className="vue-marqueurs" ref={couche}>
        {etat === 'pret' &&
          marqueurs.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`marqueur marqueur-${m.style}`}
              data-marqueur={m.id}
              data-x={m.x}
              data-y={m.y}
              title={m.titre ?? m.libelle}
              onClick={(e) => {
                e.stopPropagation();
                surAppuiMarqueur?.(m.id);
              }}
            >
              <span className="marqueur-point" />
              {m.libelle && <span className="marqueur-libelle">{m.libelle}</span>}
            </button>
          ))}
      </div>
      {etat === 'chargement' && <div className="vue-etat">Chargement du plan…</div>}
      {etat !== 'chargement' && etat !== 'pret' && <div className="vue-etat texte-erreur">{etat}</div>}
      <div className="vue-commandes">
        <button type="button" aria-label="Zoom avant" onClick={() => moteur.current?.zoomer(1.6)}>
          +
        </button>
        <button type="button" aria-label="Zoom arrière" onClick={() => moteur.current?.zoomer(1 / 1.6)}>
          −
        </button>
        <button type="button" aria-label="Plan entier" title="Plan entier" onClick={() => moteur.current?.ajuster()}>
          ⤢
        </button>
        <span className="vue-zoom" aria-live="polite">
          {zoom} %
        </span>
      </div>
    </div>
  );
});
