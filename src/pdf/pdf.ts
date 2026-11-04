import * as pdfjs from 'pdfjs-dist';
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

/** Dessine une page du PDF dans un canevas, à la largeur demandée (aperçu). */
export async function dessinerApercu(fichier: Blob, canevas: HTMLCanvasElement, largeur: number, page = 1): Promise<void> {
  const tache = pdfjs.getDocument({ data: new Uint8Array(await fichier.arrayBuffer()) });
  try {
    const doc = await tache.promise;
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const ratio = window.devicePixelRatio || 1;
    const vue = p.getViewport({ scale: (largeur / base.width) * ratio });
    canevas.width = Math.floor(vue.width);
    canevas.height = Math.floor(vue.height);
    canevas.style.width = `${Math.floor(vue.width / ratio)}px`;
    await p.render({ canvas: canevas, viewport: vue }).promise;
  } finally {
    await tache.destroy();
  }
}
