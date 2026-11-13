// Test de bout en bout du lot 1, dans un vrai navigateur Chromium (sans écran).
// Le choix de dossier Windows est simulé par le stockage interne du navigateur (OPFS),
// qui offre exactement la même interface.
// Usage : npm run build && npm run build:test && npm run test:e2e
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

// Playwright n'est pas une dépendance du projet : on utilise celui installé sur la machine.
const { chromium } = createRequire(import.meta.url)('playwright');

const racine = resolve(import.meta.dirname, '../..');
const dossierCaptures = process.env.CAPTURES;

/**
 * PDF fictif minimal d'une page, avec un titre et des étiquettes de locaux
 * (lignes de 7 pt empilées, comme celles produites par les logiciels de dessin).
 */
const ETIQUETTES_FICTIVES = [
  [200, 400, ['TGBT', 'LT001', '12,5 m²']],
  [400, 400, ['CHAUFFERIE', 'LT002', '30 m²']],
  [600, 400, ['BUREAU', 'B101', '18 m²']],
  [400, 200, ['SANIT. H', 'SH101', '6 m²']],
];
function pdfFictif(texte, etiquettesPlan = ETIQUETTES_FICTIVES) {
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const etiquettes = etiquettesPlan.flatMap(([x, y, lignes]) =>
    lignes.map((l, i) => {
      const t = l.replace('²', '2');
      return `BT /F1 7 Tf ${x - t.length * 2} ${y - i * 7.5} Td (${t}) Tj ET`;
    }),
  ).join(' ');
  const flux = `BT /F1 36 Tf 80 500 Td (${texte}) Tj ET ${etiquettes} 0 0 1 RG 4 w 60 60 722 475 re S`;
  objets[3] = `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`;
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
function servir(dossier) {
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

// Remplace la fenêtre de choix de dossier par un dossier du stockage interne.
const simulationChoixDossier = () => {
  window.showDirectoryPicker = async ({ id } = {}) => {
    const r = await navigator.storage.getDirectory();
    return r.getDirectoryHandle(`simule-${id ?? 'x'}`, { create: true });
  };
};

async function arborescence(page, parent, nomDossier) {
  return page.evaluate(async ([parent, nom]) => {
    const lignes = [];
    async function parcourir(d, prefixe) {
      const entrees = [];
      for await (const [n, h] of d.entries()) entrees.push([n, h]);
      entrees.sort(([a], [b]) => a.localeCompare(b));
      for (const [n, h] of entrees) {
        if (h.kind === 'directory') {
          lignes.push(`${prefixe}${n}/`);
          await parcourir(h, `${prefixe}${n}/`);
        } else lignes.push(`${prefixe}${n}`);
      }
    }
    const r = window.__racineSimulee ?? (await navigator.storage.getDirectory());
    await parcourir(await (await r.getDirectoryHandle(parent)).getDirectoryHandle(nom), '');
    return lignes;
  }, [parent, nomDossier]);
}

// Fichier ouvert par double-clic (file://) : le stockage interne n'y existe pas.
// On simule alors le dossier Windows par un faux dossier en mémoire, sans fonction « move »,
// ce qui fait aussi passer par le renommage par copie.
const simulationDossierMemoire = () => {
  const introuvable = () => new DOMException('introuvable', 'NotFoundError');
  class Fichier {
    kind = 'file';
    constructor(name) { this.name = name; this.blob = new Blob([]); }
    async getFile() { return new File([this.blob], this.name); }
    async createWritable() {
      const morceaux = [];
      return { write: async (c) => morceaux.push(c), close: async () => { this.blob = new Blob(morceaux); }, abort: async () => {} };
    }
  }
  class Dossier {
    kind = 'directory';
    constructor(name) { this.name = name; this.enfants = new Map(); }
    async getDirectoryHandle(n, o = {}) {
      let e = this.enfants.get(n);
      if (!e) { if (!o.create) throw introuvable(); e = new Dossier(n); this.enfants.set(n, e); }
      if (e.kind !== 'directory') throw new DOMException('type', 'TypeMismatchError');
      return e;
    }
    async getFileHandle(n, o = {}) {
      let e = this.enfants.get(n);
      if (!e) { if (!o.create) throw introuvable(); e = new Fichier(n); this.enfants.set(n, e); }
      if (e.kind !== 'file') throw new DOMException('type', 'TypeMismatchError');
      return e;
    }
    async removeEntry(n) { if (!this.enfants.delete(n)) throw introuvable(); }
    async *entries() { yield* this.enfants.entries(); }
  }
  const racine = new Dossier('racine');
  window.__racineSimulee = racine;
  window.showDirectoryPicker = async ({ id } = {}) => racine.getDirectoryHandle(`simule-${id ?? 'x'}`, { create: true });
};

// Téléphone : pas de choix de dossier, projets dans le stockage interne (dossier « projets »).
const simulationTelephone = () => {
  delete window.showDirectoryPicker;
  delete Window.prototype.showDirectoryPicker;
};

async function parcours(url, libelle, telephone = false, memoire = false) {
  console.log(`\n=== ${libelle} : ${url}`);
  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dossierCaptures ? 2 : 1 });
  await contexte.addInitScript(telephone ? simulationTelephone : memoire ? simulationDossierMemoire : simulationChoixDossier);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  page.on('dialog', (d) => d.accept());
  const capture = async (nom) => dossierCaptures && page.screenshot({ path: join(dossierCaptures, `${libelle}-${nom}.png`), fullPage: true });

  await page.goto(url);
  await page.getByLabel('Initiales ou nom').fill('BL');
  await page.getByRole('button', { name: 'Continuer' }).click();

  await page.getByRole('button', { name: '+ Nouveau projet' }).click();
  await page.getByLabel("Code d'affaire").fill('t01');
  await page.getByLabel('Nom du projet').fill('Groupe scolaire fictif');
  await page.getByLabel('Sous-sols').fill('1');
  await page.getByLabel('Étages (au-dessus du RDC)').fill('2');
  await capture('1-nouveau-projet');
  await page.getByRole('button', { name: /créer/i }).click();

  await page.getByRole('heading', { name: 'Groupe scolaire fictif' }).waitFor();
  const dossierProjet = `${new Date().getFullYear()}-T01_Groupe-scolaire-fictif`;

  // Import de deux plans : niveaux et indices devinés depuis les noms.
  await page.locator('input[type=file][accept*=pdf]').setInputFiles([
    { name: 'ARCHI_PLAN_R+1_Ind-A.pdf', mimeType: 'application/pdf', buffer: pdfFictif('Plan fictif R+1 ind A') },
    {
      name: 'plan RDC.pdf',
      mimeType: 'application/pdf',
      buffer: pdfFictif('Plan fictif RDC', [
        [300, 300, ['LOCAL VENTIL', 'LT010', '8 m²']],
        [500, 300, ['ARCHIVES', 'AR001', '15 m²']],
      ]),
    },
  ]);
  await page.getByRole('button', { name: 'Importer 2 plans' }).waitFor();
  await capture('2-import');
  await page.getByRole('button', { name: 'Importer 2 plans' }).click();
  await page.getByText('Plan importé : plan RDC.pdf').waitFor();

  // Nouvel indice du R+1 : l'indice A doit être archivé.
  await page.locator('input[type=file][accept*=pdf]').setInputFiles([
    { name: 'ARCHI_PLAN_R+1_Ind-B.pdf', mimeType: 'application/pdf', buffer: pdfFictif('Plan fictif R+1 ind B') },
  ]);
  await page.getByText("remplace l'indice A (archivé)").waitFor();
  await page.getByRole('button', { name: 'Importer 1 plan' }).click();
  await page.getByText(/Indice A archivé/).waitFor();

  // « ss » devient SS1, déjà présent : refusé. Puis ajout de R+3 : TT doit être renuméroté.
  await page.getByLabel('Ajouter un niveau').fill('ss');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByText('Niveau en double : « SS1 ».').waitFor();
  await page.getByLabel('Ajouter un niveau').fill('r3');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByText('Dossier renommé : 04_TT → 05_TT').waitFor();

  // Niveau intermédiaire à code libre, puis déplacement d'un cran vers le haut.
  await page.getByLabel('Ajouter un niveau').fill('R+2 mezzanine');
  await page.getByText('R+2-MEZZANINE', { exact: true }).waitFor(); // aperçu du code
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByText('Niveau ajouté : R+2-MEZZANINE (R+2 mezzanine)').waitFor();
  await page.getByRole('button', { name: 'Monter le niveau R+2-MEZZANINE' }).click();
  await page.getByText('Niveau R+2-MEZZANINE déplacé vers le haut').waitFor();
  await page.getByText('Dossier renommé : 05_R+3 → 04_R+3').waitFor();

  // Lot 2 : ouverture du plan R+1, détection des locaux, enregistrement.
  // Le plan s'ouvre d'un clic sur le nom du niveau.
  await page.locator('.lien-niveau', { hasText: 'R+1' }).click();
  await page.locator('.visionneuse[data-fond-pret]').waitFor();
  // Le menu « Affichage » se ferme quand on touche le plan.
  await page.getByText('Affichage', { exact: true }).click();
  await page.getByRole('button', { name: 'Fiche', exact: true }).click();
  assert.equal(await page.locator('details.options-plan').evaluate((d) => d.open), true);
  const vue = await page.locator('.visionneuse').boundingBox();
  await page.mouse.click(vue.x + 20, vue.y + vue.height - 20);
  assert.equal(await page.locator('details.options-plan').evaluate((d) => d.open), false);
  await page.getByText('Affichage', { exact: true }).click();
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await page.mouse.click(vue.x + 20, vue.y + vue.height - 20);
  await page.getByRole('tab', { name: /Locaux/ }).click();
  await page.getByRole('button', { name: 'Détecter les locaux' }).click();
  await page.getByRole('button', { name: 'Enregistrer 4 locaux' }).waitFor();
  await capture('3-detection');
  await page.getByRole('button', { name: 'Enregistrer 4 locaux' }).click();
  await page.getByRole('heading', { name: /Locaux de ce plan/ }).waitFor();
  assert.equal(await page.locator('.liste-locaux li').count(), 4);

  // Ajout manuel d'un local par appui sur le plan, puis correction d'un nom.
  await page.getByRole('button', { name: '+ Ajouter un local' }).click();
  const boite = await page.locator('.visionneuse').boundingBox();
  await page.mouse.click(boite.x + boite.width * 0.5, boite.y + boite.height * 0.3);
  await page.getByLabel('Nom').fill('Local CTA');
  assert.equal(await page.getByLabel('Numéro').inputValue(), 'R1-01'); // numéro automatique proposé
  await page.getByLabel('Numéro').fill('lt003');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.locator('.marqueur-selection').filter({ hasText: 'LT003' }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Fermer' }).click();

  // « Je tape TGBT, je trouve le local » depuis l'écran projet.
  await page.getByRole('button', { name: '← Projet' }).click();
  await page.getByLabel('Rechercher un local').fill('tgbt');
  await page.locator('.resultats button').first().click();
  await page.locator('.marqueur-selection').filter({ hasText: 'LT001' }).waitFor({ state: 'attached' });
  assert.equal(await page.getByLabel('Nom').inputValue(), 'TGBT');
  await capture('4-tgbt');
  await page.getByRole('button', { name: '← Projet' }).click();

  // Détection sur tous les plans : le RDC n'a pas encore de locaux, le R+1 les a déjà.
  await page.getByRole('button', { name: 'Détecter les locaux sur tous les plans…' }).click();
  await page.getByRole('button', { name: 'Lancer la détection' }).click();
  await page.getByRole('button', { name: 'Enregistrer 2 locaux' }).waitFor();
  await capture('5-detection-globale');
  await page.getByRole('button', { name: 'Enregistrer 2 locaux' }).click();
  await page.getByText(/2 locaux enregistrés sur le plan T01_RDC\.pdf/).waitFor();
  await page.getByLabel('Rechercher un local').fill('archives');
  await page.locator('.resultats button').filter({ hasText: 'AR001' }).waitFor();
  await page.getByLabel('Rechercher un local').fill('');

  const arbo = await arborescence(page, telephone ? 'projets' : 'simule-parent-projets', dossierProjet);
  const sansDonnees = arbo.filter((l) => !/^_data\/(niveaux|plans|locaux)\/.+\.json$/.test(l));
  assert.deepEqual([...sansDonnees].sort(), [
    '00_PLANS/',
    '00_PLANS/T01_R+1.pdf',
    '00_PLANS/T01_RDC.pdf',
    '00_PLANS/_ANCIENS/',
    '00_PLANS/_ANCIENS/T01_R+1_Ind-A.pdf',
    '01_PHOTOS/',
    '01_PHOTOS/00_SS1/',
    '01_PHOTOS/01_RDC/',
    '01_PHOTOS/02_R+1/',
    '01_PHOTOS/03_R+2/',
    '01_PHOTOS/04_R+3/',
    '01_PHOTOS/05_R+2-MEZZANINE/',
    '01_PHOTOS/06_TT/',
    '01_PHOTOS/_A-CLASSER/',
    '02_EXPORTS/',
    '_data/',
    '_data/locaux/',
    '_data/miniatures/',
    '_data/niveaux/',
    '_data/photos/',
    '_data/plans/',
    '_data/reperes/',
    '_data/projet.json',
  ].sort());
  assert.equal(arbo.filter((l) => l.startsWith('_data/niveaux/') && l.endsWith('.json')).length, 7);
  assert.equal(arbo.filter((l) => l.startsWith('_data/plans/') && l.endsWith('.json')).length, 2);
  assert.equal(arbo.filter((l) => l.startsWith('_data/locaux/') && l.endsWith('.json')).length, 7);
  console.log(arbo.join('\n'));

  // Après rechargement, le projet est dans la liste des récents et se rouvre.
  // Seulement en mode téléphone : le navigateur de test plante en relisant un accès au
  // stockage interne mémorisé, ce qui est justement le cas de la simulation « PC ».
  if (telephone) {
    await page.reload();
    await page.getByRole('button', { name: /Groupe scolaire fictif/ }).click();
    await page.getByRole('heading', { name: 'Groupe scolaire fictif' }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 7);
    await capture('5-rouvert');
  }

  const filtrees = erreurs.filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(filtrees, [], 'erreurs dans la console');
  await navigateur.close();
  console.log(`OK : ${libelle}`);
}

const serveur = await servir(join(racine, 'dist'));
try {
  await parcours(`http://localhost:${serveur.address().port}/`, 'pwa');
  await parcours(`http://localhost:${serveur.address().port}/`, 'telephone', true);
  await parcours(`file://${join(racine, 'dist-test', 'index.html')}`, 'fichier-unique', false, true);
} finally {
  serveur.close();
}
