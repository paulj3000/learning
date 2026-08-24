import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThreeGameContainer } from './ThreeGameContainer';

function fakeEngine() {
  return { dispose: vi.fn() };
}

describe('ThreeGameContainer', () => {
  it('creates exactly one engine on mount, with the container as parent', () => {
    const engines: HTMLDivElement[] = [];
    const createEngine = vi.fn((parent: HTMLDivElement) => {
      engines.push(parent);
      return fakeEngine();
    });

    const { container } = render(<ThreeGameContainer createEngine={createEngine} />);

    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(engines[0]).toBe(container.firstElementChild);
  });

  it('disposes the engine on unmount', () => {
    const engine = fakeEngine();
    const createEngine = vi.fn().mockReturnValue(engine);

    const { unmount } = render(<ThreeGameContainer createEngine={createEngine} />);
    unmount();

    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not recreate the engine when createEngine identity changes but instanceKey does not', () => {
    const createEngineA = vi.fn().mockReturnValue(fakeEngine());
    const createEngineB = vi.fn().mockReturnValue(fakeEngine());

    const { rerender } = render(
      <ThreeGameContainer createEngine={createEngineA} instanceKey="sandbox" />,
    );
    rerender(<ThreeGameContainer createEngine={createEngineB} instanceKey="sandbox" />);

    expect(createEngineA).toHaveBeenCalledTimes(1);
    expect(createEngineB).not.toHaveBeenCalled();
  });

  it('recreates the engine when instanceKey changes', () => {
    const firstEngine = fakeEngine();
    const secondEngine = fakeEngine();
    const createEngine = vi
      .fn()
      .mockReturnValueOnce(firstEngine)
      .mockReturnValueOnce(secondEngine);

    const { rerender } = render(<ThreeGameContainer createEngine={createEngine} instanceKey="a" />);
    rerender(<ThreeGameContainer createEngine={createEngine} instanceKey="b" />);

    expect(createEngine).toHaveBeenCalledTimes(2);
    expect(firstEngine.dispose).toHaveBeenCalledTimes(1);
  });

  it('calls onEngineReady with the created engine so a parent can keep an imperative reference', () => {
    const engine = fakeEngine();
    const onEngineReady = vi.fn();

    render(<ThreeGameContainer createEngine={() => engine} onEngineReady={onEngineReady} />);

    expect(onEngineReady).toHaveBeenCalledWith(engine);
  });

  it('renders an aria-hidden container, since the canvas is not screen-reader representable', () => {
    const { container } = render(<ThreeGameContainer createEngine={() => fakeEngine()} />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
