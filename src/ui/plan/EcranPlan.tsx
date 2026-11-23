import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRetour } from '../retour';
import type { LocalDetecte, StyleEtiquette } from '../../domaine/locaux';
import type { Local, Photo } from '../../domaine/types';
import { dateLocale } from '../../domaine/nommage';
import { compresserPhoto } from '../../photo/compression';
import { extensionVideo, miniatureVideo } from '../../photo/enregistrement';
import { CameraTerrain } from '../photo/CameraTerrain';
import { VisionneusePhoto } from '../photo/VisionneusePhoto';
import { ComparaisonPhotos } from '../photo/ComparaisonPhotos';
import { FicheRepere, PanneauPanier, PanneauTerrain, PhotosDuLocal } from './PanneauxTerrain';
import type { EspaceProjet, ResultatLocal, SaisieLocal } from '../../projet/EspaceProjet';
import { proposerLocaux, styleEncadre } from '../../pdf/pdf';
import { CadreSelection } from './CadreSelection';
import { ecrireReglage, lireReglage } from '../../stockage/registre';
import { BarreRecherche } from '../BarreRecherche';
import { Message, texteErreur } from '../commun';
import { VisionneusePlan, type CommandesVisionneuse, type Marqueur } from './VisionneusePlan';

interface Props {
  espace: EspaceProjet;
  auteur: string;
  planId: string;
  /** Local à montrer à l'ouverture (résultat de recherche). */
  localId?: string | null;
  surChangerPlan: (planId: string, localId?: string | null) => void;
  surFermer: () => void;
  /** Compte rendu à ajouter au journal du projet. */
  surJournal: (lignes: string[]) => void;
}

interface Candidat extends LocalDetecte {
  cle: string;
  retenu: boolean;
  doublon: boolean;
}

type Mode =
  | { type: 'consultation' }
  | { type: 'ajout' }
  | { type: 'brouillon'; x: number; y: number }
  | { type: 'deplacement'; localId: string }
  | { type: 'deplacementRepere'; repereId: string }
  | { type: 'classement'; photoIds: string[] }
  | { type: 'rattachement'; repereId: string }
  | { type: 'direction'; repereId: string }
  | { type: 'detection'; candidats: Candidat[]; sansTexte: boolean; exemple?: StyleEtiquette; encadrer?: boolean };

const PREFIXE_REPERE = 'repere:';

const court = (t: string, n = 16) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function EcranPlan({ espace, auteur, planId, localId, surChangerPlan, surFermer, surJournal }: Props) {
  const plan = espace.planParId(planId)!;
  const niveau = espace.niveauDuPlan(plan);
  const [fichier, setFichier] = useState<Blob | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ type: 'consultation' });
  const [selection, setSelection] = useState<string | null>(localId ?? null);
  const [occupe, setOccupe] = useState(false);
  const [, setVersion] = useState(0);
  const vue = useRef<CommandesVisionneuse>(null);
  const [repereSel, setRepereSel] = useState<string | null>(null);
  /** Appareil photo ouvert ; nouveau : repère créé par appui long (son rattachement est proposé). */
  const [camera, setCamera] = useState<{ repereId: string | null; nouveau?: boolean } | null>(null);
  const [onglet, setOnglet] = useState<'terrain' | 'locaux' | 'panier'>('terrain');
  const [photoOuverte, setPhotoOuverte] = useState<{ photos: Photo[]; index: number } | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Bouton Retour du téléphone (18/11/2026) : il annule le mode en cours, puis désélectionne le
  // repère ou le local ; l'appareil photo et la visionneuse se ferment d'abord (niveau 3).
  useRetour(!!selection, () => setSelection(null), 2);
  useRetour(!!repereSel, () => setRepereSel(null), 2);
  useRetour(mode.type !== 'consultation', () => setMode({ type: 'consultation' }), 2);
  useRetour(!!photoOuverte, () => setPhotoOuverte(null), 3);
  /** Fermeture de l'appareil photo par le bouton Retour : la visée termine d'abord les prises en cours. */
  const fermetureCamera = useRef<(() => void) | null>(null);
  useRetour(!!camera, () => (fermetureCamera.current ? fermetureCamera.current() : setCamera(null)), 3);

  /**
   * Nouveau repère dont on vient de terminer les prises de vue : sa fenêtre de rattachement à un
   * local s'ouvre à la fermeture de la visée (19/11/2026), le plan restant visible derrière.
   */
  const [aRattacher, setARattacher] = useState<string | null>(null);
  /** Dernière action annulable sur les locaux (détection enregistrée, suppression) : bouton « ↶ Annuler ». */
  const [annulation, setAnnulation] = useState<{ texte: string; annuler: () => Promise<void> } | null>(null);
  const annuler = () =>
    annulation &&
    executer(async () => {
      await annulation.annuler();
      setInfo(`Annulé : ${annulation.texte}`);
      setAnnulation(null);
    });
  /** Comparaison avant / après ouverte sur un repère (lot 6). */
  const [comparaison, setComparaison] = useState<string | null>(null);
  useRetour(!!aRattacher, () => setARattacher(null), 3);

  /** Après un placement depuis le panier : retour au panier pour continuer le classement. */
  function apresPlacement(nb: number, cible: string) {
    setMode({ type: 'consultation' });
    setSelection(null);
    setRepereSel(null);
    setOnglet('panier');
    setInfo(`${nb > 1 ? `${nb} photos placées` : '1 photo placée'} sur ${cible}.`);
  }

  // File d'enregistrement des photos : la compression (1 à 2 s par photo sur téléphone)
  // se fait en arrière-plan, pour pouvoir enchaîner les prises de vue sans attendre.
  const file = useRef<Promise<void>>(Promise.resolve());
  const [enAttente, setEnAttente] = useState(0);
  function enregistrerPhoto(
    original: Blob,
    source: Photo['source'],
    prisLe: Date,
    repereId: string | null,
    nomOrigine?: string,
    tags: string[] = [],
  ): Promise<Photo | null> {
    setEnAttente((n) => n + 1);
    const tache = file.current.then(async () => {
      try {
        const c = await compresserPhoto(original);
        return await espace.ajouterPhoto(
          {
            repereId,
            jpeg: c.jpeg,
            miniature: c.miniature,
            largeur: c.largeur,
            hauteur: c.hauteur,
            source,
            prisLe: source !== 'appli' && c.dateExif ? c.dateExif : prisLe,
            nomOrigine,
            tags,
          },
          auteur,
        );
      } catch (e) {
        setErreur(`Photo non enregistrée : ${texteErreur(e)}`);
        return null;
      } finally {
        setEnAttente((n) => n - 1);
        setVersion((v) => v + 1);
      }
    });
    file.current = tache.then(() => undefined);
    return tache;
  }

  /** Vidéo : pas de recompression (le fichier est gardé tel quel) ; miniature tirée de la vidéo. */
  function enregistrerVideo(
    fichier: Blob,
    source: Photo['source'],
    prisLe: Date,
    repereId: string | null,
    nomOrigine?: string,
    tags: string[] = [],
  ): Promise<Photo | null> {
    setEnAttente((n) => n + 1);
    const tache = file.current.then(async () => {
      try {
        const extension = extensionVideo(fichier as File) ?? (fichier.type.includes('mp4') ? 'mp4' : 'webm');
        const m = await miniatureVideo(fichier);
        return await espace.ajouterPhoto(
          {
            repereId,
            jpeg: fichier,
            miniature: m.miniature,
            largeur: m.largeur,
            hauteur: m.hauteur,
            source,
            prisLe,
            nomOrigine,
            video: { extension, duree: m.duree },
            tags,
          },
          auteur,
        );
      } catch (e) {
        setErreur(`Vidéo non enregistrée : ${texteErreur(e)}`);
        return null;
      } finally {
        setEnAttente((n) => n - 1);
        setVersion((v) => v + 1);
      }
    });
    file.current = tache.then(() => undefined);
    return tache;
  }
  // Ne pas quitter la page tant que des photos sont en cours d'enregistrement.
  useEffect(() => {
    if (enAttente === 0) return;
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', retenir);
    return () => window.removeEventListener('beforeunload', retenir);
  }, [enAttente]);

  // Appui sur un repère : ouvre l'appareil photo (par défaut) ou la fiche du repère.
  const [appuiRepere, setAppuiRepere] = useState<'photo' | 'fiche'>('photo');
  useEffect(() => {
    void lireReglage<'photo' | 'fiche'>('appuiRepere').then((v) => v && setAppuiRepere(v));
  }, []);

  useEffect(() => {
    let annule = false;
    setFichier(null);
    espace
      .lirePlan(plan)
      .then((b) => !annule && setFichier(b))
      .catch((e) => !annule && setErreur(texteErreur(e)));
    return () => {
      annule = true;
    };
  }, [espace, plan]);

  const locaux = espace.locauxDuPlan(planId);
  const localFocus = localId ? espace.locaux.find((l) => l.id === localId) : undefined;
  // Niveaux ayant un plan, dans l'ordre du projet.
  const plansTries = useMemo(
    () => espace.niveaux.flatMap((n) => {
      const p = espace.planDuNiveau(n.id);
      return p ? [{ p, n }] : [];
    }),
    [espace, espace.plans, espace.niveaux],
  );

  // Étiquettes sur le plan : le nom du local (le choix « numéro » est retiré le 18/11/2026).
  const texteEtiquette = (l: { nom: string }) => court(l.nom, 22);

  async function executer(action: () => Promise<void>) {
    setErreur(null);
    setOccupe(true);
    try {
      await action();
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setOccupe(false);
      setVersion((v) => v + 1);
    }
  }

  // ------------------------------------------------------------ marqueurs

  const marqueurs: Marqueur[] = [];
  // Repère sélectionné (ou en cours de prise de vue) : son local est entouré en rouge.
  const repereAssocie = espace.reperes.find((r) => r.id === (aRattacher ?? repereSel ?? camera?.repereId) && !r.surEtiquette);
  const photographies = espace.locauxPhotographies(dateLocale(new Date()));
  for (const l of locaux) {
    if (mode.type === 'deplacement' && mode.localId === l.id) continue;
    marqueurs.push({
      id: l.id,
      x: l.x,
      y: l.y,
      libelle: texteEtiquette(l),
      titre: l.nom + (photographies.has(l.id) ? ' (photographié aujourd’hui)' : ''),
      style: l.id === selection ? 'selection' : photographies.has(l.id) ? 'local-visite' : 'local',
      associe: !!repereAssocie && repereAssocie.localId === l.id,
      pastille: espace.photosDuLocal(l.id).length || undefined,
    });
  }
  if (mode.type !== 'detection') {
    for (const rep of espace.reperesDuPlan(planId)) {
      if (mode.type === 'deplacementRepere' && mode.repereId === rep.id) continue;
      if (rep.surEtiquette) continue; // ses photos s'affichent sur l'étiquette du local
      marqueurs.push({
        id: PREFIXE_REPERE + rep.id,
        x: rep.x,
        y: rep.y,
        libelle: (rep.suivi ? '📌 ' : '') + (rep.libelle ? court(rep.libelle, 22) : rep.numero),
        titre: `${rep.numero}${rep.libelle ? ` · ${rep.libelle}` : ''}`,
        style: rep.id === repereSel ? 'repere-selection' : 'repere',
        pastille: espace.photosDuRepere(rep.id).length || undefined,
        vers: rep.visee,
      });
    }
  }
  if (mode.type === 'detection') {
    for (const c of mode.candidats) {
      if (c.doublon) continue;
      marqueurs.push({
        id: `candidat:${c.cle}`,
        x: c.x,
        y: c.y,
        libelle: texteEtiquette(c),
        titre: `${c.lignes.join(' / ')}${c.retenu ? '' : ' (écarté)'}`,
        style: c.retenu ? 'candidat' : 'candidat-ecarte',
      });
    }
  }
  if (mode.type === 'brouillon') marqueurs.push({ id: 'brouillon', x: mode.x, y: mode.y, libelle: 'Nouveau', style: 'brouillon' });

  // ------------------------------------------------------------ actions

  function ouvrirCamera(repereId: string | null) {
    setCamera({ repereId });
  }

  /** Appui long : nouveau repère (rattaché au local le plus proche), puis appareil photo. */
  function surAppuiLongPlan(x: number, y: number) {
    if (mode.type === 'classement') return surAppuiPlan(x, y);
    if (mode.type !== 'consultation') return;
    void executer(async () => {
      const r = await espace.creerRepere(planId, x, y, auteur);
      setSelection(null);
      setRepereSel(r.id);
      setCamera({ repereId: r.id, nouveau: true });
    });
  }

  function surAppuiPlan(x: number, y: number) {
    if (mode.type === 'rattachement') return; // on attend un appui sur un local
    if (mode.type === 'direction') {
      const id = mode.repereId;
      void executer(async () => {
        await espace.modifierRepere(id, { visee: { x, y } }, auteur);
        setMode({ type: 'consultation' });
        setRepereSel(id);
      });
      return;
    }
    if (mode.type === 'classement') {
      const photoIds = mode.photoIds;
      void executer(async () => {
        const r = await espace.creerRepere(planId, x, y, auteur);
        await espace.classerPhotos(photoIds, r.id, auteur);
        apresPlacement(photoIds.length, `le nouveau repère ${r.numero}`);
      });
      return;
    }
    if (mode.type === 'deplacementRepere') {
      const id = mode.repereId;
      void executer(async () => {
        await espace.modifierRepere(id, { x, y, localId: espace.localProche(planId, x, y)?.id ?? null }, auteur);
        setMode({ type: 'consultation' });
        setRepereSel(id);
      });
      return;
    }
    if (mode.type === 'ajout' || mode.type === 'brouillon') {
      setSelection(null);
      setMode({ type: 'brouillon', x, y });
    } else if (mode.type === 'deplacement') {
      const l = espace.locaux.find((x2) => x2.id === mode.localId)!;
      void executer(async () => {
        await espace.modifierLocal(l.id, { ...l, x, y }, auteur);
        setMode({ type: 'consultation' });
        setSelection(l.id);
      });
    } else if (mode.type === 'consultation') {
      setSelection(null);
      setRepereSel(null);
    }
  }

  function surAppuiMarqueur(id: string) {
    if (id.startsWith('candidat:') && mode.type === 'detection') {
      const cle = id.slice('candidat:'.length);
      setMode({ ...mode, candidats: mode.candidats.map((c) => (c.cle === cle ? { ...c, retenu: !c.retenu } : c)) });
      return;
    }
    if (id.startsWith(PREFIXE_REPERE)) {
      const repereId = id.slice(PREFIXE_REPERE.length);
      if (mode.type === 'classement') {
        const photoIds = mode.photoIds;
        void executer(async () => {
          await espace.classerPhotos(photoIds, repereId, auteur);
          apresPlacement(photoIds.length, `le repère ${espace.reperes.find((x) => x.id === repereId)?.numero ?? ''}`);
        });
        return;
      }
      if (mode.type !== 'consultation') return;
      if (appuiRepere === 'photo') photoSurMarqueur(id);
      else ficheSurMarqueur(id);
      return;
    }
    // Appui sur l'étiquette d'un local.
    if (mode.type === 'classement') {
      const photoIds = mode.photoIds;
      void executer(async () => {
        const r = await espace.repereEtiquette(id, auteur);
        await espace.classerPhotos(photoIds, r.id, auteur);
        const l = espace.locaux.find((x) => x.id === id);
        apresPlacement(photoIds.length, `le local ${l?.nom ?? ''}`);
      });
      return;
    }
    if (mode.type === 'rattachement') {
      const repereId = mode.repereId;
      void executer(async () => {
        await espace.modifierRepere(repereId, { localId: id }, auteur);
        setMode({ type: 'consultation' });
        setRepereSel(repereId);
      });
      return;
    }
    if (mode.type === 'ajout') setMode({ type: 'consultation' });
    if (mode.type === 'consultation' || mode.type === 'ajout') {
      // Réglage « Affichage » : appui = photo (par défaut) ou fiche ; l'appui long fait l'autre.
      if (appuiRepere === 'photo' && mode.type === 'consultation') photoSurMarqueur(id);
      else ficheSurMarqueur(id);
    }
  }

  /** Double appui sur un repère ou sur l'étiquette d'un local : ses photos, la plus récente d'abord affichée. */
  function surDoubleAppuiMarqueur(id: string) {
    if (mode.type !== 'consultation') return;
    const repereId = id.startsWith(PREFIXE_REPERE) ? id.slice(PREFIXE_REPERE.length) : null;
    const photos = repereId ? espace.photosDuRepere(repereId) : espace.photosDuLocal(id);
    if (repereId) {
      setSelection(null);
      setRepereSel(repereId);
    } else {
      setRepereSel(null);
      setSelection(id);
    }
    if (photos.length === 0) {
      setInfo('Aucune photo pour l’instant.');
      return;
    }
    setPhotoOuverte({ photos, index: photos.length - 1 });
  }

  /** Appui long sur une étiquette de local ou un repère : l'action inverse du simple appui. */
  function surAppuiLongMarqueur(id: string) {
    if (mode.type !== 'consultation') return;
    if (appuiRepere === 'photo') ficheSurMarqueur(id);
    else photoSurMarqueur(id);
  }

  /** Ouvre l'appareil photo sur un repère, ou sur l'étiquette d'un local. */
  function photoSurMarqueur(id: string) {
    if (id.startsWith(PREFIXE_REPERE)) {
      const repereId = id.slice(PREFIXE_REPERE.length);
      setSelection(null);
      setRepereSel(repereId);
      ouvrirCamera(repereId);
      return;
    }
    if (!espace.locaux.some((l) => l.id === id)) return;
    void executer(async () => {
      const r = await espace.repereEtiquette(id, auteur);
      setRepereSel(null);
      setSelection(id);
      ouvrirCamera(r.id);
    });
  }

  /** Ouvre la fiche d'un repère ou d'un local. */
  function ficheSurMarqueur(id: string) {
    if (id.startsWith(PREFIXE_REPERE)) {
      setSelection(null);
      setRepereSel(id.slice(PREFIXE_REPERE.length));
      return;
    }
    setRepereSel(null);
    setSelection(id);
  }

  function titreCamera(repereId: string | null) {
    const rep = repereId ? espace.reperes.find((x) => x.id === repereId) : undefined;
    if (!rep) return 'Photo sans repère → panier à classer';
    const local = rep.localId ? espace.locaux.find((l) => l.id === rep.localId) : undefined;
    if (rep.surEtiquette && local) return [niveau.code, local.nom, 'photo du local'].join(' · ');
    return [rep.numero, niveau.code, local ? local.nom : 'hors local', rep.libelle]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * Calque de la visée (lot 6) : seulement sur un repère de suivi (20/11/2026). Photos proposées :
   * celles du repère (sans les vidéos) ; affichée d'office : la plus récente d'un jour précédent.
   */
  function photosCalque(repereId: string | null): Photo[] {
    const rep = repereId ? espace.reperes.find((r) => r.id === repereId) : undefined;
    return rep?.suivi ? espace.photosDuRepere(rep.id).filter((p) => p.type !== 'video') : [];
  }
  function referenceCalque(repereId: string | null): Photo | null {
    const photos = photosCalque(repereId);
    if (!photos.length) return null;
    const aujourdhui = dateLocale(new Date());
    return [...photos].reverse().find((p) => p.date < aujourdhui) ?? photos[photos.length - 1] ?? null;
  }

  const detecter = (exemple?: StyleEtiquette) =>
    executer(async () => {
      if (!fichier) return;
      const { locaux: trouves, sansTexte } = await proposerLocaux(plan.empreinte, fichier, exemple);
      setSelection(null);
      setMode({
        type: 'detection',
        sansTexte,
        ...(exemple ? { exemple } : {}),
        candidats: trouves.map((t, i) => {
          const doublon = espace.dejaPresent(planId, t) !== undefined;
          return { ...t, cle: String(i), retenu: !doublon, doublon };
        }),
      });
      if (exemple) setInfo(`${trouves.length} étiquette${trouves.length > 1 ? 's' : ''} du même style que l'exemple encadré.`);
    });

  /** Encadré tracé autour du nom d'un local : son style guide une nouvelle détection (23/11/2026). */
  const detecterSelonCadre = (cadre: { x1: number; y1: number; x2: number; y2: number }) =>
    executer(async () => {
      if (!fichier) return;
      const style = await styleEncadre(plan.empreinte, fichier, cadre);
      if (!style) {
        setInfo('Aucun texte dans le cadre : encadrez le nom d’un local, au plus près.');
        return;
      }
      await detecter(style);
    });

  /** Supprime des locaux, avec possibilité d'annuler. */
  const supprimerLocaux = (ids: string[], texte: string) =>
    executer(async () => {
      const instantane = await espace.supprimerLocaux(ids, auteur);
      setSelection(null);
      setAnnulation({ texte, annuler: () => espace.restaurerLocaux(instantane) });
      setInfo(texte);
    });

  const choisirResultat = (r: ResultatLocal) => {
    if (r.plan.id !== planId) {
      surChangerPlan(r.plan.id, r.local.id);
      return;
    }
    setMode({ type: 'consultation' });
    setRepereSel(null);
    setSelection(r.local.id);
    vue.current?.centrerSur(r.local.x, r.local.y);
  };

  // ------------------------------------------------------------ rendu

  const selectionne = selection ? espace.locaux.find((l) => l.id === selection) : undefined;
  const repereSelectionne = repereSel ? espace.reperes.find((x) => x.id === repereSel) : undefined;
  const nbPanier = espace.photosAClasser().length;
  const modePlacement = ['ajout', 'brouillon', 'deplacement', 'deplacementRepere', 'classement', 'rattachement', 'direction'].includes(mode.type);

  return (
    <div className="ecran-plan">
      <div className="barre-plan">
        <button onClick={surFermer}>← Projet</button>
        <select
          aria-label="Niveau affiché"
          value={planId}
          onChange={(e) => surChangerPlan(e.target.value, null)}
        >
          {plansTries.map(({ p, n }) => (
            <option key={p.id} value={p.id}>
              {n.code} · {espace.libelle(n)}
            </option>
          ))}
        </select>
        <span className="discret mono">
          {plan.fichier.split('/').pop()} · ind. {plan.indice}
        </span>
        {/* Appui sur un repère ou une étiquette : photo (📷) ou consultation (👁). Un appui bascule (19/11/2026). */}
        <button
          className={`bascule-appui ${appuiRepere}`}
          aria-label={appuiRepere === 'photo' ? 'Mode photo : un appui sur un repère ou une étiquette ouvre l’appareil photo. Toucher pour passer en consultation.' : 'Mode consultation : un appui ouvre la fiche. Toucher pour passer en mode photo.'}
          title={appuiRepere === 'photo' ? 'Appui = photo (toucher pour passer en consultation)' : 'Appui = consultation (toucher pour passer en photo)'}
          onClick={() => {
            const v = appuiRepere === 'photo' ? 'fiche' : 'photo';
            setAppuiRepere(v);
            void ecrireReglage('appuiRepere', v);
          }}
        >
          <span aria-hidden="true">{appuiRepere === 'photo' ? '📷' : '👁'}</span>
          <span className="bascule-appui-texte">{appuiRepere === 'photo' ? 'Photo' : 'Consultation'}</span>
        </button>
        {enAttente > 0 && <span className="enregistrement">Enregistrement de {enAttente} photo{enAttente > 1 ? 's' : ''}…</span>}
        <div className="barre-recherche-plan">
          <BarreRecherche espace={espace} surChoix={choisirResultat} />
        </div>
      </div>

      {erreur && <Message type="erreur">{erreur}</Message>}
      {info && !erreur && (
        <div className="message message-succes bandeau-info" role="status">
          {info}
          {annulation && (
            <button className="petit" onClick={() => void annuler()} disabled={occupe} title={`Annuler : ${annulation.texte}`}>
              ↶ Annuler
            </button>
          )}
          <button className="petit" onClick={() => setInfo(null)}>
            OK
          </button>
        </div>
      )}

      <div className="corps-plan">
        <div className="zone-vue">
          {fichier ? (
            <VisionneusePlan
              key={plan.id + plan.empreinte}
              ref={vue}
              cle={plan.empreinte}
              fichier={fichier}
              marqueurs={marqueurs}
              focus={localFocus ? { x: localFocus.x, y: localFocus.y } : null}
              modePlacement={modePlacement}
              surAppuiPlan={surAppuiPlan}
              surAppuiLongPlan={surAppuiLongPlan}
              surAppuiLongMarqueur={surAppuiLongMarqueur}
              surDoubleAppuiMarqueur={surDoubleAppuiMarqueur}
              surAppuiMarqueur={surAppuiMarqueur}
            />
          ) : (
            <div className="vue-etat">Lecture du plan…</div>
          )}
          {mode.type === 'detection' && mode.encadrer && (
            <CadreSelection
              convertir={(x, y) => vue.current?.relatifDepuisEcran(x, y) ?? null}
              surCadre={(c) => void detecterSelonCadre(c)}
              surAnnuler={() => (mode.candidats.length ? setMode({ ...mode, encadrer: false }) : setMode({ type: 'consultation' }))}
            />
          )}
          {(mode.type === 'ajout' || mode.type === 'deplacement' || mode.type === 'deplacementRepere' || mode.type === 'classement' || mode.type === 'rattachement' || mode.type === 'direction') && (
            <div className="consigne">
              {mode.type === 'ajout'
                ? 'Touchez le plan à l’emplacement du local.'
                : mode.type === 'classement'
                  ? `${mode.photoIds.length > 1 ? `${mode.photoIds.length} photos` : '1 photo'} : touchez l’étiquette d’un local, un repère, ou le plan pour créer un repère.`
                  : mode.type === 'rattachement'
                    ? 'Touchez l’étiquette du local auquel rattacher le repère.'
                    : mode.type === 'direction'
                    ? 'Touchez le plan dans la direction où regarde l’appareil photo.'
                    : mode.type === 'deplacementRepere'
                      ? 'Touchez la nouvelle position du repère.'
                      : 'Touchez la nouvelle position du local.'}
              <button className="petit" onClick={() => setMode({ type: 'consultation' })}>
                Annuler
              </button>
            </div>
          )}
        </div>

        <aside className="panneau-plan">
          {mode.type === 'detection' ? (
            <PanneauDetection
              candidats={mode.candidats}
              sansTexte={mode.sansTexte}
              occupe={occupe}
              surBasculer={(cle) =>
                setMode({ ...mode, candidats: mode.candidats.map((c) => (c.cle === cle ? { ...c, retenu: !c.retenu } : c)) })
              }
              surTout={(retenu) => setMode({ ...mode, candidats: mode.candidats.map((c) => (c.doublon ? c : { ...c, retenu })) })}
              surVoir={(c) => vue.current?.centrerSur(c.x, c.y, 4)}
              exemple={!!mode.exemple}
              surEncadrer={() => setMode({ ...mode, encadrer: true })}
              surAnnuler={() => setMode({ type: 'consultation' })}
              surEnregistrer={() =>
                executer(async () => {
                  const cr = await espace.enregistrerDetection(
                    planId,
                    mode.candidats.filter((c) => c.retenu && !c.doublon),
                    auteur,
                  );
                  surJournal(cr);
                  const crees = espace.dernieresCreations;
                  setAnnulation({ texte: cr[0], annuler: async () => void (await espace.supprimerLocaux(crees, auteur)) });
                  setInfo(cr[0]);
                  setMode({ type: 'consultation' });
                })
              }
            />
          ) : repereSelectionne && mode.type !== 'brouillon' ? (
            <FicheRepere
              key={repereSelectionne.id}
              espace={espace}
              repere={repereSelectionne}
              occupe={occupe}
              surPhoto={() => ouvrirCamera(repereSelectionne.id)}
              surDeplacer={() => setMode({ type: 'deplacementRepere', repereId: repereSelectionne.id })}
              surSupprimer={() => {
                if (!confirm(`Supprimer le repère ${repereSelectionne.numero} ?`)) return;
                void executer(async () => {
                  await espace.supprimerRepere(repereSelectionne.id);
                  setRepereSel(null);
                });
              }}
              surModifier={(maj) => executer(async () => void (await espace.modifierRepere(repereSelectionne.id, maj, auteur)))}
              surOuvrirPhoto={(photos, index) => setPhotoOuverte({ photos, index })}
              surFermer={() => setRepereSel(null)}
              surChoisirLocalSurPlan={() => setMode({ type: 'rattachement', repereId: repereSelectionne.id })}
              surDirection={() => setMode({ type: 'direction', repereId: repereSelectionne.id })}
              surEffacerDirection={() => executer(async () => void (await espace.modifierRepere(repereSelectionne.id, { visee: null }, auteur)))}
              surComparer={() => setComparaison(repereSelectionne.id)}
            />
          ) : mode.type === 'brouillon' ? (
            <FicheLocal
              key="brouillon"
              titre="Nouveau local"
              initial={{ nom: '', numero: null, surface: null, x: mode.x, y: mode.y }}
              occupe={occupe}
              surAnnuler={() => setMode({ type: 'consultation' })}
              surEnregistrer={(s) =>
                executer(async () => {
                  const l = await espace.creerLocal(planId, s, auteur);
                  setMode({ type: 'consultation' });
                  setSelection(l.id);
                })
              }
            />
          ) : selectionne ? (
            <FicheLocal
              key={selectionne.id + selectionne.modifieLe}
              titre={`${selectionne.nom} · ${niveau.code}`}
              local={selectionne}
              photos={
                !repereSelectionne ? (
                  <PhotosDuLocal
                    key={`photos-${selectionne.id}`}
                    espace={espace}
                    localId={selectionne.id}
                    appuiPhoto={appuiRepere === 'photo'}
                    surOuvrirPhoto={(photos, index) => setPhotoOuverte({ photos, index })}
                  />
                ) : undefined
              }
              initial={selectionne}
              occupe={occupe}
              surAnnuler={() => setSelection(null)}
              surEnregistrer={(s) => executer(async () => void (await espace.modifierLocal(selectionne.id, s, auteur)))}
              surDeplacer={() => setMode({ type: 'deplacement', localId: selectionne.id })}
              surSupprimer={() => {
                void supprimerLocaux([selectionne.id], `Local supprimé : ${selectionne.nom}`);
              }}
            />
          ) : null}
          {mode.type !== 'detection' && mode.type !== 'brouillon' && !repereSelectionne && !selectionne && (
            <>
            <div className="onglets" role="tablist">
              {(
                [
                  ['terrain', 'Terrain'],
                  ['locaux', `Locaux (${locaux.length})`],
                  ['panier', `Panier (${nbPanier})`],
                ] as const
              ).map(([cle, texte]) => (
                <button key={cle} role="tab" aria-selected={onglet === cle} className={onglet === cle ? 'actif' : undefined} onClick={() => setOnglet(cle)}>
                  {texte}
                </button>
              ))}
            </div>
            {onglet === 'terrain' ? (
              <PanneauTerrain
                espace={espace}
                planId={planId}
                occupe={occupe}
                appuiPhoto={appuiRepere === 'photo'}
                surPhotoSansRepere={() => ouvrirCamera(null)}
                surChoixRepere={(rep) => {
                  setRepereSel(rep.id);
                  vue.current?.centrerSur(rep.x, rep.y, 4);
                }}
              />
            ) : onglet === 'panier' ? (
              <PanneauPanier
                espace={espace}
                occupe={occupe}
                surPhotoSansRepere={() => ouvrirCamera(null)}
                surImporter={(fichiers) => {
                  for (const f of fichiers) {
                    const prisLe = new Date(f.lastModified || Date.now());
                    if (f.type.startsWith('video/') || extensionVideo(f)) void enregistrerVideo(f, 'import', prisLe, null, f.name);
                    else void enregistrerPhoto(f, 'import', prisLe, null, f.name);
                  }
                }}
                surPlacer={(photos) => setMode({ type: 'classement', photoIds: photos.map((p) => p.id) })}
                surVersLocal={(photos, r) =>
                  void executer(async () => {
                    const repere = await espace.repereEtiquette(r.local.id, auteur);
                    await espace.classerPhotos(
                      photos.map((p) => p.id),
                      repere.id,
                      auteur,
                    );
                    apresPlacement(photos.length, `le local ${r.local.nom} (${r.niveau.code})`);
                  })
                }
                surOuvrirPhoto={(photos, index) => setPhotoOuverte({ photos, index })}
              />
            ) : (
            <ListeLocaux
              locaux={locaux}
              occupe={occupe || !fichier}
              surChoix={(l) => {
                setRepereSel(null);
                setSelection(l.id);
                vue.current?.centrerSur(l.x, l.y);
              }}
              surDetecter={() => detecter()}
              surDetecterExemple={() => {
                setSelection(null);
                setMode({ type: 'detection', candidats: [], sansTexte: false, encadrer: true });
              }}
              surSupprimer={(ids) => {
                const tous = ids.length === locaux.length;
                const quoi = ids.length > 1 ? `${ids.length} locaux` : '1 local';
                if (!confirm(`Supprimer ${tous ? `les ${quoi} de ce plan` : quoi} ? Les photos restent, sur des repères hors local. (Annulable)`)) return;
                void supprimerLocaux(ids, `${quoi} supprimé${ids.length > 1 ? 's' : ''}`);
              }}
              annulation={annulation?.texte ?? null}
              surAnnuler={() => void annuler()}
              surAjouter={() => {
                setSelection(null);
                setMode({ type: 'ajout' });
              }}
            />
            )}
            </>
          )}
        </aside>
      </div>

      {camera && (
        <CameraTerrain
          espace={espace}
          auteur={auteur}
          titre={titreCamera(camera.repereId)}
          fermeture={fermetureCamera}
          calques={photosCalque(camera.repereId)}
          reference={referenceCalque(camera.repereId)}
          enAttente={enAttente}
          surCapture={(photo, source, prisLe, tags) => enregistrerPhoto(photo, source, prisLe, camera.repereId, undefined, tags)}
          surVideo={(fichier, source, prisLe, tags, nom) => enregistrerVideo(fichier, source, prisLe, camera.repereId, nom, tags)}
          surFermer={() => {
            if (camera.nouveau && camera.repereId) setARattacher(camera.repereId);
            setCamera(null);
          }}
        />
      )}
      {comparaison && (
        <ComparaisonPhotos
          espace={espace}
          photos={espace.photosDuRepere(comparaison)}
          titre={`Repère ${espace.reperes.find((r) => r.id === comparaison)?.numero ?? ''} · avant / après`}
          surFermer={() => setComparaison(null)}
        />
      )}
      {aRattacher && !camera && (
        <FenetreRattachement
          espace={espace}
          repereId={aRattacher}
          occupe={occupe}
          surChoisir={(localId) => executer(async () => void (await espace.modifierRepere(aRattacher, { localId }, auteur)))}
          surChoisirSurPlan={() => {
            setARattacher(null);
            setMode({ type: 'rattachement', repereId: aRattacher });
          }}
          surFermer={() => setARattacher(null)}
        />
      )}
      {photoOuverte && (
        <VisionneusePhoto
          espace={espace}
          photos={photoOuverte.photos}
          indexInitial={photoOuverte.index}
          auteur={auteur}
          surFermer={() => setPhotoOuverte(null)}
          surModifie={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ panneaux

/**
 * Rattachement d'un nouveau repère, proposé une fois ses prises de vue terminées (19/11/2026) :
 * le local associé par défaut (le plus proche, entouré en rouge sur le plan), les autres locaux
 * proches, « hors local » ou « choisir sur le plan ». Le bouton Retour vaut OK.
 */
function FenetreRattachement({
  espace,
  repereId,
  occupe,
  surChoisir,
  surChoisirSurPlan,
  surFermer,
}: {
  espace: EspaceProjet;
  repereId: string;
  occupe: boolean;
  surChoisir: (localId: string | null) => void;
  surChoisirSurPlan: () => void;
  surFermer: () => void;
}) {
  const rep = espace.reperes.find((r) => r.id === repereId);
  if (!rep) return null;
  const local = rep.localId ? espace.locaux.find((l) => l.id === rep.localId) : undefined;
  const proches = espace.locauxProches(rep.planId, rep.x, rep.y, 4).filter((l) => l.id !== rep.localId);
  const nb = espace.photosDuRepere(rep.id).length;
  return (
    <div className="fenetre-rattachement" role="dialog" aria-label="Local du repère">
      <div>
        <strong>
          📍 Repère {rep.numero} → <span className={local ? 'local-associe' : 'discret'}>{local ? local.nom : 'hors local'}</span>
        </strong>
        <div className="discret petit-texte">
          {nb} prise{nb > 1 ? 's' : ''} de vue · associé par défaut au local le plus proche (entouré en rouge). Autre choix :
        </div>
      </div>
      <div className="boutons">
        {proches.map((l) => (
          <button key={l.id} className="petit" disabled={occupe} onClick={() => surChoisir(l.id)}>
            {l.nom}
          </button>
        ))}
        {rep.localId && (
          <button className="petit" disabled={occupe} onClick={() => surChoisir(null)}>
            Hors local
          </button>
        )}
        <button className="petit" disabled={occupe} onClick={surChoisirSurPlan}>
          Choisir sur le plan
        </button>
        <button className="principal" onClick={surFermer}>
          OK
        </button>
      </div>
    </div>
  );
}

/**
 * Liste des locaux du plan. Depuis le 23/11/2026 : détection guidée par une étiquette encadrée,
 * sélection de plusieurs locaux, « Tout supprimer », et « ↶ Annuler » la dernière action.
 */
function ListeLocaux({
  locaux,
  occupe,
  surChoix,
  surDetecter,
  surDetecterExemple,
  surAjouter,
  surSupprimer,
  annulation,
  surAnnuler,
}: {
  locaux: Local[];
  occupe: boolean;
  surChoix: (l: Local) => void;
  surDetecter: () => void;
  surDetecterExemple: () => void;
  surAjouter: () => void;
  surSupprimer: (ids: string[]) => void;
  /** Dernière action annulable (texte), ou null. */
  annulation: string | null;
  surAnnuler: () => void;
}) {
  // Mode sélection : null = désactivé.
  const [choisis, setChoisis] = useState<Set<string> | null>(null);
  useRetour(choisis !== null, () => setChoisis(null), 2);
  const basculer = (id: string) =>
    setChoisis((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <>
      <div className="boutons">
        <button className="principal" onClick={surDetecter} disabled={occupe}>
          {occupe ? 'Lecture du plan…' : 'Détecter les locaux'}
        </button>
        <button onClick={surDetecterExemple} disabled={occupe} title="Tracez un cadre autour du nom d'un local : seules les étiquettes de même police et taille seront proposées">
          ▭ D'après un exemple
        </button>
        <button onClick={surAjouter} disabled={occupe}>
          + Ajouter un local
        </button>
      </div>
      {annulation && (
        <div className="boutons">
          <button className="petit" onClick={surAnnuler} disabled={occupe} title={`Annuler : ${annulation}`}>
            ↶ Annuler : {annulation}
          </button>
        </div>
      )}
      <h2>
        Locaux de ce plan <span className="discret">({locaux.length})</span>
      </h2>
      {locaux.length > 0 && (
        <div className="boutons">
          {choisis === null ? (
            <>
              <button className="petit" onClick={() => setChoisis(new Set())} disabled={occupe}>
                ☑ Sélectionner
              </button>
              <button className="petit discret" onClick={() => surSupprimer(locaux.map((l) => l.id))} disabled={occupe}>
                Tout supprimer
              </button>
            </>
          ) : (
            <>
              <button
                className="petit"
                onClick={() => setChoisis(choisis.size === locaux.length ? new Set() : new Set(locaux.map((l) => l.id)))}
              >
                {choisis.size === locaux.length ? 'Tout décocher' : `Tout cocher (${locaux.length})`}
              </button>
              <button
                className="petit principal"
                disabled={occupe || choisis.size === 0}
                onClick={() => {
                  surSupprimer([...choisis]);
                  setChoisis(null);
                }}
              >
                Supprimer la sélection ({choisis.size})
              </button>
              <button className="petit" onClick={() => setChoisis(null)}>
                Terminer
              </button>
            </>
          )}
        </div>
      )}
      {locaux.length === 0 ? (
        <p className="discret">
          Aucun local pour l'instant. « Détecter les locaux » lit les étiquettes du plan ; vous validez ensuite la liste. Si les
          propositions sont fausses, « D'après un exemple » : encadrez le nom d'un local sur le plan.
        </p>
      ) : (
        <ul className="liste-locaux">
          {locaux.map((l) => (
            <li key={l.id} className={choisis?.has(l.id) ? 'choisi' : undefined}>
              {choisis !== null && (
                <input type="checkbox" checked={choisis.has(l.id)} aria-label={`Choisir ${l.nom}`} onChange={() => basculer(l.id)} />
              )}
              <button onClick={() => (choisis !== null ? basculer(l.id) : surChoix(l))}>
                <span>{l.nom}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PanneauDetection({
  candidats,
  sansTexte,
  occupe,
  surBasculer,
  surTout,
  surVoir,
  surAnnuler,
  surEnregistrer,
  exemple,
  surEncadrer,
}: {
  /** Détection guidée par une étiquette encadrée. */
  exemple: boolean;
  surEncadrer: () => void;
  candidats: Candidat[];
  sansTexte: boolean;
  occupe: boolean;
  surBasculer: (cle: string) => void;
  surTout: (retenu: boolean) => void;
  surVoir: (c: Candidat) => void;
  surAnnuler: () => void;
  surEnregistrer: () => void;
}) {
  const nouveaux = candidats.filter((c) => !c.doublon);
  const retenus = nouveaux.filter((c) => c.retenu).length;
  const doublons = candidats.length - nouveaux.length;
  return (
    <>
      <h2>Locaux détectés</h2>
      {sansTexte ? (
        <Message type="info">
          Ce plan ne contient pas de texte lisible (PDF scanné, ou texte converti en traits). Ajoutez les locaux à la main.
        </Message>
      ) : (
        <p className="discret">
          {nouveaux.length} proposition{nouveaux.length > 1 ? 's' : ''}
          {doublons > 0 && `, ${doublons} déjà enregistrée${doublons > 1 ? 's' : ''}`}. Décochez celles qui ne sont pas des
          locaux (cartouche, légende…) ; un appui sur une étiquette du plan la coche ou la décoche. Les noms et numéros se
          corrigent ensuite, local par local.
        </p>
      )}
      <div className="boutons">
        <button className="principal" onClick={surEnregistrer} disabled={retenus === 0 || occupe}>
          Enregistrer {retenus} {retenus > 1 ? 'locaux' : 'local'}
        </button>
        <button onClick={surAnnuler}>Annuler</button>
      </div>
      <div className="boutons">
        <button className="petit" onClick={surEncadrer} disabled={occupe} title="Tracez un cadre autour du nom d'un local : seules les étiquettes de même police et taille seront proposées">
          ▭ {exemple ? 'Encadrer une autre étiquette' : 'Propositions fausses ? Encadrer une étiquette de local'}
        </button>
      </div>
      {nouveaux.length > 0 && (
        <>
          <div className="boutons">
            <button className="petit" onClick={() => surTout(true)}>
              Tout cocher
            </button>
            <button className="petit" onClick={() => surTout(false)}>
              Tout décocher
            </button>
          </div>
          <ul className="liste-locaux liste-candidats">
            {nouveaux.map((c) => (
              <li key={c.cle} className={c.retenu ? undefined : 'ecarte'}>
                <input
                  type="checkbox"
                  checked={c.retenu}
                  aria-label={`Retenir ${c.nom}`}
                  onChange={() => surBasculer(c.cle)}
                />
                <button onClick={() => surVoir(c)}>
                  <span>{c.nom}</span>
                  {c.confiance === 'moyenne' && <span className="discret" title="Nom seul, sans numéro ni surface">à vérifier</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * Fiche d'un local. Local existant (18/11/2026) : ni numéro, ni bouton Enregistrer ni Fermer.
 * Le nom s'enregistre en quittant le champ (ou par Entrée) ; le bouton Retour du téléphone ferme
 * la fiche (sur PC : Échap, ou la croix). Nouveau local : boutons Créer et Annuler.
 */
function FicheLocal({
  titre,
  local,
  initial,
  occupe,
  surEnregistrer,
  surAnnuler,
  surDeplacer,
  surSupprimer,
  photos,
}: {
  titre: string;
  /** Photos du local : affichées juste sous son nom, sans avoir à faire défiler (17/11/2026). */
  photos?: ReactNode;
  local?: Local;
  initial: SaisieLocal;
  occupe: boolean;
  surEnregistrer: (s: SaisieLocal) => void;
  surAnnuler: () => void;
  surDeplacer?: () => void;
  surSupprimer?: () => void;
}) {
  const [nom, setNom] = useState(initial.nom);
  // Le numéro et la surface ne se saisissent plus ; une valeur déjà enregistrée est conservée.
  const enregistrer = () => {
    if (nom.trim() && nom.trim() !== initial.nom) surEnregistrer({ ...initial, nom });
  };

  return (
    <form
      className="fiche-local"
      onSubmit={(e) => {
        e.preventDefault();
        if (local) {
          enregistrer();
          (document.activeElement as HTMLElement | null)?.blur();
        } else if (nom.trim()) surEnregistrer({ ...initial, nom });
      }}
    >
      <div className="titre-fiche">
        <h2>{titre}</h2>
        {local && (
          <button type="button" className="petit fermer-pc" aria-label="Fermer la fiche" title="Fermer (Échap)" onClick={surAnnuler}>
            ✕
          </button>
        )}
      </div>
      {photos}
      <label>
        Nom
        <input
          value={nom}
          autoFocus={!local}
          maxLength={60}
          onChange={(e) => setNom(e.target.value)}
          onBlur={() => local && enregistrer()}
        />
      </label>
      {local ? (
        <p className="discret petit-texte">
          {local.origine === 'auto' ? 'Détecté sur le plan' : 'Placé à la main'} · modifié par {local.modifiePar} le{' '}
          {new Date(local.modifieLe).toLocaleDateString('fr-FR')}
        </p>
      ) : (
        <div className="boutons">
          <button className="principal" disabled={!nom.trim() || occupe}>
            Créer le local
          </button>
          <button type="button" onClick={surAnnuler}>
            Annuler
          </button>
        </div>
      )}
      {(surDeplacer || surSupprimer) && (
        <div className="boutons">
          {surDeplacer && (
            <button type="button" className="petit" onClick={surDeplacer}>
              Déplacer sur le plan
            </button>
          )}
          {surSupprimer && (
            <button type="button" className="petit discret" onClick={surSupprimer}>
              Supprimer
            </button>
          )}
        </div>
      )}
    </form>
  );
}
