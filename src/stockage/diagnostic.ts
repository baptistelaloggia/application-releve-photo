import type { Stockage } from './Stockage';

/**
 * Test d'écriture dans un emplacement (CONCEPTION §A.9-4 : écriture sur lecteur réseau mappé).
 * Écrit, relit, renomme puis supprime un petit dossier de test, en mesurant les temps.
 */
export interface EtapeDiagnostic {
  etape: string;
  reussi: boolean;
  dureeMs: number;
  detail?: string;
}

export async function diagnostiquer(stockage: Stockage): Promise<EtapeDiagnostic[]> {
  const racine = `_test-releve-photo-${Date.now()}`;
  const etapes: EtapeDiagnostic[] = [];
  const contenu = new Blob([new Uint8Array(1024 * 1024).map((_, i) => i % 251)]);
  // Les 50 petits fichiers sont écrits un par un : cela prend quelques secondes sur un lecteur réseau.

  async function etape(nom: string, action: () => Promise<string | void>) {
    const debut = performance.now();
    try {
      const detail = await action();
      etapes.push({ etape: nom, reussi: true, dureeMs: performance.now() - debut, detail: detail || undefined });
      return true;
    } catch (e) {
      etapes.push({ etape: nom, reussi: false, dureeMs: performance.now() - debut, detail: String(e) });
      return false;
    }
  }

  const ok =
    (await etape('Créer un dossier', () => stockage.creerDossier(`${racine}/sous-dossier`))) &&
    (await etape('Écrire un fichier de 1 Mo', () => stockage.ecrireFichier(`${racine}/sous-dossier/essai.bin`, contenu))) &&
    (await etape('Relire et comparer', async () => {
      const relu = new Uint8Array(await (await stockage.lireFichier(`${racine}/sous-dossier/essai.bin`)).arrayBuffer());
      const attendu = new Uint8Array(await contenu.arrayBuffer());
      if (relu.length !== attendu.length || relu.some((v, i) => v !== attendu[i])) throw new Error('Contenu différent');
    })) &&
    (await etape('Renommer un fichier', () =>
      stockage.deplacer(`${racine}/sous-dossier/essai.bin`, `${racine}/sous-dossier/essai-renomme.bin`),
    )) &&
    (await etape('Renommer un dossier', () => stockage.deplacer(`${racine}/sous-dossier`, `${racine}/01_dossier-renomme`))) &&
    // Lecture d'un dossier de données comme à l'ouverture d'un projet : 50 petits fichiers JSON.
    (await etape('Écrire 50 petits fichiers', async () => {
      for (let i = 0; i < 50; i++) await stockage.ecrireFichier(`${racine}/donnees/${i}.json`, `{"i":${i}}`);
    })) &&
    (await etape('Lister le dossier (50 fichiers)', async () => {
      const n = (await stockage.lister(`${racine}/donnees`)).length;
      if (n !== 50) throw new Error(`${n} fichiers trouvés`);
    })) &&
    (await etape('Lire les 50 fichiers un par un', async () => {
      for (let i = 0; i < 50; i++) await (await stockage.lireFichier(`${racine}/donnees/${i}.json`)).text();
    })) &&
    (await etape('Lire les 50 fichiers d’un coup', async () => {
      const lus = await stockage.lireDossier(`${racine}/donnees`);
      await Promise.all(lus.map((f) => f.contenu.text()));
    }));
  await etape('Supprimer le dossier de test', () => stockage.supprimer(racine));
  if (!ok) etapes.push({ etape: 'Résultat', reussi: false, dureeMs: 0, detail: 'Au moins une étape a échoué.' });
  return etapes;
}
