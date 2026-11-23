import { useEffect, useState } from 'react';
import { dossierAppareil } from '../stockage/acces';
import { oublierProjet, photosExportees } from '../stockage/registre';
import { Message, texteErreur } from './commun';

interface DossierAppareil {
  nom: string;
  /** Projet contenu (null : dossier incomplet, reste d'une création ou d'un import interrompu). */
  projet: { id: string; nom: string } | null;
  nbPhotos: number;
  /** Photos jamais envoyées au serveur (paquet ou transit). */
  nonEnvoyees: number;
}

/** Inventaire du stockage interne de l'appli : un dossier par projet. */
async function lister(): Promise<DossierAppareil[]> {
  const parent = await dossierAppareil();
  const liste: DossierAppareil[] = [];
  for await (const [nom, h] of parent.entries()) {
    if (h.kind !== 'directory') continue;
    const dossier = h as FileSystemDirectoryHandle;
    let projet: DossierAppareil['projet'] = null;
    const photos: string[] = [];
    try {
      const data = await dossier.getDirectoryHandle('_data');
      const p = JSON.parse(await (await (await data.getFileHandle('projet.json')).getFile()).text());
      if (p?.id) projet = { id: p.id, nom: p.nom ?? nom };
      const dp = await data.getDirectoryHandle('photos');
      for await (const n of dp.keys()) if (n.endsWith('.json')) photos.push(n.slice(0, -5));
    } catch {
      /* dossier incomplet */
    }
    const envoyees = projet ? await photosExportees(projet.id) : new Set<string>();
    liste.push({ nom, projet, nbPhotos: photos.length, nonEnvoyees: photos.filter((id) => !envoyees.has(id)).length });
  }
  return liste.sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * Stockage du téléphone (24/11/2026) : les projets du stockage interne de l'appli, invisibles dans le
 * gestionnaire de fichiers du téléphone, avec leur nombre de photos et un bouton « Supprimer ».
 * Sert à repartir d'une bonne base (import interrompu, essai) ou à libérer de la place.
 */
export function StockageAppareil({ surModifie }: { surModifie: () => void }) {
  const [dossiers, setDossiers] = useState<DossierAppareil[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const actualiser = () =>
    void lister()
      .then(setDossiers)
      .catch((e) => setErreur(texteErreur(e)));
  useEffect(actualiser, []);

  async function supprimer(d: DossierAppareil) {
    const alerte = d.nonEnvoyees
      ? `\n\n⚠️ ${d.nonEnvoyees} photo${d.nonEnvoyees > 1 ? 's n’ont' : ' n’a'} jamais été envoyée${d.nonEnvoyees > 1 ? 's' : ''} au serveur : ${d.nonEnvoyees > 1 ? 'elles seront perdues' : 'elle sera perdue'}.`
      : '';
    if (!confirm(`Supprimer « ${d.projet?.nom ?? d.nom} » de ce téléphone ?${alerte}\n\nLe projet sur le serveur partagé n'est pas touché.`)) return;
    if (d.nonEnvoyees && !confirm(`Dernière confirmation : supprimer ${d.nonEnvoyees} photo(s) non envoyée(s) ?`)) return;
    try {
      await (await dossierAppareil()).removeEntry(d.nom, { recursive: true });
      if (d.projet) await oublierProjet(d.projet.id);
      actualiser();
      surModifie();
    } catch (e) {
      setErreur(texteErreur(e));
    }
  }

  return (
    <section className="carte">
      <h2>Stockage du téléphone</h2>
      <p className="discret">
        Projets rangés dans le stockage interne de l'appli (invisibles dans les fichiers du téléphone). Les photos sont
        envoyées au serveur partagé par paquet .zip ou par le transit SharePoint, depuis l'écran du projet.
      </p>
      {erreur && <Message type="erreur">{erreur}</Message>}
      {dossiers === null ? (
        <p className="discret">Lecture…</p>
      ) : dossiers.length === 0 ? (
        <p className="discret">Aucun projet sur ce téléphone.</p>
      ) : (
        <ul className="liste-projets">
          {dossiers.map((d) => (
            <li key={d.nom}>
              <div className="projet">
                <strong>{d.projet?.nom ?? d.nom}</strong>
                <span className="discret">
                  {d.nom} · {d.projet ? `${d.nbPhotos} photo${d.nbPhotos > 1 ? 's' : ''}` : 'dossier incomplet (import ou création interrompus)'}
                  {d.nonEnvoyees > 0 && <span className="texte-erreur"> · {d.nonEnvoyees} non envoyée{d.nonEnvoyees > 1 ? 's' : ''}</span>}
                </span>
              </div>
              <button className="discret petit" onClick={() => void supprimer(d)}>
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
