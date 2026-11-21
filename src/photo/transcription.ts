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

export interface ResultatTranscription {
  /** Phrase reconnue ('' si rien). */
  texte: string;
  /** Cause d'un échec (« audio-capture », « network », « no-speech »…), pour l'expliquer. */
  erreur?: string;
}

export interface Transcripteur {
  /** Arrête l'écoute et renvoie la phrase reconnue. */
  arreter(): Promise<ResultatTranscription>;
  /** Fin de l'écoute, d'elle-même (dictée : fin de la phrase) ou après arreter(). */
  termine: Promise<ResultatTranscription>;
  annuler(): void;
}

/** Explication lisible d'un code d'erreur de la reconnaissance vocale. */
export function texteErreurTranscription(code: string): string {
  switch (code) {
    case 'audio-capture':
      return 'micro indisponible pour la reconnaissance (déjà utilisé par l’enregistrement de la note ?)';
    case 'network':
      return 'pas de réseau (la reconnaissance vocale de Chrome est en ligne)';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'reconnaissance vocale refusée par le navigateur';
    case 'no-speech':
      return 'aucune parole entendue';
    case 'language-not-supported':
      return 'français non pris en charge';
    default:
      return code;
  }
}

/**
 * Démarre l'écoute (français).
 * - continu : false pour une dictée (fin automatique à la fin de la phrase), true pendant une note vocale ;
 * - piste : piste du micro déjà ouverte pour l'enregistrement de la note. Les versions récentes de
 *   Chrome acceptent de l'écouter (start(piste)), ce qui évite le conflit d'accès au micro sur
 *   Android [À VÉRIFIER : version de Chrome du téléphone] ;
 * - sigles : vocabulaire du métier, proposé à la reconnaissance quand elle le permet.
 */
export function demarrerTranscription(options: { locale?: boolean; continu: boolean; piste?: MediaStreamTrack; sigles?: string[] }): Transcripteur | null {
  const C = constructeur();
  if (!C) return null;
  const rec = new C();
  rec.lang = 'fr-FR';
  rec.continuous = options.continu;
  // Résultats provisoires gardés : sur Android, le résultat définitif arrive parfois après l'arrêt.
  rec.interimResults = true;
  if (options.locale) rec.processLocally = true;
  // Vocabulaire du métier (« biais contextuel » des versions récentes de Chrome), si disponible.
  try {
    const Phrase = (window as unknown as { SpeechRecognitionPhrase?: new (p: string, poids: number) => unknown }).SpeechRecognitionPhrase;
    if (Phrase && options.sigles?.length) (rec as unknown as { phrases: unknown[] }).phrases = options.sigles.map((p) => new Phrase(p, 5));
  } catch {
    /* non pris en charge */
  }
  const definitifs: string[] = [];
  let provisoire = '';
  let erreur: string | undefined;
  const texte = () => [...definitifs, provisoire].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  let fini: (r: ResultatTranscription) => void = () => undefined;
  const termine = new Promise<ResultatTranscription>((ok) => (fini = ok));
  rec.onresult = (e) => {
    provisoire = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) definitifs.push(t);
      else provisoire = `${provisoire} ${t}`.trim();
    }
  };
  rec.onerror = (e) => {
    if (e.error !== 'aborted') erreur = e.error;
  };
  rec.onend = () => fini({ texte: texte(), ...(erreur && !texte() ? { erreur } : {}) });
  try {
    if (options.piste) {
      try {
        (rec.start as (piste?: MediaStreamTrack) => void).call(rec, options.piste);
      } catch {
        rec.start();
      }
    } else rec.start();
  } catch {
    return null;
  }
  return {
    termine,
    arreter() {
      try {
        rec.stop();
      } catch {
        fini({ texte: texte() });
      }
      // Garde-fou : on n'attend pas plus de 8 s la fin de la reconnaissance (réseau mobile lent).
      return Promise.race([termine, new Promise<ResultatTranscription>((ok) => window.setTimeout(() => ok({ texte: texte(), ...(erreur ? { erreur } : {}) }), 8000))]);
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
