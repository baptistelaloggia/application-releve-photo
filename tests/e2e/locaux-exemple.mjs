// Test de bout en bout du 23/11/2026 : plan dont les noms de locaux sont en gras sans surface, et
// le mobilier désigné en maigre avec une surface (« Bureau / 12,6 m² »).
//   1. Le niveau est lu dans le titre « Plan projet R+6 ».
//   2. La détection automatique propose le mobilier ; un encadré tracé autour d'un nom en gras ne
//      garde que les étiquettes de même police et taille.
//   3. « ↶ Annuler » défait l'enregistrement ; sélection et « Tout supprimer » suppriment, et s'annulent.
// Usage : npm run build && node tests/e2e/locaux-exemple.mjs   (CAPTURES=dossier pour les captures)
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { chromium, pdfFictif, servir } from './outils.mjs';

const racine = resolve(import.meta.dirname, '../..');
const captures = process.env.CAPTURES;
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
page.on('dialog', (d) => d.accept());
const capture = (nom) => captures && page.screenshot({ path: join(captures, `exemple-${nom}.png`) });

// Plan fictif : 3 locaux en gras sans surface, 8 désignations de mobilier « Bureau / 12,6 m² ».
const gras = (t) => ({ t, gras: true });
const LOCAUX = [
  [250, 430, 'Open space flex office 01'],
  [480, 430, 'CTA 01'],
  [640, 430, 'WC 01'],
];
const etiquettes = [
  ...LOCAUX.map(([x, y, t]) => [x, y, [gras(t)]]),
  ...Array.from({ length: 8 }, (_, i) => [150 + i * 75, 280, ['Bureau', '12,6 m²']]),
];

try {
  await page.goto(url);
  await page.getByLabel('Initiales ou nom').fill('BL');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: '+ Nouveau projet' }).click();
  await page.getByLabel("Code d'affaire").fill('T08');
  await page.getByLabel('Nom du projet').fill('Exemple fictif');
  await page.getByLabel('Toiture (TT)').uncheck();
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('heading', { name: 'Exemple fictif' }).waitFor();

  // 1. Le niveau vient du titre « Plan projet R+6 » (le nom du fichier n'en dit rien).
  await page.locator('input[type=file][accept*=pdf]').setInputFiles({ name: 'document.pdf', mimeType: 'application/pdf', buffer: pdfFictif('Plan projet R+6', etiquettes) });
  await page.getByRole('button', { name: 'Importer 1 plan' }).waitFor();
  assert.equal(await page.getByLabel('Niveau', { exact: true }).inputValue(), 'R+6');
  await page.getByRole('button', { name: 'Importer 1 plan' }).click();
  await page.getByText(/Plan importé/).waitFor();
  await page.locator('tr:has(strong:text-is("R+6"))').locator('td').first().click();
  await page.locator('.visionneuse[data-fond-pret]').waitFor();
  await page.getByRole('tab', { name: /Locaux/ }).click();

  // 2. Détection automatique : le mobilier « Bureau » est proposé, pas les noms en gras.
  await page.getByRole('button', { name: 'Détecter les locaux' }).click();
  await page.getByRole('button', { name: 'Enregistrer 8 locaux' }).waitFor();
  // Correspondance plan ↔ écran, d'après deux propositions (data-x, data-y relatifs).
  const reperes = await page.locator('.marqueur-candidat').evaluateAll((els) =>
    els.slice(0, 8).map((e) => ({ x: Number(e.dataset.x), y: Number(e.dataset.y), r: e.getBoundingClientRect() })),
  );
  const a = reperes[0];
  const b = reperes[reperes.length - 1];
  const kx = (b.r.left - a.r.left) / (b.x - a.x);
  // Zoom uniforme : en relatif, 1 en x vaut 842 pt et 1 en y vaut 595 pt.
  const versEcran = (rx, ry) => ({ x: a.r.left + (rx - a.x) * kx, y: a.r.top + (ry - a.y) * kx * (595 / 842) });
  // Encadré autour de « Open space flex office 01 » (centre : x = 250 pt, y = 595 − 430 pt).
  await page.getByRole('button', { name: /Encadrer une étiquette de local/ }).click();
  await page.locator('.cadre-selection').waitFor();
  const centre = versEcran(250 / 842, (595 - 432.5) / 595);
  // Échelle verticale : même zoom que l'horizontale (pixels par point).
  const ppp = kx / 842;
  await page.mouse.move(centre.x - 60 * ppp, centre.y - 8 * ppp);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60 * ppp, centre.y + 6 * ppp, { steps: 5 });
  await capture('1-encadre');
  await page.mouse.up();
  await page.getByText(/3 étiquettes du même style que l.exemple encadré/).waitFor();
  const noms = await page.locator('.liste-candidats li button span:first-child').allInnerTexts();
  assert.deepEqual(noms.sort(), ['CTA 01', 'Open space flex office 01', 'WC 01']);
  await capture('2-propositions');
  await page.getByRole('button', { name: 'Enregistrer 3 locaux' }).click();
  await page.getByRole('heading', { name: /Locaux de ce plan \(3\)/ }).waitFor();

  // 3. Annuler l'enregistrement, puis refaire par « D'après un exemple ».
  await page.getByRole('button', { name: /↶ Annuler : 3 locaux enregistrés/ }).click();
  await page.getByRole('heading', { name: /Locaux de ce plan \(0\)/ }).waitFor();
  await page.getByRole('button', { name: 'OK', exact: true }).click(); // ferme le bandeau (le plan reprend sa place)
  await page.getByRole('button', { name: "▭ D'après un exemple" }).click();
  await page.locator('.cadre-selection').waitFor();
  await page.mouse.move(centre.x - 60 * ppp, centre.y - 8 * ppp);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60 * ppp, centre.y + 6 * ppp, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Enregistrer 3 locaux' }).click();
  await page.getByRole('heading', { name: /Locaux de ce plan \(3\)/ }).waitFor();

  // Sélection de 2 locaux, suppression, annulation ; puis « Tout supprimer », annulation.
  await page.getByRole('button', { name: '☑ Sélectionner' }).click();
  await page.getByLabel('Choisir CTA 01').check();
  await page.getByLabel('Choisir WC 01').check();
  await page.getByRole('button', { name: 'Supprimer la sélection (2)' }).click();
  await page.getByRole('heading', { name: /Locaux de ce plan \(1\)/ }).waitFor();
  await page.getByRole('button', { name: /↶ Annuler : 2 locaux supprimés/ }).click();
  await page.getByRole('heading', { name: /Locaux de ce plan \(3\)/ }).waitFor();
  await page.getByRole('button', { name: 'Tout supprimer' }).click();
  await page.getByRole('heading', { name: /Locaux de ce plan \(0\)/ }).waitFor();
  await capture('3-tout-supprime');
  await page.getByRole('button', { name: /↶ Annuler : 3 locaux supprimés/ }).click();
  await page.getByRole('heading', { name: /Locaux de ce plan \(3\)/ }).waitFor();
  // Les données sur le disque suivent : 3 fichiers de locaux.
  const nb = await page.evaluate(async () => {
    let d = await navigator.storage.getDirectory();
    for (const m of ['projets', `${new Date().getFullYear()}-T08_Exemple-fictif`, '_data', 'locaux']) d = await d.getDirectoryHandle(m);
    let n = 0;
    for await (const _ of d.keys()) n++;
    return n;
  });
  assert.equal(nb, 3);

  assert.deepEqual(erreurs, []);
  console.log('OK : détection d’après un exemple, suppression et annulation');
} finally {
  await navigateur.close();
  serveur.close();
}
