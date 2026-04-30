import { describe, expect, it } from 'vitest';
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH
} from '../src/renderer/hooks/useResizableSidebar';

describe('renderer resizable sidebar helpers', () => {
  it('keeps sidebar width inside the supported interaction range', () => {
    expect(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 80)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 80)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(333.5)).toBe(333.5);
  });
});
