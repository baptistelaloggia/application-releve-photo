import { useState } from 'react';
import type { EspaceProjet, ResultatLocal } from '../projet/EspaceProjet';

interface Props {
  espace: EspaceProjet;
  surChoix: (r: ResultatLocal) => void;
  autoFocus?: boolean;
}

/** Recherche d'un local dans tout le projet : « TGBT », « 012 », « cta ss1 ». */
export function BarreRecherche({ espace, surChoix, autoFocus }: Props) {
  const [requete, setRequete] = useState('');
  const resultats = requete.trim() ? espace.rechercherLocaux(requete) : [];
  return (
    <div className="recherche">
      <input
        type="search"
        value={requete}
        autoFocus={autoFocus}
        placeholder="Rechercher un local (TGBT, 012…)"
        aria-label="Rechercher un local"
        onChange={(e) => setRequete(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && resultats[0]) {
            surChoix(resultats[0]);
            setRequete('');
          }
          if (e.key === 'Escape') setRequete('');
        }}
      />
      {requete.trim() && (
        <ul className="resultats" role="listbox">
          {resultats.length === 0 && (
            <li className="discret aucun">
              Aucun local trouvé. {espace.locaux.length === 0 && 'Les locaux se détectent depuis chaque plan.'}
            </li>
          )}
          {resultats.map((r) => (
            <li key={r.local.id}>
              <button
                type="button"
                role="option"
                onClick={() => {
                  surChoix(r);
                  setRequete('');
                }}
              >
                <span className="res-niveau">{r.niveau.code}</span>
                <span className="res-numero mono">{r.local.numero ?? '—'}</span>
                <span className="res-nom">{r.local.nom}</span>
                {r.local.surface !== null && <span className="discret">{String(r.local.surface).replace('.', ',')} m²</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
