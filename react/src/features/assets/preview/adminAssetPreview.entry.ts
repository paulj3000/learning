import { mountAssetPreview } from './mountAssetPreview';

/**
 * Entry point of the Django Admin preview bundle (LAI-2200 AM-10). Built by
 * `npm run build:admin-preview` into `lai/apps/assets/static/assets/admin/`
 * and loaded only by the admin preview page. Not part of the child app.
 */
const mounted = Array.from(document.querySelectorAll<HTMLElement>('[data-asset-preview]')).map(
  (root) => mountAssetPreview(root),
);

window.addEventListener('pagehide', () => {
  for (const preview of mounted) preview.dispose();
});
