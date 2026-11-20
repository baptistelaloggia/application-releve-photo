/**
 * Transcription des notes vocales (20/11/2026) : la phrase dictée devient le commentaire de la
 * photo, et les tags qu'elle cite sont ajoutés (domaine/tags.ts, tagsDansPhrase).
 *
 * Elle passe par la reconnaissance vocale du navigateur (Web Speech API, Chrome et Edge) : Chrome
 * envoie le son à son service de reconnaissance (serveurs Google). C'est un service en ligne tiers,
 * contraire au principe de CONCEPTION §A.4 (pas de service cloud tiers) : il n'est donc utilisé
 * qu'avec l'accord explicite de l'utilisateur, demandé une fois et mémorisé sur l'appareil.
 * Sans réseau ni accord, la note est enregistrée sans transcription.
 *
 * Reconnaissance sur l'appareil (option « processLocally » des versions récentes de Chrome) :
 * **désactivée** (20/11/2026). Dans le Chromium des tests, `SpeechRecognition.available()` et
 * `processLocally` font planter la page ; sur un téléphone, un tel plantage pendant une visite
 * ferait perdre les prises en cours. À réessayer sur un vrai téléphone [À VÉRIFIER].
 */

interface ResultatReconnaissance {
  isFinal: boolean;
  0: { transcript: string };
}
interface Reconnaissance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ResultatReconnaissance> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type ConstructeurReconnaissance = (new () => Reconnaissance) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

function constructeur(): ConstructeurReconnaissance | null {
  const w = window as unknown as { SpeechRecognition?: ConstructeurReconnaissance; webkitSpeechRecognition?: ConstructeurReconnaissance };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function transcriptionDisponible(): boolean {
  return constructeur() !== null;
}

/**
 * La reconnaissance du français peut-elle se faire sur l'appareil, sans envoi du son ?
 * Désactivée pour l'instant (plantage de la page constaté, voir l'en-tête) : toujours false.
 */
export async function transcriptionLocale(): Promise<boolean> {
  return false;
}

export interface Transcripteur {
  /** Arrête l'écoute et renvoie la phrase reconnue ('' si rien). */
  arreter(): Promise<string>;
  annuler(): void;
}

/** Démarre l'écoute (français). locale : reconnaissance sur l'appareil uniquement. */
export function demarrerTranscription(locale: boolean): Transcripteur | null {
  const C = constructeur();
  if (!C) return null;
  const rec = new C();
  rec.lang = 'fr-FR';
  rec.continuous = true;
  rec.interimResults = false;
  if (locale) rec.processLocally = true;
  const morceaux: string[] = [];
  let fini: (texte: string) => void = () => undefined;
  const termine = new Promise<string>((ok) => (fini = ok));
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) morceaux.push(e.results[i][0].transcript.trim());
  };
  // Erreur (pas de réseau, micro déjà pris par l'enregistrement…) : la note reste, sans transcription.
  rec.onerror = () => undefined;
  rec.onend = () => fini(morceaux.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    arreter() {
      try {
        rec.stop();
      } catch {
        fini(morceaux.join(' '));
      }
      // Garde-fou : on n'attend pas plus de 4 s la fin de la reconnaissance.
      return Promise.race([termine, new Promise<string>((ok) => window.setTimeout(() => ok(morceaux.join(' ').trim()), 4000))]);
    },
    annuler() {
      try {
        rec.abort();
      } catch {
        /* déjà arrêtée */
      }
    },
  };
}

/** Phrase ajoutée au commentaire existant (sans doublon), 2 000 caractères au plus. */
export function ajouterAuCommentaire(commentaire: string, phrase: string): string {
  const p = phrase.trim();
  if (!p) return commentaire;
  const c = commentaire.trim();
  if (c.toLowerCase().includes(p.toLowerCase())) return c;
  const avecMajuscule = p.charAt(0).toUpperCase() + p.slice(1);
  return (c ? `${c} — ${avecMajuscule}` : avecMajuscule).slice(0, 2000);
}
