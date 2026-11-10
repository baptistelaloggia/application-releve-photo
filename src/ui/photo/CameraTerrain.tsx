import { useEffect, useRef, useState } from 'react';
import { cameraDisponible, fermerCamera, ouvrirCamera, prendrePhoto, texteErreurCamera } from '../../photo/camera';

interface Props {
  /** Ce qui est photographié : « P012 · R+2 · SF202 SANIT. F » ou « Panier à classer ». */
  titre: string;
  /** Photos en cours de compression et d'enregistrement. */
  enAttente: number;
  surCapture: (photo: Blob, source: 'appli' | 'appareil', prisLe: Date) => void;
  surFermer: () => void;
}

/** Visée plein écran : déclencheur, rafale, retour au plan. */
export function CameraTerrain({ titre, enAttente, surCapture, surFermer }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const flux = useRef<MediaStream | null>(null);
  const [erreur, setErreur] = useState<string | null>(cameraDisponible() ? null : 'Caméra non disponible dans ce navigateur.');
  const [pret, setPret] = useState(false);
  const [prises, setPrises] = useState(0);
  const [eclair, setEclair] = useState(false);
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
      fermerCamera(flux.current);
      flux.current = null;
    };
  }, []);

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
        surCapture(photo, 'appli', prisLe);
        setPrises((n) => n + 1);
      } catch (e) {
        setErreur(texteErreurCamera(e));
      } finally {
        setEnPrise((n) => n - 1);
      }
    });
  }

  // Fermer la visée seulement quand les photos demandées ont été prises.
  const fermer = () => void file.current.then(surFermer);

  return (
    <div className="camera" role="dialog" aria-label="Appareil photo">
      <video ref={video} playsInline muted className="camera-video" />
      {eclair && <div className="camera-eclair" />}
      <div className="camera-haut">
        <button className="camera-fermer" onClick={fermer}>
          ✕ Retour au plan
        </button>
        <div className="camera-titre">{titre}</div>
      </div>
      {erreur && <div className="camera-erreur">{erreur}</div>}
      <div className="camera-bas">
        <span className="camera-compteur" aria-live="polite">
          {prises > 0 && `${prises} photo${prises > 1 ? 's' : ''}`}
          {enPrise + enAttente > 0 && ` · enregistrement ${enPrise + enAttente}…`}
        </span>
        <button
          className="camera-declencheur"
          aria-label="Prendre la photo"
          disabled={!pret}
          onClick={declencher}
        />
        <label className="camera-natif" title="Appareil photo du téléphone">
          Appareil du téléphone
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                surCapture(f, 'appareil', new Date(f.lastModified || Date.now()));
                setPrises((n) => n + 1);
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
