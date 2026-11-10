// Test de bout en bout du lot 3 (terrain), dans Chromium avec une fausse caméra.
// Critère de validation du lot (CONCEPTION §A.8) : une visite de 300 photos en mode avion.
// Usage : npm run build && node --experimental-strip-types tests/e2e/terrain-lot3.mjs
// Variables : NB_PHOTOS (300 par défaut), CAPTURES=dossier pour les captures d'écran.
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { arborescenceOpfs, chromium, pdfFictif, servir } from './outils.mjs';
import { extraireExif, insererExif, lireInfosExif } from '../../src/photo/exif.ts';

const racine = resolve(import.meta.dirname, '../..');
const NB_PHOTOS = Number(process.env.NB_PHOTOS ?? 300);
const captures = process.env.CAPTURES;

/** Segment Exif minimal : orientation 6 (photo prise en portrait) et date de prise de vue. */
function exifFictif(date) {
  const tiff = [];
  const u16 = (v) => tiff.push(v & 0xff, v >> 8);
  const u32 = (v) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24);
  tiff.push(0x49, 0x49); u16(42); u32(8);
  u16(2);
  u16(0x0112); u16(3); u32(1); u16(6); u16(0);
  u16(0x8769); u16(4); u32(1); u32(38);
  u32(0);
  u16(1);
  u16(0x9003); u16(2); u32(20); u32(56);
  u32(0);
  for (const c of `${date}\u0000`) tiff.push(c.charCodeAt(0));
  const charge = [...'Exif\u0000\u0000'].map((c) => c.charCodeAt(0)).concat(tiff);
  return new Uint8Array([0xff, 0xe1, (charge.length + 2) >> 8, (charge.length + 2) & 0xff, ...charge]);
}

const serveur = await servir(join(racine, 'dist'));
const url = `http://localhost:${serveur.address().port}/`;
const navigateur = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera'] });
// Comme sur un téléphone : pas de choix de dossier, projets dans le stockage interne.
await contexte.addInitScript(() => {
  delete window.showDirectoryPicker;
  delete Window.prototype.showDirectoryPicker;
});
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('dialog', (d) => d.accept());
const capture = (nom) => captures && page.screenshot({ path: join(captures, `terrain-${nom}.png`) });

async function attendreEnregistrements() {
  await page.waitForFunction(() => !document.querySelector('.enregistrement') && !/enregistrement/.test(document.querySelector('.camera-compteur')?.textContent ?? ''), null, { timeout: 600_000 });
}

/** Appui long sur le plan, un peu sous l'étiquette d'un local (en pixels écran). */
async function appuiLongPres(texteMarqueur) {
  const p = await page.evaluate((t) => {
    const m = [...document.querySelectorAll('.marqueur')].find((e) => e.textContent === t);
    const r = m.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }, texteMarqueur);
  await page.mouse.move(p.x + 4, p.y + 6);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

async function declencher(n) {
  const bouton = page.getByRole('button', { name: 'Prendre la photo' });
  await page.locator('.camera-declencheur:not([disabled])').waitFor({ timeout: 30_000 });
  // Appuis enchaînés sans attendre, comme en rafale : aucun ne doit être perdu.
  for (let i = 0; i < n; i++) await bouton.click({ delay: 0 });
}

try {
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready); // appli en cache pour le mode avion
  await page.getByLabel('Initiales ou nom').fill('BL');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: '+ Nouveau projet' }).click();
  await page.getByLabel("Code d'affaire").fill('T03');
  await page.getByLabel('Nom du projet').fill('Visite fictive');
  await page.getByLabel('Toiture (TT)').uncheck();
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('heading', { name: 'Visite fictive' }).waitFor();
  const dossierProjet = `projets/${new Date().getFullYear()}-T03_Visite-fictive`;

  await page.locator('input[type=file][accept*=pdf]').setInputFiles({
    name: 'plan R+1.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFictif('Plan fictif R+1', [
      [200, 400, ['TGBT', 'LT001', '12,5 m²']],
      [500, 400, ['LOCAL CTA', 'LT002', '30 m²']],
      [400, 200, ['BUREAUX']],
    ]),
  });
  await page.getByRole('button', { name: 'Importer 1 plan' }).click();
  await page.getByText(/Plan importé/).waitFor();
  await page.locator('tr:has(strong:text-is("R+1"))').getByRole('button', { name: 'Ouvrir' }).click();
  await page.locator('.visionneuse[data-fond-pret]').waitFor();
  await page.getByRole('tab', { name: /Locaux/ }).click();
  await page.getByRole('button', { name: 'Détecter les locaux' }).click();
  await page.getByRole('button', { name: 'Enregistrer 3 locaux' }).click();
  await page.getByRole('tab', { name: 'Terrain' }).click();

  // 1. Appui long près du TGBT : repère P001 rattaché au TGBT, visée ouverte ; rafale de 3 photos.
  await appuiLongPres('LT001');
  await page.getByText('P001 · R+1 · LT001 TGBT').waitFor();
  await page.locator('.camera-declencheur:not([disabled])').waitFor({ timeout: 30_000 });
  await capture('1-visee');
  await declencher(3);
  await attendreEnregistrements();
  await page.getByRole('button', { name: '✕ Retour au plan' }).click();
  await page.getByRole('heading', { name: 'Repère P001' }).waitFor();
  await capture('2-fiche-repere');
  if ((await page.locator('.grille-photos .vignette').count()) !== 3) {
    console.log('Erreur affichée :', await page.locator('.message-erreur').allInnerTexts());
    console.log(await arborescenceOpfs(page, `${dossierProjet}`));
  }
  assert.equal(await page.locator('.grille-photos .vignette').count(), 3);

  // 2. Appui long sur les BUREAUX (sans numéro) : le local reçoit un numéro automatique à la 1re photo.
  await page.getByRole('button', { name: 'Fermer' }).first().click();
  await appuiLongPres('BUREAUX');
  await page.getByText(/P002 · R\+1 · BUREAUX/).waitFor();
  await declencher(1);
  await attendreEnregistrements();
  await page.getByRole('button', { name: '✕ Retour au plan' }).click();

  const jour = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  let arbo = await arborescenceOpfs(page, `${dossierProjet}/01_PHOTOS`);
  assert.deepEqual(arbo.filter((l) => l.endsWith('.jpg')), [
    `01_R+1/R+1.LT001_TGBT/T03_R+1.LT001_P001_${jour}_01.jpg`,
    `01_R+1/R+1.LT001_TGBT/T03_R+1.LT001_P001_${jour}_02.jpg`,
    `01_R+1/R+1.LT001_TGBT/T03_R+1.LT001_P001_${jour}_03.jpg`,
    `01_R+1/R+1.R1-01_BUREAUX/T03_R+1.R1-01_P002_${jour}_01.jpg`,
  ]);

  // 3. Mode avion : rechargement hors ligne, puis visite de NB_PHOTOS photos sur le repère P001.
  await contexte.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /Visite fictive/ }).click();
  await page.locator('tr:has(strong:text-is("R+1"))').getByRole('button', { name: 'Ouvrir' }).click();
  await page.locator('.visionneuse[data-fond-pret]').waitFor();
  await page.locator('.marqueur-repere .marqueur-libelle', { hasText: 'P001' }).click(); // appui sur un repère : photo
  const t0 = Date.now();
  await declencher(NB_PHOTOS);
  const tPrise = (Date.now() - t0) / 1000;
  await attendreEnregistrements();
  const tTotal = (Date.now() - t0) / 1000;
  console.log(`Mode avion : ${NB_PHOTOS} photos prises en ${tPrise.toFixed(0)} s, toutes enregistrées en ${tTotal.toFixed(0)} s`);
  await capture('3-rafale');
  await page.getByRole('button', { name: '✕ Retour au plan' }).click();

  // 4. Photo sans repère, dans le panier, puis classée sur le repère P002.
  await page.getByRole('button', { name: 'Fermer' }).first().click(); // ferme la fiche du repère P001
  await page.getByRole('button', { name: '📷 Photo sans repère' }).first().click();
  await page.getByText('Photo sans repère → panier à classer').waitFor();
  await declencher(1);
  await attendreEnregistrements();
  await page.getByRole('button', { name: '✕ Retour au plan' }).click();
  await page.getByRole('tab', { name: 'Panier (1)' }).click();
  await page.getByRole('button', { name: 'Placer' }).click();
  await page.locator('.marqueur-repere .marqueur-libelle', { hasText: 'P002' }).click();
  await page.getByRole('heading', { name: 'Repère P002' }).waitFor();
  assert.equal(await page.locator('.grille-photos .vignette').count(), 2);

  // 5. Import d'une grande photo de téléphone (4 000 × 3 000, prise en portrait, EXIF daté) :
  //    compression, redressement, EXIF conservé, date de prise de vue reprise de l'EXIF.
  await contexte.setOffline(false);
  const grande = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4000;
    c.height = 3000;
    const g = c.getContext('2d');
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `hsl(${(i * 37) % 360} 60% ${30 + (i % 50)}%)`;
      g.fillRect((i * 997) % 4000, (i * 613) % 3000, 40 + (i % 200), 30 + (i % 150));
    }
    g.fillStyle = '#000';
    g.font = '120px sans-serif';
    for (let y = 200; y < 3000; y += 300) g.fillText('Plaque signalétique CTA 2 — 12 500 m3/h', 100, y);
    const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.95));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  const original = insererExif(new Uint8Array(grande), exifFictif('2026:10:30 14:05:09'));
  console.log(`Photo importée : ${(original.length / 1024 / 1024).toFixed(1)} Mo`);
  await page.getByRole('button', { name: 'Fermer' }).first().click(); // ferme la fiche du repère
  await page.getByRole('tab', { name: 'Panier (0)' }).click();
  await page.getByText('Le panier est vide.').waitFor();
  await page.locator('input[type=file][accept="image/*"][multiple]').setInputFiles({
    name: 'IMG_20261030_140509.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(original),
  });
  await page.getByRole('tab', { name: 'Panier (1)' }).waitFor({ timeout: 60_000 });
  const infos = await page.evaluate(async (chemin) => {
    let d = await navigator.storage.getDirectory();
    for (const m of chemin.split('/')) d = await d.getDirectoryHandle(m);
    for await (const [, h] of d.entries()) {
      const p = JSON.parse(await (await h.getFile()).text());
      if (p.source !== 'import') continue;
      let f = await navigator.storage.getDirectory();
      const morceaux = `${chemin.replace('/_data/photos', '')}/${p.fichier}`.split('/');
      for (const m of morceaux.slice(0, -1)) f = await f.getDirectoryHandle(m);
      const fichier = await (await f.getFileHandle(morceaux.at(-1))).getFile();
      return { ...p, octets: [...new Uint8Array(await fichier.arrayBuffer()).slice(0, 4096)] };
    }
  }, `${dossierProjet}/_data/photos`);
  console.log(`Après compression : ${infos.largeur} × ${infos.hauteur}, ${(infos.taille / 1024 / 1024).toFixed(2)} Mo, date ${infos.date}`);
  assert.equal(infos.largeur, 2448); // redressée : portrait
  assert.equal(infos.hauteur, 3264);
  assert.ok(infos.taille <= 1.5 * 1024 * 1024, 'photo trop lourde');
  assert.equal(infos.date, '2026-10-30');
  const exif = lireInfosExif(extraireExif(new Uint8Array(infos.octets)));
  assert.deepEqual(exif, { orientation: 1, dateOriginale: new Date(2026, 9, 30, 14, 5, 9) });

  arbo = await arborescenceOpfs(page, `${dossierProjet}/01_PHOTOS`);
  const nb = arbo.filter((l) => l.startsWith('01_R+1/R+1.LT001_TGBT/') && l.endsWith('.jpg')).length;
  assert.equal(nb, 3 + NB_PHOTOS);
  const donnees = await arborescenceOpfs(page, `${dossierProjet}/_data/photos`);
  assert.equal(donnees.length, 3 + NB_PHOTOS + 1 + 1 + 1);
  assert.deepEqual(erreurs, []);
  console.log('OK : terrain');
} finally {
  await navigateur.close();
  serveur.close();
}
