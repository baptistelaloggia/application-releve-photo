// Test de bout en bout du lot 4 : aller-retour PC ↔ téléphone par paquets .zip.
// Deux contextes de navigateur, chacun avec son propre stockage, jouent les deux appareils.
// Le « serveur » du PC est simulé par un dossier du stockage interne (choix de dossier simulé).
// Usage : npm run build && node tests/e2e/synchro-lot4.mjs   (CAPTURES=dossier pour les captures)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { arborescenceOpfs, chromium, pdfFictif, servir } from './outils.mjs';

const { devices } = createRequire(import.meta.url)('playwright');
const racine = resolve(import.meta.dirname, '../..');
const captures = process.env.CAPTURES;
/** Nombre de photos de la rafale sur le TGBT (NB_SYNCHRO=300 pour une visite complète). */
const NB = Number(process.env.NB_SYNCHRO ?? 3);
const temp = await mkdtemp(join(tmpdir(), 'paquets-'));

const serveur = await servir(join(racine, 'dist'));
const url = `http://localhost:${serveur.address().port}/`;
const navigateur = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

async function appareil(nom, options) {
  const contexte = await navigateur.newContext({ ...options, permissions: ['camera'], acceptDownloads: true });
  if (nom === 'pc') {
    await contexte.addInitScript(() => {
      window.showDirectoryPicker = async ({ id } = {}) =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(`simule-${id ?? 'x'}`, { create: true });
    });
  }
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`${nom} : ${e}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.getByLabel('Initiales ou nom').fill(nom === 'pc' ? 'BL' : 'BL-tel');
  await page.getByRole('button', { name: 'Continuer' }).click();
  return { page, erreurs, capture: (n) => captures && page.screenshot({ path: join(captures, `synchro-${nom}-${n}.png`), fullPage: nom === 'pc' }) };
}

/** Clique sur « Télécharger » et enregistre le paquet sur le disque. */
async function telecharger(page, nomFichier) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger' }).click()]);
  const chemin = join(temp, nomFichier);
  await dl.saveAs(chemin);
  console.log(`Paquet : ${dl.suggestedFilename()}`);
  return { chemin, nom: dl.suggestedFilename() };
}

const pc = await appareil('pc', { viewport: { width: 1280, height: 900 } });
const tel = await appareil('telephone', { ...devices['Pixel 7'] });

try {
  // ---------------------------------------------------------------- PC : préparation du projet
  let p = pc.page;
  await p.getByRole('button', { name: '+ Nouveau projet' }).click();
  await p.getByLabel("Code d'affaire").fill('T04');
  await p.getByLabel('Nom du projet').fill('Synchro fictive');
  await p.getByLabel('Toiture (TT)').uncheck();
  await p.getByRole('button', { name: /créer/i }).click();
  await p.getByRole('heading', { name: 'Synchro fictive' }).waitFor();
  const dossier = `${new Date().getFullYear()}-T04_Synchro-fictive`;
  await p.locator('input[type=file][accept*=pdf]').setInputFiles({
    name: 'plan R+1.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFictif('Plan fictif R+1', [
      [200, 400, ['TGBT', 'LT001', '12,5 m²']],
      [500, 400, ['LOCAL CTA', 'LT002', '30 m²']],
    ]),
  });
  await p.getByRole('button', { name: 'Importer 1 plan' }).click();
  await p.getByText(/Plan importé/).waitFor();
  await p.getByRole('button', { name: 'Détecter les locaux sur tous les plans…' }).click();
  await p.getByRole('button', { name: 'Lancer la détection' }).click();
  await p.getByRole('button', { name: 'Enregistrer 2 locaux' }).click();
  await p.getByText(/2 locaux enregistrés/).waitFor();

  await p.getByRole('button', { name: 'Préparer le paquet pour le téléphone' }).click();
  await p.getByText('Paquet prêt :').waitFor();
  const aller = await telecharger(p, 'aller.zip');
  assert.match(aller.nom, new RegExp(`^${dossier}_pour-telephone_\\d{4}-\\d{2}-\\d{2}_\\d{4}\\.zip$`));

  // ---------------------------------------------------------------- téléphone : réception, visite
  p = tel.page;
  await p.locator('input[type=file][accept*=zip]').setInputFiles(aller.chemin);
  await p.getByRole('heading', { name: 'Synchro fictive' }).waitFor();
  await p.getByText(/Paquet de préparation de visite, préparé par BL/).waitFor();
  await tel.capture('1-apercu-aller');
  await p.getByRole('button', { name: 'Importer et ranger' }).click();
  await p.getByText(/Paquet importé/).waitFor();
  assert.equal(await p.locator('tbody tr').first().locator('.lien-niveau').count(), 1);

  await p.locator('.lien-niveau', { hasText: 'R+1' }).click();
  await p.locator('.visionneuse[data-fond-pret]').waitFor();
  // Appui sur l'étiquette du TGBT : photo du local, rafale de NB photos.
  await p.locator('.marqueur .marqueur-libelle', { hasText: 'LT001' }).click();
  await p.getByText('R+1 · LT001 TGBT · photo du local').waitFor();
  await p.locator('.camera-declencheur:not([disabled])').waitFor({ timeout: 30_000 });
  for (let i = 0; i < NB; i++) await p.getByRole('button', { name: 'Prendre la photo' }).click();
  await p.waitForFunction(() => !/enregistrement/.test(document.querySelector('.camera-compteur')?.textContent ?? ''), null, { timeout: 600_000 });
  await p.getByRole('button', { name: '✕ Retour au plan' }).click();
  // Une photo importée dans le panier (image différente : la fausse caméra donne toujours la même).
  await p.getByRole('button', { name: 'Fermer' }).first().click();
  await p.getByRole('tab', { name: /Panier/ }).click();
  const image = await p.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d');
    g.fillStyle = '#c33';
    g.fillRect(50, 50, 300, 200);
    const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await p.locator('input[type=file][accept="image/*"][multiple]').setInputFiles({ name: 'IMG_panier.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(image) });
  await p.getByRole('tab', { name: 'Panier (1)' }).waitFor({ timeout: 30_000 });
  await p.getByRole('button', { name: '← Projet' }).click();

  const t0 = Date.now();
  await p.getByRole('button', { name: `Exporter la visite pour le serveur (${NB + 1} photos)` }).click();
  await p.getByText('Paquet prêt :').waitFor({ timeout: 600_000 });
  console.log(`Export du téléphone : ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await tel.capture('2-export-retour');
  const retour = await telecharger(p, 'retour.zip');
  assert.match(retour.nom, /_retour-terrain_/);
  // Les photos exportées ne sont plus comptées comme nouvelles.
  await p.getByRole('button', { name: 'Exporter la visite pour le serveur (0 photo)' }).waitFor();

  // ---------------------------------------------------------------- PC : retour de terrain
  p = pc.page;
  await p.locator('section:has(h2:text("Échanges")) input[type=file]').setInputFiles(retour.chemin);
  await p.getByText(/Paquet de retour de terrain, préparé par BL-tel/).waitFor();
  const apercu = await p.locator('.apercu-import tbody').innerText();
  console.log('Aperçu :', apercu.replace(/\s*\n\s*/g, ' | '));
  // La fausse caméra renvoie souvent la même image : les doublons exacts sont écartés.
  const nouvelles = Number(/Photos nouvelles\s+(\d+)/.exec(apercu)[1]);
  assert.ok(nouvelles >= 2 && nouvelles <= NB + 1, `photos nouvelles : ${nouvelles}`);
  await pc.capture('3-apercu-retour');
  const t1 = Date.now();
  await p.getByRole('button', { name: 'Importer et ranger' }).click();
  await p.getByText(new RegExp(`${nouvelles} photos rangées en`)).waitFor({ timeout: 600_000 });
  console.log(`Import sur le PC : ${((Date.now() - t1) / 1000).toFixed(1)} s`);

  const jour = await p.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const arbo = await arborescenceOpfs(p, `simule-parent-projets/${dossier}/01_PHOTOS`);
  const jpg = arbo.filter((l) => l.endsWith('.jpg'));
  if (NB <= 5) console.log(jpg.join('\n'));
  // Rafale de la fausse caméra : images souvent identiques, écartées comme doublons à l'import.
  const tgbt = jpg.filter((l) => l.startsWith('01_R+1/R+1.LT001_TGBT/'));
  assert.ok(tgbt.length >= 1 && tgbt.length <= NB);
  assert.equal(tgbt[0], `01_R+1/R+1.LT001_TGBT/T04_R+1.LT001_P001_${jour}_01.jpg`);
  assert.equal(jpg.filter((l) => l.startsWith('_A-CLASSER/')).length, 1);

  // Un second import du même paquet ne change rien.
  await p.locator('section:has(h2:text("Échanges")) input[type=file]').setInputFiles(retour.chemin);
  await p.getByRole('button', { name: 'Rien de nouveau dans ce paquet' }).waitFor();
  await p.getByRole('button', { name: 'Annuler' }).click();

  // Le serveur a bien tout : réouverture et contrôle du rangement.
  await p.getByRole('button', { name: 'Actualiser et vérifier' }).click();
  await p.getByText('Arborescence vérifiée : tout est en ordre.').waitFor();
  assert.deepEqual([...pc.erreurs, ...tel.erreurs], []);
  console.log('OK : synchro');
} finally {
  await navigateur.close();
  serveur.close();
}
