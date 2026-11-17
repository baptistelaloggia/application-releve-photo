// Test de bout en bout du lot 5 : échanges par le transit SharePoint, avec une imitation de
// Microsoft Graph (tests/e2e/outils.mjs). Seule la connexion Microsoft (MSAL) n'est pas exercée :
// les deux appareils utilisent un jeton fictif.
// Usage : npm run build && node tests/e2e/transit-lot5.mjs   (CAPTURES=dossier pour les captures)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { arborescenceOpfs, chromium, pdfFictif, servirAvecGraphe } from './outils.mjs';

const { devices } = createRequire(import.meta.url)('playwright');
const racine = resolve(import.meta.dirname, '../..');
const captures = process.env.CAPTURES;
const { serveur, graphe } = await servirAvecGraphe(join(racine, 'dist'));
const url = `http://localhost:${serveur.address().port}/`;
const navigateur = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

/** Réglages du transit, pointés vers l'imitation de Graph (jamais utilisé dans l'appli réelle). */
const reglages = {
  tenantId: '00000000-0000-0000-0000-000000000000',
  clientId: '00000000-0000-0000-0000-000000000000',
  siteUrl: 'https://entreprise.sharepoint.com/sites/Transit',
  bibliotheque: 'Transit',
  test: { baseGraph: `${url}graph`, jeton: 'jeton-test' },
};

async function appareil(nom, options) {
  const contexte = await navigateur.newContext({ ...options, permissions: ['camera', 'microphone'] });
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
  await page.evaluate(async (r) => {
    await new Promise((ok, ko) => {
      const o = indexedDB.open('releve-photo', 1);
      o.onsuccess = () => {
        const tx = o.result.transaction('reglages', 'readwrite');
        tx.objectStore('reglages').put(r, 'transitSharePoint');
        tx.oncomplete = ok;
        tx.onerror = ko;
      };
    });
  }, reglages);
  await page.reload();
  return { page, erreurs, capture: (n) => captures && page.screenshot({ path: join(captures, `transit-${nom}-${n}.png`), fullPage: true }) };
}

const etatGraphe = async () => (await fetch(`${url}graph/etat`)).json();
const pc = await appareil('pc', { viewport: { width: 1280, height: 900 } });
const tel = await appareil('telephone', { ...devices['Pixel 7'] });

try {
  // ---------------------------------------------------------------- PC : projet, publication
  let p = pc.page;
  await p.getByRole('button', { name: '+ Nouveau projet' }).click();
  await p.getByLabel("Code d'affaire").fill('T05');
  await p.getByLabel('Nom du projet').fill('Transit fictif');
  await p.getByLabel('Toiture (TT)').uncheck();
  await p.getByRole('button', { name: /créer/i }).click();
  await p.getByRole('heading', { name: 'Transit fictif' }).waitFor();
  const dossier = `${new Date().getFullYear()}-T05_Transit-fictif`;
  await p.locator('input[type=file][accept*=pdf]').setInputFiles({
    name: 'plan R+1.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFictif('Plan fictif R+1', [[200, 400, ['TGBT', 'LT001', '12,5 m²']], [500, 400, ['LOCAL CTA', 'LT002', '30 m²']]]),
  });
  await p.getByRole('button', { name: 'Importer 1 plan' }).click();
  await p.getByText(/Plan importé/).waitFor();
  await p.getByRole('button', { name: 'Détecter les locaux sur tous les plans…' }).click();
  await p.getByRole('button', { name: 'Lancer la détection' }).click();
  await p.getByRole('button', { name: 'Enregistrer 2 locaux' }).click();
  await p.getByText(/2 locaux enregistrés/).waitFor();
  await p.getByRole('button', { name: 'Publier la copie de travail' }).click();
  await p.getByText(/Copie de travail publiée sur le transit/).waitFor();
  let g = await etatGraphe();
  const racineTransit = g.fichiers[0].split('/')[0];
  assert.match(racineTransit, new RegExp(`^${dossier}__[0-9a-f]{8}$`));
  assert.deepEqual(g.fichiers, [`${racineTransit}/copie-de-travail/travail.zip`, `${racineTransit}/copie-de-travail/version.json`]);
  await pc.capture('1-publication');

  // ---------------------------------------------------------------- téléphone : récupération, visite
  p = tel.page;
  await p.getByRole('button', { name: 'Projets disponibles sur le transit…' }).click();
  await p.getByRole('button', { name: /Transit fictif/ }).click();
  await p.getByRole('button', { name: 'Importer et ranger' }).click();
  await p.getByText(/Paquet importé/).waitFor();
  await p.locator('.lien-niveau', { hasText: 'R+1' }).click();
  await p.locator('.visionneuse[data-fond-pret]').waitFor();
  await p.locator('.marqueur .marqueur-libelle', { hasText: 'TGBT' }).click();
  await p.locator('.camera-declencheur:not([disabled])').waitFor({ timeout: 30_000 });
  for (let i = 0; i < 3; i++) await p.getByRole('button', { name: 'Prendre la photo' }).click();
  await p.waitForFunction(() => !/enregistrement/.test(document.querySelector('.camera-compteur')?.textContent ?? ''), null, { timeout: 60_000 });

  // Annotations sur la dernière photo : V vert, X rouge, bulle.
  const derniere = p.locator('.camera-derniere');
  await derniere.getByRole('button', { name: '✏️ Annoter' }).click();
  const zone = p.locator('.annot-svg');
  await zone.waitFor();
  const b = await zone.boundingBox();
  const toucherZone = (fx, fy) => p.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  await p.getByRole('button', { name: 'V vert : travaux conformes' }).click();
  await toucherZone(0.3, 0.5);
  await p.getByRole('button', { name: 'X rouge : travaux non conformes' }).click();
  await toucherZone(0.7, 0.5);
  await p.getByRole('button', { name: 'Bulle : texte encadré' }).click();
  await toucherZone(0.5, 0.7);
  await p.getByLabel('Texte de la bulle').fill('Calorifuge manquant');
  await p.getByRole('button', { name: 'OK', exact: true }).click();
  // Appui long sur le V, puis glisser : il se déplace (pas de nouveau V).
  await p.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.5);
  await p.mouse.down();
  await p.waitForTimeout(700);
  await p.locator('.annot-svg.deplacement').waitFor();
  await p.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.3, { steps: 5 });
  await p.mouse.up();
  await p.locator('.annot-svg.deplacement').waitFor({ state: 'detached' });
  await p.getByRole('dialog', { name: 'Annoter la photo' }).getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await p.locator('.editeur-annotations').waitFor({ state: 'detached' });
  await tel.capture('2a-annotee');
  // Note vocale sur la même photo (micro factice de Chromium).
  await derniere.getByRole('button', { name: '🎤 Note vocale' }).click();
  await p.waitForTimeout(1500);
  await derniere.getByRole('button', { name: /Arrêter/ }).click();
  await derniere.getByRole('button', { name: '🎤 Note ✓' }).waitFor({ timeout: 10_000 });
  // Vidéo de 2 secondes.
  await p.getByRole('radio', { name: 'Vidéo' }).click();
  await p.getByRole('button', { name: 'Filmer' }).click();
  await p.locator('.camera-tournage').waitFor();
  await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Arrêter la vidéo' }).click();
  await p.locator('.camera-derniere', { hasText: 'Dernière vidéo' }).waitFor({ timeout: 30_000 });
  await p.getByRole('button', { name: '✕ Retour au plan' }).click();
  // Visionneuse : flèches de part et d'autre, photo annotée, vidéo.
  await p.locator('.camera').waitFor({ state: 'detached' });
  await tel.capture('2c-fiche-local'); // photos du local juste sous son nom
  await p.locator('.marqueur .marqueur-libelle', { hasText: 'TGBT' }).dblclick();
  const voile = p.locator('.voile-photo');
  await voile.locator('video.photo-media').waitFor(); // la plus récente : la vidéo
  assert.equal(await voile.getByRole('button', { name: 'Photo suivante' }).count(), 0);
  await voile.getByRole('button', { name: 'Photo précédente' }).click();
  await voile.locator('.photo-annotations').waitFor();
  assert.match(await voile.innerText(), /Annotations : 1 V, 1 X, 1 bulle/);
  // Le V a bien été déplacé vers le haut (il était à mi-hauteur).
  const vY = await voile.locator('.photo-annotations path').first().evaluate((e) => Number(/M[\d.]+ ([\d.]+)/.exec(e.getAttribute('d'))[1]));
  const hImage = await voile.locator('.photo-annotations').evaluate((e) => e.viewBox.baseVal.height);
  assert.ok(vY / hImage < 0.42, `V déplacé (y relatif ${(vY / hImage).toFixed(2)})`);
  await voile.locator('audio').waitFor();
  await tel.capture('2b-visionneuse');
  await voile.getByRole('button', { name: 'Fermer' }).click();
  // Photos importées volumineuses (bruit, environ 1,3 Mo chacune) : le paquet dépasse 9,4 Mo,
  // ce qui impose l'envoi en plusieurs morceaux.
  await p.getByRole('button', { name: 'Fermer' }).first().click();
  await p.getByRole('tab', { name: /Panier/ }).click();
  const images = await p.evaluate(async () => {
    const liste = [];
    for (let k = 0; k < 8; k++) {
      const c = document.createElement('canvas');
      c.width = 2000;
      c.height = 1500;
      const g = c.getContext('2d');
      const img = g.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i++) img.data[i] = (Math.random() * 255) | 0;
      g.putImageData(img, 0, 0);
      const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.75));
      liste.push([...new Uint8Array(await b.arrayBuffer())]);
    }
    return liste;
  });
  await p.locator('input[type=file][accept="image/*,video/*"][multiple]').setInputFiles(
    images.map((o, k) => ({ name: `IMG_${k}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(o) })),
  );
  await p.getByRole('tab', { name: 'Panier (8)' }).waitFor({ timeout: 120_000 });
  await p.getByRole('button', { name: '← Projet' }).click();
  await p.getByRole('button', { name: /^Envoyer la visite \(\d+ photos\)$/ }).click();
  await p.getByText(/Visite déposée sur le transit/).waitFor({ timeout: 120_000 });
  await tel.capture('2-envoi');
  g = await etatGraphe();
  console.log(`Dépôt : ${(g.plusGrosEnvoi / 1024 / 1024).toFixed(1)} Mo, ${g.sessions} session(s) d'envoi, ${g.morceaux} morceau(x)`);
  assert.ok(g.morceaux >= 2, 'envoi en plusieurs morceaux attendu');
  assert.equal(g.fichiers.filter((f) => f.includes('/depots/')).length, 1);
  await p.getByRole('button', { name: 'Envoyer la visite (0 photo)' }).waitFor();

  // ---------------------------------------------------------------- PC : collecte, rangement, purge du dépôt
  p = pc.page;
  await p.getByRole('button', { name: "Actualiser l'état" }).click();
  await p.getByText(/Dépôts à collecter : 1/).waitFor();
  await p.getByRole('button', { name: 'Collecter et ranger les visites' }).click();
  await p.getByText(/Dépôt supprimé du transit/).waitFor({ timeout: 120_000 });
  await pc.capture('3-collecte');
  const arbo = await arborescenceOpfs(p, `simule-parent-projets/${dossier}/01_PHOTOS`);
  const jpg = arbo.filter((l) => l.endsWith('.jpg'));
  assert.ok(jpg.some((l) => l.startsWith('01_R+1/R+1.R1-01_TGBT/T05_R+1.R1-01_P001_')), 'photos du TGBT rangées');
  const tgbt = arbo.filter((l) => l.startsWith('01_R+1/R+1.R1-01_TGBT/')).map((l) => l.split('/').pop().replace(/^T05_R\+1\.R1-01_P001_\d{4}-\d{2}-\d{2}_/, ''));
  console.log(`Local TGBT : ${tgbt.join(', ')}`);
  assert.deepEqual(tgbt.filter((n) => n && !/^0[1-3]\.jpg$/.test(n)).map((n) => n.replace(/\.(wav|m4a|webm|ogg|mp4)$/, '.son-ou-video')).sort(), [
    '03_annote.jpg',
    '03_note.son-ou-video',
    '04.son-ou-video',
  ]);
  assert.equal(jpg.filter((l) => l.startsWith('_A-CLASSER/')).length, 8);
  g = await etatGraphe();
  assert.equal(g.fichiers.filter((f) => f.includes('/depots/')).length, 0, 'dépôt purgé après collecte');

  // ---------------------------------------------------------------- PC modifie, publie ; le téléphone met à jour
  await p.getByLabel('Rechercher un local').fill('tgbt');
  await p.locator('.resultats button').first().click();
  await p.getByLabel('Nom').fill('TGBT principal');
  await p.getByRole('button', { name: 'Enregistrer' }).click();
  await p.getByRole('button', { name: '← Projet' }).click();
  await p.getByRole('button', { name: 'Publier la copie de travail' }).click();
  await p.getByText(/Copie de travail publiée sur le transit/).first().waitFor();

  p = tel.page;
  await p.getByRole('button', { name: "Actualiser l'état" }).click();
  await p.getByText('· nouvelle version disponible').waitFor();
  await p.getByRole('button', { name: 'Mettre à jour la copie de travail' }).click();
  await p.getByText(/Local mis à jour \(modification plus récente\) : R1-01 TGBT principal/).waitFor({ timeout: 60_000 });
  await p.getByLabel('Rechercher un local').fill('principal');
  await p.locator('.resultats button', { hasText: 'TGBT principal' }).waitFor();

  // ---------------------------------------------------------------- PC : clôture
  p = pc.page;
  await p.getByRole('button', { name: 'Clôture : supprimer du transit' }).click();
  await p.getByText('Projet supprimé du transit SharePoint (clôture).').waitFor();
  g = await etatGraphe();
  assert.deepEqual(g.fichiers, []);

  assert.deepEqual([...pc.erreurs, ...tel.erreurs], []);
  console.log('OK : transit');
} finally {
  await navigateur.close();
  serveur.close();
}
