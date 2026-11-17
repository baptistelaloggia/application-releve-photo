/**
 * Enregistrement de vidéos et de notes vocales avec MediaRecorder (Chrome Android, Edge, Chrome).
 * Le format MP4 (lisible partout sous Windows) est préféré quand le navigateur sait l'enregistrer ;
 * sinon WebM (lisible dans Edge, Chrome et VLC). [À VÉRIFIER : MP4 sur votre téléphone]
 */

export type FormatVideo = { mime: string; extension: 'mp4' | 'webm' };
export type FormatAudio = { mime: string; extension: 'm4a' | 'webm' | 'ogg' };

/** Fréquence d'échantillonnage des notes vocales en WAV : suffisante pour la voix (environ 1,9 Mo par minute). */
const FREQUENCE_NOTE = 16_000;

/**
 * Convertit une note vocale en WAV (PCM 16 bits, mono, 16 kHz).
 * Le format enregistré par le téléphone (Opus dans un conteneur .m4a ou .webm) n'est pas lu par
 * tous les lecteurs Windows ; le WAV l'est partout (Explorateur, Lecteur multimédia, Edge, VLC).
 * Renvoie null si le navigateur ne sait pas décoder l'enregistrement : il est alors gardé tel quel.
 */
export async function versWav(audio: Blob): Promise<Blob | null> {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    let decode: AudioBuffer;
    try {
      decode = await ctx.decodeAudioData(await audio.arrayBuffer());
    } finally {
      void ctx.close();
    }
    const longueur = Math.max(1, Math.ceil(decode.duration * FREQUENCE_NOTE));
    const hors = new OfflineAudioContext(1, longueur, FREQUENCE_NOTE);
    const source = hors.createBufferSource();
    source.buffer = decode;
    source.connect(hors.destination);
    source.start();
    const mono = (await hors.startRendering()).getChannelData(0);
    return encoderWav(mono, FREQUENCE_NOTE);
  } catch {
    return null;
  }
}

/** En-tête RIFF/WAVE et échantillons PCM 16 bits. */
export function encoderWav(echantillons: Float32Array, frequence: number): Blob {
  const octets = new DataView(new ArrayBuffer(44 + echantillons.length * 2));
  const texte = (pos: number, t: string) => [...t].forEach((c, i) => octets.setUint8(pos + i, c.charCodeAt(0)));
  texte(0, 'RIFF');
  octets.setUint32(4, 36 + echantillons.length * 2, true);
  texte(8, 'WAVE');
  texte(12, 'fmt ');
  octets.setUint32(16, 16, true);
  octets.setUint16(20, 1, true); // PCM
  octets.setUint16(22, 1, true); // mono
  octets.setUint32(24, frequence, true);
  octets.setUint32(28, frequence * 2, true);
  octets.setUint16(32, 2, true);
  octets.setUint16(34, 16, true);
  texte(36, 'data');
  octets.setUint32(40, echantillons.length * 2, true);
  for (let i = 0; i < echantillons.length; i++) {
    const v = Math.max(-1, Math.min(1, echantillons[i]));
    octets.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([octets.buffer], { type: 'audio/wav' });
}

/** Type MIME d'une note vocale, d'après son extension (pour la lecture dans l'appli). */
export const mimeNote = (extension: string) =>
  ({ wav: 'audio/wav', m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg' })[extension] ?? 'application/octet-stream';

const prisEnCharge = (mime: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime);

export function enregistrementDisponible(): boolean {
  return typeof MediaRecorder !== 'undefined';
}

export function formatVideo(): FormatVideo {
  for (const [mime, extension] of [
    ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ] as const) {
    if (prisEnCharge(mime)) return { mime, extension };
  }
  return { mime: '', extension: 'webm' };
}

export function formatAudio(): FormatAudio {
  for (const [mime, extension] of [
    ['audio/mp4', 'm4a'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/ogg;codecs=opus', 'ogg'],
  ] as const) {
    if (prisEnCharge(mime)) return { mime, extension };
  }
  return { mime: '', extension: 'webm' };
}

/** Débits : vidéo 720p lisible (environ 20 Mo par minute) ; voix (environ 0,25 Mo par minute). */
export const DEBIT_VIDEO = 2_500_000;
export const DEBIT_AUDIO = 32_000;
/** Durée maximale d'une vidéo : au-delà, l'enregistrement s'arrête de lui-même. */
export const DUREE_MAX_VIDEO = 180;
export const DUREE_MAX_NOTE = 120;

export interface Enregistreur {
  /** Arrête l'enregistrement et renvoie le fichier et sa durée (secondes). */
  arreter(): Promise<{ fichier: Blob; duree: number }>;
  annuler(): void;
}

/** Démarre un enregistrement sur un flux (vidéo et son, ou son seul). */
export function demarrerEnregistrement(flux: MediaStream, format: { mime: string }, debits: MediaRecorderOptions): Enregistreur {
  const morceaux: Blob[] = [];
  const rec = new MediaRecorder(flux, { ...(format.mime ? { mimeType: format.mime } : {}), ...debits });
  const debut = performance.now();
  let fin = debut;
  const termine = new Promise<Blob>((ok, ko) => {
    rec.ondataavailable = (e) => e.data.size && morceaux.push(e.data);
    rec.onstop = () => ok(new Blob(morceaux, { type: (rec.mimeType || format.mime).split(';')[0] }));
    rec.onerror = (e) => ko((e as unknown as { error?: Error }).error ?? new Error('Enregistrement interrompu'));
  });
  // Morceaux d'une seconde : une coupure brutale ne perd que la dernière seconde.
  rec.start(1000);
  return {
    async arreter() {
      if (rec.state !== 'inactive') {
        fin = performance.now();
        rec.stop();
      }
      const fichier = await termine;
      return { fichier, duree: (fin - debut) / 1000 };
    },
    annuler() {
      if (rec.state !== 'inactive') rec.stop();
    },
  };
}

/** Micro seul, pour une note vocale. */
export async function ouvrirMicro(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
}

const COTE_MINIATURE = 320;

/** Image d'une vidéo (miniature) et ses dimensions, lues dans le fichier. */
export async function miniatureVideo(fichier: Blob): Promise<{ miniature: Blob; largeur: number; hauteur: number; duree: number }> {
  const url = URL.createObjectURL(fichier);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise<void>((ok, ko) => {
      v.onloadeddata = () => ok();
      v.onerror = () => ko(new Error('Vidéo illisible dans ce navigateur.'));
      window.setTimeout(() => ko(new Error('Vidéo illisible (délai dépassé).')), 15_000);
    });
    // Un enregistrement WebM n'annonce pas toujours sa durée (Infinity) : on la mesure.
    let duree = v.duration;
    if (!Number.isFinite(duree)) {
      v.currentTime = 1e7;
      await new Promise((ok) => (v.onseeked = ok));
      duree = v.duration;
      v.currentTime = 0;
      await new Promise((ok) => (v.onseeked = ok));
    } else if (duree > 0.5) {
      v.currentTime = Math.min(0.3, duree / 2);
      await new Promise((ok) => (v.onseeked = ok));
    }
    const largeur = v.videoWidth;
    const hauteur = v.videoHeight;
    const e = Math.min(1, COTE_MINIATURE / Math.max(largeur, hauteur, 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(largeur * e));
    c.height = Math.max(1, Math.round(hauteur * e));
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    const miniature = await new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('Miniature impossible'))), 'image/jpeg', 0.7));
    return { miniature, largeur, hauteur, duree: Number.isFinite(duree) ? duree : 0 };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** Extension d'une vidéo importée, d'après son type ou son nom ; null si le format n'est pas retenu. */
export function extensionVideo(f: Blob & { name?: string }): 'mp4' | 'webm' | null {
  const t = f.type.toLowerCase();
  const nom = (f.name ?? '').toLowerCase();
  if (t.includes('mp4') || t.includes('quicktime') || /\.(mp4|m4v|mov)$/.test(nom)) return 'mp4';
  if (t.includes('webm') || nom.endsWith('.webm')) return 'webm';
  return null;
}

export const dureeLisible = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
