import { useEffect, useRef, useState } from 'react';
import type { Plan } from '../domaine/types';
import type { EspaceProjet } from '../projet/EspaceProjet';
import { dessinerApercu } from '../pdf/pdf';
import { texteErreur } from './commun';

/** Aperçu simple de la 1re page (l'affichage complet par tuiles arrive au lot 2). */
export function Apercu({ espace, plan, surFermer }: { espace: EspaceProjet; plan: Plan; surFermer: () => void }) {
  const canevas = useRef<HTMLCanvasElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const largeur = Math.min(window.innerWidth - 48, 1100);
    void espace
      .lirePlan(plan)
      .then((blob) => dessinerApercu(blob, canevas.current!, largeur))
      .then(() => canevas.current?.setAttribute('data-pret', 'oui'))
      .catch((e) => setErreur(texteErreur(e)));
  }, [espace, plan]);

  return (
    <div className="voile" onClick={surFermer} role="dialog" aria-label="Aperçu du plan">
      <div className="fenetre" onClick={(e) => e.stopPropagation()}>
        <div className="titre-projet">
          <strong className="mono">{plan.fichier.split('/').pop()}</strong>
          <button onClick={surFermer}>Fermer</button>
        </div>
        {erreur ? <p className="texte-erreur">{erreur}</p> : <canvas ref={canevas} />}
      </div>
    </div>
  );
}
