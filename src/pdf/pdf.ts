import * as pdfjs from 'pdfjs-dist';
import type { StyleEtiquette } from '../domaine/locaux';
import urlTravailleur from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// pdf.js lit les PDF dans un « worker » (tâche de fond) pour ne pas figer l'écran.
pdfjs.GlobalWorkerOptions.workerSrc = urlTravailleur;

export interface InfosPdf {
  pages: number;
  /** Texte de chaque page (vide si le PDF est scanné ou si le texte a été converti en traits). */
  textes: string[];
}

/** Ouvre un PDF, compte ses pages et lit leur texte. Lève une erreur si le fichier n'est pas un PDF lisible. */
export async function lireInfosPdf(fichier: Blob): Promise<InfosPdf> {
  const tache = pdfjs.getDocument({ data: new Uint8Array(await fichier.arrayBuffer()) });
  try {
    const doc = await tache.promise;
    const textes: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const contenu = await (await doc.getPage(i)).getTextContent();
      textes.push(contenu.items.map((it) => ('str' in it ? it.str : '')).join(' '));
    }
    return { pages: doc.numPages, textes };
  } finally {
    await tache.destroy();
  }
}

/**
 * Extrait une page d'un PDF dans un nouveau PDF (contenu vectoriel conservé).
 * Sert à découper un carnet de plans en un fichier par niveau.
 */
export async function extrairePage(fichier: Blob, numeroPage: number): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(await fichier.arrayBuffer(), { ignoreEncryption: true });
  const cible = await PDFDocument.create();
  const [page] = await cible.copyPages(source, [numeroPage - 1]);
  cible.addPage(page);
  cible.setProducer('Relevé photo sur plans');
  return new Blob([(await cible.save()) as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

// ------------------------------------------------------------------ documents ouverts

type TachePdf = ReturnType<typeof pdfjs.getDocument>;
export type PagePdf = Awaited<ReturnType<Awaited<TachePdf['promise']>['getPage']>>;

interface Ouvert {
  tache: Promise<TachePdf>;
  page: Promise<PagePdf>;
}
const ouverts = new Map<string, Ouvert>();
const MAX_OUVERTS = 3;

/**
 * Ouvre la 1re page d'un plan et la garde en mémoire (les 3 derniers plans ouverts),
 * pour revenir vite sur un niveau déjà consulté.
 * cle : identifiant stable du contenu (par ex. l'empreinte du plan).
 */
export function ouvrirPagePlan(cle: string, fichier: Blob): Promise<PagePdf> {
  const deja = ouverts.get(cle);
  if (deja) {
    ouverts.delete(cle);
    ouverts.set(cle, deja); // remis en dernier : le plus récemment utilisé
    return deja.page;
  }
  // fontExtraProperties : nom réel des polices, pour reconnaître le style des étiquettes (24/11/2026).
  const tache = fichier.arrayBuffer().then((b) => pdfjs.getDocument({ data: new Uint8Array(b), fontExtraProperties: true }));
  const page = tache.then(async (t) => (await t.promise).getPage(1));
  const entree: Ouvert = { tache, page };
  ouverts.set(cle, entree);
  page.catch(() => ouverts.delete(cle));
  while (ouverts.size > MAX_OUVERTS) {
    const [ancienne, a] = ouverts.entries().next().value!;
    ouverts.delete(ancienne);
    void a.tache.then((t) => t.destroy()).catch(() => undefined);
  }
  return page;
}

/**
 * Propose les locaux d'un plan à partir de son texte (voir domaine/locaux.ts). exemple : style
 * d'une étiquette montrée par l'utilisateur (encadré) ; seules les étiquettes de ce style sont gardées.
 */
export async function proposerLocaux(cle: string, fichier: Blob, exemple?: StyleEtiquette) {
  const { detecterLocaux } = await import('../domaine/locaux');
  const { lireTextesPlaces } = await import('./textesPlaces');
  const page = await ouvrirPagePlan(cle, fichier);
  const { textes, largeur, hauteur } = await lireTextesPlaces(page);
  return { locaux: detecterLocaux(textes, largeur, hauteur, exemple), sansTexte: textes.every((t) => !t.texte.trim()) };
}

/** Style du texte encadré par l'utilisateur sur le plan (coordonnées relatives) ; null s'il n'y a pas de texte. */
export async function styleEncadre(cle: string, fichier: Blob, cadre: { x1: number; y1: number; x2: number; y2: number }) {
  const { styleDansCadre } = await import('../domaine/locaux');
  const { lireTextesPlaces } = await import('./textesPlaces');
  const page = await ouvrirPagePlan(cle, fichier);
  const { textes, largeur, hauteur } = await lireTextesPlaces(page);
  return styleDansCadre(textes, largeur, hauteur, cadre);
}
