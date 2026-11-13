import { useState } from 'react';
import { avecDelai, choisirDossier } from '../stockage/acces';
import { diagnostiquer, type EtapeDiagnostic } from '../stockage/diagnostic';
import { StockageDossier } from '../stockage/StockageDossier';
import { Message, texteErreur } from './commun';

export function Diagnostic({ surRetour }: { surRetour: () => void }) {
  const [resultat, setResultat] = useState<{ dossier: string; etapes: EtapeDiagnostic[] } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [enCours, setEnCours] = useState<string | null>(null);

  async function lancer() {
    setErreur(null);
    setResultat(null);
    try {
      setEnCours("Choix du dossier : acceptez ensuite « Modifier les fichiers » dans la fenêtre d'autorisation du navigateur");
      const handle = await choisirDossier('diagnostic', setEnCours);
      if (!handle) return;
      setOccupe(true);
      const etapes = await avecDelai(diagnostiquer(new StockageDossier(handle, handle.name), setEnCours), 300, 'Test du serveur');
      setResultat({ dossier: handle.name, etapes });
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setOccupe(false);
      setEnCours(null);
    }
  }

  const toutBon = resultat?.etapes.every((e) => e.reussi);
  return (
    <section className="carte">
      <h1>Test d'écriture dans un dossier</h1>
      <ol>
        <li>Cliquez sur « Choisir le dossier à tester ».</li>
        <li>Dans la fenêtre Windows, allez sur le lecteur réseau (par ex. « P: ») et choisissez un dossier où vous avez le droit d'écrire.</li>
        <li>Acceptez la demande d'autorisation du navigateur (« Modifier les fichiers »).</li>
      </ol>
      <p className="discret">
        Le test crée un dossier « _test-releve-photo-… », y écrit un fichier de 1 Mo, le relit, le renomme, mesure la
        lecture de 50 petits fichiers (comme à l'ouverture d'un projet), puis supprime le tout.
      </p>
      <div className="boutons">
        <button className="principal" onClick={lancer} disabled={occupe}>
          {occupe ? 'Test en cours…' : 'Choisir le dossier à tester…'}
        </button>
        <button onClick={surRetour}>Retour</button>
      </div>
      {enCours && <Message type="info">En cours : {enCours}…</Message>}
      {erreur && <Message type="erreur">{erreur}</Message>}
      {resultat && (
        <>
          <Message type={toutBon ? 'succes' : 'erreur'}>
            {toutBon
              ? `Réussi : l'application peut travailler dans « ${resultat.dossier} ».`
              : `Échec dans « ${resultat.dossier} » : voir le détail ci-dessous.`}
          </Message>
          <table className="tableau">
            <thead>
              <tr>
                <th>Étape</th>
                <th>Résultat</th>
                <th>Durée</th>
              </tr>
            </thead>
            <tbody>
              {resultat.etapes.map((e, i) => (
                <tr key={i}>
                  <td>{e.etape}</td>
                  <td>{e.reussi ? 'OK' : `Échec${e.detail ? ` : ${e.detail}` : ''}`}</td>
                  <td>{e.dureeMs > 0 ? `${Math.round(e.dureeMs)} ms` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="discret">Vous pouvez me copier ce tableau pour que je l'analyse.</p>
        </>
      )}
    </section>
  );
}
