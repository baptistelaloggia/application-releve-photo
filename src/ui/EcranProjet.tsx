import { useState } from 'react';
import { libelleNiveau } from '../domaine/niveaux';
import type { EspaceProjet } from '../projet/EspaceProjet';
import type { ProjetConnu } from '../stockage/registre';
import { BarreRecherche } from './BarreRecherche';
import { EcranPlan } from './plan/EcranPlan';
import { dateLisible, Journal, Message, tailleLisible, texteErreur } from './commun';
import { ImportPlans } from './ImportPlans';

interface Props {
  espace: EspaceProjet;
  connu: ProjetConnu;
  auteur: string;
  surFermer: () => void;
}

export function EcranProjet({ espace, connu, auteur, surFermer }: Props) {
  const [, setVersion] = useState(0);
  const [journal, setJournal] = useState<string[]>(espace.avertissements.map((a) => `Attention : ${a}`));
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouveauNiveau, setNouveauNiveau] = useState('');
  const [planOuvert, setPlanOuvert] = useState<{ planId: string; localId: string | null } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const { projet } = espace;

  async function executer(action: () => Promise<string[] | void>) {
    setErreur(null);
    setOccupe(true);
    try {
      const lignes = await action();
      if (lignes) setJournal((j) => [...lignes, ...j]);
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setOccupe(false);
      setVersion((v) => v + 1);
    }
  }

  if (planOuvert && espace.planParId(planOuvert.planId)) {
    return (
      <EcranPlan
        key={planOuvert.planId + (planOuvert.localId ?? '')}
        espace={espace}
        auteur={auteur}
        planId={planOuvert.planId}
        localId={planOuvert.localId}
        surChangerPlan={(planId, localId) => setPlanOuvert({ planId, localId: localId ?? null })}
        surFermer={() => setPlanOuvert(null)}
        surJournal={(lignes) => setJournal((j) => [...lignes, ...j])}
      />
    );
  }

  return (
    <>
      <section className="carte">
        <div className="titre-projet">
          <div>
            <h1>{projet.nom}</h1>
            <p className="discret">
              {projet.dossier} · affaire {projet.codeAffaire} · {connu.type === 'dossier' ? 'dossier PC' : 'appareil'}
            </p>
          </div>
          <div className="boutons">
            <button
              onClick={() =>
                executer(async () => {
                  await espace.recharger();
                  const cr = await espace.appliquerArborescence();
                  return cr.length ? cr : ['Arborescence vérifiée : tout est en ordre.'];
                })
              }
              disabled={occupe}
            >
              Actualiser et vérifier
            </button>
            <button onClick={surFermer}>Fermer</button>
          </div>
        </div>
        {erreur && <Message type="erreur">{erreur}</Message>}
        <BarreRecherche espace={espace} surChoix={(r) => setPlanOuvert({ planId: r.plan.id, localId: r.local.id })} />
        <Journal lignes={journal} />
      </section>

      <section className="carte">
        <h2>Niveaux et plans</h2>
        <div className="defilement">
          <table className="tableau">
            <thead>
              <tr>
                <th>Niveau</th>
                <th>Dossier photos</th>
                <th>Plan courant</th>
                <th>Indice</th>
                <th>Locaux</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {espace.niveaux.map((n) => {
                const plan = espace.planDuNiveau(n.id);
                return (
                  <tr key={n.id}>
                    <td>
                      <strong>{n.code}</strong> <span className="discret">{libelleNiveau(n.code)}</span>
                    </td>
                    <td className="mono">{espace.dossierNiveau(n.code).split('/')[1]}</td>
                    <td>
                      {plan ? (
                        <>
                          <span className="mono">{plan.fichier.split('/').pop()}</span>
                          <br />
                          <span className="discret">
                            {plan.pages} page{plan.pages > 1 ? 's' : ''} · {tailleLisible(plan.taille)} · {plan.importePar},{' '}
                            {dateLisible(plan.importeLe)}
                          </span>
                        </>
                      ) : (
                        <span className="discret">aucun</span>
                      )}
                    </td>
                    <td>
                      {plan ? (
                        <>
                          <strong>{plan.indice}</strong>
                          {plan.historique.length > 0 && (
                            <span className="discret"> (avant : {plan.historique.map((h) => h.indice).join(', ')})</span>
                          )}
                        </>
                      ) : null}
                    </td>
                    <td>{plan ? espace.locauxDuPlan(plan.id).length : ''}</td>
                    <td className="actions-ligne">
                      {plan && (
                        <button className="petit" onClick={() => setPlanOuvert({ planId: plan.id, localId: null })}>
                          Ouvrir
                        </button>
                      )}
                      {!plan && (
                        <button
                          className="petit discret"
                          disabled={occupe}
                          onClick={() => {
                            if (confirm(`Supprimer le niveau ${n.code} ? Son dossier photos (vide) sera supprimé.`)) {
                              void executer(() => espace.supprimerNiveau(n.id));
                            }
                          }}
                        >
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <form
          className="ajout-niveau"
          onSubmit={(e) => {
            e.preventDefault();
            void executer(async () => {
              const cr = await espace.ajouterNiveau(nouveauNiveau, auteur);
              setNouveauNiveau('');
              return cr;
            });
          }}
        >
          <label>
            Ajouter un niveau
            <input
              value={nouveauNiveau}
              placeholder="SS1, R+4, TT…"
              maxLength={6}
              onChange={(e) => setNouveauNiveau(e.target.value)}
            />
          </label>
          <button disabled={!nouveauNiveau.trim() || occupe}>Ajouter</button>
        </form>
      </section>

      <ImportPlans
        espace={espace}
        auteur={auteur}
        occupe={occupe}
        executer={executer}
      />

    </>
  );
}
