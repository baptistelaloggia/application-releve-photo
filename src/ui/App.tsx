import { useEffect, useState } from 'react';
import { EspaceProjet } from '../projet/EspaceProjet';
import { demanderStockagePersistant } from '../stockage/acces';
import { ecrireReglage, lireReglage, type ProjetConnu } from '../stockage/registre';
import { activerHorsLigne } from '../pwa';
import { Accueil } from './Accueil';
import { NouveauProjet } from './NouveauProjet';
import { EcranProjet } from './EcranProjet';
import { Diagnostic } from './Diagnostic';

type Ecran =
  | { type: 'accueil' }
  | { type: 'nouveau' }
  | { type: 'diagnostic' }
  | { type: 'projet'; espace: EspaceProjet; connu: ProjetConnu; paquet?: File | null };

export function App() {
  const [ecran, setEcran] = useState<Ecran>({ type: 'accueil' });
  const [auteur, setAuteur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [majDisponible, setMajDisponible] = useState<null | (() => void)>(null);

  useEffect(() => {
    void lireReglage<string>('auteur').then((a) => {
      setAuteur(a ?? null);
      setChargement(false);
    });
    void demanderStockagePersistant();
    if (!__FICHIER_UNIQUE__) activerHorsLigne((installer) => setMajDisponible(() => installer));
  }, []);

  const ouvert = (espace: EspaceProjet, connu: ProjetConnu, paquet?: File | null) =>
    setEcran({ type: 'projet', espace, connu, paquet });
  const accueil = () => setEcran({ type: 'accueil' });

  return (
    <div className="appli">
      <header className="entete">
        <button className="lien-titre" onClick={accueil}>
          <img src="./icone.svg" alt="" width={28} height={28} />
          <span>Relevé photo sur plans</span>
        </button>
        {auteur && (
          <button className="auteur" title="Changer d'utilisateur" onClick={() => setAuteur(null)}>
            {auteur}
          </button>
        )}
      </header>

      {majDisponible && (
        <div className="bandeau-maj">
          Une nouvelle version est disponible.
          <button onClick={majDisponible}>Mettre à jour</button>
        </div>
      )}
      {__FICHIER_UNIQUE__ && (
        <div className="bandeau-test">Version de test (fichier unique) : pas d'installation ni de mode hors ligne.</div>
      )}

      <main>
        {chargement ? null : !auteur ? (
          <SaisieAuteur
            surValider={async (a) => {
              await ecrireReglage('auteur', a);
              setAuteur(a);
            }}
          />
        ) : ecran.type === 'accueil' ? (
          <Accueil
            surNouveau={() => setEcran({ type: 'nouveau' })}
            surDiagnostic={() => setEcran({ type: 'diagnostic' })}
            surOuvert={ouvert}
          />
        ) : ecran.type === 'nouveau' ? (
          <NouveauProjet auteur={auteur} surAnnuler={accueil} surCree={ouvert} />
        ) : ecran.type === 'diagnostic' ? (
          <Diagnostic surRetour={accueil} />
        ) : (
          <EcranProjet
            key={ecran.connu.id}
            espace={ecran.espace}
            connu={ecran.connu}
            auteur={auteur}
            paquetInitial={ecran.paquet}
            surFermer={accueil}
          />
        )}
      </main>
      <footer className="pied">Version {__VERSION__} · les données restent dans vos dossiers</footer>
    </div>
  );
}

function SaisieAuteur({ surValider }: { surValider: (a: string) => void }) {
  const [valeur, setValeur] = useState('');
  const propre = valeur.trim();
  return (
    <section className="carte etroite">
      <h1>Bienvenue</h1>
      <p>
        Indiquez vos initiales ou votre nom. Ils seront enregistrés comme auteur de chaque plan importé et de chaque
        photo prise sur cet appareil.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (propre) surValider(propre);
        }}
      >
        <label>
          Initiales ou nom
          <input autoFocus value={valeur} maxLength={40} onChange={(e) => setValeur(e.target.value)} />
        </label>
        <button className="principal" disabled={!propre}>
          Continuer
        </button>
      </form>
    </section>
  );
}
