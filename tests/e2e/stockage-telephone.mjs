// Test de bout en bout du 24/11/2026, sur un téléphone simulé (Pixel 7) :
//   1. un paquet importé alors qu'il reste le dossier d'un import interrompu (sans projet complet) :
//      le reste est remplacé et le projet s'ouvre (avant : « Un dossier … existe déjà ») ;
//   2. « Stockage du téléphone » : les dossiers du stockage interne, y compris incomplets, se suppriment.
// Usage : npm run build && node tests/e2e/stockage-telephone.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, servir } from './outils.mjs';

const { devices } = createRequire(import.meta.url)('playwright');
const racine = resolve(import.meta.dirname, '../..');
const temp = mkdtempSync(join(tmpdir(), 'stockage-'));
const serveur = await servir(join(racine, 'dist'));
const url = `http://localhost:${serveur.address().port}/`;
const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({ ...devices['Pixel 7'] });
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('dialog', (d) => d.accept());
const dossier = `${new Date().getFullYear()}-T09_Stockage-fictif`;
const stockage = page.locator('section.carte', { has: page.getByRole('heading', { name: 'Stockage du téléphone' }) });

try {
  await page.goto(url);
  await page.getByLabel('Initiales ou nom').fill('BL-tel');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: '+ Nouveau projet' }).click();
  await page.getByLabel("Code d'affaire").fill('T09');
  await page.getByLabel('Nom du projet').fill('Stockage fictif');
  await page.getByLabel('Toiture (TT)').uncheck();
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('heading', { name: 'Stockage fictif' }).waitFor();
  await page.getByRole('button', { name: /Exporter la visite pour le serveur/ }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger' }).click()]);
  const paquet = join(temp, 'paquet.zip');
  await dl.saveAs(paquet);

  // 1. Import interrompu simulé : le dossier reste, sans projet.json, et le projet n'est plus listé.
  await page.goBack();
  await page.getByRole('button', { name: '+ Nouveau projet' }).waitFor();
  await page.getByRole('button', { name: 'Retirer' }).click();
  await page.evaluate(async (d) => {
    const p = await (await navigator.storage.getDirectory()).getDirectoryHandle('projets');
    await (await (await p.getDirectoryHandle(d)).getDirectoryHandle('_data')).removeEntry('projet.json');
  }, dossier);
  await page.reload();
  await stockage.getByText('dossier incomplet').waitFor();
  await page.locator('input[type=file][accept*=zip]').setInputFiles(paquet);
  await page.getByRole('heading', { name: 'Stockage fictif' }).waitFor({ timeout: 30_000 });
  console.log('Import par-dessus un dossier incomplet : le projet s’ouvre');

  // 2. Suppression depuis « Stockage du téléphone » : le projet, puis un reste incomplet.
  await page.goBack();
  await stockage.getByText(`${dossier} · 0 photo`).waitFor();
  await page.evaluate(async () => {
    const p = await (await navigator.storage.getDirectory()).getDirectoryHandle('projets');
    await (await p.getDirectoryHandle('2026-T09_Reste', { create: true })).getDirectoryHandle('_data', { create: true });
  });
  await page.reload();
  await stockage.getByText('2026-T09_Reste · dossier incomplet').waitFor();
  assert.equal(await stockage.locator('li').count(), 2);
  for (let i = 0; i < 2; i++) await stockage.getByRole('button', { name: 'Supprimer' }).first().click();
  await stockage.getByText('Aucun projet sur ce téléphone.').waitFor();
  assert.equal(await page.getByText('Aucun projet ouvert sur cet appareil pour l’instant.'.replace('’', "'")).count(), 1, 'retiré des projets récents');
  const reste = await page.evaluate(async () => {
    const p = await (await navigator.storage.getDirectory()).getDirectoryHandle('projets');
    const noms = [];
    for await (const n of p.keys()) noms.push(n);
    return noms;
  });
  assert.deepEqual(reste, []);

  assert.deepEqual(erreurs, []);
  console.log('OK : stockage du téléphone');
} finally {
  await navigateur.close();
  serveur.close();
}
