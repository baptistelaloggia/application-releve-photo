import { useMemo, useState } from 'react';
import { genererNiveaux, libelleNiveau, nomsDossiersNiveaux } from '../domaine/niveaux';
import { nomDossierProjet, normaliserCodeAffaire } from '../domaine/nommage';
import { controlerNouveauProjet, type EspaceProjet } from '../projet/EspaceProjet';
import { creerProjet } from '../projet/ouverture';
import { choisirDossier, choixDeDossierDisponible, dossierAppareil } from '../stockage/acces';
import type { ProjetConnu } from '../stockage/registre';
import { Message, texteErreur } from './commun';

interface Props {
  auteur: string;
  surAnnuler: () => void;
  surCree: (espace: EspaceProjet, connu: ProjetConnu) => void;
}

export function NouveauProjet({ auteur, surAnnuler, surCree }: Props) {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [code, setCode] = useState('');
  const [nom, setNom] = useState('');
  const [sousSols, setSousSols] = useState(0);
  const [etages, setEtages] = useState(1);
  const [toiture, setToiture] = useState(true);
  const [entresol, setEntresol] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const surPC = choixDeDossierDisponible();

  const niveaux = useMemo(
    () => genererNiveaux(sousSols, etages, toiture, entresol),
    [sousSols, etages, toiture, entresol],
  );
  const infos = { annee, codeAffaire: code, nom, niveaux };
  const problemes = controlerNouveauProjet(infos);
  const dossiers = [...nomsDossiersNiveaux(niveaux).entries()];

  async function creer() {
    setErreur(null);
    try {
      const parent = surPC ? await choisirDossier('parent-projets') : await dossierAppareil();
      if (!parent) return;
      setOccupe(true);
      const { espace, connu } = await creerProjet(parent, surPC ? 'dossier' : 'appareil', infos, auteur);
      surCree(espace, connu);
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section className="carte">
      <h1>Nouveau projet</h1>
      <div className="grille-formulaire">
        <label>
          Année
          <input type="number" value={annee} min={2000} max={2100} onChange={(e) => setAnnee(Number(e.target.value))} />
        </label>
        <label>
          Code d'affaire
          <input
            value={code}
            placeholder="ex. 1234"
            maxLength={20}
            onChange={(e) => setCode(normaliserCodeAffaire(e.target.value))}
          />
        </label>
        <label className="large">
          Nom du projet
          <input value={nom} placeholder="ex. Lycée Jean Moulin" maxLength={80} onChange={(e) => setNom(e.target.value)} />
        </label>
      </div>

      <h2>Niveaux</h2>
      <div className="grille-formulaire">
        <label>
          Sous-sols
          <input type="number" min={0} max={9} value={sousSols} onChange={(e) => setSousSols(Number(e.target.value))} />
        </label>
        <label>
          Étages (au-dessus du RDC)
          <input type="number" min={0} max={60} value={etages} onChange={(e) => setEtages(Number(e.target.value))} />
        </label>
        <label className="case">
          <input type="checkbox" checked={entresol} onChange={(e) => setEntresol(e.target.checked)} />
          Entresol (ES)
        </label>
        <label className="case">
          <input type="checkbox" checked={toiture} onChange={(e) => setToiture(e.target.checked)} />
          Toiture (TT)
        </label>
      </div>
      <p className="discret">D'autres niveaux pourront être ajoutés ou retirés ensuite.</p>

      <h2>Aperçu de l'arborescence</h2>
      <pre className="arbo">
        {[
          `${code && nom ? nomDossierProjet(annee, code, nom) : `${annee}-CODE_NomProjet`}/`,
          '├── 00_PLANS/',
          '│   └── _ANCIENS/',
          '├── 01_PHOTOS/',
          ...dossiers.map(([c, d], i) => `│   ${i === dossiers.length - 1 ? '└' : '├'}── ${d}/`.padEnd(30) + `  ${libelleNiveau(c)}`),
          '├── 02_EXPORTS/',
          '└── _data/',
        ].join('\n')}
      </pre>

      {code && nom && problemes.length > 0 && (
        <Message type="erreur">
          {problemes.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Message>
      )}
      {erreur && <Message type="erreur">{erreur}</Message>}

      <p>
        {surPC
          ? "Au clic, choisissez le dossier qui contiendra le projet (par ex. le dossier des affaires sur le serveur partagé). Le dossier du projet y sera créé."
          : "Le projet sera créé dans le stockage interne de l'application sur ce téléphone."}
      </p>
      <div className="boutons">
        <button className="principal" disabled={problemes.length > 0 || occupe} onClick={creer}>
          {occupe ? 'Création…' : surPC ? 'Choisir l’emplacement et créer…' : 'Créer le projet'}
        </button>
        <button onClick={surAnnuler}>Annuler</button>
      </div>
    </section>
  );
}
