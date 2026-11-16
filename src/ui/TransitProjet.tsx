import { useEffect, useState } from 'react';
import type { EspaceProjet } from '../projet/EspaceProjet';
import { ErreurImport, executerImport, preparerImport } from '../projet/importPaquet';
import { lireConfigTransit, type ConfigTransit } from '../transit/config';
import {
  deposerVisite,
  listerDepots,
  publierCopie,
  purgerProjet,
  supprimerDepot,
  telechargerCopie,
  telechargerDepot,
  versionCopie,
  type VersionCopie,
} from '../transit/protocole';
import { TransitGraph, type ElementTransit } from '../transit/TransitGraph';
import { ecrireReglage, lireReglage, marquerPhotosExportees, photosExportees } from '../stockage/registre';
import { Message, tailleLisible, texteErreur } from './commun';

interface Props {
  espace: EspaceProjet;
  auteur: string;
  surPC: boolean;
  surJournal: (lignes: string[]) => void;
  surModifie: () => void;
}

const date = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Transit SharePoint (lot 5) :
 * - PC : publier la copie de travail ; collecter les visites déposées, les ranger, puis les supprimer
 *   du transit ; purger le projet à sa clôture ;
 * - téléphone : mettre à jour la copie de travail ; envoyer la visite.
 */
export function TransitProjet({ espace, auteur, surPC, surJournal, surModifie }: Props) {
  const [config, setConfig] = useState<ConfigTransit | null | undefined>(undefined);
  const [etat, setEtat] = useState<{ version: VersionCopie | null; depots: ElementTransit[]; appliquee: string | null } | null>(null);
  const [progression, setProgression] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [deja, setDeja] = useState<Set<string>>(new Set());
  const cleAppliquee = `copieAppliquee:${espace.projet.id}`;

  useEffect(() => {
    void lireConfigTransit().then(setConfig);
    void photosExportees(espace.projet.id).then(setDeja);
  }, [espace]);

  const transit = config ? new TransitGraph(config) : null;

  async function actualiser() {
    if (!transit) return;
    const [version, depots, appliquee] = await Promise.all([
      versionCopie(transit, espace.projet),
      surPC ? listerDepots(transit, espace.projet) : Promise.resolve([]),
      lireReglage<string>(cleAppliquee),
    ]);
    setEtat({ version, depots, appliquee: appliquee ?? null });
  }

  async function agir(action: () => Promise<void>) {
    if (progression) return;
    setErreur(null);
    setProgression('Connexion à SharePoint…');
    try {
      await action();
    } catch (e) {
      setErreur(texteErreur(e));
      if (e instanceof ErreurImport) surJournal(e.compteRendu);
    } finally {
      setProgression(null);
      surModifie();
    }
  }

  if (config === undefined) return null;
  if (!config || !transit) {
    return (
      <section className="carte">
        <h2>Transit SharePoint</h2>
        <p className="discret">
          Non configuré sur cet appareil. Une fois les valeurs fournies par la DSI, renseignez-les depuis l'accueil
          (« Réglages SharePoint »). En attendant, les échanges se font par paquet .zip (carte ci-dessus).
        </p>
      </section>
    );
  }

  const nouvelles = espace.photos.filter((p) => !deja.has(p.id));

  const publier = () =>
    agir(async () => {
      const v = await publierCopie(transit, espace, auteur, setProgression);
      surJournal([`Copie de travail publiée sur le transit (${tailleLisible(v.taille)}) : les téléphones peuvent la récupérer.`]);
      await actualiser();
    });

  const collecter = () =>
    agir(async () => {
      const depots = await listerDepots(transit, espace.projet);
      const compteRendu: string[] = [];
      for (const [i, d] of depots.entries()) {
        setProgression(`Dépôt ${i + 1}/${depots.length} : téléchargement (${tailleLisible(d.taille)})…`);
        const fichier = await telechargerDepot(transit, espace.projet, d.nom);
        const prepare = await preparerImport(espace, fichier);
        if (!prepare.rien) {
          compteRendu.push(
            ...(await executerImport(espace, fichier, d.nom, prepare, auteur, (t) => setProgression(`Dépôt ${i + 1}/${depots.length} : ${t}`))),
          );
        } else compteRendu.push(`Dépôt déjà rangé : ${d.nom}`);
        // Purge : le dépôt n'est supprimé du transit qu'une fois tout rangé sur le serveur.
        await supprimerDepot(transit, espace.projet, d.nom);
        compteRendu.push(`Dépôt supprimé du transit : ${d.nom}`);
      }
      surJournal(compteRendu.length ? compteRendu : ['Aucun dépôt à collecter sur le transit.']);
      await actualiser();
    });

  const purger = () => {
    if (!confirm('Clôture du projet : supprimer du transit SharePoint la copie de travail et les dépôts non collectés ?')) return;
    void agir(async () => {
      const depots = await listerDepots(transit, espace.projet);
      if (depots.length && !confirm(`${depots.length} dépôt(s) ne sont pas encore collectés. Les supprimer quand même ?`)) return;
      await purgerProjet(transit, espace.projet);
      surJournal(['Projet supprimé du transit SharePoint (clôture).']);
      await actualiser();
    });
  };

  const mettreAJour = () =>
    agir(async () => {
      const version = await versionCopie(transit, espace.projet);
      if (!version) throw new Error("Pas de copie de travail de ce projet sur le transit : publiez-la d'abord depuis le PC.");
      setProgression('Téléchargement de la copie de travail…');
      const fichier = await telechargerCopie(transit, espace.projet);
      const prepare = await preparerImport(espace, fichier);
      const cr = prepare.rien ? ['Copie de travail du transit : rien de nouveau.'] : await executerImport(espace, fichier, fichier.name, prepare, auteur, setProgression);
      await ecrireReglage(cleAppliquee, version.publieLe);
      surJournal(cr);
      await actualiser();
    });

  const envoyer = () =>
    agir(async () => {
      const r = await deposerVisite(transit, espace, auteur, nouvelles, setProgression);
      // Les photos ne sont comptées comme transmises qu'une fois le dépôt terminé.
      await marquerPhotosExportees(espace.projet.id, nouvelles.map((p) => p.id));
      setDeja(await photosExportees(espace.projet.id));
      surJournal([`Visite déposée sur le transit : ${r.nom} (${tailleLisible(r.taille)}, ${nouvelles.length} photo(s)).`]);
      await actualiser();
    });

  const copieNouvelle = !surPC && etat?.version && etat.version.publieLe !== etat.appliquee;

  return (
    <section className="carte">
      <h2>Transit SharePoint</h2>
      <p className="discret">
        {surPC
          ? 'Publiez la copie de travail pour les téléphones ; collectez les visites déposées : elles sont rangées sur le serveur puis supprimées de SharePoint.'
          : 'Récupérez la dernière copie de travail avant la visite ; envoyez la visite au retour (connexion Internet nécessaire).'}
      </p>
      {etat && (
        <ul className="etat-transit">
          <li>
            Copie de travail :{' '}
            {etat.version ? `publiée le ${date(etat.version.publieLe)} par ${etat.version.publiePar}` : 'pas encore publiée'}
            {copieNouvelle && <strong> · nouvelle version disponible</strong>}
          </li>
          {surPC && (
            <li>
              Dépôts à collecter : <strong>{etat.depots.length}</strong>
              {etat.depots.length > 0 && ` (${tailleLisible(etat.depots.reduce((s, d) => s + d.taille, 0))})`}
            </li>
          )}
        </ul>
      )}
      <div className="boutons">
        {surPC ? (
          <>
            <button className="principal" disabled={!!progression} onClick={() => void collecter()}>
              Collecter et ranger les visites
            </button>
            <button disabled={!!progression} onClick={() => void publier()}>
              Publier la copie de travail
            </button>
          </>
        ) : (
          <>
            <button className="principal" disabled={!!progression} onClick={() => void envoyer()}>
              Envoyer la visite ({nouvelles.length} photo{nouvelles.length > 1 ? 's' : ''})
            </button>
            <button disabled={!!progression} onClick={() => void mettreAJour()}>
              Mettre à jour la copie de travail
            </button>
          </>
        )}
        <button className="petit" disabled={!!progression} onClick={() => void agir(actualiser)}>
          Actualiser l'état
        </button>
        {surPC && (
          <button className="petit discret" disabled={!!progression} onClick={purger}>
            Clôture : supprimer du transit
          </button>
        )}
      </div>
      {progression && <Message type="info">{progression}</Message>}
      {erreur && <Message type="erreur">{erreur}</Message>}
    </section>
  );
}
