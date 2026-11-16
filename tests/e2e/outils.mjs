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

/**
 * Imitation de Microsoft Graph (bibliothèque SharePoint « Transit ») pour les tests du lot 5.
 * Reproduit les seules opérations utilisées par l'appli, avec les règles de Graph qui comptent :
 * jeton exigé (sauf sur l'adresse de session d'envoi, où il est interdit), envoi simple limité à 4 Mo,
 * envoi en morceaux multiples de 320 Kio par session.
 */
export function grapheFictif() {
  const fichiers = new Map(); // chemin → { contenu: Buffer, modifieLe }
  const sessions = new Map(); // jeton de session → { chemin, morceaux: Buffer[], recu, total }
  const etat = { sessions: 0, morceaux: 0, plusGrosEnvoi: 0 };
  const LECTEUR = 'lecteur-transit';

  const json = (res, statut, corps) => res.writeHead(statut, { 'content-type': 'application/json' }).end(JSON.stringify(corps));
  const lireCorps = (req) =>
    new Promise((ok) => {
      const morceaux = [];
      req.on('data', (m) => morceaux.push(m));
      req.on('end', () => ok(Buffer.concat(morceaux)));
    });
  const enfants = (dossier) => {
    const prefixe = dossier ? `${dossier}/` : '';
    const vus = new Map();
    for (const [chemin, f] of fichiers) {
      if (!chemin.startsWith(prefixe)) continue;
      const reste = chemin.slice(prefixe.length);
      const [nom, ...suite] = reste.split('/');
      if (suite.length) vus.set(nom, { name: nom, folder: { childCount: 1 }, size: 0, lastModifiedDateTime: f.modifieLe });
      else vus.set(nom, { name: nom, file: {}, size: f.contenu.length, lastModifiedDateTime: f.modifieLe });
    }
    return [...vus.values()];
  };
  const existeDossier = (dossier) => !dossier || [...fichiers.keys()].some((c) => c.startsWith(`${dossier}/`));

  async function traiter(req, res, url) {
    const p = url.pathname.slice('/graph'.length);
    if (p === '/etat') return json(res, 200, { ...etat, fichiers: [...fichiers.keys()].sort() });
    const session = /^\/session\/([\w-]+)$/.exec(p);
    if (session) {
      if (req.headers.authorization) return json(res, 401, { error: { message: 'Pas de jeton sur une session d’envoi' } });
      const s = sessions.get(session[1]);
      if (!s) return json(res, 404, { error: { message: 'session inconnue' } });
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers['content-range'] ?? '');
      const corps = await lireCorps(req);
      if (!m || +m[1] !== s.recu || corps.length !== +m[2] - +m[1] + 1) return json(res, 416, { error: { message: 'plage incorrecte' } });
      if (+m[2] + 1 < +m[3] && corps.length % (320 * 1024) !== 0) return json(res, 400, { error: { message: 'morceau non multiple de 320 Kio' } });
      s.morceaux.push(corps);
      s.recu += corps.length;
      etat.morceaux++;
      if (s.recu < +m[3]) return json(res, 202, { nextExpectedRanges: [`${s.recu}-`] });
      fichiers.set(s.chemin, { contenu: Buffer.concat(s.morceaux), modifieLe: new Date().toISOString() });
      etat.plusGrosEnvoi = Math.max(etat.plusGrosEnvoi, s.recu);
      sessions.delete(session[1]);
      return json(res, 201, { name: s.chemin.split('/').pop(), size: s.recu });
    }
    if (req.headers.authorization !== 'Bearer jeton-test') return json(res, 401, { error: { message: 'jeton absent' } });
    if (/^\/sites\/[^/]+:\/sites\/[^/]+$/.test(p) && req.method === 'GET') return json(res, 200, { id: 'site-transit' });
    if (p === '/sites/site-transit/drives') return json(res, 200, { value: [{ id: 'docs', name: 'Documents' }, { id: LECTEUR, name: 'Transit' }] });
    if (p === `/drives/${LECTEUR}/root/children`) return json(res, 200, { value: enfants('') });
    const m = new RegExp(`^/drives/${LECTEUR}/root:/(.+?)(?::(/children|/content|/createUploadSession))?$`).exec(p);
    if (!m) return json(res, 404, { error: { message: `route inconnue ${p}` } });
    if (m[1].endsWith(':')) return json(res, 400, { error: { message: 'chemin terminé par « : » sans action' } });
    const chemin = m[1].split('/').map(decodeURIComponent).join('/');
    const action = m[2] ?? '';
    if (action === '/children' && req.method === 'GET') {
      return existeDossier(chemin) ? json(res, 200, { value: enfants(chemin) }) : json(res, 404, { error: { message: 'introuvable' } });
    }
    if (action === '/content' && req.method === 'GET') {
      const f = fichiers.get(chemin);
      return f ? res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(f.contenu) : json(res, 404, { error: { message: 'introuvable' } });
    }
    if (action === '/content' && req.method === 'PUT') {
      const corps = await lireCorps(req);
      if (corps.length > 4 * 1000 * 1000) return json(res, 413, { error: { message: 'envoi simple limité à 4 Mo' } });
      fichiers.set(chemin, { contenu: corps, modifieLe: new Date().toISOString() });
      etat.plusGrosEnvoi = Math.max(etat.plusGrosEnvoi, corps.length);
      return json(res, 201, { name: chemin.split('/').pop(), size: corps.length });
    }
    if (action === '/createUploadSession' && req.method === 'POST') {
      await lireCorps(req);
      const jeton = Math.random().toString(36).slice(2);
      sessions.set(jeton, { chemin, morceaux: [], recu: 0 });
      etat.sessions++;
      return json(res, 200, { uploadUrl: `${url.origin}/graph/session/${jeton}` });
    }
    if (!action && req.method === 'DELETE') {
      for (const c of [...fichiers.keys()]) if (c === chemin || c.startsWith(`${chemin}/`)) fichiers.delete(c);
      return res.writeHead(204).end();
    }
    return json(res, 405, { error: { message: 'méthode' } });
  }
  return { traiter, etat, fichiers };
}

/** Serveur de l'appli avec, sous /graph, l'imitation de Microsoft Graph. */
export function servirAvecGraphe(dossier) {
  const graphe = grapheFictif();
  return new Promise((ok) => {
    const serveur = createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/graph')) return void graphe.traiter(req, res, url).catch((e) => res.writeHead(500).end(String(e)));
      let chemin = decodeURIComponent(url.pathname);
      if (chemin.endsWith('/')) chemin += 'index.html';
      try {
        const contenu = await readFile(join(dossier, chemin));
        res.writeHead(200, { 'content-type': types[extname(chemin)] ?? 'application/octet-stream' });
        res.end(contenu);
      } catch {
        res.writeHead(404).end();
      }
    }).listen(0, () => ok({ serveur, graphe }));
  });
}
