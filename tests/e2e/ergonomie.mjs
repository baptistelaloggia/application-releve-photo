// Test de bout en bout des réglages d'ergonomie du 21/11/2026, sur un téléphone simulé (Pixel 7) :
//   1. pincement à deux doigts posés sur des étiquettes de locaux : le plan zoome ;
//   2. la ligne d'un niveau ouvre le plan (sans lien souligné) ;
//   3. dictée « 🎙 Dicter » (reconnaissance simulée) : sigles corrigés (« cé té a » → CTA),
//      commentaire et tags de la photo ;
//   4. visionneuse : appui long sur la photo, puis glisser sur la corbeille : photo supprimée.
// Usage : npm run build && node tests/e2e/ergonomie.mjs   (CAPTURES=dossier pour les captures)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { chromium, pdfFictif, servir } from './outils.mjs';

const { devices } = createRequire(import.meta.url)('playwright');
const racine = resolve(import.meta.dirname, '../..');
const captures = process.env.CAPTURES;
const serveur = await servir(join(racine, 'dist'));
const url = `http://localhost:${serveur.address().port}/`;
const navigateur = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const contexte = await navigateur.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] });
await contexte.addInitScript(() => {
  // Reconnaissance vocale simulée : elle « entend » une phrase dont les sigles sont mal écrits.
  class ReconnaissanceFictive {
    start() {
      setTimeout(() => {
        this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'cé té a non conforme, calorifuge absent' } }] });
        this.onend?.();
      }, 300);
    }
    stop() {}
    abort() {}
  }
  window.SpeechRecognition = ReconnaissanceFictive;
});
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('dialog', (d) => d.accept());
const capture = (nom) => captures && page.screenshot({ path: join(captures, `ergonomie-${nom}.png`) });
const cdp = await contexte.newCDPSession(page);

/** Pincement à deux doigts : départ sur a et b, écartés d'un facteur k autour de leur milieu. */
async function pincer(a, b, k) {
  const milieu = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const points = (t) => [a, b].map((p, id) => ({ x: milieu.x + (p.x - milieu.x) * t, y: milieu.y + (p.y - milieu.y) * t, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(1) });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(1 + ((k - 1) * i) / 10) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

try {
  await page.goto(url);
  await page.getByLabel('Initiales ou nom').fill('BL');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: '+ Nouveau projet' }).click();
  await page.getByLabel("Code d'affaire").fill('T07');
  await page.getByLabel('Nom du projet').fill('Ergonomie fictive');
  await page.getByLabel('Toiture (TT)').uncheck();
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('heading', { name: 'Ergonomie fictive' }).waitFor();
  // Plan chargé : une grille serrée d'étiquettes de bureaux.
  const etiquettes = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) etiquettes.push([150 + i * 110, 250 + j * 110, [`BUREAU ${i}${j}`, `B${i}${j}0`, '12,0 m²']]);
  await page.locator('input[type=file][accept*=pdf]').setInputFiles({
    name: 'plan R+1.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFictif('Plan fictif R+1', etiquettes),
  });
  await page.getByRole('button', { name: 'Importer 1 plan' }).click();
  await page.getByText(/Plan importé/).waitFor();

  // 2. La ligne du niveau est un bouton (pas de lien souligné).
  const ligne = page.getByRole('row', { name: /Ouvrir le plan R\+1/ });
  assert.equal(await ligne.locator('.lien-niveau').evaluate((e) => getComputedStyle(e).textDecorationLine), 'none');
  await capture('1-niveaux');
  await ligne.click({ position: { x: 300, y: 10 } }); // n'importe où sur la ligne
  await page.locator('.visionneuse[data-fond-pret]').waitFor();
  await page.getByRole('tab', { name: /Locaux/ }).click();
  await page.getByRole('button', { name: 'Détecter les locaux' }).click();
  await page.getByRole('button', { name: 'Enregistrer 24 locaux' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.marqueur-local').length === 24);
  await page.getByRole('tab', { name: 'Terrain' }).click();

  // 1. Pincement, les deux doigts posés sur des étiquettes.
  const zoomAvant = Number(await page.locator('.visionneuse').getAttribute('data-zoom'));
  const e1 = await page.locator('.marqueur .marqueur-libelle', { hasText: 'BUREAU 11' }).boundingBox();
  const e2 = await page.locator('.marqueur .marqueur-libelle', { hasText: 'BUREAU 22' }).boundingBox();
  await pincer({ x: e1.x + e1.width / 2, y: e1.y + e1.height / 2 }, { x: e2.x + e2.width / 2, y: e2.y + e2.height / 2 }, 2.2);
  await page.waitForTimeout(300);
  const zoomApres = Number(await page.locator('.visionneuse').getAttribute('data-zoom'));
  console.log(`Pincement sur deux étiquettes : zoom ${zoomAvant} % → ${zoomApres} %`);
  assert.ok(zoomApres > zoomAvant * 1.5, 'le plan doit zoomer');
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.camera').count(), 0, 'le pincement ne doit pas ouvrir l’appareil photo');
  await capture('2-pincement');

  // 3. Deux photos du local « BUREAU 11 », puis dictée sur la dernière.
  await page.locator('.marqueur .marqueur-libelle', { hasText: 'BUREAU 11' }).click();
  await page.locator('.camera-declencheur:not([disabled])').waitFor({ timeout: 30_000 });
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Prendre la photo' }).click();
  await page.waitForFunction(() => !/enregistrement/.test(document.querySelector('.camera-compteur')?.textContent ?? ''), null, { timeout: 60_000 });
  await page.locator('.camera-derniere').getByRole('button', { name: '🎙 Dicter' }).click();
  await page.locator('.camera-info', { hasText: '« CTA non conforme, calorifuge absent » · tags : Non conforme, Calorifuge, CTA' }).waitFor({ timeout: 15_000 });
  await capture('3-dictee');
  await page.goBack();
  await page.locator('.camera').waitFor({ state: 'detached' });

  // 4. Visionneuse : appui long sur la photo, glisser sur la corbeille.
  await page.locator('.marqueur .marqueur-libelle', { hasText: 'BUREAU 11' }).dblclick();
  const voile = page.locator('.voile-photo');
  await voile.waitFor();
  assert.equal(await voile.locator('.photo-position').innerText(), '2/2');
  assert.equal(await voile.locator('textarea').inputValue(), 'CTA non conforme, calorifuge absent');
  const img = await voile.locator('.photo-deplacable').boundingBox();
  const vue = page.viewportSize();
  await page.mouse.move(img.x + img.width / 2, img.y + img.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await voile.locator('.corbeille').waitFor();
  await page.mouse.move(vue.width / 2, vue.height - 60, { steps: 8 });
  await voile.locator('.corbeille.active').waitFor();
  await capture('4-corbeille');
  await page.mouse.up();
  await voile.locator('.corbeille').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.photo-position')?.textContent === '1/1');
  console.log('Photo supprimée par glisser sur la corbeille ; la visionneuse reste ouverte sur la suivante');
  const nb = await page.evaluate(async () => {
    let d = await navigator.storage.getDirectory();
    for (const m of ['projets', `${new Date().getFullYear()}-T07_Ergonomie-fictive`, '_data', 'photos']) d = await d.getDirectoryHandle(m);
    let n = 0;
    for await (const _ of d.keys()) n++;
    return n;
  });
  assert.equal(nb, 1);

  assert.deepEqual(erreurs, []);
  console.log('OK : ergonomie');
} finally {
  await navigateur.close();
  serveur.close();
}
