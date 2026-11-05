/**
 * Recherche de locaux par nom ou numéro (« TGBT », « 012 », « chaufferie », « R+1 cta »).
 * Insensible aux accents, à la casse et à la ponctuation. Tous les mots tapés doivent être trouvés.
 */

export interface Cherchable {
  nom: string;
  numero: string | null;
  codeNiveau: string;
}

export function normaliserRecherche(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9+]+/g, ' ')
    .trim();
}

/** Score de pertinence (plus grand = meilleur), ou null si le local ne correspond pas. */
export function scoreRecherche(requete: string, element: Cherchable): number | null {
  const mots = normaliserRecherche(requete).split(' ').filter(Boolean);
  if (mots.length === 0) return null;
  const nom = normaliserRecherche(element.nom);
  const numero = normaliserRecherche(element.numero ?? '');
  const numeroCompact = numero.replace(/ /g, '');
  const niveau = element.codeNiveau;
  let score = 0;
  for (const mot of mots) {
    if (mot === niveau) score += 1;
    else if (numeroCompact === mot) score += 100;
    else if (numeroCompact.startsWith(mot)) score += 40;
    else if (numeroCompact.includes(mot)) score += 20;
    else if (nom.split(' ').includes(mot)) score += 30;
    else if (nom.split(' ').some((m) => m.startsWith(mot))) score += 15;
    else if (nom.replace(/ /g, '').includes(mot)) score += 5;
    else return null;
  }
  return score;
}

/** Filtre et trie une liste d'éléments selon la requête. */
export function rechercher<T extends Cherchable>(requete: string, elements: readonly T[], limite = 50): T[] {
  return elements
    .map((e) => ({ e, s: scoreRecherche(requete, e) }))
    .filter((x): x is { e: T; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || (a.e.numero ?? a.e.nom).localeCompare(b.e.numero ?? b.e.nom, 'fr'))
    .slice(0, limite)
    .map((x) => x.e);
}
