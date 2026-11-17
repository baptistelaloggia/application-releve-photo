import { useEffect, useRef, useState } from 'react';
import { elementsSvg, resumeAnnotations } from '../../domaine/annotations';
import type { Photo } from '../../domaine/types';
import type { EspaceProjet } from '../../projet/EspaceProjet';
import { dureeLisible, mimeNote } from '../../photo/enregistrement';
import { retirerPhotosExportees } from '../../stockage/registre';
import { tailleLisible, texteErreur } from '../commun';
import { EditeurAnnotations } from './EditeurAnnotations';
import { BoutonNoteVocale } from './NoteVocale';

interface Props {
  espace: EspaceProjet;
  photos: Photo[];
  indexInitial: number;
  surFermer: () => void;
  /** Après une modification (commentaire, annotations, note vocale, suppression, retour au panier). */
  surModifie: () => void;
  /** Ouvre directement l'éditeur d'annotations (depuis l'appareil photo). */
  annoterDesLOuverture?: boolean;
  /** Utilisateur de l'appareil (auteur des notes vocales). */
  auteur?: string;
}

/**
 * Photo ou vidéo en grand. On passe à la précédente ou à la suivante par les flèches sur les côtés,
 * en balayant du doigt, ou par les touches ← → du clavier.
 */
export function VisionneusePhoto({ espace, photos, indexInitial, surFermer, surModifie, annoterDesLOuverture, auteur }: Props) {
  const [index, setIndex] = useState(indexInitial);
  const [, setVersion] = useState(0);
  const base = photos[Math.min(index, photos.length - 1)];
  // Toujours l'état le plus récent (après annotation ou note vocale).
  const photo = base ? (espace.photos.find((p) => p.id === base.id) ?? base) : undefined;
  const [src, setSrc] = useState<string | null>(null);
  const [audio, setAudio] = useState<string | null>(null);
  const [commentaire, setCommentaire] = useState(photo?.commentaire ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [annoter, setAnnoter] = useState(!!annoterDesLOuverture);
  const [original, setOriginal] = useState(false);
  const [taille, setTaille] = useState<{ l: number; h: number } | null>(null);
  const toucher = useRef<{ x: number; y: number } | null>(null);
  const video = photo?.type === 'video';
  const dernier = photos.length - 1;
  const aller = (i: number) => setIndex(Math.max(0, Math.min(dernier, i)));

  useEffect(() => {
    if (!photo) return;
    setCommentaire(photo.commentaire);
    setSrc(null);
    setTaille(null);
    setErreur(null);
    let url: string | null = null;
    let annule = false;
    espace
      .lirePhoto(photo)
      .then((b) => {
        if (annule) return;
        url = URL.createObjectURL(video ? new Blob([b], { type: photo.extension === 'webm' ? 'video/webm' : 'video/mp4' }) : b);
        setSrc(url);
      })
      .catch((e) => !annule && setErreur(texteErreur(e)));
    return () => {
      annule = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espace, photo?.id, photo?.fichier]);

  const cleNote = photo?.noteVocale ? `${photo.fichier}|${photo.noteVocale.enregistreLe}` : '';
  useEffect(() => {
    setAudio(null);
    if (!photo?.noteVocale) return;
    let url: string | null = null;
    let annule = false;
    const extension = photo.noteVocale.extension;
    void espace
      .lireNoteVocale(photo)
      .then((b) => {
        if (annule) return;
        if (!b) return setAudio('absente');
        // Type précisé d'après l'extension : un fichier lu sur le serveur n'en porte pas toujours.
        url = URL.createObjectURL(new Blob([b], { type: mimeNote(extension) }));
        setAudio(url);
      })
      .catch(() => !annule && setAudio('absente'));
    return () => {
      annule = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espace, cleNote]);

  useEffect(() => {
    const clavier = (e: KeyboardEvent) => {
      if (annoter || (e.target as HTMLElement).closest?.('textarea, input')) return;
      if (e.key === 'ArrowLeft') aller(index - 1);
      else if (e.key === 'ArrowRight') aller(index + 1);
      else if (e.key === 'Escape') surFermer();
    };
    window.addEventListener('keydown', clavier);
    return () => window.removeEventListener('keydown', clavier);
  });

  if (!photo) return null;
  const repere = espace.repereDe(photo);

  async function agir(action: () => Promise<unknown>, fermer = false) {
    setErreur(null);
    try {
      await action();
      setVersion((v) => v + 1);
      surModifie();
      if (fermer) surFermer();
    } catch (e) {
      setErreur(texteErreur(e));
    }
  }

  /** Une photo modifiée après un envoi repart au prochain envoi, avec ses fichiers annexes. */
  const aRenvoyer = (id: string) => retirerPhotosExportees(espace.projet.id, [id]);

  if (annoter && !video) {
    return (
      <EditeurAnnotations
        espace={espace}
        photo={photo}
        surFermer={() => setAnnoter(false)}
        surEnregistre={(p) => {
          setAnnoter(false);
          setOriginal(false);
          void agir(() => aRenvoyer(p.id));
        }}
      />
    );
  }

  const annotations = !video && !original ? (photo.annotations ?? []) : [];

  return (
    <div className="voile-photo" role="dialog" aria-label={video ? 'Vidéo' : 'Photo'}>
      <div
        className="photo-image"
        onTouchStart={(e) => (toucher.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const d = toucher.current;
          toucher.current = null;
          if (!d || e.changedTouches.length !== 1) return;
          const dx = e.changedTouches[0].clientX - d.x;
          const dy = e.changedTouches[0].clientY - d.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) aller(index + (dx < 0 ? 1 : -1));
        }}
      >
        {!src ? (
          <span>Chargement…</span>
        ) : video ? (
          <video key={src} src={src} controls playsInline className="photo-media" />
        ) : (
          <div className="photo-cadre">
            <img
              src={src}
              alt={photo.fichier}
              className="photo-media"
              onLoad={(e) => setTaille({ l: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
            {taille && annotations.length > 0 && (
              <svg className="photo-annotations" viewBox={`0 0 ${taille.l} ${taille.h}`} aria-hidden="true">
                <g dangerouslySetInnerHTML={{ __html: elementsSvg(annotations, taille.l, taille.h) }} />
              </svg>
            )}
          </div>
        )}
        {index > 0 && (
          <button className="photo-fleche gauche" onClick={() => aller(index - 1)} aria-label="Photo précédente">
            ‹
          </button>
        )}
        {index < dernier && (
          <button className="photo-fleche droite" onClick={() => aller(index + 1)} aria-label="Photo suivante">
            ›
          </button>
        )}
        <span className="photo-position">
          {index + 1}/{photos.length}
        </span>
      </div>
      <div className="photo-infos">
        <div className="titre-projet">
          <div>
            <strong>{repere ? repere.numero : 'Panier à classer'}</strong>{' '}
            <span className="discret">
              {video ? `Vidéo ${dureeLisible(photo.duree ?? 0)} · ` : ''}
              {new Date(photo.prisLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · {photo.prisPar} ·{' '}
              {photo.largeur} × {photo.hauteur} · {tailleLisible(photo.taille)}
            </span>
            <div className="discret mono petit-texte">{photo.fichier.split('/').pop()}</div>
          </div>
          <div className="boutons">
            <button onClick={surFermer}>Fermer</button>
          </div>
        </div>
        <div className="boutons">
          {!video && (
            <button className="petit" onClick={() => setAnnoter(true)}>
              ✏️ {photo.annotations?.length ? 'Modifier les annotations' : 'Annoter'}
            </button>
          )}
          {!video && !!photo.annotations?.length && (
            <button className="petit" aria-pressed={original} onClick={() => setOriginal(!original)}>
              {original ? 'Voir les annotations' : "Voir l'original"}
            </button>
          )}
          <BoutonNoteVocale
            libelle={photo.noteVocale ? '🎤 Réenregistrer la note' : '🎤 Note vocale'}
            surEnregistre={(note) =>
              agir(async () => {
                await espace.enregistrerNoteVocale(photo.id, note, auteur ?? photo.prisPar);
                await aRenvoyer(photo.id);
              })
            }
          />
        </div>
        {!video && !!photo.annotations?.length && <p className="discret petit-texte">Annotations : {resumeAnnotations(photo.annotations)}</p>}
        {photo.noteVocale && (
          <div className="note-vocale">
            {audio === 'absente' ? (
              <span className="texte-erreur">
                Fichier de la note vocale absent ({photo.fichier.split('/').pop()?.replace(/\.[^.]+$/, '')}_note.{photo.noteVocale.extension}) : la
                note n'a pas été transmise. Sur le téléphone, renvoyez la visite (la photo repart avec sa note).
              </span>
            ) : audio ? (
              <audio
                key={audio}
                src={audio}
                controls
                preload="metadata"
                onError={() => setErreur(`Note vocale illisible par ce navigateur (format ${photo.noteVocale?.extension}).`)}
              />
            ) : (
              <span className="discret">Chargement de la note…</span>
            )}
            <button
              className="petit discret"
              onClick={() => confirm('Supprimer la note vocale ?') && void agir(() => espace.enregistrerNoteVocale(photo.id, null, auteur ?? photo.prisPar))}
            >
              Supprimer la note
            </button>
          </div>
        )}
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
            <button className="petit" onClick={() => void agir(() => espace.classerPhoto(photo.id, null, photo.prisPar), true)}>
              Renvoyer au panier
            </button>
          )}
          <button
            className="petit discret"
            onClick={() => {
              if (confirm(`Supprimer définitivement cette ${video ? 'vidéo' : 'photo'} ?`)) void agir(() => espace.supprimerPhoto(photo.id), true);
            }}
          >
            Supprimer {video ? 'la vidéo' : 'la photo'}
          </button>
        </div>
        {erreur && <p className="texte-erreur">{erreur}</p>}
      </div>
    </div>
  );
}
