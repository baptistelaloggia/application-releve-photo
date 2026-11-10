// Outils communs aux tests de bout en bout.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

// Playwright n'est pas une dépendance du projet : on utilise celui installé sur la machine.
export const { chromium } = createRequire(import.meta.url)('playwright');

/**
 * PDF fictif d'une page (842 × 595 pt), avec un titre et des étiquettes de locaux
 * (lignes de 7 pt empilées, comme celles produites par les logiciels de dessin).
 * etiquettes : [[x, y, [lignes…]], …] en points PDF (origine en bas à gauche).
 */
export function pdfFictif(texte, etiquettes = []) {
  const textes = etiquettes
    .flatMap(([x, y, lignes]) =>
      lignes.map((l, i) => {
        const t = l.replace('²', '2');
        return `BT /F1 7 Tf ${x - t.length * 2} ${y - i * 7.5} Td (${t}) Tj ET`;
      }),
    )
    .join(' ');
  const flux = `BT /F1 36 Tf 80 500 Td (${texte}) Tj ET ${textes} 0 0 1 RG 4 w 60 60 722 475 re S`;
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let sortie = '%PDF-1.4\n';
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(sortie.length);
    sortie += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = sortie.length;
  sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const p of positions) sortie += `${String(p).padStart(10, '0')} 00000 n \n`;
  sortie += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(sortie, 'latin1');
}

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

/** Petit serveur web de fichiers statiques. */
export function servir(dossier) {
  return new Promise((ok) => {
    const serveur = createServer(async (req, res) => {
      let chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (chemin.endsWith('/')) chemin += 'index.html';
      try {
        const contenu = await readFile(join(dossier, chemin));
        res.writeHead(200, { 'content-type': types[extname(chemin)] ?? 'application/octet-stream' });
        res.end(contenu);
      } catch {
        res.writeHead(404).end();
      }
    }).listen(0, () => ok(serveur));
  });
}

/** Arborescence d'un dossier du stockage interne du navigateur (OPFS). */
export async function arborescenceOpfs(page, chemin) {
  return page.evaluate(async (morceaux) => {
    const lignes = [];
    async function parcourir(d, prefixe) {
      const entrees = [];
      for await (const [n, h] of d.entries()) entrees.push([n, h]);
      entrees.sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [n, h] of entrees) {
        if (h.kind === 'directory') {
          lignes.push(`${prefixe}${n}/`);
          await parcourir(h, `${prefixe}${n}/`);
        } else lignes.push(`${prefixe}${n}`);
      }
    }
    let d = await navigator.storage.getDirectory();
    for (const m of morceaux) d = await d.getDirectoryHandle(m);
    await parcourir(d, '');
    return lignes;
  }, chemin.split('/'));
}
