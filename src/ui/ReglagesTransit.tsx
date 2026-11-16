import { useEffect, useState } from 'react';
import { controlerConfig, ecrireConfigTransit, lireConfigTransit, type ConfigTransit } from '../transit/config';
import { adresseRetour, compteConnecte, deconnecter } from '../transit/connexion';
import { TransitGraph } from '../transit/TransitGraph';
import { Message, texteErreur } from './commun';

const VIDE: ConfigTransit = { tenantId: '', clientId: '', siteUrl: '', bibliotheque: 'Transit' };

/**
 * Réglages du transit SharePoint (lot 5). Les valeurs sont fournies par la DSI (voir docs/NOTE_DSI.md)
 * et restent sur cet appareil.
 */
export function ReglagesTransit({ surRetour }: { surRetour: () => void }) {
  const [c, setC] = useState<ConfigTransit>(VIDE);
  const [message, setMessage] = useState<{ type: 'erreur' | 'info' | 'succes'; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [compte, setCompte] = useState<string | null>(null);

  useEffect(() => {
    void lireConfigTransit().then((x) => {
      if (!x) return;
      setC(x);
      void compteConnecte(x).then(setCompte).catch(() => undefined);
    });
  }, []);

  const problemes = c.test ? [] : controlerConfig(c);
  const champ = (cle: keyof Omit<ConfigTransit, 'test'>, libelle: string, aide: string, placeholder = '') => (
    <label>
      {libelle}
      <input value={c[cle]} placeholder={placeholder} spellCheck={false} onChange={(e) => setC({ ...c, [cle]: e.target.value })} />
      <span className="discret petit-texte">{aide}</span>
    </label>
  );

  async function agir(action: () => Promise<string>) {
    setMessage(null);
    setOccupe(true);
    try {
      setMessage({ type: 'succes', texte: await action() });
    } catch (e) {
      setMessage({ type: 'erreur', texte: texteErreur(e) });
    } finally {
      setOccupe(false);
    }
  }

  const propre = (): ConfigTransit => ({
    ...c,
    tenantId: c.tenantId.trim(),
    clientId: c.clientId.trim(),
    siteUrl: c.siteUrl.trim().replace(/\/+$/, ''),
    bibliotheque: c.bibliotheque.trim(),
  });

  return (
    <section className="carte">
      <h1>Transit SharePoint</h1>
      <p>
        Le transit SharePoint remplace le câble USB : le téléphone y dépose ses visites, le PC les collecte, les range sur
        le serveur et les supprime de SharePoint. Les valeurs ci-dessous sont fournies par la DSI ; elles restent sur cet
        appareil.
      </p>
      {champ('tenantId', 'Identifiant du locataire (tenant ID)', 'Fourni par la DSI.', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')}
      {champ('clientId', "Identifiant de l'application (client ID)", 'Fourni par la DSI.', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')}
      {champ('siteUrl', 'Adresse du site SharePoint', 'Le site qui porte la bibliothèque de transit.', 'https://entreprise.sharepoint.com/sites/NomDuSite')}
      {champ('bibliotheque', 'Bibliothèque', 'Nom de la bibliothèque de documents.', 'Transit')}

      <label className="bouton-fichier petit-bouton">
        Importer un fichier de réglages (.json) fourni par la DSI…
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            void f.text().then((t) => {
              try {
                const j = JSON.parse(t) as Partial<ConfigTransit>;
                setC({ ...VIDE, ...c, ...j, test: undefined });
                setMessage({ type: 'info', texte: 'Réglages lus : vérifiez-les, puis « Enregistrer ».' });
              } catch {
                setMessage({ type: 'erreur', texte: "Ce fichier n'est pas un fichier de réglages valable." });
              }
            });
          }}
        />
      </label>

      {problemes.length > 0 && (c.tenantId || c.clientId || c.siteUrl) && (
        <Message type="erreur">
          {problemes.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Message>
      )}

      <div className="boutons">
        <button
          className="principal"
          disabled={problemes.length > 0 || occupe}
          onClick={() =>
            void agir(async () => {
              await ecrireConfigTransit(propre());
              return 'Réglages enregistrés.';
            })
          }
        >
          Enregistrer
        </button>
        <button
          disabled={problemes.length > 0 || occupe}
          onClick={() =>
            void agir(async () => {
              const config = propre();
              await ecrireConfigTransit(config);
              await new TransitGraph(config).tester();
              setCompte(await compteConnecte(config));
              return `Connexion réussie : bibliothèque « ${config.bibliotheque} » accessible.`;
            })
          }
        >
          {occupe ? 'Connexion…' : 'Se connecter et tester'}
        </button>
        {compte && (
          <button
            className="petit"
            disabled={occupe}
            onClick={() =>
              void agir(async () => {
                await deconnecter(propre());
                setCompte(null);
                return 'Déconnecté.';
              })
            }
          >
            Se déconnecter ({compte})
          </button>
        )}
        <button onClick={surRetour}>Retour</button>
      </div>
      {message && <Message type={message.type}>{message.texte}</Message>}

      <details className="journal">
        <summary>Informations pour la DSI</summary>
        <ul>
          <li>
            Type d'application : <strong>application monopage (SPA)</strong>, sans secret (code d'autorisation + PKCE).
          </li>
          <li>
            URI de redirection à déclarer : <span className="mono">{adresseRetour()}</span>
          </li>
          <li>
            Permission Microsoft Graph déléguée : <span className="mono">Sites.Selected</span>, accordée sur le seul site de
            transit (droit « write »).
          </li>
        </ul>
      </details>
      <div className="boutons">
        <button
          className="petit discret"
          onClick={() =>
            void agir(async () => {
              await ecrireConfigTransit(null);
              setC(VIDE);
              return 'Réglages effacés de cet appareil.';
            })
          }
        >
          Effacer les réglages de cet appareil
        </button>
      </div>
    </section>
  );
}
