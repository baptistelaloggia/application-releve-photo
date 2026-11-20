import { useEffect, useState } from 'react';
import { CATALOGUE_TAGS, cleTag, nettoyerTag, puces, rechercherTags, tousLesTags } from '../../domaine/tags';
import { ajouterTagPerso, basculerTagFavori, lireMemoireTags, noterTagsUtilises, type MemoireTags } from '../../stockage/registre';
import { useRetour } from '../retour';

interface Props {
  /** Tags choisis. */
  selection: string[];
  surChange: (tags: string[]) => void;
  /** Variante sombre, pour la visée. */
  sombre?: boolean;
}

const contient = (liste: string[], t: string) => liste.some((x) => cleTag(x) === cleTag(t));

/**
 * Barre de tags (20/11/2026) : les 6 puces des tags favoris ou les plus récents, un appui pour
 * cocher ou décocher. La liste complète (« ＋ Tous ») ne sert qu'en dernier recours, avec une
 * recherche par les premières lettres et la création d'un tag personnel.
 */
export function BarreTags({ selection, surChange, sombre }: Props) {
  const [memoire, setMemoire] = useState<MemoireTags>({ favoris: [], recents: [], perso: [] });
  const [liste, setListe] = useState(false);
  useEffect(() => {
    void lireMemoireTags().then(setMemoire);
  }, []);

  function basculer(tag: string) {
    if (contient(selection, tag)) surChange(selection.filter((t) => cleTag(t) !== cleTag(tag)));
    else {
      surChange([...selection, tag]);
      void noterTagsUtilises([tag]).then(setMemoire);
    }
  }

  const affichees = puces(memoire.favoris, memoire.recents);
  // Les tags choisis hors des puces restent visibles (et décochables).
  const autres = selection.filter((t) => !contient(affichees, t));

  return (
    <div className={`barre-tags${sombre ? ' sombre' : ''}`} role="group" aria-label="Tags">
      {[...affichees, ...autres].map((t) => (
        <button key={t} className={`puce-tag${contient(selection, t) ? ' active' : ''}`} aria-pressed={contient(selection, t)} onClick={() => basculer(t)}>
          {memoire.favoris.includes(t) ? '★ ' : ''}
          {t}
        </button>
      ))}
      <button className="puce-tag tous" onClick={() => setListe(true)} aria-label="Tous les tags">
        ＋ Tous
      </button>
      {liste && (
        <ListeTags
          memoire={memoire}
          selection={selection}
          surBasculer={basculer}
          surMemoire={setMemoire}
          surFermer={() => setListe(false)}
        />
      )}
    </div>
  );
}

/** Liste complète des tags : recherche par les premières lettres, favoris (★), création d'un tag. */
function ListeTags({
  memoire,
  selection,
  surBasculer,
  surMemoire,
  surFermer,
}: {
  memoire: MemoireTags;
  selection: string[];
  surBasculer: (tag: string) => void;
  surMemoire: (m: MemoireTags) => void;
  surFermer: () => void;
}) {
  const [requete, setRequete] = useState('');
  useRetour(true, surFermer, 4);
  const tous = tousLesTags(memoire.perso);
  const trouves = rechercherTags(tous, requete);
  const nouveau = nettoyerTag(requete);
  const groupes = requete.trim()
    ? [{ nom: `${trouves.length} tag${trouves.length > 1 ? 's' : ''}`, tags: trouves }]
    : [
        ...(memoire.perso.length ? [{ nom: 'Mes tags', tags: memoire.perso }] : []),
        ...CATALOGUE_TAGS,
      ];

  const ligne = (t: string) => (
    <li key={t}>
      <button className={`ligne-tag${contient(selection, t) ? ' active' : ''}`} aria-pressed={contient(selection, t)} onClick={() => surBasculer(t)}>
        {contient(selection, t) ? '☑' : '☐'} {t}
      </button>
      <button
        className="favori-tag"
        aria-label={memoire.favoris.includes(t) ? `Retirer ${t} des favoris` : `Mettre ${t} en favori`}
        aria-pressed={memoire.favoris.includes(t)}
        onClick={() => void basculerTagFavori(t).then(surMemoire)}
      >
        {memoire.favoris.includes(t) ? '★' : '☆'}
      </button>
    </li>
  );

  return (
    <div className="liste-tags" role="dialog" aria-label="Tous les tags">
      <div className="liste-tags-haut">
        <input
          autoFocus
          type="search"
          value={requete}
          placeholder="Premières lettres : cal, cta, non c…"
          aria-label="Rechercher un tag"
          onChange={(e) => setRequete(e.target.value)}
        />
        <button className="principal" onClick={surFermer}>
          OK
        </button>
      </div>
      <div className="liste-tags-corps">
        {groupes.map((g) => (
          <section key={g.nom}>
            <h3>{g.nom}</h3>
            <ul>{g.tags.map(ligne)}</ul>
          </section>
        ))}
        {nouveau && !tous.some((t) => cleTag(t) === cleTag(nouveau)) && (
          <button
            className="creer-tag"
            onClick={() =>
              void ajouterTagPerso(nouveau).then((m) => {
                surMemoire(m);
                surBasculer(nouveau);
                setRequete('');
              })
            }
          >
            ＋ Créer le tag « {nouveau} »
          </button>
        )}
      </div>
    </div>
  );
}
