/**
 * Réglages du transit SharePoint (lot 5, CONCEPTION §A.4-3 et §A.6 sexies).
 * Saisis dans l'appli par chaque utilisateur, d'après les valeurs fournies par la DSI,
 * et gardés sur l'appareil : ils ne sont JAMAIS écrits dans le dépôt de code (dépôt public).
 */
import { ecrireReglage, lireReglage } from '../stockage/registre';

export interface ConfigTransit {
  /** Identifiant du locataire Entra ID (« Directory (tenant) ID »). */
  tenantId: string;
  /** Identifiant de l'application enregistrée par la DSI (« Application (client) ID »). */
  clientId: string;
  /** Adresse du site SharePoint qui porte la bibliothèque, par ex. https://entreprise.sharepoint.com/sites/ReleveTransit */
  siteUrl: string;
  /** Nom de la bibliothèque de documents, par ex. « Transit ». */
  bibliotheque: string;
  /**
   * Réservé aux tests automatiques : adresse d'une imitation de Microsoft Graph et jeton fictif.
   * Jamais renseigné dans l'appli réelle.
   */
  test?: { baseGraph: string; jeton: string };
}

const CLE = 'transitSharePoint';

export async function lireConfigTransit(): Promise<ConfigTransit | null> {
  const c = await lireReglage<ConfigTransit>(CLE);
  return c && c.siteUrl && c.bibliotheque && (c.test || (c.tenantId && c.clientId)) ? c : null;
}

export async function ecrireConfigTransit(c: ConfigTransit | null): Promise<void> {
  await ecrireReglage(CLE, c);
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contrôle une saisie ; renvoie la liste des problèmes. */
export function controlerConfig(c: ConfigTransit): string[] {
  const problemes: string[] = [];
  if (!GUID.test(c.tenantId.trim())) problemes.push("L'identifiant du locataire doit être de la forme xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.");
  if (!GUID.test(c.clientId.trim())) problemes.push("L'identifiant de l'application doit être de la forme xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.");
  let url: URL | null = null;
  try {
    url = new URL(c.siteUrl.trim());
  } catch {
    /* adresse invalide */
  }
  if (!url || url.protocol !== 'https:' || !url.hostname.endsWith('.sharepoint.com') || !/^\/sites\/[^/]+/.test(url.pathname)) {
    problemes.push("L'adresse du site doit être de la forme https://entreprise.sharepoint.com/sites/NomDuSite.");
  }
  if (!c.bibliotheque.trim()) problemes.push('Le nom de la bibliothèque est obligatoire (par ex. « Transit »).');
  return problemes;
}
