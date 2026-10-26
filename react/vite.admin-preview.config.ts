import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The Django Admin model preview bundle (LAI-2200 AM-10): one ES module with
 * Three.js inside, written into the `assets` app's static files so Django's
 * `collectstatic` ships it with the admin. No Node step runs in the Django
 * image, so the built file is committed; rebuild it with
 * `npm run build:admin-preview` whenever `src/features/assets/preview/` changes.
 */
export default defineConfig({
  publicDir: false, // never copy the child app's public/ (models, audio) into Django static
  build: {
    outDir: fileURLToPath(new URL('../lai/apps/assets/static/assets/admin', import.meta.url)),
    emptyOutDir: false, // the directory also holds the hand-written stylesheet
    sourcemap: false, // collectstatic's manifest storage would chase a sourceMappingURL
    minify: true,
    chunkSizeWarningLimit: 800, // Three.js alone is about 600 kB; this is the only chunk
    target: 'es2022',
    modulePreload: false,
    rollupOptions: {
      input: fileURLToPath(
        new URL('./src/features/assets/preview/adminAssetPreview.entry.ts', import.meta.url),
      ),
      output: { format: 'es', entryFileNames: 'asset-preview.js' },
    },
  },
});
