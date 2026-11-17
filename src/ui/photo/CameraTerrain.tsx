import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../../domaine/types';
import type { EspaceProjet } from '../../projet/EspaceProjet';
import { cameraDisponible, fermerCamera, ouvrirCamera, prendrePhoto, texteErreurCamera } from '../../photo/camera';
import {
  DEBIT_AUDIO,
  DEBIT_VIDEO,
  DUREE_MAX_VIDEO,
  demarrerEnregistrement,
  dureeLisible,
  enregistrementDisponible,
  formatVideo,
  type Enregistreur,
} from '../../photo/enregistrement';
import { retirerPhotosExportees } from '../../stockage/registre';
import { texteErreur } from '../commun';
import { EditeurAnnotations } from './EditeurAnnotations';
import { BoutonNoteVocale } from './NoteVocale';

interface Props {
  espace: EspaceProjet;
  auteur: string;
  /** Ce qui est photographié : « P012 · R+2 · SF202 SANIT. F » ou « Panier à classer ». */
  titre: string;
  /** Photos en cours de compression et d'enregistrement. */
  enAttente: number;
  /** Enregistre une photo ; renvoie la photo enregistrée (null en cas d'échec). */
  surCapture: (photo: Blob, source: 'appli' | 'appareil', prisLe: Date) => Promise<Photo | null>;
  /** Enregistre une vidéo. */
  surVideo: (video: Blob, source: 'appli' | 'appareil', prisLe: Date, nomOrigine?: string) => Promise<Photo | null>;
  surFermer: () => void;
}

type Mode = 'photo' | 'video';

/**
 * Visée plein écran : déclencheur, rafale, mode vidéo, retour au plan.
 * Après une prise de vue, deux raccourcis sur la dernière : « Annoter » et « Note vocale ».
 */
export function CameraTerrain({ espace, auteur, titre, enAttente, surCapture, surVideo, surFermer }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const flux = useRef<MediaStream | null>(null);
  const micro = useRef<MediaStream | null>(null);
  const [erreur, setErreur] = useState<string | null>(cameraDisponible() ? null : 'Caméra non disponible dans ce navigateur.');
  const [pret, setPret] = useState(false);
  const [prises, setPrises] = useState(0);
  const [eclair, setEclair] = useState(false);
  const [mode, setMode] = useState<Mode>('photo');
  const [derniere, setDerniere] = useState<Photo | null>(null);
  const [annoter, setAnnoter] = useState<Photo | null>(null);
  const [tournage, setTournage] = useState<{ debut: number; secondes: number } | null>(null);
  const enregistreur = useRef<{ rec: Enregistreur; prisLe: Date; minuteur: number } | null>(null);
  // Chaque appui sur le déclencheur est mis en file : aucun n'est perdu en rafale,
  // même si la photo précédente est encore en cours de prise.
  const file = useRef<Promise<void>>(Promise.resolve());
  const [enPrise, setEnPrise] = useState(0);

  useEffect(() => {
    if (!cameraDisponible()) return;
    let annule = false;
    ouvrirCamera()
      .then((f) => {
        if (annule) return fermerCamera(f);
        flux.current = f;
        if (video.current) {
          video.current.srcObject = f;
          void video.current.play().then(() => setPret(true));
        }
      })
      .catch((e) => !annule && setErreur(texteErreurCamera(e)));
    return () => {
      annule = true;
      enregistreur.current?.rec.annuler();
      fermerCamera(flux.current);
      fermerCamera(micro.current);
      flux.current = null;
      micro.current = null;
    };
  }, []);

  /** La dernière prise de vue, une fois enregistrée, reçoit les raccourcis « Annoter » et « Note vocale ». */
  const suivre = (p: Promise<Photo | null>) => void p.then((ph) => ph && setDerniere(ph));

  function declencher() {
    if (!flux.current || !video.current) return;
    const prisLe = new Date();
    setEclair(true);
    window.setTimeout(() => setEclair(false), 120);
    navigator.vibrate?.(30);
    setEnPrise((n) => n + 1);
    file.current = file.current.then(async () => {
      try {
        if (!flux.current || !video.current) return;
        const photo = await prendrePhoto(flux.current, video.current);
        suivre(surCapture(photo, 'appli', prisLe));
        setPrises((n) => n + 1);
      } catch (e) {
        setErreur(texteErreurCamera(e));
      } finally {
        setEnPrise((n) => n - 1);
      }
    });
  }

  /** Mode vidéo : définition 720p (la photo garde la pleine résolution par ImageCapture). [À VÉRIFIER sur votre téléphone] */
  async function changerMode(m: Mode) {
    if (tournage || m === mode) return;
    setMode(m);
    const piste = flux.current?.getVideoTracks()[0];
    try {
      await piste?.applyConstraints(
        m === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 4032 }, height: { ideal: 3024 } },
      );
    } catch {
      // Caméra qui refuse le changement : on garde la définition actuelle.
    }
  }

  async function demarrerVideo() {
    const piste = flux.current?.getVideoTracks()[0];
    if (!piste) return;
    setErreur(null);
    if (!micro.current) {
      try {
        micro.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        setErreur('Micro refusé : la vidéo sera enregistrée sans le son.');
      }
    }
    try {
      const pistes = new MediaStream([piste, ...(micro.current?.getAudioTracks() ?? [])]);
      const rec = demarrerEnregistrement(pistes, formatVideo(), { videoBitsPerSecond: DEBIT_VIDEO, audioBitsPerSecond: DEBIT_AUDIO * 2 });
      const debut = Date.now();
      const minuteur = window.setInterval(() => {
        const s = (Date.now() - debut) / 1000;
        setTournage({ debut, secondes: s });
        if (s >= DUREE_MAX_VIDEO) void arreterVideo();
      }, 250);
      enregistreur.current = { rec, prisLe: new Date(), minuteur };
      setTournage({ debut, secondes: 0 });
      navigator.vibrate?.(60);
    } catch (e) {
      setErreur(`Enregistrement vidéo impossible (${texteErreur(e)}).`);
    }
  }

  async function arreterVideo() {
    const e = enregistreur.current;
    if (!e) return;
    enregistreur.current = null;
    window.clearInterval(e.minuteur);
    setTournage(null);
    navigator.vibrate?.([30, 60, 30]);
    try {
      const { fichier } = await e.rec.arreter();
      if (fichier.size) {
        const p = surVideo(fichier, 'appli', e.prisLe);
        file.current = file.current.then(() => p.then(() => undefined));
        suivre(p);
        setPrises((n) => n + 1);
      }
    } catch (err) {
      setErreur(`Vidéo non enregistrée (${texteErreur(err)}).`);
    }
  }

  // Fermer la visée seulement quand les prises demandées sont enregistrées.
  const fermer = async () => {
    await arreterVideo();
    void file.current.then(surFermer);
  };

  const enVideo = mode === 'video';
  return (
    <div className="camera" role="dialog" aria-label="Appareil photo">
      <video ref={video} playsInline muted className="camera-video" />
      {eclair && <div className="camera-eclair" />}
      <div className="camera-haut">
        <button className="camera-fermer" onClick={() => void fermer()}>
          ✕ Retour au plan
        </button>
        <div className="camera-titre">{titre}</div>
        {tournage && <div className="camera-tournage">● {dureeLisible(tournage.secondes)}</div>}
      </div>
      {erreur && <div className="camera-erreur">{erreur}</div>}
      {derniere && !tournage && (
        <div className="camera-derniere">
          <span>Dernière {derniere.type === 'video' ? 'vidéo' : 'photo'} :</span>
          {derniere.type !== 'video' && (
            <button className="petit" onClick={() => setAnnoter(espace.photos.find((p) => p.id === derniere.id) ?? derniere)}>
              ✏️ Annoter
            </button>
          )}
          <BoutonNoteVocale
            libelle={espace.photos.find((p) => p.id === derniere.id)?.noteVocale ? '🎤 Note ✓' : '🎤 Note vocale'}
            surEnregistre={async (note) => {
              try {
                setDerniere(await espace.enregistrerNoteVocale(derniere.id, note, auteur));
                await retirerPhotosExportees(espace.projet.id, [derniere.id]);
              } catch (e) {
                setErreur(texteErreur(e));
              }
            }}
          />
        </div>
      )}
      <div className="camera-bas">
        <div className="camera-gauche">
          <span className="camera-compteur" aria-live="polite">
            {prises > 0 && `${prises} prise${prises > 1 ? 's' : ''}`}
            {enPrise + enAttente > 0 && ` · enregistrement ${enPrise + enAttente}…`}
          </span>
          {enregistrementDisponible() && (
            <div className="camera-modes" role="radiogroup" aria-label="Mode">
              {(['photo', 'video'] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={mode === m}
                  className={mode === m ? 'actif' : ''}
                  disabled={!!tournage}
                  onClick={() => void changerMode(m)}
                >
                  {m === 'photo' ? 'Photo' : 'Vidéo'}
                </button>
              ))}
            </div>
          )}
        </div>
        {enVideo ? (
          <button
            className={`camera-declencheur video${tournage ? ' en-cours' : ''}`}
            aria-label={tournage ? 'Arrêter la vidéo' : 'Filmer'}
            disabled={!pret}
            onClick={() => void (tournage ? arreterVideo() : demarrerVideo())}
          />
        ) : (
          <button className="camera-declencheur" aria-label="Prendre la photo" disabled={!pret} onClick={declencher} />
        )}
        <label className="camera-natif" title="Appareil photo du téléphone">
          Appareil du téléphone
          <input
            type="file"
            accept={enVideo ? 'video/*' : 'image/*'}
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const prisLe = new Date(f.lastModified || Date.now());
                suivre(enVideo || f.type.startsWith('video/') ? surVideo(f, 'appareil', prisLe, f.name) : surCapture(f, 'appareil', prisLe));
                setPrises((n) => n + 1);
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {annoter && (
        <div className="camera-annoter">
          <EditeurAnnotations
            espace={espace}
            photo={annoter}
            surFermer={() => setAnnoter(null)}
            surEnregistre={(p) => {
              setAnnoter(null);
              setDerniere(p);
              void retirerPhotosExportees(espace.projet.id, [p.id]);
            }}
          />
        </div>
      )}
    </div>
  );
}
