import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldStage } from './WorldStage';

let fullscreenElement: Element | null = null;

function setFullscreenEnabled(enabled: boolean) {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: enabled });
}

beforeEach(() => {
  fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
  document.exitFullscreen = vi.fn(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  HTMLElement.prototype.requestFullscreen = vi.fn(function (this: HTMLElement) {
    fullscreenElement = this;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
});

afterEach(() => {
  setFullscreenEnabled(false);
});

function renderInWrapper() {
  return render(
    <div data-testid="wrapper">
      <WorldStage>
        <span>canvas</span>
      </WorldStage>
      <div role="dialog" aria-label="Panel below the canvas" />
    </div>,
  );
}

describe('WorldStage', () => {
  it('hides the full screen button when the browser cannot go full screen', () => {
    setFullscreenEnabled(false);
    renderInWrapper();

    expect(screen.queryByRole('button', { name: 'Full screen' })).not.toBeInTheDocument();
  });

  it('puts the whole world view (its parent) in full screen, so panels stay visible', async () => {
    setFullscreenEnabled(true);
    renderInWrapper();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    });

    expect(fullscreenElement).toBe(screen.getByTestId('wrapper'));
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('exits full screen when pressed again', async () => {
    setFullscreenEnabled(true);
    renderInWrapper();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    });

    expect(fullscreenElement).toBeNull();
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
  });

  it('leaves full screen when the region unmounts', async () => {
    setFullscreenEnabled(true);
    const { unmount } = renderInWrapper();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    });
    unmount();

    expect(document.exitFullscreen).toHaveBeenCalled();
  });
});
