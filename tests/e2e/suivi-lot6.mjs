// Test de bout en bout du lot 6 (suivi dans le temps), dans Chromium avec une fausse caméra.
// Critère de validation du lot (CONCEPTION §A.8) : « même cadrage à 2 dates ».
//   1. Une photo ancienne (30/10/2026, date lue dans l'EXIF) est placée sur un repère.
//   2. En reprenant ce repère, la visée affiche cette photo en transparence (calque réglable).
//   3. La comparaison avant / après (rideau, côte à côte, frise des dates) s'ouvre depuis la fiche
//      du repère et depuis la visionneuse ; le bouton Retour la ferme.
//   4. La direction de prise de vue se saisit d'un appui sur le plan et se dessine en flèche.
// Usage : npm run build && node --experimental-strip-types tests/e2e/suivi-lot6.mjs   (CAPTURES=dossier)
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { chromium, pdfFictif, servir } from './outils.mjs';
import { insererExif } from '../../src/photo/exif.ts';

const racine = resolve(import.meta.dirname, '../..');
const captures = process.env.CAPTURES;

/** Segment Exif minimal portant une date de prise de vue. */
function exifDate(date) {
  const tiff = [];
  const u16 = (v) => tiff.push(v & 0xff, v >> 8);
  const u32 = (v) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24);
  tiff.push(0x49, 0x49); u16(42); u32(8);
  u16(1);
  u16(0x8769); u16(4); u32(1); u32(26);
  u32(0);
  u16(1);
  u16(0x9003); u16(2); u32(20); u32(44);
  u32(0);
  for (const c of `${date}\u0000`) tiff.push(c.charCodeAt(0));
  const charge = [...'Exif\u0000\u0000'].map((c) => c.charCodeAt(0)).concat(tiff);
  return new Uint8Array([0xff, 0xe1, (charge.length + 2) >> 8, (charge.length + 2) & 0xff, ...charge]);
}

const serveur = await servir(join(racine, 'dist'));
const url = `http://localhost:${serveur.address().port}/`;
const navigateur = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera'] });
await contexte.addInitScript(() => {
  delete window.showDirectoryPicker;
  delete Window.prototype.showDirectoryPicker;
});
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('dialog', (d) => d.accept());
const capture = (nom) => captures && page.screenshot({ path: join(captures, `suivi-${nom}.png`) });
const aujourdhui = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });

try {
  await page.goto(url);
  await page.getByLabel('Initiales ou nom').fill('BL');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: '+ Nouveau projet' }).click();
  await page.getByLabel("Code d'affaire").fill('T06');
  await page.getByLabel('Nom du projet').fill('Suivi fictif');
  await page.getByLabel('Toiture (TT)').uncheck();
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('heading', { name: 'Suivi fictif' }).waitFor();
  await page.locator('input[type=file][accept*=pdf]').setInputFiles({
    name: 'plan R+1.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFictif('Plan fictif R+1', [[200, 400, ['TGBT', 'LT001', '12,5 m²']], [500, 400, ['LOCAL CTA', 'LT002', '30 m²']]]),
  });
  await page.getByRole('button', { name: 'Importer 1 plan' }).click();
  await page.getByText(/Plan importé/).waitFor();
  await page.locator('tr:has(strong:text-is("R+1"))').getByRole('button', { name: 'Ouvrir' }).click();
  await page.locator('.visionneuse[data-fond-pret]').waitFor();
  await page.getByRole('tab', { name: /Locaux/ }).click();
  await page.getByRole('button', { name: 'Détecter les locaux' }).click();
  await page.getByRole('button', { name: 'Enregistrer 2 locaux' }).click();

  // 1. Photo ancienne (30/10/2026) importée, puis placée sur le plan près du TGBT : repère P001.
  const image = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = '#8a6';
    g.fillRect(0, 0, 1600, 1200);
    g.fillStyle = '#123';
    g.fillRect(400, 300, 800, 600);
    const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page.getByRole('tab', { name: /Panier/ }).click();
  await page.locator('input[type=file][accept="image/*,video/*"][multiple]').setInputFiles({
    name: 'IMG_20261030.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(insererExif(new Uint8Array(image), exifDate('2026:10:30 09:15:00'))),
  });
  await page.getByRole('tab', { name: 'Panier (1)' }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Tout cocher (1)' }).click();
  await page.getByRole('button', { name: /^Placer la photo/ }).click();
  const tgbt = await page.locator('.marqueur .marqueur-libelle', { hasText: 'TGBT' }).boundingBox();
  await page.mouse.click(tgbt.x + tgbt.width / 2 + 10, tgbt.y + 80);
  await page.getByText(/1 photo placée sur le nouveau repère P001/).waitFor();

  // 2. Nouvelle visite : appui sur P001 (mode photo) ; la photo du 30/10 est en transparence dans la visée.
  await page.locator('.marqueur-repere .marqueur-libelle', { hasText: 'P001' }).click();
  await page.locator('.camera-declencheur:not([disabled])').waitFor({ timeout: 30_000 });
  const calque = page.locator('.camera-calque');
  await calque.waitFor();
  assert.equal(await calque.evaluate((e) => getComputedStyle(e).opacity), '0.4');
  await page.getByRole('button', { name: /Calque du 30\/10\/26/ }).waitFor();
  await page.getByLabel('Transparence du calque').fill('0.6');
  assert.equal(await calque.evaluate((e) => getComputedStyle(e).opacity), '0.6');
  await capture('1-calque');
  await page.getByRole('button', { name: 'Prendre la photo' }).click();
  await page.waitForFunction(() => !/enregistrement/.test(document.querySelector('.camera-compteur')?.textContent ?? ''), null, { timeout: 60_000 });
  await page.goBack(); // bouton Retour : fin des prises de vue
  await page.locator('.camera').waitFor({ state: 'detached' });
  // Repère existant : pas de fenêtre de rattachement (réservée aux nouveaux repères).
  assert.equal(await page.locator('.fenetre-rattachement').count(), 0);

  // 3. Comparaison avant / après depuis la fiche du repère.
  await page.getByRole('heading', { name: 'Repère P001 · TGBT' }).waitFor();
  await page.getByRole('button', { name: '↔ Avant / après' }).click();
  const comparaison = page.locator('.comparaison');
  await comparaison.waitFor();
  assert.match(await comparaison.locator('.comparaison-etiquette.gauche').innerText(), /Avant · 30\/10\/26/);
  assert.match(await comparaison.locator('.comparaison-etiquette.droite').innerText(), new RegExp(`Après · ${aujourdhui.replaceAll('/', '\\/')}`));
  assert.deepEqual(await comparaison.locator('.frise-date').allInnerTexts(), ['30/10/26', aujourdhui]);
  await comparaison.getByLabel('Position du rideau entre avant et après').fill('30');
  await capture('2-rideau');
  await comparaison.getByRole('button', { name: 'Côte à côte' }).click();
  assert.equal(await comparaison.locator('.comparaison-cote img').count(), 2);
  await capture('3-cote-a-cote');
  // Frise : la photo du jour choisie comme « avant » aussi (même photo des deux côtés).
  await comparaison.getByRole('button', { name: 'Avant', exact: true }).click();
  await comparaison.locator('.frise-photo').last().click();
  assert.equal(await comparaison.locator('.frise-photo.avant.apres').count(), 1);
  await page.goBack(); // Retour : ferme la comparaison, la fiche reste ouverte
  await comparaison.waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: 'Repère P001 · TGBT' }).waitFor();

  // 4. Direction de prise de vue : appui sur le plan, à droite du repère.
  await page.getByRole('button', { name: /Direction de prise de vue/ }).click();
  await page.getByText('Touchez le plan dans la direction où regarde l’appareil photo.').waitFor();
  const p001 = await page.locator('.marqueur-repere-selection').boundingBox();
  await page.mouse.click(p001.x + 200, p001.y);
  const fleche = page.locator('.marqueur-direction');
  await fleche.waitFor();
  const angle = await page.locator('.marqueur-repere-selection').evaluate((e) => parseFloat(e.style.getPropertyValue('--angle')));
  assert.ok(Math.abs(angle) < 0.15, `flèche vers la droite (angle ${angle.toFixed(2)} rad)`);
  await page.getByRole('button', { name: /Changer la direction/ }).waitFor();
  await capture('4-direction');

  // 5. Comparaison depuis la visionneuse : « avant » = photo d'une date antérieure.
  await page.goBack(); // ferme la fiche du repère
  await page.locator('.marqueur-repere .marqueur-libelle', { hasText: 'P001' }).dblclick();
  const voile = page.locator('.voile-photo');
  await voile.waitFor();
  await voile.getByRole('button', { name: '↔ Comparer' }).click();
  await comparaison.waitFor();
  assert.match(await comparaison.locator('.comparaison-etiquette.gauche').innerText(), /30\/10\/26/);
  await page.goBack(); // retour à la visionneuse
  await comparaison.waitFor({ state: 'detached' });
  await voile.waitFor();
  await page.goBack();
  await voile.waitFor({ state: 'detached' });

  // Données : la direction est enregistrée dans le JSON du repère.
  const visee = await page.evaluate(async () => {
    let d = await navigator.storage.getDirectory();
    for (const m of ['projets', `${new Date().getFullYear()}-T06_Suivi-fictif`, '_data', 'reperes']) d = await d.getDirectoryHandle(m);
    for await (const [, h] of d.entries()) return JSON.parse(await (await h.getFile()).text()).visee;
  });
  assert.ok(visee && visee.x > 0 && visee.x <= 1, 'direction enregistrée');

  assert.deepEqual(erreurs, []);
  console.log('OK : suivi dans le temps');
} finally {
  await navigateur.close();
  serveur.close();
}
