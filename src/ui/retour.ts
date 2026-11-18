/**
 * Bouton « Retour » du téléphone (et du navigateur, de la souris…) : il ferme le dernier écran ou
 * la dernière sélection ouverts, au lieu de quitter l'application (18/11/2026).
 *
 * Chaque « calque » ouvert (projet, plan, local ou repère sélectionné, appareil photo, visionneuse,
 * éditeur d'annotations…) ajoute une entrée dans l'historique du navigateur. Le retour retire
 * cette entrée et ferme le calque du dessus. Un calque fermé par un bouton de l'appli retire son
 * entrée lui-même (history.go), sans rien fermer d'autre.
 */
import { useEffect, useRef } from 'react';

/**
 * Niveau d'empilement : un calque de niveau plus élevé est toujours fermé avant les autres, même
 * s'il a été ouvert dans le même instant (React inscrit les enfants avant leurs parents).
 * 0 écran (projet…), 1 plan, 2 sélection ou mode du plan, 3 appareil photo ou visionneuse,
 * 4 éditeur d'annotations.
 */
export type NiveauCalque = 0 | 1 | 2 | 3 | 4;

interface Calque {
  niveau: NiveauCalque;
  /** Ferme le calque ; false : la fermeture est refusée (modifications à garder), le calque reste. */
  fermer: () => boolean | void;
}

const pile: Calque[] = [];

/** Touche Échap (PC) : même effet que le bouton Retour, sauf pendant une saisie. */
function surClavier(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !pile.length || e.defaultPrevented) return;
  if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
  history.back();
}
/** Retours provoqués par l'appli elle-même (calques fermés par un bouton) : à ignorer. */
let aIgnorer = 0;
let ecoute = false;
/** Entrées d'historique à retirer, regroupées en un seul history.go(-n) (plusieurs calques fermés d'un coup). */
let aRetirer = 0;

function retirerEntree() {
  if (aRetirer++ > 0) return;
  queueMicrotask(() => {
    const n = aRetirer;
    aRetirer = 0;
    aIgnorer++; // un seul « popstate » pour history.go(-n)
    history.go(-n);
  });
}

function surRetour() {
  if (aIgnorer > 0) {
    aIgnorer--;
    return;
  }
  const haut = pile.pop();
  if (!haut) return;
  if (haut.fermer() === false) {
    // Fermeture refusée : le calque reste ouvert, avec une nouvelle entrée d'historique.
    empiler(haut);
    history.pushState({ calque: true }, '');
  }
}

function empiler(c: Calque) {
  const i = pile.findIndex((x) => x.niveau > c.niveau);
  if (i < 0) pile.push(c);
  else pile.splice(i, 0, c);
}

/**
 * Tant que `actif` est vrai, le bouton Retour appelle `fermer` (si ce calque est le dernier ouvert).
 * `fermer` peut renvoyer false pour refuser (par exemple après confirmation refusée).
 */
export function useRetour(actif: boolean, fermer: () => boolean | void, niveau: NiveauCalque): void {
  const rappel = useRef(fermer);
  rappel.current = fermer;
  useEffect(() => {
    if (!actif) return;
    if (!ecoute) {
      window.addEventListener('popstate', surRetour);
      window.addEventListener('keydown', surClavier);
      ecoute = true;
    }
    const calque: Calque = { niveau, fermer: () => rappel.current() };
    empiler(calque);
    history.pushState({ calque: true }, '');
    return () => {
      // Fermé par l'appli (pas par le bouton Retour) : son entrée d'historique est retirée.
      const i = pile.indexOf(calque);
      if (i >= 0) {
        pile.splice(i, 1);
        retirerEntree();
      }
    };
  }, [actif, niveau]);
}
