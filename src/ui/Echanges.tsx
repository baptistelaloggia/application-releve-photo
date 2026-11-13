import { useEffect, useState } from 'react';
import { fusionner, type ResultatFusion } from '../domaine/fusion';
import type { EspaceProjet } from '../projet/EspaceProjet';
import {
  exporterPaquet,
  lireEnTete,
  lirePhotos,
  partageDisponible,
  partagerPaquet,
  telechargerPaquet,
  type EnTetePaquet,
} from '../projet/paquet';
import { marquerPhotosExportees, photosExportees } from '../stockage/registre';
import { Message, tailleLisible, texteErreur } from './commun';

interface Props {
  espace: EspaceProjet;
  auteur: string;
  /** PC (serveur) ou téléphone. */
  surPC: boolean;
  /** Paquet à importer dès l'ouverture (projet créé depuis l'accueil à partir d'un paquet). */
  paquetInitial?: File | null;
  /** Le paquet initial a été pris en compte (il ne doit plus être relu). */
  surPaquetLu?: () => void;
  surJournal: (lignes: string[]) => void;
  surModifie: () => void;
}

type Import =
  | { etape: 'apercu'; fichier: File; entete: EnTetePaquet; fusion: ResultatFusion }
  | { etape: 'encours'; progression: string };

/**
 * Échanges par paquet .zip (lot 4) :
 * - sur PC : paquet pour le téléphone (plans, locaux, repères), import du retour de terrain ;
 * - sur téléphone : export de la visite (photos nouvelles), import des mises à jour du PC.
 */
export function Echanges({ espace, auteur, surPC, paquetInitial, surPaquetLu, surJournal, surModifie }: Props) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [progression, setProgression] = useState<string | null>(null);
  const [exporte, setExporte] = useState<{ fichier: File; nom: string } | null>(null);
  const [deja, setDeja] = useState<Set<string>>(new Set());
  const [toutes, setToutes] = useState(false);
  const [imp, setImp] = useState<Import | null>(null);

  useEffect(() => {
    void photosExportees(espace.projet.id).then(setDeja);
  }, [espace]);
  useEffect(() => {
    if (paquetInitial) {
      surPaquetLu?.();
      void preparerImport(paquetInitial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paquetInitial]);

  const nouvelles = espace.photos.filter((p) => !deja.has(p.id));
  const aTransmettre = toutes ? espace.photos : nouvelles;

  async function exporter() {
    if (progression) return; // déjà en cours (double clic)
    setErreur(null);
    setExporte(null);
    setProgression('Préparation du paquet…');
    try {
      const sens = surPC ? 'vers-telephone' : 'vers-serveur';
      const resultat = await exporterPaquet(espace, sens, auteur, aTransmettre, setProgression);
      if (!surPC) {
        await marquerPhotosExportees(espace.projet.id, aTransmettre.map((p) => p.id));
        setDeja(await photosExportees(espace.projet.id));
      }
      setExporte(resultat);
      surJournal([
        `Paquet préparé : ${resultat.nom} (${tailleLisible(resultat.fichier.size)})`,
        ...(resultat.incident
          ? [`Attention : stockage interne du navigateur refusé (${resultat.incident}) ; paquet construit en mémoire.`]
          : []),
      ]);
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setProgression(null);
    }
  }

  async function preparerImport(fichier: File) {
    setErreur(null);
    setImp({ etape: 'encours', progression: 'Lecture du paquet…' });
    try {
      const entete = await lireEnTete(fichier);
      if (entete.manifeste.projet.id !== espace.projet.id) {
        throw new Error(
          `Ce paquet concerne un autre projet : « ${entete.manifeste.projet.nom} » (${entete.manifeste.projet.dossier}).`,
        );
      }
      setImp({ etape: 'apercu', fichier, entete, fusion: fusionner(espace.donnees(), entete.donnees) });
    } catch (e) {
      setImp(null);
      setErreur(texteErreur(e));
    }
  }

  async function importer(fichier: File, entete: EnTetePaquet, fusion: ResultatFusion) {
    setErreur(null);
    const compteRendu: string[] = [];
    try {
      setImp({ etape: 'encours', progression: 'Mise à jour des plans, locaux et repères…' });
      compteRendu.push(...(await espace.appliquerFusion(fusion, (id) => entete.pdfs.get(id), auteur)));
      const voulues = new Map(fusion.photosNouvelles.map((p) => [p.id, p]));
      let faites = 0;
      const debut = performance.now();
      if (voulues.size) {
        await lirePhotos(fichier, new Set(voulues.keys()), async (id, jpeg, miniature) => {
          await espace.ajouterPhotoImportee(voulues.get(id)!, jpeg, miniature);
          voulues.delete(id);
          faites++;
          setImp({ etape: 'encours', progression: `Photos rangées : ${faites}/${fusion.photosNouvelles.length}` });
        });
      }
      if (faites) {
        compteRendu.unshift(
          `${faites} photo${faites > 1 ? 's' : ''} rangée${faites > 1 ? 's' : ''} en ${((performance.now() - debut) / 1000).toFixed(0)} s`,
        );
      }
      if (voulues.size) {
        compteRendu.push(
          `Attention : ${voulues.size} photo(s) décrite(s) dans le paquet sans leur fichier (déjà transmises dans un paquet précédent non importé ?). Sur le téléphone, réexportez en cochant « inclure aussi les photos déjà exportées ».`,
        );
      }
      compteRendu.unshift(`Paquet importé : ${fichier.name}`);
      surJournal(compteRendu);
    } catch (e) {
      setErreur(`Import interrompu : ${texteErreur(e)}. Ce qui a été rangé est conservé ; relancez l'import pour terminer.`);
      surJournal(compteRendu);
    } finally {
      setImp(null);
      surModifie();
    }
  }

  const choisirFichier = (
    <label className="bouton-fichier">
      {surPC ? 'Importer un paquet du téléphone…' : 'Importer un paquet du PC…'}
      <input
        type="file"
        accept=".zip,application/zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void preparerImport(f);
        }}
      />
    </label>
  );

  return (
    <section className="carte">
      <h2>Échanges avec {surPC ? 'le téléphone' : 'le serveur'} (paquet .zip)</h2>
      {surPC ? (
        <p className="discret">
          Avant la visite : préparez le paquet du projet (plans, locaux, repères, sans photos) et copiez-le sur le téléphone
          (câble USB ou OneDrive). Après la visite : importez ici le paquet de retour du téléphone, et tout est rangé sur le
          serveur.
        </p>
      ) : (
        <p className="discret">
          Après la visite : exportez les photos et relevés, puis transmettez le paquet au PC (partage OneDrive, ou câble
          USB : le fichier est dans « Téléchargements »). Le PC l'importe et range tout sur le serveur.
        </p>
      )}

      <div className="boutons">
        <button className="principal" disabled={!!progression || !!imp} onClick={() => void exporter()}>
          {progression ??
            (surPC
              ? 'Préparer le paquet pour le téléphone'
              : `Exporter la visite pour le serveur (${aTransmettre.length} photo${aTransmettre.length > 1 ? 's' : ''})`)}
        </button>
        {choisirFichier}
      </div>
      {!surPC && deja.size > 0 && (
        <label className="case">
          <input type="checkbox" checked={toutes} onChange={(e) => setToutes(e.target.checked)} />
          Inclure aussi les {espace.photos.length - nouvelles.length} photos déjà exportées
        </label>
      )}

      {exporte && (
        <div className="resultat-export">
          <div>
            Paquet prêt : <span className="mono">{exporte.nom}</span> ({tailleLisible(exporte.fichier.size)})
          </div>
          <div className="boutons">
            {partageDisponible(exporte.fichier) && (
              <button
                className="principal"
                onClick={() => void partagerPaquet(exporte.fichier).catch((e) => setErreur(texteErreur(e)))}
              >
                Partager… (OneDrive, e-mail…)
              </button>
            )}
            <button onClick={() => telechargerPaquet(exporte.fichier, exporte.nom)}>Télécharger</button>
          </div>
        </div>
      )}

      {imp?.etape === 'encours' && <Message type="info">{imp.progression}</Message>}
      {imp?.etape === 'apercu' && (
        <ApercuImport
          imp={imp}
          surAnnuler={() => setImp(null)}
          surImporter={() => void importer(imp.fichier, imp.entete, imp.fusion)}
        />
      )}
      {erreur && <Message type="erreur">{erreur}</Message>}
    </section>
  );
}

function ApercuImport({
  imp,
  surAnnuler,
  surImporter,
}: {
  imp: Extract<Import, { etape: 'apercu' }>;
  surAnnuler: () => void;
  surImporter: () => void;
}) {
  const { manifeste } = imp.entete;
  const f = imp.fusion;
  const lignes: Array<[string, number]> = [
    ['Niveaux ajoutés', f.niveaux.length],
    ['Plans ajoutés', f.plans.length],
    ['Locaux ajoutés ou mis à jour', f.locaux.length],
    ['Repères ajoutés ou mis à jour', f.reperes.length],
    ['Photos nouvelles', f.photosNouvelles.length],
    ['Photos reclassées ou commentées', f.photosModifiees.length],
  ];
  const alertes = f.compteRendu.filter((l) => l.startsWith('Attention') || /renuméroté/.test(l));
  const rien = lignes.every(([, n]) => n === 0);
  return (
    <div className="apercu-import">
      <h3>
        Paquet {manifeste.sens === 'vers-serveur' ? 'de retour de terrain' : 'de préparation de visite'}, préparé par{' '}
        {manifeste.creePar} le {new Date(manifeste.creeLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
      </h3>
      <table className="tableau">
        <tbody>
          {lignes.map(([texte, n]) => (
            <tr key={texte} className={n ? undefined : 'ligne-ignoree'}>
              <td>{texte}</td>
              <td>
                <strong>{n}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {alertes.length > 0 && (
        <ul className="alertes-import">
          {alertes.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <div className="boutons">
        <button className="principal" onClick={surImporter} disabled={rien}>
          {rien ? 'Rien de nouveau dans ce paquet' : 'Importer et ranger'}
        </button>
        <button onClick={surAnnuler}>Annuler</button>
      </div>
    </div>
  );
}
