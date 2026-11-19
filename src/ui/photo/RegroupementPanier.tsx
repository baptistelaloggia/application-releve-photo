/**
 * Panier à classer, vue « Par groupes » (CONCEPTION §A.6 nonies, 19/11/2026).
 *
 * Les photos du panier (prises hors de l'appli, puis importées) sont regroupées par lieu probable,
 * d'après leur heure, leur ressemblance (reconnaissance sur l'appareil) et leur position GPS.
 * L'utilisateur vérifie chaque groupe, décoche les intruses, puis le rattache d'un coup à un local
 * (recherche par nom, tous niveaux) ou à un point du plan.
 */
import { useEffect, useMemo, useState } from 'react';
import { regrouperPhotos, REGLAGES_REGROUPEMENT, SEUIL_MAX, SEUIL_MIN, type PhotoARegrouper } from '../../domaine/regroupement';
import type { Photo } from '../../domaine/types';
import { indicesExif, vecteurImage, type IndicesExif } from '../../photo/reconnaissance';
import type { EspaceProjet, ResultatLocal } from '../../projet/EspaceProjet';
import { BarreRecherche } from '../BarreRecherche';
import { useRetour } from '../retour';
import { Miniature } from './Miniature';

interface Analyse {
  vecteurs: Map<string, Float32Array>;
  exif: Map<string, IndicesExif>;
  faites: number;
  /** Message si la reconnaissance visuelle n'a pas pu être chargée (regroupement sur l'heure seule). */
  sansReconnaissance: string | null;
}

const CLE_SEUIL = 'regroupement-seuil';

function seuilMemorise(): number {
  try {
    const v = Number(localStorage.getItem(CLE_SEUIL));
    if (v >= SEUIL_MIN && v <= SEUIL_MAX) return v;
  } catch {
    // stockage du navigateur indisponible : réglage par défaut
  }
  return REGLAGES_REGROUPEMENT.seuil;
}

function heure(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function RegroupementPanier({
  espace,
  photos,
  occupe,
  surPlacer,
  surVersLocal,
  surOuvrirPhoto,
}: {
  espace: EspaceProjet;
  photos: Photo[];
  occupe: boolean;
  surPlacer: (photos: Photo[]) => void;
  surVersLocal: (photos: Photo[], local: ResultatLocal) => void;
  surOuvrirPhoto: (photos: Photo[], index: number) => void;
}) {
  const [analyse, setAnalyse] = useState<Analyse>({ vecteurs: new Map(), exif: new Map(), faites: 0, sansReconnaissance: null });
  const [seuil, setSeuil] = useState(seuilMemorise);
  const [exclues, setExclues] = useState<Set<string>>(new Set());
  const [rechercheOuverte, setRechercheOuverte] = useState<number | null>(null);
  useRetour(rechercheOuverte !== null, () => setRechercheOuverte(null), 2);

  // Analyse des photos (vecteur visuel et GPS), une par une, avec avancement à l'écran.
  const cleAnalyse = photos.map((p) => p.id).join(',');
  useEffect(() => {
    let annule = false;
    void (async () => {
      const vecteurs = new Map<string, Float32Array>();
      const exif = new Map<string, IndicesExif>();
      let sansReconnaissance: string | null = null;
      let faites = 0;
      for (const p of photos) {
        if (annule) return;
        if (!sansReconnaissance) {
          try {
            vecteurs.set(p.id, await vecteurImage(await espace.lireMiniature(p), p.empreinte));
          } catch (e) {
            sansReconnaissance = navigator.onLine
              ? `Reconnaissance visuelle indisponible (${e instanceof Error ? e.message : String(e)}).`
              : 'Reconnaissance visuelle indisponible : elle se télécharge à la première utilisation, avec du réseau.';
          }
        }
        if (p.type !== 'video') {
          try {
            exif.set(p.id, await indicesExif(await espace.lirePhoto(p), p.empreinte));
          } catch {
            // fichier illisible : la photo est regroupée sans GPS
          }
        }
        faites++;
        if (!annule && (faites % 8 === 0 || faites === photos.length)) {
          setAnalyse({ vecteurs: new Map(vecteurs), exif: new Map(exif), faites, sansReconnaissance });
        }
      }
      if (!annule) setAnalyse({ vecteurs, exif, faites, sansReconnaissance });
    })();
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espace, cleAnalyse]);

  const termine = analyse.faites >= photos.length;
  /** Heure fiable : photo de l'appli, ou date de prise de vue présente dans l'EXIF. */
  const heureSure = (p: Photo) => p.source === 'appli' || !!analyse.exif.get(p.id)?.dateExif;
  const groupes = useMemo(() => {
    if (!termine) return [];
    const parId = new Map(photos.map((p) => [p.id, p]));
    const elements: PhotoARegrouper[] = photos.map((p) => ({
      id: p.id,
      instant: heureSure(p) ? new Date(p.prisLe).getTime() : null,
      // Sans reconnaissance pour une seule photo, toutes passent à l'heure seule (échelles comparables).
      vecteur: analyse.sansReconnaissance ? null : (analyse.vecteurs.get(p.id) ?? null),
      gps: analyse.exif.get(p.id)?.gps ?? null,
    }));
    return regrouperPhotos(elements, { seuil }).map((ids) => ids.map((id) => parId.get(id)!));
  }, [termine, photos, analyse, seuil]);

  if (!termine) {
    return (
      <div className="regroupement-analyse">
        <p className="discret">
          Analyse des photos : {analyse.faites} / {photos.length}…
          {analyse.faites === 0 && ' (la première fois, la reconnaissance visuelle se télécharge : 26 Mo)'}
        </p>
        <progress max={photos.length} value={analyse.faites} />
      </div>
    );
  }

  return (
    <div className="regroupement">
      {analyse.sansReconnaissance && <p className="message message-info">{analyse.sansReconnaissance} Regroupement sur l'heure et le GPS seuls.</p>}
      <div className="regroupement-seuil">
        <span className="discret petit-texte">Groupes plus larges</span>
        <input
          type="range"
          min={SEUIL_MIN}
          max={SEUIL_MAX}
          step={0.05}
          value={seuil}
          aria-label="Finesse des groupes"
          onChange={(e) => {
            const v = Number(e.target.value);
            setSeuil(v);
            try {
              localStorage.setItem(CLE_SEUIL, String(v));
            } catch {
              // sans stockage : le réglage vaut pour la session
            }
          }}
        />
        <span className="discret petit-texte">plus fins</span>
      </div>
      <p className="discret petit-texte">
        {groupes.length} groupe{groupes.length > 1 ? 's' : ''} pour {photos.length} photo{photos.length > 1 ? 's' : ''}. Décochez
        les photos qui ne vont pas avec leur groupe : elles restent dans le panier.
      </p>
      {groupes.map((groupe, g) => {
        const retenues = groupe.filter((p) => !exclues.has(p.id));
        const avecGps = groupe.some((p) => analyse.exif.get(p.id)?.gps);
        const sure = groupe.filter(heureSure);
        const debut = sure[0] as Photo | undefined;
        const fin = sure[sure.length - 1] as Photo | undefined;
        return (
          <section key={groupe[0].id} className="groupe-regroupement" aria-label={`Groupe ${g + 1}`}>
            <div className="groupe-entete">
              <strong>Groupe {g + 1}</strong>
              <span className="discret petit-texte">
                {groupe.length} photo{groupe.length > 1 ? 's' : ''} ·{' '}
                {debut && fin
                  ? `${new Date(debut.prisLe).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${heure(debut.prisLe)}${
                      heure(fin.prisLe) !== heure(debut.prisLe) ? `–${heure(fin.prisLe)}` : ''
                    }`
                  : 'heure de prise de vue inconnue'}
                {avecGps ? ' · GPS' : ''}
              </span>
            </div>
            <div className="grille-groupe">
              {groupe.map((p) => {
                const exclue = exclues.has(p.id);
                return (
                  <span key={p.id} className={`case-groupe${exclue ? ' exclue' : ''}`}>
                    <button type="button" className="vignette" onClick={() => surOuvrirPhoto(groupe, groupe.indexOf(p))}>
                      <Miniature espace={espace} photo={p} taille={88} />
                    </button>
                    <input
                      type="checkbox"
                      checked={!exclue}
                      aria-label={`Garder ${p.nomOrigine ?? 'la photo'} dans le groupe ${g + 1}`}
                      onChange={() =>
                        setExclues((x) => {
                          const n = new Set(x);
                          if (exclue) n.delete(p.id);
                          else n.add(p.id);
                          return n;
                        })
                      }
                    />
                  </span>
                );
              })}
            </div>
            <div className="boutons">
              <button
                type="button"
                className="principal"
                disabled={occupe || retenues.length === 0}
                onClick={() => setRechercheOuverte(rechercheOuverte === g ? null : g)}
              >
                Vers un local…
              </button>
              <button type="button" disabled={occupe || retenues.length === 0} onClick={() => surPlacer(retenues)}>
                Placer sur le plan
              </button>
            </div>
            {rechercheOuverte === g && (
              <BarreRecherche
                espace={espace}
                autoFocus
                surChoix={(r) => {
                  setRechercheOuverte(null);
                  surVersLocal(retenues, r);
                }}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
