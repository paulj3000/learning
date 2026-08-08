import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    scale: record('scale'),
    setTransform: record('setTransform'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
}

describe('drawChatty', () => {
  it('draws Chatty without throwing, using fill and stroke shapes', () => {
    const ctx = createFakeContext();

    expect(() => drawChatty(ctx)).not.toThrow();

    expect(ctx.calls).toContain('clearRect');
    expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThan(0);
    expect(ctx.calls.filter((call) => call === 'stroke').length).toBeGreaterThan(0);
    expect(ctx.calls).toContain('arc');
    expect(ctx.calls).toContain('ellipse');
  });
});

describe('ChattyAvatar', () => {
  it('renders an accessible canvas sized to the requested size', () => {
    render(<ChattyAvatar size={64} />);

    const canvas = screen.getByRole('img', { name: 'Chatty the Parrot' });
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveStyle({ width: '64px', height: '64px' });
  });

  it('does not throw when the test environment has no real canvas context', () => {
    // jsdom's HTMLCanvasElement.getContext returns null with no canvas
    // package installed; the component must degrade quietly, not crash.
    expect(() => render(<ChattyAvatar />)).not.toThrow();
  });

  it('draws using a mocked 2D context', () => {
    const fakeCtx = createFakeContext();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(fakeCtx);

    render(<ChattyAvatar size={48} />);

    expect(fakeCtx.calls).toContain('clearRect');
    getContextSpy.mockRestore();
  });
});
