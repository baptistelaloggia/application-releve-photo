import { useEffect, useRef, useState } from 'react';
import {
  DEBIT_AUDIO,
  DUREE_MAX_NOTE,
  demarrerEnregistrement,
  dureeLisible,
  enregistrementDisponible,
  formatAudio,
  ouvrirMicro,
  type Enregistreur,
  type FormatAudio,
  versWav,
} from '../../photo/enregistrement';
import { cleTag, tagsDansPhrase, tousLesTags } from '../../domaine/tags';
import type { EspaceProjet } from '../../projet/EspaceProjet';
import { corrigerDictee, siglesConnus } from '../../domaine/dictee';
import {
  ajouterAuCommentaire,
  demarrerTranscription,
  texteErreurTranscription,
  transcriptionDisponible,
  transcriptionLocale,
  type ResultatTranscription,
  type Transcripteur,
} from '../../photo/transcription';
import { ecrireReglage, lireMemoireTags, lireReglage, noterTagsUtilises } from '../../stockage/registre';
import { texteErreur } from '../commun';

/**
 * Transcription autorisée ? Sur l'appareil : toujours. En ligne (service vocal de Chrome, serveurs
 * Google) : seulement avec l'accord de l'utilisateur, demandé une fois et mémorisé sur l'appareil.
 */
export async function modeTranscription(): Promise<'locale' | 'en-ligne' | null> {
  if (!transcriptionDisponible()) return null;
  if (await transcriptionLocale()) return 'locale';
  let accord = await lireReglage<boolean>('transcriptionEnLigne');
  if (accord === undefined) {
    accord = confirm(
      'Transcrire la dictée et les notes vocales en texte (commentaire et tags) ?\n\n' +
        "Ce téléphone ne sait pas le faire seul : le son serait envoyé au service de reconnaissance vocale de Chrome (serveurs Google), le temps de la transcription. " +
        'Annuler : les notes restent enregistrées, sans transcription. (Choix modifiable en effaçant les données de l’appli.)',
    );
    await ecrireReglage('transcriptionEnLigne', accord);
  }
  return accord ? 'en-ligne' : null;
}

/**
 * Applique la phrase dictée à une photo : corrigée (sigles du métier : « cé té a » → CTA), ajoutée
 * au commentaire, et les tags qu'elle cite ajoutés à ceux de la photo.
 */
export async function appliquerPhrase(espace: EspaceProjet, photoId: string, brute: string): Promise<{ phrase: string; tags: string[] }> {
  const photo = espace.photos.find((p) => p.id === photoId);
  if (!photo || !brute.trim()) return { phrase: '', tags: [] };
  const perso = (await lireMemoireTags()).perso;
  const phrase = corrigerDictee(brute, siglesConnus(perso));
  await espace.commenterPhoto(photoId, ajouterAuCommentaire(photo.commentaire, phrase));
  const reconnus = tagsDansPhrase(phrase, tousLesTags(perso));
  const actuels = photo.tags ?? [];
  const nouveaux = reconnus.filter((t) => !actuels.some((a) => cleTag(a) === cleTag(t)));
  if (nouveaux.length) {
    await espace.etiqueterPhoto(photoId, [...actuels, ...nouveaux]);
    await noterTagsUtilises(nouveaux);
  }
  return { phrase, tags: reconnus };
}

/** Compte rendu d'une transcription appliquée, pour l'afficher. */
export function compteRenduPhrase(r: { phrase: string; tags: string[] }, erreur?: string): string {
  if (!r.phrase) return erreur ? `Transcription impossible : ${texteErreurTranscription(erreur)}.` : 'Aucune phrase reconnue.';
  return `« ${r.phrase} »${r.tags.length ? ` · tags : ${r.tags.join(', ')}` : ' · aucun tag reconnu'}`;
}

interface Props {
  /** Appelé à la fin de l'enregistrement. */
  /** Appelé à la fin de l'enregistrement ; transcription : phrase reconnue, ou cause de l'échec. */
  surEnregistre: (note: { audio: Blob; extension: FormatAudio['extension'] | 'wav'; duree: number }, transcription: ResultatTranscription) => Promise<void> | void;
  libelle?: string;
  className?: string;
  desactive?: boolean;
}

/** Bouton « 🎤 Note vocale » : un appui démarre l'enregistrement, un second l'arrête. */
export function BoutonNoteVocale({ surEnregistre, libelle = '🎤 Note vocale', className = 'petit', desactive }: Props) {
  const [enCours, setEnCours] = useState(false);
  const [secondes, setSecondes] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const rec = useRef<{
    enregistreur: Enregistreur;
    micro: MediaStream;
    format: FormatAudio;
    minuteur: number;
    transcripteur: Transcripteur | null;
  } | null>(null);

  const liberer = () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    window.clearInterval(r.minuteur);
    r.micro.getTracks().forEach((p) => p.stop());
  };
  useEffect(
    () => () => {
      rec.current?.enregistreur.annuler();
      rec.current?.transcripteur?.annuler();
      liberer();
    },
    [],
  );

  async function demarrer() {
    setErreur(null);
    try {
      const mode = await modeTranscription();
      const micro = await ouvrirMicro();
      const format = formatAudio();
      const enregistreur = demarrerEnregistrement(micro, format, { audioBitsPerSecond: DEBIT_AUDIO });
      const debut = Date.now();
      const minuteur = window.setInterval(() => {
        const s = (Date.now() - debut) / 1000;
        setSecondes(s);
        if (s >= DUREE_MAX_NOTE) void arreter();
      }, 250);
      // Écoute en parallèle de l'enregistrement : la phrase dictée devient commentaire et tags.
      // La piste du micro est passée à la reconnaissance : sur Android, le micro ne s'ouvre pas deux fois.
      const transcripteur = mode
        ? demarrerTranscription({ locale: mode === 'locale', continu: true, piste: micro.getAudioTracks()[0], sigles: [...siglesConnus()] })
        : null;
      rec.current = { enregistreur, micro, format, minuteur, transcripteur };
      setSecondes(0);
      setEnCours(true);
      navigator.vibrate?.(30);
    } catch (e) {
      setErreur(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? "Accès au micro refusé : autorisez-le dans les réglages du navigateur."
          : `Micro indisponible (${texteErreur(e)}).`,
      );
    }
  }

  async function arreter() {
    const r = rec.current;
    if (!r) return;
    setEnCours(false);
    try {
      const [{ fichier, duree }, transcription] = await Promise.all([
        r.enregistreur.arreter(),
        r.transcripteur?.arreter() ?? Promise.resolve<ResultatTranscription>({ texte: '' }),
      ]);
      liberer();
      if (!fichier.size) return;
      // WAV lisible partout sous Windows ; à défaut, le format d'origine.
      const wav = await versWav(fichier);
      await surEnregistre(wav ? { audio: wav, extension: 'wav', duree } : { audio: fichier, extension: r.format.extension, duree }, transcription);
    } catch (e) {
      liberer();
      setErreur(texteErreur(e));
    }
  }

  if (!enregistrementDisponible()) return null;
  return (
    <>
      <button
        className={`${className}${enCours ? ' enregistre' : ''}`}
        disabled={desactive && !enCours}
        aria-pressed={enCours}
        onClick={() => void (enCours ? arreter() : demarrer())}
      >
        {enCours ? `⏹ Arrêter ${dureeLisible(secondes)}` : libelle}
      </button>
      {erreur && <span className="texte-erreur">{erreur}</span>}
    </>
  );
}

/**
 * Bouton « 🎙 Dicter » (21/11/2026) : la reconnaissance vocale seule, sans enregistrement de note,
 * donc sans conflit d'accès au micro. Un appui, on parle, l'écoute s'arrête à la fin de la phrase
 * (ou d'un second appui). La phrase, corrigée pour les sigles du métier, est passée à surPhrase.
 */
export function BoutonDicter({
  surPhrase,
  className = 'petit',
}: {
  surPhrase: (texte: string, erreur?: string) => Promise<void> | void;
  className?: string;
}) {
  const [ecoute, setEcoute] = useState<Transcripteur | null>(null);
  useEffect(() => () => ecoute?.annuler(), [ecoute]);
  if (!transcriptionDisponible()) return null;

  async function demarrer() {
    const mode = await modeTranscription();
    if (!mode) return;
    const t = demarrerTranscription({ locale: mode === 'locale', continu: false, sigles: [...siglesConnus()] });
    if (!t) return void surPhrase('', 'indisponible');
    setEcoute(t);
    navigator.vibrate?.(30);
    const r = await t.termine;
    setEcoute(null);
    await surPhrase(r.texte, r.erreur);
  }

  return (
    <button
      className={`${className}${ecoute ? ' enregistre' : ''}`}
      aria-pressed={!!ecoute}
      title="Dicter le commentaire : la phrase s'ajoute au commentaire, les tags cités sont ajoutés"
      onClick={() => void (ecoute ? ecoute.arreter() : demarrer())}
    >
      {ecoute ? '⏹ J’écoute… (fin)' : '🎙 Dicter'}
    </button>
  );
}
