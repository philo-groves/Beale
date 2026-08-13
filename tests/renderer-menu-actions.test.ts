import { describe, expect, it } from 'vitest';
import { viewMenuShortcut, zoomPercentLabel } from '../src/renderer/app/menuActions';

describe('renderer menu actions', () => {
  it('formats platform-specific view shortcuts', () => {
    expect(viewMenuShortcut('darwin', 'zoom_in')).toBe('⌘+');
    expect(viewMenuShortcut('linux', 'zoom_out')).toBe('Ctrl+-');
    expect(viewMenuShortcut('win32', 'zoom_in')).toBe('Ctrl++');
    expect(zoomPercentLabel(124.6)).toBe('125%');
  });
});
