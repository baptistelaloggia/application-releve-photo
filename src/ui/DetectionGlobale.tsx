import { useState } from 'react';
import type { LocalDetecte } from '../domaine/locaux';
import type { Niveau, Plan } from '../domaine/types';
import type { EspaceProjet } from '../projet/EspaceProjet';
import { proposerLocaux } from '../pdf/pdf';
import { Message, texteErreur } from './commun';

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

/** Détection des locaux sur tous les plans du projet, avec un récapitulatif par niveau avant enregistrement. */
export function DetectionGlobale({ espace, auteur, surJournal, surFin }: Props) {
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [progression, setProgression] = useState<string | null>(null);
  const [inclureNomsSeuls, setInclureNomsSeuls] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const plans = espace.niveaux.flatMap((n) => {
    const p = espace.planDuNiveau(n.id);
    return p ? [{ p, n }] : [];
  });

  async function lancer() {
    setErreur(null);
    setOccupe(true);
    const resultat: Ligne[] = [];
    try {
      for (const [i, { p, n }] of plans.entries()) {
        setProgression(`Lecture du plan ${n.code} (${i + 1}/${plans.length})…`);
        const { locaux, sansTexte } = await proposerLocaux(p.empreinte, await espace.lirePlan(p));
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
      {!lignes ? (
        <>
          <p className="discret">
            Lit les étiquettes de locaux des {plans.length} plans du projet. Rien n'est enregistré avant votre validation ;
            les locaux déjà présents ne sont pas recréés.
          </p>
          <div className="boutons">
            <button className="principal" onClick={lancer} disabled={occupe || plans.length === 0}>
              {progression ?? 'Lancer la détection'}
            </button>
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
