import { mountAssetCapture } from './mountAssetCapture';

/**
 * Entry point of the Django Admin thumbnail capture bundle (ADR-069). Built by
 * `npm run build:admin-capture` into `lai/apps/assets/static/assets/admin/asset-capture.js` and
 * loaded only by the capture page. Not part of the child app.
 */
const mounted = Array.from(document.querySelectorAll<HTMLElement>('[data-asset-capture]')).map(
  (root) => mountAssetCapture(root),
);

window.addEventListener('pagehide', () => {
  for (const capture of mounted) capture.dispose();
});
