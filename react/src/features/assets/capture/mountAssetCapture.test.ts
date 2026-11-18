import { describe, expect, it, vi } from 'vitest';
import { mountAssetCapture } from './mountAssetCapture';

function page(modelUrl: string): HTMLElement {
  const root = document.createElement('div');
  Object.assign(root.dataset, {
    assetCapture: '',
    modelUrl,
    format: 'glb',
    maxBytes: '1000',
    tokenHeader: 'X-Asset-Preview-Token',
    token: 't',
    captureUrl: '/admin/assets/assetversion/1/capture/upload/',
    versionId: '1',
    sourceSha256: 'a'.repeat(64),
  });
  root.innerHTML = `
    <input name="csrfmiddlewaretoken" value="c">
    <div data-capture-stage></div><p data-capture-status></p>
    <img data-capture-result hidden>
    <select data-capture-size><option value="512">512</option></select>
    <input type="checkbox" data-capture-transparent>
    <button data-capture-action="reset"></button><button data-capture-action="capture"></button>
    <button data-capture-action="save"></button><button data-capture-action="discard"></button>`;
  return root;
}

describe('mountAssetCapture', () => {
  it('refuses a model URL on another origin without making any request', async () => {
    const fetchImpl = vi.fn();
    const root = page('https://evil.example.test/m.glb');
    const mounted = mountAssetCapture(root, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      origin: 'https://admin.example.test',
    });
    expect(await mounted.loaded).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(root.querySelector('[data-capture-status]')?.textContent).toMatch(/this site/);
    mounted.dispose();
  });

  it('refuses a missing model URL and keeps buttons disabled', async () => {
    const root = page('');
    const mounted = mountAssetCapture(root, { origin: 'https://admin.example.test' });
    expect(await mounted.loaded).toBe('error');
    expect(root.querySelector<HTMLButtonElement>('[data-capture-action="capture"]')?.disabled).toBe(
      true,
    );
    mounted.dispose();
  });

  it('reports a refused download as an error', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 403 }));
    const root = page('/admin/assets/assetversion/1/preview/model/');
    const mounted = mountAssetCapture(root, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      origin: 'https://admin.example.test',
    });
    expect(await mounted.loaded).toBe('error');
    expect(fetchImpl).toHaveBeenCalledOnce();
    mounted.dispose();
  });
});
