import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

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
      : { outDir: 'dist' },
    plugins: [
      react(),
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
              maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
            },
          }),
    ],
    test: {
      include: ['src/**/*.test.ts'],
    },
  };
});
