import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * KTX2 in the Admin preview (ADR-070): the code supports it, but the Basis
 * transcoder (`basis_transcoder.js` and a 527 kB `.wasm`, imported with `?url`
 * by `gltfDecoders`) is a binary build output and is not committed into Django
 * static files. This build therefore drops those emitted assets and turns the
 * preview's KTX2 loader off (`VITE_LAI_ADMIN_KTX2=off`), so a KTX2 model gets
 * the readable `compression_unsupported` message instead of a failed fetch.
 * Serving the transcoder from Django is ADR-070 open decision O7.
 */
function dropTranscoderAssets(): Plugin {
  return {
    name: 'lai-preview-drop-transcoder',
    generateBundle(_options, bundle) {
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === 'asset' && name.includes('basis_transcoder')) delete bundle[name];
      }
    },
  };
}

/**
 * The Django Admin model preview bundle (LAI-2200 AM-10): one ES module with
 * Three.js inside, written into the `assets` app's static files so Django's
 * `collectstatic` ships it with the admin. No Node step runs in the Django
 * image, so the built file is committed; rebuild it with
 * `npm run build:admin-preview` whenever `src/features/assets/preview/` changes.
 */
export default defineConfig({
  plugins: [dropTranscoderAssets()],
  define: { 'import.meta.env.VITE_LAI_ADMIN_KTX2': JSON.stringify('off') },
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
