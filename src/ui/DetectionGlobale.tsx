import { useEffect, useRef, useState } from 'react';
import type { LocalDetecte, StyleEtiquette } from '../domaine/locaux';
import type { Niveau, Plan } from '../domaine/types';
import type { EspaceProjet } from '../projet/EspaceProjet';
import { proposerLocaux, styleEncadre } from '../pdf/pdf';
import { ecrireReglage, lireReglage } from '../stockage/registre';
import { Message, texteErreur } from './commun';
import { CadreSelection } from './plan/CadreSelection';
import { VisionneusePlan, type CommandesVisionneuse } from './plan/VisionneusePlan';
import { useRetour } from './retour';

/** Clé de l'exemple d'étiquette d'un projet, mémorisé sur l'appareil (24/11/2026). */
export const cleExempleLocaux = (projetId: string) => `exempleLocaux:${projetId}`;

interface Ligne {
  plan: Plan;
  niveau: Niveau;
  /** Étiquettes complètes (numéro ou surface) : sûres. */
  sures: LocalDetecte[];
  /** Noms seuls (« BUREAUX ») : à vérifier. */
  aVerifier: LocalDetecte[];
  dejaPresents: number;
  sansTexte: boolean;
  retenue: boolean;
}

interface Props {
  espace: EspaceProjet;
  auteur: string;
  surJournal: (lignes: string[]) => void;
  surFin: () => void;
}

/**
 * Détection des locaux sur tous les plans du projet, avec un récapitulatif par niveau avant enregistrement.
 * D'après un exemple (24/11/2026) : on choisit un plan, on encadre le nom d'un local ; seules les
 * étiquettes de même police et de même taille sont proposées, sur tous les plans. L'exemple est
 * mémorisé pour le projet (sur l'appareil) et peut être réutilisé.
 */
export function DetectionGlobale({ espace, auteur, surJournal, surFin }: Props) {
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [exemple, setExemple] = useState<StyleEtiquette | null>(null);
  /** Encadré en cours : plan exemple choisi. */
  const [encadrer, setEncadrer] = useState<{ planId: string; fichier: Blob | null; apercu?: number } | null>(null);
  const vue = useRef<CommandesVisionneuse>(null);
  useRetour(!!encadrer, () => setEncadrer(null), 2);
  useEffect(() => {
    void lireReglage<StyleEtiquette>(cleExempleLocaux(espace.projet.id)).then((e) => e && setExemple(e));
  }, [espace]);
  const [progression, setProgression] = useState<string | null>(null);
  const [inclureNomsSeuls, setInclureNomsSeuls] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const plans = espace.niveaux.flatMap((n) => {
    const p = espace.planDuNiveau(n.id);
    return p ? [{ p, n }] : [];
  });

  async function choisirPlanExemple(planId: string) {
    setEncadrer({ planId, fichier: null });
    const plan = espace.planParId(planId);
    if (plan) {
      const fichier = await espace.lirePlan(plan);
      setEncadrer((e) => (e && e.planId === planId ? { ...e, fichier } : e));
    }
  }

  /** Encadré tracé sur le plan exemple : style relevé, mémorisé, et aperçu sur ce plan. */
  async function surCadre(cadre: { x1: number; y1: number; x2: number; y2: number }) {
    const plan = encadrer && espace.planParId(encadrer.planId);
    if (!plan || !encadrer.fichier) return;
    setErreur(null);
    const style = await styleEncadre(plan.empreinte, encadrer.fichier, cadre);
    if (!style) {
      setErreur('Aucun texte dans le cadre : encadrez le nom d’un local, au plus près.');
      return;
    }
    setExemple(style);
    await ecrireReglage(cleExempleLocaux(espace.projet.id), style);
    const { locaux } = await proposerLocaux(plan.empreinte, encadrer.fichier, style);
    setEncadrer({ ...encadrer, apercu: locaux.length });
  }

  async function lancer(avecExemple?: StyleEtiquette) {
    setErreur(null);
    setOccupe(true);
    setEncadrer(null);
    const resultat: Ligne[] = [];
    try {
      for (const [i, { p, n }] of plans.entries()) {
        setProgression(`Lecture du plan ${n.code} (${i + 1}/${plans.length})…`);
        const { locaux, sansTexte } = await proposerLocaux(p.empreinte, await espace.lirePlan(p), avecExemple);
        const nouveaux = locaux.filter((l) => !espace.dejaPresent(p.id, l));
        const sures = nouveaux.filter((l) => l.confiance === 'forte');
        const aVerifier = nouveaux.filter((l) => l.confiance === 'moyenne');
        resultat.push({
          plan: p,
          niveau: n,
          sures,
          aVerifier,
          dejaPresents: locaux.length - nouveaux.length,
          sansTexte,
          retenue: nouveaux.length > 0,
        });
      }
      setLignes(resultat);
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setProgression(null);
      setOccupe(false);
    }
  }

  async function enregistrer() {
    if (!lignes) return;
    setOccupe(true);
    setErreur(null);
    try {
      const compteRendu: string[] = [];
      for (const l of lignes.filter((x) => x.retenue)) {
        setProgression(`Enregistrement ${l.niveau.code}…`);
        const retenus = inclureNomsSeuls ? [...l.sures, ...l.aVerifier] : l.sures;
        if (retenus.length) compteRendu.push(...(await espace.enregistrerDetection(l.plan.id, retenus, auteur)));
      }
      surJournal(compteRendu);
      surFin();
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setProgression(null);
      setOccupe(false);
    }
  }

  const total = (lignes ?? [])
    .filter((l) => l.retenue)
    .reduce((s, l) => s + l.sures.length + (inclureNomsSeuls ? l.aVerifier.length : 0), 0);

  return (
    <section className="carte">
      <h2>Détecter les locaux sur tous les plans</h2>
      {encadrer ? (
        <>
          <p className="discret">
            Plan exemple :{' '}
            <select aria-label="Plan exemple" value={encadrer.planId} onChange={(e) => void choisirPlanExemple(e.target.value)}>
              {plans.map(({ p, n }) => (
                <option key={p.id} value={p.id}>
                  {n.code} · {espace.libelle(n)}
                </option>
              ))}
            </select>{' '}
            · encadrez le nom d'un local au doigt (« ✋ Déplacer / zoomer » pour agrandir d'abord le plan).
          </p>
          {encadrer.apercu !== undefined && exemple && (
            <Message type="info">
              Exemple : « {exemple.texte} » · {encadrer.apercu} étiquette{encadrer.apercu > 1 ? 's' : ''} de ce style sur ce plan.
            </Message>
          )}
          <div className="boutons">
            <button className="principal" disabled={occupe || !exemple || encadrer.apercu === undefined} onClick={() => exemple && void lancer(exemple)}>
              Appliquer à tous les plans ({plans.length})
            </button>
            <button onClick={() => setEncadrer(null)} disabled={occupe}>
              Retour
            </button>
          </div>
          <div className="zone-exemple">
            {encadrer.fichier ? (
              <>
                <VisionneusePlan
                  key={encadrer.planId}
                  ref={vue}
                  cle={espace.planParId(encadrer.planId)!.empreinte}
                  fichier={encadrer.fichier}
                  marqueurs={[]}
                  modePlacement
                />
                <CadreSelection
                  convertir={(x, y) => vue.current?.relatifDepuisEcran(x, y) ?? null}
                  surCadre={(c) => void surCadre(c)}
                  surAnnuler={() => setEncadrer(null)}
                />
              </>
            ) : (
              <div className="vue-etat">Lecture du plan…</div>
            )}
          </div>
        </>
      ) : !lignes ? (
        <>
          <p className="discret">
            Lit les étiquettes de locaux des {plans.length} plans du projet. Rien n'est enregistré avant votre validation ;
            les locaux déjà présents ne sont pas recréés. Si la détection automatique propose de faux locaux (mobilier,
            annotations), détectez d'après un exemple : vous encadrez le nom d'un local sur un plan, et seules les étiquettes
            de même police et de même taille sont retenues, sur tous les plans.
          </p>
          <div className="boutons">
            <button className="principal" onClick={() => void lancer()} disabled={occupe || plans.length === 0}>
              {progression ?? 'Lancer la détection'}
            </button>
            <button onClick={() => plans[0] && void choisirPlanExemple(plans[0].p.id)} disabled={occupe || plans.length === 0}>
              ▭ D'après un exemple…
            </button>
            {exemple && (
              <button onClick={() => void lancer(exemple)} disabled={occupe || plans.length === 0} title="Exemple déjà encadré pour ce projet">
                Réutiliser l'exemple « {exemple.texte ?? 'étiquette'} »
              </button>
            )}
            <button onClick={surFin} disabled={occupe}>
              Annuler
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="defilement">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Enregistrer</th>
                  <th>Niveau</th>
                  <th>Locaux sûrs</th>
                  <th>Noms seuls, à vérifier</th>
                  <th>Déjà présents</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.plan.id} className={l.retenue ? undefined : 'ligne-ignoree'}>
                    <td>
                      <input
                        type="checkbox"
                        checked={l.retenue}
                        disabled={l.sures.length + l.aVerifier.length === 0}
                        aria-label={`Enregistrer les locaux du niveau ${l.niveau.code}`}
                        onChange={(e) =>
                          setLignes(lignes.map((x) => (x.plan.id === l.plan.id ? { ...x, retenue: e.target.checked } : x)))
                        }
                      />
                    </td>
                    <td>
                      <strong>{l.niveau.code}</strong> <span className="discret">{espace.libelle(l.niveau)}</span>
                      {l.sansTexte && <div className="discret">pas de texte lisible (PDF scanné ?)</div>}
                    </td>
                    <td>{l.sures.length}</td>
                    <td title={l.aVerifier.map((x) => x.nom).join(', ')}>{l.aVerifier.length}</td>
                    <td>{l.dejaPresents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="case">
            <input type="checkbox" checked={inclureNomsSeuls} onChange={(e) => setInclureNomsSeuls(e.target.checked)} />
            Inclure les noms seuls (« BUREAUX »…). Quelques erreurs possibles (cartouche, légende) : à supprimer ensuite sur
            le plan.
          </label>
          <div className="boutons">
            <button className="principal" onClick={enregistrer} disabled={occupe || total === 0}>
              {progression ?? `Enregistrer ${total} ${total > 1 ? 'locaux' : 'local'}`}
            </button>
            <button onClick={surFin} disabled={occupe}>
              Annuler
            </button>
          </div>
        </>
      )}
      {erreur && <Message type="erreur">{erreur}</Message>}
    </section>
  );
}
