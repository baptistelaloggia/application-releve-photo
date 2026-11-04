import { useState } from 'react';
import { devinerNiveau, devinerNiveauPage, normaliserCodeNiveau } from '../domaine/niveaux';
import { devinerIndice, normaliserIndice } from '../domaine/nommage';
import { calculerEmpreinte, type EspaceProjet } from '../projet/EspaceProjet';
import { extrairePage, lireInfosPdf } from '../pdf/pdf';
import { tailleLisible } from './commun';

/** Un fichier PDF choisi par l'utilisateur. */
interface Source {
  cle: string;
  fichier: File;
  etat: 'lecture' | 'pret' | 'erreur';
  pages: number;
  empreinte: string;
  sansTexte: boolean;
}

/**
 * Une ligne du tableau d'import : un fichier d'une page, ou une page d'un carnet
 * de plans multi-pages (qui sera extraite dans son propre fichier).
 */
interface Ligne {
  cle: string;
  source: string;
  /** Numéro de page pour un carnet multi-pages ; null pour un PDF d'une seule page. */
  page: number | null;
  retenue: boolean;
  niveau: string;
  indice: string;
}

interface Props {
  espace: EspaceProjet;
  auteur: string;
  occupe: boolean;
  executer: (action: () => Promise<string[] | void>) => Promise<void>;
}

export function ImportPlans({ espace, auteur, occupe, executer }: Props) {
  const [sources, setSources] = useState<Source[]>([]);
  const [lignes, setLignes] = useState<Ligne[]>([]);

  async function ajouterFichiers(fichiers: FileList | null) {
    if (!fichiers) return;
    for (const fichier of [...fichiers]) {
      const cle = crypto.randomUUID();
      const source: Source = { cle, fichier, etat: 'lecture', pages: 0, empreinte: '', sansTexte: false };
      setSources((s) => [...s, source]);
      try {
        const [infos, empreinte] = await Promise.all([lireInfosPdf(fichier), calculerEmpreinte(fichier)]);
        const indice = devinerIndice(fichier.name) ?? 'A';
        const nouvelles: Ligne[] =
          infos.pages === 1
            ? [
                {
                  cle: crypto.randomUUID(),
                  source: cle,
                  page: null,
                  retenue: true,
                  niveau: devinerNiveau(fichier.name) ?? devinerNiveauPage(infos.textes[0]) ?? '',
                  indice,
                },
              ]
            : infos.textes.map((texte, i) => {
                const niveau = devinerNiveauPage(texte);
                return { cle: crypto.randomUUID(), source: cle, page: i + 1, retenue: niveau !== null, niveau: niveau ?? '', indice };
              });
        const sansTexte = infos.textes.every((t) => t.trim() === '');
        setSources((s) => s.map((x) => (x.cle === cle ? { ...x, etat: 'pret', pages: infos.pages, empreinte, sansTexte } : x)));
        setLignes((l) => [...l, ...nouvelles]);
      } catch {
        setSources((s) => s.map((x) => (x.cle === cle ? { ...x, etat: 'erreur' } : x)));
      }
    }
  }

  const modifier = (cle: string, maj: Partial<Ligne>) =>
    setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, ...maj } : x)));

  /** Un carnet de plans a un seul indice : on l'applique à toutes ses pages. */
  const modifierIndice = (ligne: Ligne, indice: string) =>
    setLignes((l) => l.map((x) => (x.source === ligne.source ? { ...x, indice } : x)));

  const retirerSource = (cle: string) => {
    setSources((s) => s.filter((x) => x.cle !== cle));
    setLignes((l) => l.filter((x) => x.source !== cle));
  };

  // Contrôle de chaque ligne retenue, y compris deux plans pour un même niveau.
  const comptes = new Map<string, number>();
  for (const l of lignes) {
    if (!l.retenue) continue;
    const c = normaliserCodeNiveau(l.niveau);
    comptes.set(c, (comptes.get(c) ?? 0) + 1);
  }
  const sourceDe = (l: Ligne) => sources.find((s) => s.cle === l.source)!;
  const empreinteDe = (l: Ligne) => (l.page === null ? sourceDe(l).empreinte : `${sourceDe(l).empreinte}#p${l.page}`);
  const controles = lignes.map((l) => {
    if (!l.retenue) return { ...l, erreur: null, prevision: null };
    if (!l.niveau.trim()) return { ...l, erreur: 'Indiquez le niveau.', prevision: null };
    if ((comptes.get(normaliserCodeNiveau(l.niveau)) ?? 0) > 1) {
      return { ...l, erreur: 'Deux plans pour le même niveau : un seul plan par niveau.', prevision: null };
    }
    const prevision = espace.prevoirImport(l.niveau, l.indice, empreinteDe(l));
    return { ...l, erreur: prevision.erreur, prevision };
  });
  const aImporter = controles.filter((c) => c.retenue);
  const toutValide = aImporter.length > 0 && aImporter.every((c) => !c.erreur);

  const importer = () =>
    executer(async () => {
      const compteRendu: string[] = [];
      for (const c of aImporter) {
        const source = sourceDe(c);
        const fichier = c.page === null ? source.fichier : await extrairePage(source.fichier, c.page);
        compteRendu.push(
          ...(await espace.importerPlan(
            {
              fichier,
              nomOrigine: source.fichier.name,
              pageOrigine: c.page ?? undefined,
              empreinte: empreinteDe(c),
              codeNiveau: c.niveau,
              indice: c.indice,
              pages: c.page === null ? source.pages : 1,
            },
            auteur,
          )),
        );
        setLignes((l) => l.filter((x) => x.cle !== c.cle));
      }
      setSources([]);
      setLignes([]);
      return compteRendu.reverse();
    });

  return (
    <section className="carte">
      <h2>Importer des plans PDF</h2>
      <p className="discret">
        Chaque plan est copié dans 00_PLANS sous le nom « {espace.projet.codeAffaire}_Niveau.pdf ». Un carnet de plans
        (un PDF avec un niveau par page) est découpé : chaque page retenue devient le plan de son niveau. Si le niveau a
        déjà un plan, l'ancien indice est déplacé dans 00_PLANS/_ANCIENS. Le fichier d'origine n'est pas modifié.
      </p>
      <label className="bouton-fichier">
        Choisir des fichiers PDF…
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(e) => {
            void ajouterFichiers(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {sources.map((s) => (
        <div key={s.cle} className="source-pdf">
          <div className="titre-projet">
            <div>
              <strong>{s.fichier.name}</strong>
              <div className="discret">
                {tailleLisible(s.fichier.size)}
                {s.etat === 'pret' && ` · ${s.pages} page${s.pages > 1 ? 's' : ''}`}
                {s.etat === 'lecture' && ' · lecture en cours…'}
              </div>
              {s.etat === 'erreur' && <div className="texte-erreur">Ce fichier n'est pas un PDF lisible.</div>}
              {s.sansTexte && (
                <div className="discret">
                  Aucun texte lisible (PDF scanné ?) : le niveau de chaque page est à indiquer à la main.
                </div>
              )}
            </div>
            <button className="petit discret" onClick={() => retirerSource(s.cle)}>
              Retirer
            </button>
          </div>
        </div>
      ))}

      {lignes.length > 0 && (
        <>
          <datalist id="codes-niveaux">
            {espace.niveaux.map((n) => (
              <option key={n.id} value={n.code} />
            ))}
          </datalist>
          <div className="defilement">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Importer</th>
                  <th>Origine</th>
                  <th>Niveau</th>
                  <th>Indice</th>
                  <th>Résultat</th>
                </tr>
              </thead>
              <tbody>
                {controles.map((c) => (
                  <tr key={c.cle} className={c.erreur ? 'ligne-erreur' : !c.retenue ? 'ligne-ignoree' : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={c.retenue}
                        aria-label={`Importer ${c.page === null ? sourceDe(c).fichier.name : `la page ${c.page}`}`}
                        onChange={(e) => modifier(c.cle, { retenue: e.target.checked })}
                      />
                    </td>
                    <td>
                      {c.page === null ? sourceDe(c).fichier.name : `Page ${c.page}`}
                      {c.page !== null && <div className="discret">{sourceDe(c).fichier.name}</div>}
                    </td>
                    <td>
                      <input
                        className="court"
                        list="codes-niveaux"
                        value={c.niveau}
                        aria-label={`Niveau ${c.page === null ? '' : `page ${c.page}`}`.trim()}
                        onChange={(e) => modifier(c.cle, { niveau: e.target.value, retenue: true })}
                        onBlur={(e) => modifier(c.cle, { niveau: normaliserCodeNiveau(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        className="court"
                        value={c.indice}
                        aria-label="Indice"
                        maxLength={4}
                        onChange={(e) => modifierIndice(c, normaliserIndice(e.target.value))}
                      />
                    </td>
                    <td>
                      {!c.retenue ? (
                        <span className="discret">ignorée</span>
                      ) : c.erreur ? (
                        <span className="texte-erreur">{c.erreur}</span>
                      ) : (
                        <>
                          <span className="mono">{c.prevision!.nomFinal}</span>
                          {c.prevision!.nouveauNiveau && <div className="discret">nouveau niveau, créé à l'import</div>}
                          {c.prevision!.remplace && (
                            <div className="discret">remplace l'indice {c.prevision!.remplace} (archivé)</div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="boutons">
            <button className="principal" disabled={!toutValide || occupe} onClick={importer}>
              Importer {aImporter.length} plan{aImporter.length > 1 ? 's' : ''}
            </button>
            <button
              onClick={() => {
                setSources([]);
                setLignes([]);
              }}
            >
              Tout retirer
            </button>
          </div>
          {!toutValide && aImporter.length > 0 && (
            <p className="discret">Corrigez les lignes en rouge, ou décochez-les, pour pouvoir importer.</p>
          )}
        </>
      )}
    </section>
  );
}
