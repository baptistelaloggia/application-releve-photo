// Test de bout en bout du regroupement des photos du panier (CONCEPTION §A.6 nonies), dans Chromium.
// Photos fictives dessinées dans le navigateur (deux « locaux » d'aspects différents), datées et
// géolocalisées par un EXIF fabriqué ici, comme des photos de l'appareil photo du téléphone importées.
// Usage : npm run build && node --experimental-strip-types --no-warnings tests/e2e/regroupement-panier.mjs
// Variable : CAPTURES=dossier pour les captures d'écran.
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { arborescenceOpfs, chromium, pdfFictif, servir } from './outils.mjs';
import { insererExif } from '../../src/photo/exif.ts';

const racine = resolve(import.meta.dirname, '../..');
const captures = process.env.CAPTURES;

/** Segment Exif (petit-boutiste) : date de prise de vue et position GPS (degrés décimaux, nord et est). */
function exifDateGps(date, lat, lon) {
  const tiff = [];
  const u16 = (v) => tiff.push(v & 0xff, v >> 8);
  const u32 = (v) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24);
  const rationnels = (deg) => {
    const d = Math.floor(deg);
    const m = Math.floor((deg - d) * 60);
    const s = Math.round(((deg - d) * 60 - m) * 60 * 1000);
    u32(d); u32(1); u32(m); u32(1); u32(s); u32(1000);
  };
  tiff.push(0x49, 0x49); u16(42); u32(8);
  u16(2); // IFD0 en 8 : Exif et GPS (2 + 24 + 4 = 30 octets)
  u16(0x8769); u16(4); u32(1); u32(38);
  u16(0x8825); u16(4); u32(1); u32(76);
  u32(0);
  u16(1); // IFD Exif en 38 (18 octets) ; date en 56 (20 octets)
  u16(0x9003); u16(2); u32(20); u32(56);
  u32(0);
  for (const c of `${date}\u0000`) tiff.push(c.charCodeAt(0));
  u16(4); // IFD GPS en 76 (2 + 48 + 4 = 54 octets) ; valeurs en 130 et 154
  u16(1); u16(2); u32(2); tiff.push(0x4e, 0, 0, 0);
  u16(2); u16(5); u32(3); u32(130);
  u16(3); u16(2); u32(2); tiff.push(0x45, 0, 0, 0);
  u16(4); u16(5); u32(3); u32(154);
  u32(0);
  rationnels(lat);
  rationnels(lon);
  const charge = [...'Exif\u0000\u0000'].map((c) => c.charCodeAt(0)).concat(tiff);
  return new Uint8Array([0xff, 0xe1, (charge.length + 2) >> 8, (charge.length + 2) & 0xff, ...charge]);
}

const serveur = await servir(join(racine, 'dist'));
const url = `http://localhost:${serveur.address().port}/`;
const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
await contexte.addInitScript(() => {
  delete window.showDirectoryPicker;
  delete Window.prototype.showDirectoryPicker;
});
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
const capture = (nom) => captures && page.screenshot({ path: join(captures, `regroupement-${nom}.png`), fullPage: true });

/** Photo fictive JPEG (1 200 × 1 600) : « comptage » (coffrets beiges) ou « hydraulique » (tuyauteries). */
async function photoFictive(scene, graine) {
  const octets = await page.evaluate(
    async ([scene, graine]) => {
      let a = graine * 9301 + 49297;
      const hasard = () => ((a = (a * 9301 + 49297) % 233280) / 233280);
      const c = new OffscreenCanvas(1200, 1600);
      const g = c.getContext('2d');
      if (scene === 'comptage') {
        g.fillStyle = '#e9e4da';
        g.fillRect(0, 0, 1200, 1600);
        for (let i = 0; i < 4; i++) {
          const x = 60 + i * 290 + hasard() * 40;
          g.fillStyle = '#e8d9bd';
          g.fillRect(x, 300 + hasard() * 80, 250, 900);
          g.fillStyle = '#c9cbcf';
          g.fillRect(x + 40, 520 + hasard() * 60, 170, 330);
          g.fillStyle = '#c6e86b';
          g.beginPath();
          g.arc(x + 60, 560, 14, 0, 7);
          g.fill();
        }
        g.fillStyle = '#222';
        for (let i = 0; i < 6; i++) g.fillRect(100 + i * 180 + hasard() * 30, 0, 26, 320);
      } else {
        g.fillStyle = '#5c5f63';
        g.fillRect(0, 0, 1200, 1600);
        g.fillStyle = '#9b9a98';
        g.fillRect(0, 1150, 1200, 450);
        for (let i = 0; i < 5; i++) {
          const x = 30 + i * 240 + hasard() * 50;
          const d = g.createLinearGradient(x, 0, x + 170, 0);
          d.addColorStop(0, '#8d9399');
          d.addColorStop(0.45, '#f4f6f8');
          d.addColorStop(1, '#7c838a');
          g.fillStyle = d;
          g.fillRect(x, 120 + hasard() * 100, 170, 1100);
        }
        g.fillStyle = '#a3322a';
        g.fillRect(0, 300 + hasard() * 60, 1200, 60);
      }
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      return [...new Uint8Array(await blob.arrayBuffer())];
    },
    [scene, graine],
  );
  return new Uint8Array(octets);
}

const lat = 48.8566;
const lon = 2.3522;
/** Photo « du téléphone » : JPEG fictif avec date de prise de vue et position GPS ; sans date : null. */
async function fichier(nom, scene, graine, date) {
  const jpeg = await photoFictive(scene, graine);
  const buffer = Buffer.from(date ? insererExif(jpeg, exifDateGps(date, lat, lon)) : jpeg);
  return { name: nom, mimeType: 'image/jpeg', buffer };
}

async function versUnLocal(numeroGroupe, recherche, nomResultat) {
  const groupe = page.getByRole('region', { name: `Groupe ${numeroGroupe}` });
  await groupe.getByRole('button', { name: 'Vers un local…' }).click();
  await groupe.getByLabel('Rechercher un local').fill(recherche);
  await groupe.getByRole('option', { name: nomResultat }).click();
}

async function afficherGroupes() {
  const onglet = page.getByRole('tab', { name: 'Par groupes' });
  if ((await onglet.getAttribute('aria-selected')) !== 'true') await onglet.click();
  await page.locator('.groupe-regroupement').first().waitFor({ timeout: 180_000 });
}

try {
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Page rechargée sous le contrôle du Service Worker, comme à chaque ouverture de l'appli installée.
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByLabel('Initiales ou nom').fill('BL');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: '+ Nouveau projet' }).click();
  await page.getByLabel("Code d'affaire").fill('T09');
  await page.getByLabel('Nom du projet').fill('Regroupement fictif');
  await page.getByLabel('Toiture (TT)').uncheck();
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('heading', { name: 'Regroupement fictif' }).waitFor();
  const dossierProjet = `projets/${new Date().getFullYear()}-T09_Regroupement-fictif`;
  await page.locator('input[type=file][accept*=pdf]').setInputFiles({
    name: 'plan SS1.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFictif('Plan fictif SS1', [
      [200, 400, ['LOCAL COMPTAGE', 'LT001', '12 m²']],
      [500, 400, ['SOUS-STATION', 'LT002', '30 m²']],
    ]),
  });
  await page.getByRole('button', { name: 'Importer 1 plan' }).click();
  await page.getByText(/Plan importé/).waitFor();
  await page.locator('tr:has(strong:text-is("SS1"))').getByRole('button', { name: 'Ouvrir' }).click();
  await page.locator('.visionneuse[data-fond-pret]').waitFor();
  await page.getByRole('tab', { name: /Locaux/ }).click();
  await page.getByRole('button', { name: 'Détecter les locaux' }).click();
  await page.getByRole('button', { name: 'Enregistrer 2 locaux' }).click();

  // 1. Import de 7 photos « du téléphone », dans le désordre : 3 au comptage (10 h 00), 3 à la
  //    sous-station (10 h 06), et 1 photo du comptage sans EXIF (transférée par messagerie).
  await page.getByRole('tab', { name: 'Panier (0)' }).click();
  const fichiers = [
    await fichier('IMG_0004.jpg', 'hydraulique', 4, '2026:11:18 10:06:00'),
    await fichier('IMG_0001.jpg', 'comptage', 1, '2026:11:18 10:00:00'),
    await fichier('IMG_0005.jpg', 'hydraulique', 5, '2026:11:18 10:06:30'),
    await fichier('IMG_0002.jpg', 'comptage', 2, '2026:11:18 10:00:20'),
    await fichier('IMG_0006.jpg', 'hydraulique', 6, '2026:11:18 10:07:10'),
    await fichier('IMG_0003.jpg', 'comptage', 3, '2026:11:18 10:00:50'),
    await fichier('WhatsApp-comptage.jpg', 'comptage', 7, null),
  ];
  await page.locator('input[type=file][accept="image/*,video/*"][multiple]').setInputFiles(fichiers);
  await page.getByRole('tab', { name: 'Panier (7)' }).waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => !document.querySelector('.enregistrement'), null, { timeout: 120_000 });

  // 2. Vue « Par groupes » : reconnaissance chargée, deux groupes.
  const debut = Date.now();
  await afficherGroupes();
  console.log(`Analyse et regroupement de 7 photos : ${((Date.now() - debut) / 1000).toFixed(1)} s`);
  assert.equal(await page.getByText(/Reconnaissance visuelle indisponible/).count(), 0, 'la reconnaissance visuelle doit être chargée');
  await capture('1-groupes');
  const groupes = await page.locator('.groupe-regroupement').evaluateAll((sections) =>
    sections.map((s) => [...s.querySelectorAll('input[type=checkbox]')].map((c) => c.getAttribute('aria-label').split(' ')[1])),
  );
  console.log('Groupes :', JSON.stringify(groupes));
  assert.deepEqual(groupes, [
    ['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg', 'WhatsApp-comptage.jpg'],
    ['IMG_0004.jpg', 'IMG_0005.jpg', 'IMG_0006.jpg'],
  ]);
  assert.match(await page.getByRole('region', { name: 'Groupe 1' }).innerText(), /4 photos · 18\/11 10:00 · GPS/);

  // 3. Groupe 1 vers le local « LOCAL COMPTAGE », par la recherche.
  await versUnLocal(1, 'comptage', /LOCAL COMPTAGE/);
  await page.getByText('4 photos placées sur le local LOCAL COMPTAGE (SS1).').waitFor();
  await page.getByRole('tab', { name: 'Panier (3)', selected: true }).waitFor();

  // 4. Il reste un groupe ; une photo décochée reste au panier.
  await afficherGroupes();
  assert.equal(await page.locator('.groupe-regroupement').count(), 1);
  await page.getByLabel('Garder IMG_0006.jpg dans le groupe 1').uncheck();
  await versUnLocal(1, 'sous', /SOUS-STATION/);
  await page.getByText('2 photos placées sur le local SOUS-STATION (SS1).').waitFor();
  await page.getByRole('tab', { name: 'Panier (1)', selected: true }).waitFor();

  // 5. Rangement sur le disque, et reconnaissance gardée pour l'usage hors ligne.
  const arbre = await arborescenceOpfs(page, `${dossierProjet}/01_PHOTOS`);
  const noms = arbre;
  // La photo sans EXIF garde la date de son fichier (celle du transfert).
  assert.equal(noms.filter((l) => /COMPTAGE_P001_\d{4}-\d{2}-\d{2}_0\d\.jpg$/.test(l)).length, 4, arbre.join('\n'));
  assert.equal(noms.filter((l) => /SOUS-STATION_P002_2026-11-18_0[12]\.jpg$/.test(l)).length, 2, arbre.join('\n'));
  const enCache = await page.evaluate(async () => (await (await caches.open('reconnaissance')).keys()).map((r) => r.url.split('/').pop()));
  console.log('Cache hors ligne :', enCache.join(', '));
  assert.ok(enCache.includes('mobilenet_v3_large.tflite') && enCache.includes('vision_wasm_internal.wasm'));

  assert.deepEqual(erreurs, []);
  console.log('Regroupement du panier : OK');
} catch (e) {
  await capture('echec');
  console.error(e);
  process.exitCode = 1;
} finally {
  await navigateur.close();
  serveur.close();
}
