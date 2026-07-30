import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContainerWidth } from '../src/hooks/useContainerWidth';

let observerCallback: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);
  return <div ref={ref} data-testid="probe">{width ?? 'unmeasured'}</div>;
}

describe('useContainerWidth', () => {
  beforeEach(() => {
    observe.mockReset();
    disconnect.mockReset();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(420);
    vi.stubGlobal('ResizeObserver', vi.fn((callback: ResizeObserverCallback) => {
      observerCallback = callback;
      return { observe, unobserve: vi.fn(), disconnect };
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads the initial width, updates, and disconnects on unmount', () => {
    const { unmount } = render(<Probe />);
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveTextContent('420');
    expect(observe).toHaveBeenCalledWith(probe);

    act(() => {
      observerCallback([{ contentRect: { width: 479 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(probe).toHaveTextContent('479');

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
