import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Moteur de reconnaissance visuelle (WebAssembly de MediaPipe), recopié depuis node_modules dans
 * « reconnaissance/ », à côté du modèle (public/reconnaissance/). Voir src/photo/reconnaissance.ts.
 */
function moteurReconnaissance(): Plugin {
  const source = fileURLToPath(new URL('./node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url));
  const fichiers = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];
  let sortie = '';
  return {
    name: 'moteur-reconnaissance',
    configResolved(c) {
      sortie = c.build.outDir;
    },
    configureServer(serveur) {
      serveur.middlewares.use((req, res, suite) => {
        const nom = fichiers.find((f) => req.url?.endsWith(`/reconnaissance/${f}`));
        if (!nom) return suite();
        res.setHeader('content-type', nom.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(source + nom));
      });
    },
    writeBundle() {
      mkdirSync(`${sortie}/reconnaissance`, { recursive: true });
      for (const f of fichiers) copyFileSync(source + f, `${sortie}/reconnaissance/${f}`);
    },
  };
}

// Deux modes de construction :
// - normal : PWA installable (Service Worker, manifeste), à héberger en HTTPS ;
// - "fichier-unique" : un seul fichier HTML autonome, ouvrable par double-clic
//   dans Chrome ou Edge, pour les tests (pas de Service Worker ni d'installation).
export default defineConfig(({ mode }) => {
  const fichierUnique = mode === 'fichier-unique';
  return {
    base: './',
    define: {
      __FICHIER_UNIQUE__: JSON.stringify(fichierUnique),
      // Version affichée en bas de page : numéro, date de construction, et commit publié.
      __VERSION__: JSON.stringify(
        [
          process.env.npm_package_version ?? '0.0.0',
          new Date().toISOString().slice(0, 16).replace('T', ' '),
          process.env.GITHUB_SHA?.slice(0, 7),
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    },
    resolve: fichierUnique
      ? { alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/pwa-absent.ts', import.meta.url)) } }
      : {},
    build: fichierUnique
      ? { outDir: 'dist-test', assetsInlineLimit: 100_000_000 }
      : {
          outDir: 'dist',
          // Deux pages : l'appli, et la page de retour de la connexion Microsoft (transit SharePoint).
          rollupOptions: {
            input: {
              appli: fileURLToPath(new URL('./index.html', import.meta.url)),
              retour: fileURLToPath(new URL('./msal-retour.html', import.meta.url)),
            },
          },
        },
    plugins: [
      react(),
      moteurReconnaissance(),
      fichierUnique
        ? viteSingleFile()
        : VitePWA({
            registerType: 'prompt',
            includeAssets: ['icone.svg'],
            manifest: {
              name: 'Relevé photo sur plans',
              short_name: 'Relevé photo',
              description: 'Relevé photo localisé sur plans PDF, hors ligne',
              lang: 'fr',
              start_url: './',
              scope: './',
              display: 'standalone',
              background_color: '#ffffff',
              theme_color: '#1f4e79',
              icons: [
                { src: 'icone-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icone-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
              globIgnores: ['reconnaissance/**'],
              maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
              // Reconnaissance visuelle (26 Mo) : téléchargée à la première utilisation seulement, puis
              // gardée pour l'usage hors ligne.
              runtimeCaching: [
                {
                  urlPattern: ({ url }) => url.pathname.includes('/reconnaissance/'),
                  handler: 'CacheFirst',
                  options: { cacheName: 'reconnaissance', expiration: { maxEntries: 8 } },
                },
              ],
            },
          }),
    ],
    test: {
      include: ['src/**/*.test.ts'],
    },
  };
});
