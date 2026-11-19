import { useEffect, useState } from 'react';
import type { Photo } from '../../domaine/types';
import type { EspaceProjet } from '../../projet/EspaceProjet';
import { useRetour } from '../retour';
import { Miniature } from './Miniature';

interface Props {
  espace: EspaceProjet;
  /** Photos d'un repère (les vidéos sont écartées), de la plus ancienne à la plus récente. */
  photos: Photo[];
  /** Photos choisies au départ ; par défaut, la plus ancienne et la plus récente. */
  avantInitial?: string;
  apresInitial?: string;
  titre: string;
  surFermer: () => void;
}

const dateCourte = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** Adresse d'une photo, libérée quand elle n'est plus affichée. */
function useAdresse(espace: EspaceProjet, photo: Photo | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!photo) return;
    let url: string | null = null;
    let annule = false;
    void espace.lirePhoto(photo).then((b) => {
      if (annule) return;
      url = URL.createObjectURL(b);
      setSrc(url);
    });
    return () => {
      annule = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [espace, photo]);
  return src;
}

/**
 * Suivi dans le temps (lot 6) : comparaison avant / après de deux photos d'un même repère.
 * Frise chronologique en bas (toucher une photo l'affecte au côté choisi, « Avant » ou « Après »),
 * rideau à glisser entre les deux photos, ou affichage côte à côte.
 */
export function ComparaisonPhotos({ espace, photos, avantInitial, apresInitial, titre, surFermer }: Props) {
  const liste = photos.filter((p) => p.type !== 'video');
  const [avantId, setAvantId] = useState(avantInitial ?? liste[0]?.id);
  const [apresId, setApresId] = useState(apresInitial ?? liste[liste.length - 1]?.id);
  const [cote, setCote] = useState<'avant' | 'apres'>('avant');
  const [mode, setMode] = useState<'rideau' | 'cote'>('rideau');
  const [rideau, setRideau] = useState(50);
  useRetour(true, surFermer, 4);

  const avant = liste.find((p) => p.id === avantId);
  const apres = liste.find((p) => p.id === apresId);
  const srcAvant = useAdresse(espace, avant);
  const srcApres = useAdresse(espace, apres);

  return (
    <div className="comparaison" role="dialog" aria-label="Comparaison avant / après">
      <div className="comparaison-haut">
        <strong>{titre}</strong>
        <div className="bascule" role="group" aria-label="Affichage">
          <button className={mode === 'rideau' ? 'actif' : undefined} aria-pressed={mode === 'rideau'} onClick={() => setMode('rideau')}>
            Rideau
          </button>
          <button className={mode === 'cote' ? 'actif' : undefined} aria-pressed={mode === 'cote'} onClick={() => setMode('cote')}>
            Côte à côte
          </button>
        </div>
        <button className="petit" onClick={surFermer}>
          Fermer
        </button>
      </div>

      {mode === 'rideau' ? (
        <div className="comparaison-rideau">
          <div className="comparaison-cadre">
            {srcApres && <img src={srcApres} alt="Après" className="comparaison-image" />}
            {srcAvant && (
              <img src={srcAvant} alt="Avant" className="comparaison-image dessus" style={{ clipPath: `inset(0 ${100 - rideau}% 0 0)` }} />
            )}
            <div className="comparaison-trait" style={{ left: `${rideau}%` }} />
            <span className="comparaison-etiquette gauche">Avant · {avant ? dateCourte(avant.prisLe) : '—'}</span>
            <span className="comparaison-etiquette droite">Après · {apres ? dateCourte(apres.prisLe) : '—'}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={rideau}
            aria-label="Position du rideau entre avant et après"
            onChange={(e) => setRideau(Number(e.target.value))}
          />
        </div>
      ) : (
        <div className="comparaison-cote">
          {[
            ['Avant', avant, srcAvant] as const,
            ['Après', apres, srcApres] as const,
          ].map(([libelle, p, src]) => (
            <figure key={libelle}>
              {src ? <img src={src} alt={libelle} /> : <span className="discret">—</span>}
              <figcaption>
                {libelle} · {p ? new Date(p.prisLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                {p?.commentaire ? ` · ${p.commentaire}` : ''}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="comparaison-bas">
        <div className="bascule" role="group" aria-label="Côté à remplacer">
          <span className="discret">Frise : une photo touchée remplace l'image</span>
          <button className={cote === 'avant' ? 'actif' : undefined} aria-pressed={cote === 'avant'} onClick={() => setCote('avant')}>
            Avant
          </button>
          <button className={cote === 'apres' ? 'actif' : undefined} aria-pressed={cote === 'apres'} onClick={() => setCote('apres')}>
            Après
          </button>
        </div>
        <ol className="frise" aria-label="Frise chronologique du repère">
          {liste.map((p, i) => {
            const nouveauJour = i === 0 || liste[i - 1].date !== p.date;
            return (
              <li key={p.id} className={nouveauJour ? 'nouveau-jour' : undefined}>
                {nouveauJour && <span className="frise-date">{dateCourte(p.prisLe)}</span>}
                <button
                  className={`frise-photo${p.id === avantId ? ' avant' : ''}${p.id === apresId ? ' apres' : ''}`}
                  aria-label={`Photo du ${new Date(p.prisLe).toLocaleString('fr-FR')}`}
                  onClick={() => {
                    if (cote === 'avant') {
                      setAvantId(p.id);
                      setCote('apres');
                    } else setApresId(p.id);
                  }}
                >
                  <Miniature espace={espace} photo={p} taille={64} />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Le repère a-t-il des photos à au moins deux dates (comparaison possible) ? */
export function comparable(photos: Photo[]): boolean {
  return new Set(photos.filter((p) => p.type !== 'video').map((p) => p.date)).size >= 2;
}
