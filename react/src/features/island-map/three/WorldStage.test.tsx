import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAGE_BOTTOM_GAP, WorldStage } from './WorldStage';

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

describe('WorldStage leave button (AP-04)', () => {
  it('offers "Leave island" inside full screen, where the top bar is hidden', async () => {
    const { IslandExitProvider } = await import('../../portal/exit');
    const { MemoryRouter, Route, Routes } = await import('react-router-dom');
    setFullscreenEnabled(true);
    render(
      <MemoryRouter initialEntries={['/island/child-1/explore/forest']}>
        <Routes>
          <Route path="/island/:childId/realms" element={<p>Realm Explorer page</p>} />
          <Route
            path="*"
            element={
              <IslandExitProvider childId="child-1">
                <div data-testid="wrapper">
                  <WorldStage>
                    <span>canvas</span>
                  </WorldStage>
                </div>
              </IslandExitProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Leave island' })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave island' }));
    });

    expect(await screen.findByText('Realm Explorer page')).toBeInTheDocument();
    expect(document.exitFullscreen).toHaveBeenCalled();
  });

  it('shows no leave button outside child mode, even in full screen', async () => {
    setFullscreenEnabled(true);
    renderInWrapper();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    });
    expect(screen.queryByRole('button', { name: 'Leave island' })).not.toBeInTheDocument();
  });

  describe('GE-090-D8: the gap under the stage in full screen', () => {
    let stageBottom = 667;
    const originalHeight = window.innerHeight;

    beforeEach(() => {
      stageBottom = 667;
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const bottom = this.hasAttribute('data-world-stage') ? stageBottom : 0;
        return {
          top: 0,
          left: 0,
          right: 375,
          bottom,
          width: 375,
          height: bottom,
          x: 0,
          y: 0,
        } as DOMRect;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    });

    async function enterFullScreen() {
      setFullscreenEnabled(true);
      renderInWrapper();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
      });
      return screen.getByTestId('wrapper');
    }

    it('is 0 when the stage reaches the bottom of the screen (a tablet with nothing below)', async () => {
      const wrapper = await enterFullScreen();
      expect(wrapper.style.getPropertyValue(STAGE_BOTTOM_GAP)).toBe('0px');
    });

    it('measures settings shown below the stage at 375x667, so panels clear the exits', async () => {
      stageBottom = 540;
      const wrapper = await enterFullScreen();
      expect(wrapper.style.getPropertyValue(STAGE_BOTTOM_GAP)).toBe('127px');
    });

    it('follows a resize while full screen, and is removed on leaving it', async () => {
      const wrapper = await enterFullScreen();
      stageBottom = 600;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(wrapper.style.getPropertyValue(STAGE_BOTTOM_GAP)).toBe('67px');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
      });
      expect(wrapper.style.getPropertyValue(STAGE_BOTTOM_GAP)).toBe('');
    });

    it('never sets it outside full screen', () => {
      setFullscreenEnabled(true);
      renderInWrapper();
      expect(screen.getByTestId('wrapper').style.getPropertyValue(STAGE_BOTTOM_GAP)).toBe('');
    });
  });
});
