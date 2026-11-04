import { registerSW } from 'virtual:pwa-register';

/**
 * Service Worker : met l'application en cache pour qu'elle fonctionne hors ligne.
 * Quand une nouvelle version est publiée, on prévient l'utilisateur au lieu de
 * recharger sans prévenir (une visite peut être en cours).
 */
export function activerHorsLigne(surNouvelleVersion: (installer: () => void) => void) {
  const mettreAJour = registerSW({
    onNeedRefresh() {
      surNouvelleVersion(() => void mettreAJour(true));
    },
  });
}
