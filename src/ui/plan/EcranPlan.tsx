import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalDetecte } from '../../domaine/locaux';
import type { Local, Photo } from '../../domaine/types';
import { dateLocale } from '../../domaine/nommage';
import { compresserPhoto } from '../../photo/compression';
import { CameraTerrain } from '../photo/CameraTerrain';
import { VisionneusePhoto } from '../photo/VisionneusePhoto';
import { FicheRepere, PanneauPanier, PanneauTerrain, PhotosDuLocal } from './PanneauxTerrain';
import type { EspaceProjet, ResultatLocal, SaisieLocal } from '../../projet/EspaceProjet';
import { proposerLocaux } from '../../pdf/pdf';
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
  | { type: 'detection'; candidats: Candidat[]; sansTexte: boolean };

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
  const [camera, setCamera] = useState<{ repereId: string | null } | null>(null);
  const [onglet, setOnglet] = useState<'terrain' | 'locaux' | 'panier'>('terrain');
  const [photoOuverte, setPhotoOuverte] = useState<{ photos: Photo[]; index: number } | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Le menu « Affichage » se ferme dès qu'on touche ailleurs (le plan, le panneau…).
  const menuAffichage = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const fermer = (e: PointerEvent) => {
      const m = menuAffichage.current;
      if (m?.open && !m.contains(e.target as Node)) m.open = false;
    };
    document.addEventListener('pointerdown', fermer, true);
    return () => document.removeEventListener('pointerdown', fermer, true);
  }, []);

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
  function enregistrerPhoto(original: Blob, source: Photo['source'], prisLe: Date, repereId: string | null, nomOrigine?: string) {
    setEnAttente((n) => n + 1);
    file.current = file.current.then(async () => {
      try {
        const c = await compresserPhoto(original);
        await espace.ajouterPhoto(
          {
            repereId,
            jpeg: c.jpeg,
            miniature: c.miniature,
            largeur: c.largeur,
            hauteur: c.hauteur,
            source,
            prisLe: source !== 'appli' && c.dateExif ? c.dateExif : prisLe,
            nomOrigine,
          },
          auteur,
        );
      } catch (e) {
        setErreur(`Photo non enregistrée : ${texteErreur(e)}`);
      } finally {
        setEnAttente((n) => n - 1);
        setVersion((v) => v + 1);
      }
    });
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

  // Texte des étiquettes sur le plan : numéro du local (par défaut) ou nom. Mémorisé sur l'appareil.
  const [etiquettes, setEtiquettes] = useState<'numero' | 'nom'>('numero');
  useEffect(() => {
    void lireReglage<'numero' | 'nom'>('etiquettes').then((v) => v && setEtiquettes(v));
  }, []);
  const choisirEtiquettes = (v: 'numero' | 'nom') => {
    setEtiquettes(v);
    void ecrireReglage('etiquettes', v);
  };
  const texteEtiquette = (l: { numero: string | null; nom: string }) =>
    court(etiquettes === 'nom' ? l.nom : (l.numero ?? l.nom), etiquettes === 'nom' ? 22 : 16);

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
  const photographies = espace.locauxPhotographies(dateLocale(new Date()));
  for (const l of locaux) {
    if (mode.type === 'deplacement' && mode.localId === l.id) continue;
    marqueurs.push({
      id: l.id,
      x: l.x,
      y: l.y,
      libelle: texteEtiquette(l),
      titre: [l.numero, l.nom].filter(Boolean).join(' · ') + (photographies.has(l.id) ? ' (photographié aujourd’hui)' : ''),
      style: l.id === selection ? 'selection' : photographies.has(l.id) ? 'local-visite' : 'local',
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
        libelle: etiquettes === 'nom' && rep.libelle ? court(rep.libelle, 22) : rep.numero,
        titre: `${rep.numero}${rep.libelle ? ` · ${rep.libelle}` : ''}`,
        style: rep.id === repereSel ? 'repere-selection' : 'repere',
        pastille: espace.photosDuRepere(rep.id).length || undefined,
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
      ouvrirCamera(r.id);
    });
  }

  function surAppuiPlan(x: number, y: number) {
    if (mode.type === 'rattachement') return; // on attend un appui sur un local
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
        apresPlacement(photoIds.length, `le local ${l ? `${l.numero ?? ''} ${l.nom}`.trim() : ''}`);
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
    if (rep.surEtiquette && local) return [niveau.code, `${local.numero ?? ''} ${local.nom}`.trim(), 'photo du local'].join(' · ');
    return [rep.numero, niveau.code, local ? `${local.numero ?? ''} ${local.nom}`.trim() : 'hors local', rep.libelle]
      .filter(Boolean)
      .join(' · ');
  }

  const detecter = () =>
    executer(async () => {
      if (!fichier) return;
      const { locaux: trouves, sansTexte } = await proposerLocaux(plan.empreinte, fichier);
      setSelection(null);
      setMode({
        type: 'detection',
        sansTexte,
        candidats: trouves.map((t, i) => {
          const doublon = espace.dejaPresent(planId, t) !== undefined;
          return { ...t, cle: String(i), retenu: !doublon, doublon };
        }),
      });
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
  const modePlacement = ['ajout', 'brouillon', 'deplacement', 'deplacementRepere', 'classement', 'rattachement'].includes(mode.type);

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
        <details className="options-plan" ref={menuAffichage}>
          <summary>Affichage</summary>
          <div className="options-plan-contenu">
            <div className="bascule" role="group" aria-label="Texte des étiquettes">
              <span className="discret">Étiquettes :</span>
              <button className={etiquettes === 'numero' ? 'actif' : undefined} aria-pressed={etiquettes === 'numero'} onClick={() => choisirEtiquettes('numero')}>
                Numéro
              </button>
              <button className={etiquettes === 'nom' ? 'actif' : undefined} aria-pressed={etiquettes === 'nom'} onClick={() => choisirEtiquettes('nom')}>
                Nom
              </button>
            </div>
            <div className="bascule" role="group" aria-label="Appui sur un repère ou une étiquette">
              <span className="discret">Appui sur repère ou étiquette :</span>
              {(['photo', 'fiche'] as const).map((v) => (
                <button
                  key={v}
                  className={appuiRepere === v ? 'actif' : undefined}
                  aria-pressed={appuiRepere === v}
                  onClick={() => {
                    setAppuiRepere(v);
                    void ecrireReglage('appuiRepere', v);
                  }}
                >
                  {v === 'photo' ? 'Photo' : 'Fiche'}
                </button>
              ))}
            </div>
          </div>
        </details>
        {enAttente > 0 && <span className="enregistrement">Enregistrement de {enAttente} photo{enAttente > 1 ? 's' : ''}…</span>}
        <div className="barre-recherche-plan">
          <BarreRecherche espace={espace} surChoix={choisirResultat} />
        </div>
      </div>

      {erreur && <Message type="erreur">{erreur}</Message>}
      {info && !erreur && (
        <div className="message message-succes bandeau-info" role="status">
          {info}
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
              surAppuiMarqueur={surAppuiMarqueur}
            />
          ) : (
            <div className="vue-etat">Lecture du plan…</div>
          )}
          {(mode.type === 'ajout' || mode.type === 'deplacement' || mode.type === 'deplacementRepere' || mode.type === 'classement' || mode.type === 'rattachement') && (
            <div className="consigne">
              {mode.type === 'ajout'
                ? 'Touchez le plan à l’emplacement du local.'
                : mode.type === 'classement'
                  ? `${mode.photoIds.length > 1 ? `${mode.photoIds.length} photos` : '1 photo'} : touchez l’étiquette d’un local, un repère, ou le plan pour créer un repère.`
                  : mode.type === 'rattachement'
                    ? 'Touchez l’étiquette du local auquel rattacher le repère.'
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
              surAnnuler={() => setMode({ type: 'consultation' })}
              surEnregistrer={() =>
                executer(async () => {
                  const cr = await espace.enregistrerDetection(
                    planId,
                    mode.candidats.filter((c) => c.retenu && !c.doublon),
                    auteur,
                  );
                  surJournal(cr);
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
            />
          ) : mode.type === 'brouillon' ? (
            <FicheLocal
              key="brouillon"
              titre="Nouveau local"
              initial={{ nom: '', numero: espace.proposerNumero(planId), surface: null, x: mode.x, y: mode.y }}
              numeroAutomatique
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
              titre={`Local ${niveau.code}`}
              local={selectionne}
              initial={selectionne}
              numeroPropose={selectionne.numero ? undefined : espace.proposerNumero(planId)}
              occupe={occupe}
              surAnnuler={() => setSelection(null)}
              surEnregistrer={(s) => executer(async () => void (await espace.modifierLocal(selectionne.id, s, auteur)))}
              surDeplacer={() => setMode({ type: 'deplacement', localId: selectionne.id })}
              surSupprimer={() => {
                if (!confirm(`Supprimer le local « ${selectionne.nom} » ? Ses photos restent, sur des repères hors local.`)) return;
                void executer(async () => {
                  await espace.supprimerLocal(selectionne.id, auteur);
                  setSelection(null);
                });
              }}
            />
          ) : null}
          {selectionne && mode.type !== 'detection' && mode.type !== 'brouillon' && !repereSelectionne && (
            <PhotosDuLocal
              key={`photos-${selectionne.id}`}
              espace={espace}
              localId={selectionne.id}
              occupe={occupe}
              surPhoto={() =>
                void executer(async () => {
                  const r = await espace.repereEtiquette(selectionne.id, auteur);
                  ouvrirCamera(r.id);
                })
              }
              surOuvrirPhoto={(photos, index) => setPhotoOuverte({ photos, index })}
            />
          )}
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
                  for (const f of fichiers) enregistrerPhoto(f, 'import', new Date(f.lastModified || Date.now()), null, f.name);
                }}
                surPlacer={(photos) => setMode({ type: 'classement', photoIds: photos.map((p) => p.id) })}
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
              surDetecter={detecter}
              surAjouter={() => {
                setSelection(null);
                setMode({ type: 'ajout' });
              }}
              surNumeroter={() => executer(async () => surJournal(await espace.numeroterLocauxSansNumero(auteur, planId)))}
            />
            )}
            </>
          )}
        </aside>
      </div>

      {camera && (
        <CameraTerrain
          titre={titreCamera(camera.repereId)}
          enAttente={enAttente}
          surCapture={(photo, source, prisLe) => enregistrerPhoto(photo, source, prisLe, camera.repereId)}
          surFermer={() => setCamera(null)}
        />
      )}
      {photoOuverte && (
        <VisionneusePhoto
          espace={espace}
          photos={photoOuverte.photos}
          indexInitial={photoOuverte.index}
          surFermer={() => setPhotoOuverte(null)}
          surModifie={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ panneaux

function ListeLocaux({
  locaux,
  occupe,
  surChoix,
  surDetecter,
  surAjouter,
  surNumeroter,
}: {
  locaux: Local[];
  occupe: boolean;
  surChoix: (l: Local) => void;
  surDetecter: () => void;
  surAjouter: () => void;
  surNumeroter: () => void;
}) {
  const sansNumero = locaux.filter((l) => !l.numero).length;
  return (
    <>
      <div className="boutons">
        <button className="principal" onClick={surDetecter} disabled={occupe}>
          {occupe ? 'Lecture du plan…' : 'Détecter les locaux'}
        </button>
        <button onClick={surAjouter} disabled={occupe}>
          + Ajouter un local
        </button>
        {sansNumero > 0 && (
          <button className="petit" onClick={surNumeroter} disabled={occupe}>
            Numéroter les {sansNumero} sans numéro
          </button>
        )}
      </div>
      <h2>
        Locaux de ce plan <span className="discret">({locaux.length})</span>
      </h2>
      {locaux.length === 0 ? (
        <p className="discret">
          Aucun local pour l'instant. « Détecter les locaux » lit les étiquettes du plan ; vous validez ensuite la liste.
        </p>
      ) : (
        <ul className="liste-locaux">
          {locaux.map((l) => (
            <li key={l.id}>
              <button onClick={() => surChoix(l)}>
                <span className="mono">{l.numero ?? '—'}</span>
                <span>{l.nom}</span>
                {l.surface !== null && <span className="discret">{String(l.surface).replace('.', ',')} m²</span>}
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
}: {
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
                  <span className="mono">{c.numero ?? '—'}</span>
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

function FicheLocal({
  titre,
  local,
  initial,
  occupe,
  surEnregistrer,
  surAnnuler,
  surDeplacer,
  surSupprimer,
  numeroAutomatique,
  numeroPropose,
}: {
  titre: string;
  local?: Local;
  initial: SaisieLocal;
  /** Le numéro initial a été proposé automatiquement (nouveau local). */
  numeroAutomatique?: boolean;
  /** Numéro automatique proposé pour un local qui n'en a pas. */
  numeroPropose?: string;
  occupe: boolean;
  surEnregistrer: (s: SaisieLocal) => void;
  surAnnuler: () => void;
  surDeplacer?: () => void;
  surSupprimer?: () => void;
}) {
  const [nom, setNom] = useState(initial.nom);
  const [numero, setNumero] = useState(initial.numero ?? '');
  const [surface, setSurface] = useState(initial.surface === null ? '' : String(initial.surface).replace('.', ','));
  const surfaceNombre = surface.trim() ? Number(surface.replace(',', '.').replace(/\s/g, '')) : null;
  const surfaceValide = surfaceNombre === null || (Number.isFinite(surfaceNombre) && surfaceNombre > 0);

  return (
    <form
      className="fiche-local"
      onSubmit={(e) => {
        e.preventDefault();
        surEnregistrer({ ...initial, nom, numero: numero.trim() || null, surface: surfaceNombre });
      }}
    >
      <h2>{titre}</h2>
      <label>
        Nom
        <input value={nom} autoFocus={!local} maxLength={60} onChange={(e) => setNom(e.target.value)} />
      </label>
      <div className="grille-formulaire">
        <label>
          Numéro
          <input value={numero} maxLength={12} placeholder="facultatif" onChange={(e) => setNumero(e.target.value.toUpperCase())} />
          {numeroPropose && !numero && (
            <button type="button" className="petit" onClick={() => setNumero(numeroPropose)}>
              Numéro automatique : {numeroPropose}
            </button>
          )}
        </label>
        <label>
          Surface (m²)
          <input value={surface} inputMode="decimal" placeholder="facultatif" onChange={(e) => setSurface(e.target.value)} />
        </label>
      </div>
      {numeroAutomatique && numero === initial.numero && (
        <p className="discret">Numéro attribué automatiquement : vous pouvez le modifier ou l'effacer.</p>
      )}
      {!surfaceValide && <p className="texte-erreur">Surface non valable.</p>}
      {local && (
        <p className="discret">
          {local.origine === 'auto' ? 'Détecté sur le plan' : 'Placé à la main'} · modifié par {local.modifiePar} le{' '}
          {new Date(local.modifieLe).toLocaleDateString('fr-FR')}
        </p>
      )}
      <div className="boutons">
        <button className="principal" disabled={!nom.trim() || !surfaceValide || occupe}>
          Enregistrer
        </button>
        <button type="button" onClick={surAnnuler}>
          {local ? 'Fermer' : 'Annuler'}
        </button>
      </div>
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
