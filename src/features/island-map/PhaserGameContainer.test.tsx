import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhaserGameContainer } from './PhaserGameContainer';

const { gameInstances, FakeGame } = vi.hoisted(() => {
  const gameInstances: { config: unknown; destroy: ReturnType<typeof vi.fn> }[] = [];
  class FakeGameImpl {
    config: unknown;
    destroy = vi.fn();
    constructor(config: unknown) {
      this.config = config;
      gameInstances.push(this);
    }
  }
  return { gameInstances, FakeGame: FakeGameImpl };
});

vi.mock('phaser', () => ({
  default: { Game: FakeGame },
}));

describe('PhaserGameContainer', () => {
  it('creates exactly one game on mount, with the container as parent', () => {
    gameInstances.length = 0;
    const createConfig = vi.fn().mockReturnValue({ type: 0, width: 100, height: 100 });

    const { container } = render(<PhaserGameContainer createConfig={createConfig} />);

    expect(gameInstances).toHaveLength(1);
    expect(createConfig).toHaveBeenCalledTimes(1);
    expect((gameInstances[0].config as { parent: HTMLElement }).parent).toBe(
      container.firstElementChild,
    );
  });

  it('destroys the game on unmount', () => {
    gameInstances.length = 0;
    const createConfig = vi.fn().mockReturnValue({ type: 0 });

    const { unmount } = render(<PhaserGameContainer createConfig={createConfig} />);
    const game = gameInstances[0];

    unmount();

    expect(game.destroy).toHaveBeenCalledWith(true);
  });

  it('does not recreate the game when createConfig identity changes but instanceKey does not', () => {
    gameInstances.length = 0;
    const configA = vi.fn().mockReturnValue({ type: 0 });
    const configB = vi.fn().mockReturnValue({ type: 0 });

    const { rerender } = render(
      <PhaserGameContainer createConfig={configA} instanceKey="welcome-harbor" />,
    );
    rerender(<PhaserGameContainer createConfig={configB} instanceKey="welcome-harbor" />);

    expect(gameInstances).toHaveLength(1);
  });

  it('recreates the game when instanceKey changes', () => {
    gameInstances.length = 0;
    const createConfig = vi.fn().mockReturnValue({ type: 0 });

    const { rerender } = render(
      <PhaserGameContainer createConfig={createConfig} instanceKey="welcome-harbor" />,
    );
    rerender(<PhaserGameContainer createConfig={createConfig} instanceKey="ember-mountain" />);

    expect(gameInstances).toHaveLength(2);
    expect(gameInstances[0].destroy).toHaveBeenCalledWith(true);
  });

  it('renders an aria-hidden container, since the canvas is not screen-reader representable', () => {
    const { container } = render(
      <PhaserGameContainer createConfig={vi.fn().mockReturnValue({ type: 0 })} />,
    );

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
