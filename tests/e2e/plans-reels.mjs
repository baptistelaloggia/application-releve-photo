// Essai sur un vrai carnet de plans, fourni à part (jamais dans le dépôt).
// Usage : PLANS=/chemin/vers/carnet.pdf CAPTURES=/dossier/captures node tests/e2e/plans-reels.mjs
// Prérequis : npm run build
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const racine = resolve(import.meta.dirname, '../..');
const plans = process.env.PLANS;
const captures = process.env.CAPTURES;
const niveauxVoulus = (process.env.NIVEAUX ?? 'SS1,RDC,R+2').split(',');
if (!plans) throw new Error('Indiquez le carnet de plans : PLANS=/chemin/carnet.pdf');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const serveur = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    let c = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (c.endsWith('/')) c += 'index.html';
    try {
      const contenu = await readFile(join(racine, 'dist', c));
      res.writeHead(200, { 'content-type': types[extname(c)] ?? 'application/octet-stream' }).end(contenu);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(0, () => ok(s));
});

const navigateur = await chromium.launch();
// TELEPHONE=1 : écran de téléphone tactile (412 × 915).
const contexte = await navigateur.newContext(
  process.env.TELEPHONE
    ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 },
);
await contexte.addInitScript(() => {
  window.showDirectoryPicker = async ({ id } = {}) =>
    (await navigator.storage.getDirectory()).getDirectoryHandle(`simule-${id ?? 'x'}`, { create: true });
});
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
const capture = (nom) => captures && page.screenshot({ path: join(captures, `plans-reels${process.env.TELEPHONE ? '-tel' : ''}-${nom}.png`), fullPage: !process.env.TELEPHONE });

try {
  await page.goto(`http://localhost:${serveur.address().port}/`);
  await page.getByLabel('Initiales ou nom').fill('BL');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: '+ Nouveau projet' }).click();
  await page.getByLabel("Code d'affaire").fill('ESSAI');
  await page.getByLabel('Nom du projet').fill('Essai carnet de plans');
  await page.getByLabel('Étages (au-dessus du RDC)').fill('0');
  await page.getByLabel('Toiture (TT)').uncheck();
  await page.getByRole('button', { name: /créer/i }).click();
  await page.getByRole('heading', { name: 'Essai carnet de plans' }).waitFor();

  const debut = Date.now();
  await page.locator('input[type=file]').setInputFiles({
    name: basename(plans), mimeType: 'application/pdf', buffer: await readFile(plans),
  });
  // Niveaux reconnus page par page.
  const lignes = page.locator('section:has(h2:text("Importer des plans PDF")) tbody tr');
  await lignes.first().waitFor({ timeout: 60_000 });
  console.log(`Lecture du carnet : ${((Date.now() - debut) / 1000).toFixed(1)} s`);
  const n = await lignes.count();
  const reconnus = [];
  for (let i = 0; i < n; i++) {
    const niveau = await lignes.nth(i).locator('input.court').first().inputValue();
    reconnus.push(`page ${i + 1} : ${niveau || '(non reconnu)'}`);
    const case_ = lignes.nth(i).locator('input[type=checkbox]');
    if (niveauxVoulus.includes(niveau)) await case_.check();
    else await case_.uncheck();
  }
  console.log(reconnus.join('\n'));
  await capture('1-import');

  const t0 = Date.now();
  await page.getByRole('button', { name: `Importer ${niveauxVoulus.length} plans` }).click();
  await page.getByText(/Plan importé : .*page/).first().waitFor({ timeout: 60_000 });
  console.log(`Découpage et import : ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  await page.getByLabel('Ajouter un niveau').fill('ES');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByText('Niveau ajouté : ES (Entresol)').waitFor();
  await capture('2-projet');

  // Lot 2 : ouverture du plan SS1, détection des locaux, enregistrement.
  await page.locator('tr:has(strong:text-is("SS1"))').getByRole('button', { name: 'Ouvrir' }).click();
  await page.locator('.visionneuse[data-fond-pret]').waitFor({ timeout: 60_000 });
  await capture('3-plan-SS1');
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Détecter les locaux' }).click();
  await page.getByRole('heading', { name: 'Locaux détectés' }).waitFor({ timeout: 60_000 });
  console.log(`Détection : ${((Date.now() - t1) / 1000).toFixed(1)} s ; ${await page.locator('.liste-candidats li').count()} propositions`);
  await capture('4-detection-SS1');
  await page.getByRole('button', { name: /^Enregistrer \d+ locaux$/ }).click();
  await page.getByRole('heading', { name: /Locaux de ce plan/ }).waitFor();

  // « Je tape TGBT, je trouve le local. »
  await page.getByRole('button', { name: '← Projet' }).click();
  await page.getByLabel('Rechercher un local').fill('tgbt');
  await capture('5-recherche');
  await page.locator('.resultats button').first().click();
  await page.locator('.marqueur-selection').waitFor({ state: 'attached', timeout: 60_000 });
  await page.locator('.visionneuse[data-fond-pret]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500); // rendu des tuiles nettes
  const selection = await page.locator('.marqueur-selection').textContent();
  console.log(`Recherche « tgbt » : marqueur sélectionné = ${selection} ; fiche = ${await page.locator('.fiche-local input').first().inputValue()}`);
  assert.equal(selection, 'LT1105');
  await capture('6-TGBT-zoome');
  await page.getByRole('button', { name: 'Nom', exact: true }).click();
  await page.locator('.visionneuse').hover();
  await page.mouse.wheel(0, 500); // zoom arrière, pour voir plusieurs étiquettes
  await page.waitForTimeout(1500);
  await capture('7-etiquettes-nom');
  await page.getByRole('button', { name: 'Numéro', exact: true }).click();

  // Détection sur tous les plans (SS1 déjà fait : ses locaux sont « déjà présents »).
  await page.getByRole('button', { name: '← Projet' }).click();
  await page.getByRole('button', { name: 'Détecter les locaux sur tous les plans…' }).click();
  await page.getByRole('button', { name: 'Lancer la détection' }).click();
  await page.getByRole('button', { name: /^Enregistrer \d+ locaux$/ }).waitFor({ timeout: 60_000 });
  console.log('Détection globale :', (await page.locator('section:has(h2:text("tous les plans")) tbody').innerText()).replace(/\s*\n\s*/g, ' | '));
  await capture('8-detection-globale');

  const arbo = await page.evaluate(async () => {
    const lignes = [];
    async function parcourir(d, p) {
      const e = [];
      for await (const x of d.entries()) e.push(x);
      e.sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [nom, h] of e) {
        if (h.kind === 'directory') { lignes.push(`${p}${nom}/`); await parcourir(h, `${p}${nom}/`); }
        else if (!/^_data\/(niveaux|plans)\//.test(p)) lignes.push(`${p}${nom}  (${Math.round((await h.getFile()).size / 1024)} ko)`);
      }
    }
    const parent = await (await navigator.storage.getDirectory()).getDirectoryHandle('simule-parent-projets');
    for await (const [nom, h] of parent.entries()) { lignes.push(`${nom}/`); await parcourir(h, '  '); }
    return lignes;
  });
  console.log(arbo.join('\n'));
  assert.deepEqual(erreurs, []);
  console.log('OK');
} finally {
  await navigateur.close();
  serveur.close();
}
