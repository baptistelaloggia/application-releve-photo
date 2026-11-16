/**
 * Connexion Microsoft (Entra ID) par MSAL : application monopage, code d'autorisation + PKCE,
 * sans secret (CONCEPTION §A.4-5). Permission Microsoft Graph déléguée « Sites.Selected » :
 * l'appli n'accède qu'aux sites que la DSI lui a explicitement ouverts (la bibliothèque Transit).
 * La bibliothèque MSAL n'est chargée qu'au premier usage du transit.
 */
import type { IPublicClientApplication } from '@azure/msal-browser';
import type { ConfigTransit } from './config';

export const PERMISSIONS = ['https://graph.microsoft.com/Sites.Selected'];

/** Page de retour de la connexion (déclarée par la DSI comme « URI de redirection », type SPA). */
export function adresseRetour(): string {
  return new URL('msal-retour.html', document.baseURI).href;
}

let instance: { cle: string; app: Promise<IPublicClientApplication> } | null = null;

async function application(c: ConfigTransit): Promise<IPublicClientApplication> {
  const cle = `${c.tenantId}/${c.clientId}`;
  if (instance?.cle !== cle) {
    instance = {
      cle,
      app: import('@azure/msal-browser').then(async ({ PublicClientApplication }) => {
        const app = new PublicClientApplication({
          auth: {
            clientId: c.clientId.trim(),
            authority: `https://login.microsoftonline.com/${c.tenantId.trim()}`,
            redirectUri: adresseRetour(),
          },
          cache: { cacheLocation: 'localStorage' },
        });
        await app.initialize();
        return app;
      }),
    };
  }
  return instance.app;
}

/**
 * Jeton d'accès à Microsoft Graph. Sans connexion valide, ouvre la fenêtre de connexion Microsoft
 * (une seule fois : la session est ensuite renouvelée sans rien demander).
 */
export async function obtenirJeton(c: ConfigTransit): Promise<string> {
  if (c.test) return c.test.jeton;
  const app = await application(c);
  const compte = app.getAllAccounts()[0];
  if (compte) {
    try {
      return (await app.acquireTokenSilent({ scopes: PERMISSIONS, account: compte })).accessToken;
    } catch {
      // Session expirée : nouvelle connexion ci-dessous.
    }
  }
  const r = await app.acquireTokenPopup({ scopes: PERMISSIONS, prompt: compte ? undefined : 'select_account' });
  return r.accessToken;
}

/** Compte Microsoft connecté sur cet appareil, s'il y en a un. */
export async function compteConnecte(c: ConfigTransit): Promise<string | null> {
  if (c.test) return 'compte de test';
  return (await application(c)).getAllAccounts()[0]?.username ?? null;
}

export async function deconnecter(c: ConfigTransit): Promise<void> {
  if (c.test) return;
  const app = await application(c);
  const compte = app.getAllAccounts()[0];
  if (compte) await app.logoutPopup({ account: compte, mainWindowRedirectUri: document.baseURI });
}
