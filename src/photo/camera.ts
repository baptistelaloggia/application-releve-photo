/**
 * Appareil photo intégré à l'appli : la visée s'ouvre directement dans l'appli,
 * un appui sur le déclencheur prend la photo et l'on reste en visée (rafale possible).
 * C'est ce qui permet de tenir « 2 appuis par photo » : le repère, puis le déclencheur.
 * L'appareil photo du téléphone reste disponible en secours (meilleur traitement d'image,
 * mais une validation de plus).
 */

type ImageCaptureCtor = new (piste: MediaStreamTrack) => { takePhoto(): Promise<Blob> };

export function cameraDisponible(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** Ouvre la caméra arrière, à la meilleure résolution proposée. */
export async function ouvrirCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } },
  });
}

export function fermerCamera(flux: MediaStream | null) {
  flux?.getTracks().forEach((p) => p.stop());
}

/**
 * Prend une photo. ImageCapture (Chrome Android) donne la pleine résolution du capteur ;
 * à défaut, on copie l'image de la visée.
 */
export async function prendrePhoto(flux: MediaStream, video: HTMLVideoElement): Promise<Blob> {
  const piste = flux.getVideoTracks()[0];
  const Ctor = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  if (Ctor && piste) {
    try {
      return await new Ctor(piste).takePhoto();
    } catch {
      // Non pris en charge par cette caméra : copie de la visée.
    }
  }
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d')!.drawImage(video, 0, 0);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('Photo impossible'))), 'image/jpeg', 0.92));
}

/** Message clair selon la raison du refus de la caméra. */
export function texteErreurCamera(e: unknown): string {
  const nom = e instanceof DOMException ? e.name : '';
  if (nom === 'NotAllowedError') {
    return "Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur (icône à gauche de l'adresse), ou utilisez l'appareil photo du téléphone.";
  }
  if (nom === 'NotFoundError' || nom === 'OverconstrainedError') return 'Aucune caméra trouvée sur cet appareil.';
  if (nom === 'NotReadableError') return 'La caméra est déjà utilisée par une autre application.';
  return `Caméra indisponible (${e instanceof Error ? e.message : String(e)}).`;
}
