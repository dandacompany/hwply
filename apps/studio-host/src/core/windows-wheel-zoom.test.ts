import { describe, expect, it, vi } from 'vitest';
import { installWindowsWheelZoomReroute } from './windows-wheel-zoom';

describe('Windows modified-wheel adapter', () => {
  it('reroutes the captured gesture to the upstream scroll container', () => {
    let listener: ((event: Record<string, unknown>) => void) | undefined;
    const container = {
      contains: vi.fn(() => false),
      getBoundingClientRect: vi.fn(() => ({ left: 10, top: 20, width: 600, height: 800 })),
      dispatchEvent: vi.fn((event) => {
        listener?.(event);
        return true;
      }),
    };
    const root = {
      addEventListener: vi.fn((_name, handler) => { listener = handler; }),
      removeEventListener: vi.fn(),
      getElementById: vi.fn(() => container),
    };
    const createWheelEvent = vi.fn((init) => ({ ...init }));
    const original = {
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      deltaX: 0,
      deltaY: -120,
      deltaZ: 0,
      deltaMode: 0,
      clientX: 1,
      clientY: 2,
      target: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    const uninstall = installWindowsWheelZoomReroute(
      root as never,
      createWheelEvent as never,
    );
    listener?.(original);

    expect(original.preventDefault).toHaveBeenCalledOnce();
    expect(original.stopPropagation).toHaveBeenCalledOnce();
    expect(createWheelEvent).toHaveBeenCalledWith(expect.objectContaining({
      ctrlKey: true,
      deltaY: -120,
      clientX: 310,
      clientY: 420,
    }));
    expect(container.dispatchEvent).toHaveBeenCalledOnce();
    uninstall();
    expect(root.removeEventListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      { capture: true },
    );
  });

  it('leaves unmodified wheel gestures to upstream unchanged', () => {
    let listener: ((event: Record<string, unknown>) => void) | undefined;
    const root = {
      addEventListener: vi.fn((_name, handler) => { listener = handler; }),
      removeEventListener: vi.fn(),
      getElementById: vi.fn(),
    };
    installWindowsWheelZoomReroute(root as never, vi.fn() as never);
    const event = {
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    listener?.(event);

    expect(root.getElementById).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
