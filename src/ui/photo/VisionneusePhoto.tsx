import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { elementsSvg, resumeAnnotations } from '../../domaine/annotations';
import type { Photo } from '../../domaine/types';
import type { EspaceProjet } from '../../projet/EspaceProjet';
import { dureeLisible, mimeNote } from '../../photo/enregistrement';
import { retirerPhotosExportees } from '../../stockage/registre';
import { tailleLisible, texteErreur } from '../commun';
import { ComparaisonPhotos } from './ComparaisonPhotos';
import { EditeurAnnotations } from './EditeurAnnotations';
import { BarreTags } from './BarreTags';
import { appliquerPhrase, BoutonDicter, BoutonNoteVocale, compteRenduPhrase } from './NoteVocale';

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
export function VisionneusePhoto({ espace, photos: photosRecues, indexInitial, surFermer, surModifie, annoterDesLOuverture, auteur }: Props) {
  // Photos supprimées depuis la visionneuse : retirées de la liste, on reste sur la suivante.
  const [supprimees, setSupprimees] = useState<Set<string>>(new Set());
  const photos = photosRecues.filter((p) => !supprimees.has(p.id));
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
  /** Comparaison avant / après avec une photo plus ancienne du même repère (lot 6). */
  const [comparer, setComparer] = useState(false);
  /**
   * Suppression par glisser-déposer (21/11/2026) : un appui long saisit la photo, qui suit le doigt ;
   * relâchée sur la corbeille (en bas de l'écran), elle est supprimée après confirmation.
   */
  const [deplacement, setDeplacement] = useState<{ dx: number; dy: number; surCorbeille: boolean } | null>(null);
  const glisser = useRef<{ x: number; y: number; minuteur: number; actif: boolean } | null>(null);
  const surLaCorbeille = (x: number, y: number) => y > window.innerHeight - 130 && Math.abs(x - window.innerWidth / 2) < 140;
  function appuiPhoto(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const cible = e.currentTarget;
    const id = e.pointerId;
    const g = { x: e.clientX, y: e.clientY, actif: false, minuteur: 0 };
    g.minuteur = window.setTimeout(() => {
      g.actif = true;
      try {
        cible.setPointerCapture(id);
      } catch {
        /* doigt levé */
      }
      navigator.vibrate?.(40);
      setDeplacement({ dx: 0, dy: 0, surCorbeille: false });
    }, 450);
    glisser.current = g;
  }
  function glissePhoto(e: PointerEvent<HTMLDivElement>) {
    const g = glisser.current;
    if (!g) return;
    if (!g.actif) {
      // Le doigt bouge avant l'appui long : c'est un balayage (photo suivante), pas une saisie.
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) annulerGlisser();
      return;
    }
    setDeplacement({ dx: e.clientX - g.x, dy: e.clientY - g.y, surCorbeille: surLaCorbeille(e.clientX, e.clientY) });
  }
  function relachePhoto(e: PointerEvent<HTMLDivElement>) {
    const g = glisser.current;
    const supprimer = !!g?.actif && surLaCorbeille(e.clientX, e.clientY);
    annulerGlisser();
    if (supprimer && photo && confirm(`Supprimer définitivement cette ${photo.type === 'video' ? 'vidéo' : 'photo'} ?`)) {
      void supprimerCourante();
    }
  }
  function annulerGlisser() {
    if (glisser.current) window.clearTimeout(glisser.current.minuteur);
    // Laisser passer la fin du toucher avant d'autoriser de nouveau le balayage.
    window.setTimeout(() => (glisser.current = null), 0);
    setDeplacement(null);
  }

  async function supprimerCourante() {
    if (!photo) return;
    const id = photo.id;
    await agir(() => espace.supprimerPhoto(id), photos.length <= 1);
    setSupprimees((s) => new Set([...s, id]));
    setIndex((i) => Math.min(i, Math.max(0, photos.length - 2)));
  }

  /** Compte rendu de la dernière dictée ou note vocale transcrite. */
  const [infoDictee, setInfoDictee] = useState<string | null>(null);
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
    setInfoDictee(null);
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
      // Échap : géré comme le bouton Retour (ui/retour.ts).
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

  // Photos du même repère, pour la comparaison : la plus récente d'une date antérieure sert d'« avant ».
  // Comparaison réservée aux repères de suivi (20/11/2026).
  const duRepere = photo.repereId && repere?.suivi ? espace.photosDuRepere(photo.repereId).filter((p) => p.type !== 'video') : [];
  const avantComparaison =
    [...duRepere].reverse().find((p) => p.date < photo.date) ?? duRepere.find((p) => p.date !== photo.date);
  if (comparer && !video && avantComparaison) {
    return (
      <ComparaisonPhotos
        espace={espace}
        photos={duRepere}
        avantInitial={avantComparaison.id}
        apresInitial={photo.id}
        titre={`Repère ${repere?.numero ?? ''} · avant / après`}
        surFermer={() => setComparer(false)}
      />
    );
  }

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
          if (!d || e.changedTouches.length !== 1 || glisser.current) return;
          const dx = e.changedTouches[0].clientX - d.x;
          const dy = e.changedTouches[0].clientY - d.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) aller(index + (dx < 0 ? 1 : -1));
        }}
      >
        {!src ? (
          <span>Chargement…</span>
        ) : (
          // Appui long sur la photo, puis glisser sur la corbeille en bas de l'écran : suppression (21/11/2026).
          <div
            className={`photo-deplacable${deplacement ? ' en-deplacement' : ''}`}
            style={deplacement ? { transform: `translate(${deplacement.dx}px, ${deplacement.dy}px) scale(0.55)` } : undefined}
            onPointerDown={appuiPhoto}
            onPointerMove={glissePhoto}
            onPointerUp={relachePhoto}
            onPointerCancel={annulerGlisser}
            onContextMenu={(e) => e.preventDefault()}
          >
        {video ? (
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
          </div>
        )}
        {deplacement && (
          <div className={`corbeille${deplacement.surCorbeille ? ' active' : ''}`} aria-hidden="true">
            🗑
            <span>{deplacement.surCorbeille ? 'Relâcher pour supprimer' : 'Glisser ici pour supprimer'}</span>
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
          {!video && avantComparaison && (
            <button className="petit" onClick={() => setComparer(true)}>
              ↔ Comparer
            </button>
          )}
          {!video && !!photo.annotations?.length && (
            <button className="petit" aria-pressed={original} onClick={() => setOriginal(!original)}>
              {original ? 'Voir les annotations' : "Voir l'original"}
            </button>
          )}
          <BoutonNoteVocale
            libelle={photo.noteVocale ? '🎤 Réenregistrer la note' : '🎤 Note vocale'}
            surEnregistre={(note, transcription) =>
              agir(async () => {
                await espace.enregistrerNoteVocale(photo.id, note, auteur ?? photo.prisPar);
                // Phrase transcrite : ajoutée au commentaire ; les tags qu'elle cite sont ajoutés.
                const r = await appliquerPhrase(espace, photo.id, transcription.texte);
                setCommentaire(espace.photos.find((p) => p.id === photo.id)?.commentaire ?? commentaire);
                if (r.phrase || transcription.erreur) setInfoDictee(compteRenduPhrase(r, transcription.erreur));
                await aRenvoyer(photo.id);
              })
            }
          />
        </div>
        {!video && !!photo.annotations?.length && <p className="discret petit-texte">Annotations : {resumeAnnotations(photo.annotations)}</p>}
        <BarreTags
          key={photo.id}
          selection={photo.tags ?? []}
          surChange={(tags) =>
            void agir(async () => {
              await espace.etiqueterPhoto(photo.id, tags);
              await aRenvoyer(photo.id);
            })
          }
        />
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
          <span className="titre-commentaire">
            Commentaire
            <BoutonDicter
              surPhrase={(texte, erreurDictee) =>
                agir(async () => {
                  const r = await appliquerPhrase(espace, photo.id, texte);
                  setCommentaire(espace.photos.find((p) => p.id === photo.id)?.commentaire ?? commentaire);
                  setInfoDictee(compteRenduPhrase(r, erreurDictee));
                  await aRenvoyer(photo.id);
                })
              }
            />
          </span>
          <textarea
            value={commentaire}
            rows={2}
            maxLength={500}
            onChange={(e) => setCommentaire(e.target.value)}
            onBlur={() => commentaire !== photo.commentaire && void agir(() => espace.commenterPhoto(photo.id, commentaire))}
          />
        </label>
        {infoDictee && <p className="discret petit-texte" role="status">{infoDictee}</p>}
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
