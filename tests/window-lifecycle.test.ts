import { describe, expect, it, vi } from 'vitest';
import { restoreAndFocusWindow, type FocusableWindow } from '../src/main/windowLifecycle';

describe('window lifecycle', () => {
  it('restores, shows, and focuses a minimized existing window', () => {
    const calls: string[] = [];
    const window = testWindow({ minimized: true, calls });

    expect(restoreAndFocusWindow(window)).toBe(true);
    expect(calls).toEqual(['restore', 'show', 'focus']);
  });

  it('shows and focuses an existing window without restoring it unnecessarily', () => {
    const calls: string[] = [];
    const window = testWindow({ minimized: false, calls });

    expect(restoreAndFocusWindow(window)).toBe(true);
    expect(calls).toEqual(['show', 'focus']);
  });

  it('does not act on a missing or destroyed window', () => {
    const calls: string[] = [];
    const window = testWindow({ destroyed: true, calls });

    expect(restoreAndFocusWindow(null)).toBe(false);
    expect(restoreAndFocusWindow(window)).toBe(false);
    expect(calls).toEqual([]);
  });
});

function testWindow(options: { minimized?: boolean; destroyed?: boolean; calls: string[] }): FocusableWindow {
  return {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    restore: vi.fn(() => options.calls.push('restore')),
    show: vi.fn(() => options.calls.push('show')),
    focus: vi.fn(() => options.calls.push('focus'))
  };
}
