// Remplace « virtual:pwa-register » dans la version de test en fichier unique :
// pas de Service Worker quand l'appli est ouverte par double-clic (file://).
export function registerSW(_options: unknown) {
  return async (_recharger?: boolean) => undefined;
}
