import { useEffect, useState } from 'react';
import { ErreurPasUnProjet, type EspaceProjet } from '../projet/EspaceProjet';
import { ouvrirProjet } from '../projet/ouverture';
import { choisirDossier, choixDeDossierDisponible, dossierProjetAppareil, verifierPermission } from '../stockage/acces';
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
    }
  }

  const ouvrirDossier = () =>
    executer(async () => {
      const handle = await choisirDossier('projet');
      if (!handle) return;
      const { espace, connu } = await ouvrirProjet(handle, 'dossier');
      surOuvert(espace, connu);
    });

  const ouvrirRecent = (p: ProjetConnu) =>
    executer(async () => {
      const handle = p.handle ?? (await dossierProjetAppareil(p.dossier));
      if (!(await verifierPermission(handle, true))) {
        throw new Error("L'autorisation d'accès au dossier a été refusée.");
      }
      const { espace, connu } = await ouvrirProjet(handle, p.type);
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
                    {p.dossier} · {p.type === 'dossier' ? 'dossier PC' : 'appareil'} · ouvert le {dateLisible(p.dernierAcces)}
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
