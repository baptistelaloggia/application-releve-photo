import { useEffect, useState } from 'react';
import { ErreurPasUnProjet, type EspaceProjet } from '../projet/EspaceProjet';
import { ouvrirProjet } from '../projet/ouverture';
import { avecDelai, choisirDossier, choixDeDossierDisponible, dossierProjetAppareil, verifierPermission } from '../stockage/acces';
import { listerProjetsConnus, oublierProjet, type ProjetConnu } from '../stockage/registre';
import { dateLisible, Message, texteErreur } from './commun';

interface Props {
  surNouveau: () => void;
  surDiagnostic: () => void;
  surOuvert: (espace: EspaceProjet, connu: ProjetConnu) => void;
}

export function Accueil({ surNouveau, surDiagnostic, surOuvert }: Props) {
  const [recents, setRecents] = useState<ProjetConnu[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [etape, setEtape] = useState<string | null>(null);
  const surPC = choixDeDossierDisponible();

  const actualiser = () => void listerProjetsConnus().then(setRecents);
  useEffect(actualiser, []);

  async function executer(action: () => Promise<void>) {
    setErreur(null);
    setOccupe(true);
    try {
      await action();
    } catch (e) {
      setErreur(
        e instanceof ErreurPasUnProjet
          ? "Ce dossier n'est pas un projet. Choisissez le dossier du projet lui-même (« 2026-XXX_NomProjet », celui qui contient le sous-dossier _data)."
          : texteErreur(e),
      );
    } finally {
      setOccupe(false);
      setEtape(null);
    }
  }

  const ouvrirDossier = () =>
    executer(async () => {
      setEtape(
        "Choisissez le dossier du projet, puis acceptez « Modifier les fichiers » dans la fenêtre d'autorisation du navigateur (elle peut s'ouvrir derrière l'appli).",
      );
      const handle = await choisirDossier('projet', setEtape);
      if (!handle) return;
      setEtape(`Ouverture du projet « ${handle.name} »…`);
      const { espace, connu } = await avecDelai(ouvrirProjet(handle, 'dossier'), 90, 'Ouverture du projet');
      surOuvert(espace, connu);
    });

  const ouvrirRecent = (p: ProjetConnu) =>
    executer(async () => {
      const handle = p.handle ?? (await dossierProjetAppareil(p.dossier));
      setEtape("Autorisation d'accès au dossier : acceptez la demande du navigateur si elle apparaît.");
      if (!(await verifierPermission(handle, true))) {
        throw new Error("L'autorisation d'accès au dossier a été refusée.");
      }
      setEtape(`Ouverture du projet « ${p.nom} »…`);
      const { espace, connu } = await avecDelai(ouvrirProjet(handle, p.type), 90, 'Ouverture du projet');
      surOuvert(espace, connu);
    });

  return (
    <>
      {!surPC && (
        <Message type="info">
          Sur téléphone, les projets sont rangés dans le stockage interne de l'application. Le transfert vers le serveur
          partagé arrivera avec l'export .zip (lot 4).
        </Message>
      )}
      {etape && <Message type="info">{etape}</Message>}
      {erreur && <Message type="erreur">{erreur}</Message>}

      <section className="actions-accueil">
        <button className="principal grand" onClick={surNouveau} disabled={occupe}>
          + Nouveau projet
        </button>
        {surPC && (
          <button className="grand" onClick={ouvrirDossier} disabled={occupe}>
            Ouvrir un projet existant…
          </button>
        )}
      </section>

      <section className="carte">
        <h2>Projets récents</h2>
        {recents.length === 0 ? (
          <p className="discret">Aucun projet ouvert sur cet appareil pour l'instant.</p>
        ) : (
          <ul className="liste-projets">
            {recents.map((p) => (
              <li key={p.id}>
                <button className="projet" onClick={() => ouvrirRecent(p)} disabled={occupe}>
                  <strong>{p.nom}</strong>
                  <span className="discret">
                    {p.dossier} · {p.type === 'dossier' ? (surPC ? 'dossier PC' : 'dossier du téléphone') : 'appareil'} · ouvert le{' '}
                    {dateLisible(p.dernierAcces)}
                    {!surPC && p.type === 'dossier' && (
                      <span className="texte-erreur">
                        {' '}
                        · très lent sur téléphone : recréez ce projet avec « Nouveau projet » (stockage interne de l'appli)
                      </span>
                    )}
                  </span>
                </button>
                <button
                  className="discret petit"
                  title="Retirer de la liste (le dossier n'est pas supprimé)"
                  onClick={() => void oublierProjet(p.id).then(actualiser)}
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {surPC && (
        <section className="carte">
          <h2>Tester l'écriture sur le serveur</h2>
          <p>
            Vérifie que l'application peut créer, écrire, renommer et supprimer des fichiers dans un dossier, par exemple
            sur le lecteur réseau partagé.
          </p>
          <button onClick={surDiagnostic}>Lancer le test…</button>
        </section>
      )}
    </>
  );
}
