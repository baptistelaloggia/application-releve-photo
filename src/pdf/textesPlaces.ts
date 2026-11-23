import type { TextePlace } from '../domaine/locaux';

/** Sous-ensemble de l'API pdf.js utilisé ici (évite une dépendance directe, utilisable hors navigateur). */
interface PagePdf {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getTextContent(): Promise<{ items: object[] }>;
  getOperatorList?(): Promise<unknown>;
  commonObjs?: { get(id: string): unknown };
}

/**
 * Vrai nom des polices de la page (« WLGMLB+Poppins »), au lieu de l'identifiant interne de pdf.js
 * (« g_d0_f4 »), propre à chaque fichier : le style d'une étiquette exemple se reconnaît ainsi d'un
 * plan à l'autre (24/11/2026). Les polices ne sont connues qu'après lecture du contenu de la page.
 */
async function nomsDesPolices(page: PagePdf, ids: Set<string>): Promise<Map<string, string>> {
  const noms = new Map<string, string>();
  if (!page.getOperatorList || !page.commonObjs) return noms;
  try {
    await page.getOperatorList();
  } catch {
    return noms;
  }
  for (const id of ids) {
    try {
      const nom = (page.commonObjs.get(id) as { name?: string } | undefined)?.name;
      if (nom) noms.set(id, nom);
    } catch {
      /* police non chargée : l'identifiant interne reste */
    }
  }
  return noms;
}

/** Produit de deux matrices affines [a, b, c, d, e, f]. */
function produit(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Textes d'une page avec leur position, dans le repère de la page affichée
 * (rotation appliquée, origine en haut à gauche, unité : point PDF).
 */
export async function lireTextesPlaces(page: PagePdf): Promise<{ textes: TextePlace[]; largeur: number; hauteur: number }> {
  const vue = page.getViewport({ scale: 1 });
  const contenu = await page.getTextContent();
  const ids = new Set(contenu.items.map((i) => (i as { fontName?: string }).fontName).filter((n): n is string => !!n));
  const noms = await nomsDesPolices(page, ids);
  const textes: TextePlace[] = [];
  for (const brut of contenu.items) {
    const it = brut as { str?: string; transform?: number[]; width?: number; fontName?: string };
    if (!it.str || !it.transform) continue;
    const [a, b, c, d, e, f] = produit(vue.transform, it.transform);
    textes.push({
      texte: it.str,
      x: e,
      y: f,
      largeur: it.width ?? 0,
      hauteur: Math.hypot(c, d),
      angle: (Math.atan2(b, a) * 180) / Math.PI,
      ...(it.fontName ? { police: noms.get(it.fontName) ?? it.fontName } : {}),
    });
  }
  return { textes, largeur: vue.width, hauteur: vue.height };
}
