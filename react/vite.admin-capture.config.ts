import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The capture bundle never decodes KTX2 textures (ADR-069 open decision). Three's Basis
 * transcoder files, imported with `?url` by `gltfDecoders`, are tree-shaken out of the code but
 * still emitted as orphan files; this drops them so the build is one text file and no `.wasm` or
 * transcoder script is written or committed.
 */
function dropOrphanAssets(): Plugin {
  return {
    name: 'lai-capture-drop-orphan-assets',
    generateBundle(_options, bundle) {
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === 'asset') delete bundle[name];
      }
    },
  };
}

/**
 * The Django Admin thumbnail capture bundle (ADR-069): one ES module with
 * Three.js inside, written into the `assets` app's static files so Django's
 * `collectstatic` ships it with the admin. No Node step runs in the Django
 * image, so the built file is committed; rebuild it with
 * `npm run build:admin-capture` whenever `src/features/assets/capture/` or `preview/` changes.
 */
export default defineConfig({
  plugins: [dropOrphanAssets()],
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
        new URL('./src/features/assets/capture/adminAssetCapture.entry.ts', import.meta.url),
      ),
      output: { format: 'es', entryFileNames: 'asset-capture.js' },
    },
  },
});
