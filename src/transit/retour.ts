// Page de retour de la connexion Microsoft : transmet la réponse à la fenêtre de l'appli.
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

void broadcastResponseToMainFrame().catch((e) => {
  document.body.textContent = `Connexion impossible : ${e instanceof Error ? e.message : String(e)}`;
});
