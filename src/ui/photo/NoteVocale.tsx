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
} from '../../photo/enregistrement';
import { texteErreur } from '../commun';

interface Props {
  /** Appelé à la fin de l'enregistrement. */
  surEnregistre: (note: { audio: Blob; extension: FormatAudio['extension']; duree: number }) => Promise<void> | void;
  libelle?: string;
  className?: string;
  desactive?: boolean;
}

/** Bouton « 🎤 Note vocale » : un appui démarre l'enregistrement, un second l'arrête. */
export function BoutonNoteVocale({ surEnregistre, libelle = '🎤 Note vocale', className = 'petit', desactive }: Props) {
  const [enCours, setEnCours] = useState(false);
  const [secondes, setSecondes] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const rec = useRef<{ enregistreur: Enregistreur; micro: MediaStream; format: FormatAudio; minuteur: number } | null>(null);

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
      liberer();
    },
    [],
  );

  async function demarrer() {
    setErreur(null);
    try {
      const micro = await ouvrirMicro();
      const format = formatAudio();
      const enregistreur = demarrerEnregistrement(micro, format, { audioBitsPerSecond: DEBIT_AUDIO });
      const debut = Date.now();
      const minuteur = window.setInterval(() => {
        const s = (Date.now() - debut) / 1000;
        setSecondes(s);
        if (s >= DUREE_MAX_NOTE) void arreter();
      }, 250);
      rec.current = { enregistreur, micro, format, minuteur };
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
      const { fichier, duree } = await r.enregistreur.arreter();
      liberer();
      if (fichier.size) await surEnregistre({ audio: fichier, extension: r.format.extension, duree });
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
