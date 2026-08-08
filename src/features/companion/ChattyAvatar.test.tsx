import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChattyAvatar, drawChatty } from './ChattyAvatar';

/** A minimal fake CanvasRenderingContext2D recording which methods were called. */
function createFakeContext() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(name);
      return args[0];
    };
  const fakeGradient = { addColorStop: vi.fn() };
  const ctx = {
    calls,
    clearRect: record('clearRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    arcTo: record('arcTo'),
    ellipse: record('ellipse'),
    quadraticCurveTo: record('quadraticCurveTo'),
    fill: record('fill'),
    stroke: record('stroke'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    setTransform: record('setTransform'),
    createLinearGradient: () => {
      calls.push('createLinearGradient');
      return fakeGradient;
    },
    createRadialGradient: () => {
      calls.push('createRadialGradient');
      return fakeGradient;
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    globalAlpha: 1,
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
}

describe('drawChatty', () => {
  it('draws Chatty at rest without throwing, using fills, strokes, and gradients', () => {
    const ctx = createFakeContext();

    expect(() => drawChatty(ctx)).not.toThrow();

    expect(ctx.calls).toContain('clearRect');
    expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThan(0);
    expect(ctx.calls.filter((call) => call === 'stroke').length).toBeGreaterThan(0);
    expect(ctx.calls).toContain('arc');
    expect(ctx.calls).toContain('ellipse');
    expect(ctx.calls).toContain('createRadialGradient');
    expect(ctx.calls).toContain('createLinearGradient');
  });

  it('draws a mid-hop frame without throwing', () => {
    const ctx = createFakeContext();

    expect(() => drawChatty(ctx, { hop: 0.8, wingFlap: 0.5, tilt: 0.05 })).not.toThrow();

    expect(ctx.calls).toContain('translate');
    expect(ctx.calls).toContain('rotate');
  });
});

describe('ChattyAvatar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders an accessible, tappable button sized to the requested canvas size', () => {
    render(<ChattyAvatar size={64} />);

    const button = screen.getByRole('button', { name: /chatty the parrot/i });
    const canvas = button.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveStyle({ width: '64px', height: '64px' });
  });

  it('does not throw when the test environment has no real canvas context', () => {
    // jsdom's HTMLCanvasElement.getContext returns null with no canvas
    // package installed; the component must degrade quietly, not crash.
    expect(() => render(<ChattyAvatar />)).not.toThrow();
  });

  it('draws using a mocked 2D context on mount', () => {
    const fakeCtx = createFakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);

    render(<ChattyAvatar size={48} />);

    expect(fakeCtx.calls).toContain('clearRect');
  });

  it('starts a hop animation when clicked', async () => {
    const fakeCtx = createFakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const user = userEvent.setup();

    render(<ChattyAvatar size={48} />);
    fakeCtx.calls.length = 0;

    await user.click(screen.getByRole('button', { name: /chatty the parrot/i }));

    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it('redraws once without animating when prefers-reduced-motion is set', async () => {
    const fakeCtx = createFakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList));
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const user = userEvent.setup();

    render(<ChattyAvatar size={48} />);
    fakeCtx.calls.length = 0;
    rafSpy.mockClear();

    await user.click(screen.getByRole('button', { name: /chatty the parrot/i }));

    expect(rafSpy).not.toHaveBeenCalled();
    expect(fakeCtx.calls).toContain('clearRect');
  });
});
