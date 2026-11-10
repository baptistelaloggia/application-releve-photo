import { useState } from 'react';
import type { Photo, Repere } from '../../domaine/types';
import type { EspaceProjet } from '../../projet/EspaceProjet';
import { Miniature } from '../photo/Miniature';

/** Photos groupées par jour, du plus récent au plus ancien. */
function parJour(photos: Photo[]): Array<[string, Photo[]]> {
  const groupes = new Map<string, Photo[]>();
  for (const p of photos) groupes.set(p.date, [...(groupes.get(p.date) ?? []), p]);
  return [...groupes.entries()].sort(([a], [b]) => b.localeCompare(a));
}

const dateLongue = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// ------------------------------------------------------------------ onglet « Terrain »

export function PanneauTerrain({
  espace,
  planId,
  occupe,
  surPhotoSansRepere,
  surChoixRepere,
}: {
  espace: EspaceProjet;
  planId: string;
  occupe: boolean;
  surPhotoSansRepere: () => void;
  surChoixRepere: (r: Repere) => void;
}) {
  const reperes = espace.reperesDuPlan(planId);
  const aujourdhui = new Date();
  const jour = `${aujourdhui.getFullYear()}-${String(aujourdhui.getMonth() + 1).padStart(2, '0')}-${String(aujourdhui.getDate()).padStart(2, '0')}`;
  const duJour = espace.photos.filter((p) => p.date === jour && espace.repereDe(p)?.planId === planId).length;
  return (
    <>
      <div className="aide-terrain">
        <div>
          <strong>Appui long</strong> sur le plan : nouveau repère, puis photo.
        </div>
        <div>
          <strong>Appui</strong> sur un repère : photo.
        </div>
      </div>
      <div className="boutons">
        <button className="principal" onClick={surPhotoSansRepere} disabled={occupe}>
          📷 Photo sans repère
        </button>
      </div>
      <h2>
        Repères de ce plan <span className="discret">({reperes.length} · {duJour} photo{duJour > 1 ? 's' : ''} aujourd'hui)</span>
      </h2>
      {reperes.length === 0 ? (
        <p className="discret">Aucun repère pour l'instant.</p>
      ) : (
        <ul className="liste-locaux">
          {reperes.map((r) => {
            const local = r.localId ? espace.locaux.find((l) => l.id === r.localId) : undefined;
            const n = espace.photosDuRepere(r.id).length;
            return (
              <li key={r.id}>
                <button onClick={() => surChoixRepere(r)}>
                  <span className="mono">{r.numero}</span>
                  <span>
                    {local ? `${local.numero ?? ''} ${local.nom}`.trim() : 'Hors local'}
                    {r.libelle && <span className="discret"> · {r.libelle}</span>}
                  </span>
                  <span className="discret">
                    {n} photo{n > 1 ? 's' : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ------------------------------------------------------------------ fiche d'un repère

export function FicheRepere({
  espace,
  repere,
  occupe,
  surPhoto,
  surDeplacer,
  surSupprimer,
  surModifier,
  surOuvrirPhoto,
  surFermer,
  surChoisirLocalSurPlan,
}: {
  espace: EspaceProjet;
  repere: Repere;
  /** Passe en mode « touchez le local sur le plan ». */
  surChoisirLocalSurPlan: () => void;
  occupe: boolean;
  surPhoto: () => void;
  surDeplacer: () => void;
  surSupprimer: () => void;
  surModifier: (maj: { libelle?: string; localId?: string | null }) => void;
  surOuvrirPhoto: (photos: Photo[], index: number) => void;
  surFermer: () => void;
}) {
  const [libelle, setLibelle] = useState(repere.libelle);
  const photos = espace.photosDuRepere(repere.id);
  const locaux = espace.locauxDuPlan(repere.planId);
  const proches = espace.locauxProches(repere.planId, repere.x, repere.y, 3).filter((l) => l.id !== repere.localId);
  const localActuel = repere.localId ? espace.locaux.find((l) => l.id === repere.localId) : undefined;
  return (
    <div className="fiche-local">
      <div className="titre-projet">
        <h2>Repère {repere.numero}</h2>
        <button className="petit" onClick={surFermer}>
          Fermer
        </button>
      </div>
      <div className="boutons">
        <button className="principal" onClick={surPhoto} disabled={occupe}>
          📷 Prendre une photo
        </button>
      </div>
      <div className="rattachement">
        <div>
          Local : <strong>{localActuel ? `${localActuel.numero ?? ''} ${localActuel.nom}`.trim() : 'hors local'}</strong>
        </div>
        {proches.length > 0 && (
          <div className="boutons">
            {proches.map((l) => (
              <button key={l.id} className="petit puce" disabled={occupe} onClick={() => surModifier({ localId: l.id })} title="Rattacher à ce local">
                {l.numero ?? '—'} · {l.nom}
              </button>
            ))}
          </div>
        )}
        <div className="boutons">
          <button className="petit" disabled={occupe} onClick={surChoisirLocalSurPlan}>
            Choisir le local sur le plan
          </button>
        </div>
      </div>
      <label>
        Ou dans la liste
        <select
          value={repere.localId ?? ''}
          disabled={occupe}
          onChange={(e) => surModifier({ localId: e.target.value || null })}
        >
          <option value="">Hors local</option>
          {locaux.map((l) => (
            <option key={l.id} value={l.id}>
              {l.numero ?? '—'} · {l.nom}
            </option>
          ))}
        </select>
      </label>
      <label>
        Libellé (facultatif)
        <input
          value={libelle}
          maxLength={60}
          placeholder="ex. TD étage, CTA 2 face avant…"
          onChange={(e) => setLibelle(e.target.value)}
          onBlur={() => libelle.trim() !== repere.libelle && surModifier({ libelle })}
        />
      </label>
      <h2>
        Photos <span className="discret">({photos.length})</span>
      </h2>
      {photos.length === 0 && <p className="discret">Aucune photo.</p>}
      {parJour(photos).map(([jour, liste]) => (
        <div key={jour} className="groupe-photos">
          <div className="discret">{dateLongue(jour)}</div>
          <div className="grille-photos">
            {liste.map((p) => (
              <button key={p.id} className="vignette" onClick={() => surOuvrirPhoto(photos, photos.indexOf(p))} title={p.commentaire || p.fichier}>
                <Miniature espace={espace} photo={p} />
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="boutons">
        <button className="petit" onClick={surDeplacer} disabled={occupe}>
          Déplacer le repère
        </button>
        <button className="petit discret" onClick={surSupprimer} disabled={occupe || photos.length > 0} title={photos.length ? 'Le repère a des photos' : undefined}>
          Supprimer le repère
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ panier à classer

export function PanneauPanier({
  espace,
  occupe,
  surPhotoSansRepere,
  surImporter,
  surPlacer,
  surOuvrirPhoto,
}: {
  espace: EspaceProjet;
  occupe: boolean;
  surPhotoSansRepere: () => void;
  surImporter: (fichiers: File[]) => void;
  surPlacer: (photos: Photo[]) => void;
  surOuvrirPhoto: (photos: Photo[], index: number) => void;
}) {
  const photos = espace.photosAClasser();
  const [choisies, setChoisies] = useState<Set<string>>(new Set());
  const selection = photos.filter((p) => choisies.has(p.id));
  const basculer = (id: string) =>
    setChoisies((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <>
      <p className="discret">
        Photos prises sans repère, ou importées. Cochez une ou plusieurs photos, puis « Placer » : touchez ensuite
        l'étiquette d'un local, un repère, ou le plan pour créer un repère.
      </p>
      <div className="boutons">
        <button onClick={surPhotoSansRepere} disabled={occupe}>
          📷 Photo sans repère
        </button>
        <label className="bouton-fichier">
          Importer des photos…
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              surImporter([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {photos.length === 0 ? (
        <p className="discret">Le panier est vide.</p>
      ) : (
        <>
          <div className="boutons barre-selection">
            <button className="principal" disabled={occupe || selection.length === 0} onClick={() => surPlacer(selection)}>
              Placer {selection.length > 1 ? `les ${selection.length} photos` : selection.length === 1 ? 'la photo' : ''}
            </button>
            <button
              className="petit"
              onClick={() => setChoisies(selection.length === photos.length ? new Set() : new Set(photos.map((p) => p.id)))}
            >
              {selection.length === photos.length ? 'Tout décocher' : `Tout cocher (${photos.length})`}
            </button>
          </div>
          <ul className="liste-panier">
            {photos.map((p, i) => (
              <li key={p.id} className={choisies.has(p.id) ? 'choisie' : undefined}>
                <input type="checkbox" checked={choisies.has(p.id)} onChange={() => basculer(p.id)} aria-label={`Choisir ${p.nomOrigine ?? 'la photo'}`} />
                <button className="vignette" onClick={() => surOuvrirPhoto(photos, i)}>
                  <Miniature espace={espace} photo={p} taille={72} />
                </button>
                <span className="discret" onClick={() => basculer(p.id)}>
                  {new Date(p.prisLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                  {p.nomOrigine && <div className="petit-texte">{p.nomOrigine}</div>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ photos d'un local (sous sa fiche)

export function PhotosDuLocal({
  espace,
  localId,
  occupe,
  surPhoto,
  surOuvrirPhoto,
}: {
  espace: EspaceProjet;
  localId: string;
  occupe: boolean;
  /** Photo sur l'étiquette du local. */
  surPhoto: () => void;
  surOuvrirPhoto: (photos: Photo[], index: number) => void;
}) {
  const photos = espace.photosDuLocal(localId);
  return (
    <div className="photos-local">
      <div className="boutons">
        <button className="principal" onClick={surPhoto} disabled={occupe}>
          📷 Photo du local
        </button>
      </div>
      <p className="discret petit-texte">Raccourci : appui long sur l'étiquette du local, sur le plan.</p>
      <h2>
        Photos du local <span className="discret">({photos.length})</span>
      </h2>
      {parJour(photos).map(([jour, liste]) => (
        <div key={jour} className="groupe-photos">
          <div className="discret">{dateLongue(jour)}</div>
          <div className="grille-photos">
            {liste.map((p) => (
              <button key={p.id} className="vignette" onClick={() => surOuvrirPhoto(photos, photos.indexOf(p))}>
                <Miniature espace={espace} photo={p} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
