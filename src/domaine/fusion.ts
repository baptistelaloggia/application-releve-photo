/**
 * Fusion des données de deux exemplaires d'un même projet (lot 4, synchronisation par .zip).
 *
 * « cible » : le projet de l'appareil qui importe (le serveur, ou le téléphone).
 * « paquet » : les données reçues de l'autre appareil.
 *
 * Règles (CONCEPTION §A.6 quinquies) :
 * - niveaux et plans : ceux de la cible sont conservés ; ceux qui manquent sont ajoutés.
 *   Un niveau de même code, ou le plan d'un niveau existant, est reconnu comme le même ;
 * - locaux et repères : la modification la plus récente l'emporte (modifieLe) ;
 * - un local inconnu mais de même numéro, au même endroit, est reconnu comme le même ;
 *   un numéro de local ou de repère déjà pris ailleurs est renuméroté (et signalé) ;
 * - photos : jamais écrasées ni supprimées. Une photo inconnue est ajoutée, sauf si une photo
 *   identique (même empreinte) existe déjà. Une photo connue reçoit son classement et son
 *   commentaire s'ils sont plus récents ;
 * - les suppressions ne sont pas transmises (limite connue, voir CONCEPTION).
 */
import { proposerNumeroLocal } from './locaux';
import { numeroRepere } from './nommage';
import type { Local, Niveau, Photo, Plan, Repere } from './types';

export interface DonneesProjet {
  niveaux: Niveau[];
  plans: Plan[];
  locaux: Local[];
  reperes: Repere[];
  photos: Photo[];
}

export interface ResultatFusion {
  /** Niveaux nouveaux, à ajouter en haut de la liste (l'utilisateur peut les déplacer). */
  niveaux: Niveau[];
  /** Plans nouveaux ; leur PDF est à copier depuis le paquet (même identifiant). */
  plans: Plan[];
  /** Locaux nouveaux ou modifiés, à écrire. */
  locaux: Local[];
  /** Repères nouveaux ou modifiés, à écrire. */
  reperes: Repere[];
  /** Photos nouvelles : leur JPEG et leur miniature sont dans le paquet (même identifiant). */
  photosNouvelles: Photo[];
  /** Photos déjà connues dont le classement ou le commentaire a changé. */
  photosModifiees: Photo[];
  compteRendu: string[];
}

/** Date de dernière modification d'une photo (classement, commentaire), à défaut sa prise de vue. */
export const dateModifPhoto = (p: Photo) => p.modifieLe ?? p.prisLe;

const DISTANCE_MEME_LOCAL = 0.03;

export function fusionner(cible: DonneesProjet, paquet: DonneesProjet): ResultatFusion {
  const r: ResultatFusion = { niveaux: [], plans: [], locaux: [], reperes: [], photosNouvelles: [], photosModifiees: [], compteRendu: [] };
  const cr = r.compteRendu;

  // ------------------------------------------------------------ niveaux
  const niveaux = [...cible.niveaux];
  const idNiveau = new Map<string, string>();
  for (const n of paquet.niveaux) {
    const meme = niveaux.find((x) => x.id === n.id) ?? niveaux.find((x) => x.code === n.code);
    if (meme) {
      idNiveau.set(n.id, meme.id);
      continue;
    }
    const nouveau = { ...n, ordre: Math.max(0, ...niveaux.map((x) => x.ordre ?? 0)) + 10 };
    niveaux.push(nouveau);
    r.niveaux.push(nouveau);
    idNiveau.set(n.id, n.id);
    cr.push(`Niveau ajouté : ${n.code}`);
  }

  // ------------------------------------------------------------ plans
  const plans = [...cible.plans];
  const idPlan = new Map<string, string>();
  for (const p of paquet.plans) {
    const niveauId = idNiveau.get(p.niveauId) ?? p.niveauId;
    const meme = plans.find((x) => x.id === p.id) ?? plans.find((x) => x.niveauId === niveauId);
    const code = niveaux.find((n) => n.id === niveauId)?.code ?? '?';
    if (meme) {
      idPlan.set(p.id, meme.id);
      if (meme.empreinte !== p.empreinte) {
        cr.push(`Attention : plan ${code} différent sur l'autre appareil (indice ${p.indice}) ; celui-ci est conservé (indice ${meme.indice}).`);
      }
      continue;
    }
    const nouveau = { ...p, niveauId };
    plans.push(nouveau);
    r.plans.push(nouveau);
    idPlan.set(p.id, p.id);
    cr.push(`Plan ajouté : ${code} (indice ${p.indice})`);
  }

  // ------------------------------------------------------------ locaux
  const locaux = [...cible.locaux];
  const idLocal = new Map<string, string>();
  const ecrireLocal = (l: Local) => {
    const i = locaux.findIndex((x) => x.id === l.id);
    if (i >= 0) locaux[i] = l;
    else locaux.push(l);
    r.locaux = [...r.locaux.filter((x) => x.id !== l.id), l];
  };
  const codeDuPlan = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    return niveaux.find((n) => n.id === plan?.niveauId)?.code ?? '?';
  };
  const numeroPris = (numero: string | null, sauf: string) => !!numero && locaux.some((x) => x.numero === numero && x.id !== sauf);
  for (const brut of paquet.locaux) {
    const l: Local = { ...brut, planId: idPlan.get(brut.planId) ?? brut.planId };
    let meme = locaux.find((x) => x.id === l.id);
    if (!meme && l.numero) {
      meme = locaux.find((x) => x.numero === l.numero && x.planId === l.planId && Math.hypot(x.x - l.x, x.y - l.y) < DISTANCE_MEME_LOCAL);
    }
    if (!meme) {
      meme = locaux.find(
        (x) => x.planId === l.planId && x.nom.toUpperCase() === l.nom.toUpperCase() && Math.hypot(x.x - l.x, x.y - l.y) < 0.01,
      );
    }
    if (meme) {
      idLocal.set(brut.id, meme.id);
      if (l.modifieLe > meme.modifieLe) {
        const maj: Local = { ...l, id: meme.id };
        if (numeroPris(maj.numero, meme.id)) {
          cr.push(`Attention : numéro ${maj.numero} déjà pris ; le local ${meme.nom} garde son numéro ${meme.numero ?? '(aucun)'}.`);
          maj.numero = meme.numero;
        }
        if (JSON.stringify({ ...maj, modifieLe: '', modifiePar: '' }) !== JSON.stringify({ ...meme, modifieLe: '', modifiePar: '' })) {
          ecrireLocal(maj);
          cr.push(`Local mis à jour (modification plus récente) : ${maj.numero ?? ''} ${maj.nom}`.replace('  ', ' '));
        }
      }
      continue;
    }
    if (numeroPris(l.numero, l.id)) {
      const ancien = l.numero;
      l.numero = proposerNumeroLocal(codeDuPlan(l.planId), locaux.flatMap((x) => (x.numero ? [x.numero] : [])));
      cr.push(`Attention : numéro ${ancien} déjà pris par un autre local ; « ${l.nom} » renuméroté ${l.numero}.`);
    }
    ecrireLocal(l);
    idLocal.set(brut.id, l.id);
    cr.push(`Local ajouté : ${l.numero ?? ''} ${l.nom}`.replace('  ', ' '));
  }

  // ------------------------------------------------------------ repères
  const reperes = [...cible.reperes];
  const idRepere = new Map<string, string>();
  const ecrireRepere = (x: Repere) => {
    const i = reperes.findIndex((y) => y.id === x.id);
    if (i >= 0) reperes[i] = x;
    else reperes.push(x);
    r.reperes = [...r.reperes.filter((y) => y.id !== x.id), x];
  };
  for (const brut of paquet.reperes) {
    const rep: Repere = {
      ...brut,
      planId: idPlan.get(brut.planId) ?? brut.planId,
      localId: brut.localId ? (idLocal.get(brut.localId) ?? (locaux.some((l) => l.id === brut.localId) ? brut.localId : null)) : null,
    };
    // Repère d'étiquette : un seul par local.
    const meme =
      reperes.find((x) => x.id === rep.id) ??
      (rep.surEtiquette ? reperes.find((x) => x.surEtiquette && x.localId === rep.localId && rep.localId) : undefined);
    if (meme) {
      idRepere.set(brut.id, meme.id);
      if (rep.modifieLe > meme.modifieLe) {
        ecrireRepere({ ...rep, id: meme.id, numero: meme.numero });
        cr.push(`Repère mis à jour (modification plus récente) : ${meme.numero}`);
      }
      continue;
    }
    if (reperes.some((x) => x.numero === rep.numero)) {
      const ancien = rep.numero;
      let rang = reperes.length + 1;
      while (reperes.some((x) => x.numero === numeroRepere(rang))) rang++;
      rep.numero = numeroRepere(rang);
      cr.push(`Repère ${ancien} de l'autre appareil renuméroté ${rep.numero} (numéro déjà pris).`);
    }
    ecrireRepere(rep);
    idRepere.set(brut.id, rep.id);
    cr.push(`Repère ajouté : ${rep.numero}`);
  }

  // ------------------------------------------------------------ photos
  const empreintes = new Set(cible.photos.map((p) => p.empreinte));
  let doublons = 0;
  for (const brut of [...paquet.photos].sort((a, b) => a.prisLe.localeCompare(b.prisLe))) {
    const p: Photo = { ...brut, repereId: brut.repereId ? (idRepere.get(brut.repereId) ?? null) : null };
    const meme = cible.photos.find((x) => x.id === p.id);
    if (meme) {
      if (dateModifPhoto(p) > dateModifPhoto(meme) && (p.repereId !== meme.repereId || p.commentaire !== meme.commentaire)) {
        r.photosModifiees.push({ ...meme, repereId: p.repereId, commentaire: p.commentaire, modifieLe: p.modifieLe });
      }
      continue;
    }
    if (empreintes.has(p.empreinte)) {
      doublons++;
      continue;
    }
    empreintes.add(p.empreinte);
    r.photosNouvelles.push(p);
  }
  if (doublons) cr.push(`${doublons} photo${doublons > 1 ? 's' : ''} déjà présente${doublons > 1 ? 's' : ''} (même contenu), ignorée${doublons > 1 ? 's' : ''}.`);
  if (r.photosModifiees.length) cr.push(`${r.photosModifiees.length} photo(s) reclassée(s) ou commentée(s) sur l'autre appareil.`);
  return r;
}
