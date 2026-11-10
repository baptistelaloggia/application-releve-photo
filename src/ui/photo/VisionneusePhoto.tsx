import { useEffect, useState } from 'react';
import type { Photo } from '../../domaine/types';
import type { EspaceProjet } from '../../projet/EspaceProjet';
import { tailleLisible, texteErreur } from '../commun';

interface Props {
  espace: EspaceProjet;
  photos: Photo[];
  indexInitial: number;
  surFermer: () => void;
  /** Après une modification (commentaire, suppression, retour au panier). */
  surModifie: () => void;
}

/** Photo en grand, avec commentaire, retour au panier et suppression. */
export function VisionneusePhoto({ espace, photos, indexInitial, surFermer, surModifie }: Props) {
  const [index, setIndex] = useState(indexInitial);
  const photo = photos[Math.min(index, photos.length - 1)];
  const [src, setSrc] = useState<string | null>(null);
  const [commentaire, setCommentaire] = useState(photo?.commentaire ?? '');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) return;
    setCommentaire(photo.commentaire);
    setSrc(null);
    let url: string | null = null;
    let annule = false;
    espace
      .lirePhoto(photo)
      .then((b) => {
        if (annule) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      })
      .catch((e) => setErreur(texteErreur(e)));
    return () => {
      annule = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [espace, photo]);

  if (!photo) return null;
  const repere = espace.repereDe(photo);

  async function agir(action: () => Promise<void>, fermer = false) {
    setErreur(null);
    try {
      await action();
      surModifie();
      if (fermer) surFermer();
    } catch (e) {
      setErreur(texteErreur(e));
    }
  }

  return (
    <div className="voile-photo" role="dialog" aria-label="Photo">
      <div className="photo-image">{src ? <img src={src} alt={photo.fichier} /> : <span>Chargement…</span>}</div>
      <div className="photo-infos">
        <div className="titre-projet">
          <div>
            <strong>{repere ? repere.numero : 'Panier à classer'}</strong>{' '}
            <span className="discret">
              {new Date(photo.prisLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · {photo.prisPar} ·{' '}
              {photo.largeur} × {photo.hauteur} · {tailleLisible(photo.taille)}
            </span>
            <div className="discret mono petit-texte">{photo.fichier.split('/').pop()}</div>
          </div>
          <div className="boutons">
            <button className="petit" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="Photo précédente">
              ‹
            </button>
            <span className="discret">
              {index + 1}/{photos.length}
            </span>
            <button className="petit" disabled={index >= photos.length - 1} onClick={() => setIndex(index + 1)} aria-label="Photo suivante">
              ›
            </button>
            <button onClick={surFermer}>Fermer</button>
          </div>
        </div>
        <label>
          Commentaire (la dictée vocale du clavier du téléphone fonctionne ici)
          <textarea
            value={commentaire}
            rows={2}
            maxLength={500}
            onChange={(e) => setCommentaire(e.target.value)}
            onBlur={() => commentaire !== photo.commentaire && void agir(() => espace.commenterPhoto(photo.id, commentaire))}
          />
        </label>
        <div className="boutons">
          {repere && (
            <button className="petit" onClick={() => void agir(() => espace.classerPhoto(photo.id, null, photo.prisPar).then(() => undefined), true)}>
              Renvoyer au panier
            </button>
          )}
          <button
            className="petit discret"
            onClick={() => {
              if (confirm('Supprimer définitivement cette photo ?')) void agir(() => espace.supprimerPhoto(photo.id), true);
            }}
          >
            Supprimer la photo
          </button>
        </div>
        {erreur && <p className="texte-erreur">{erreur}</p>}
      </div>
    </div>
  );
}
