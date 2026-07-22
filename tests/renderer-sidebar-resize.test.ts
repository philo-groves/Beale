import { describe, expect, it } from 'vitest';
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH
} from '../src/renderer/hooks/useResizableSidebar';
import {
  clampResearchSidePanelWidth,
  DEFAULT_RESEARCH_SIDE_PANEL_WIDTH,
  MAX_RESEARCH_SIDE_PANEL_WIDTH,
  MIN_RESEARCH_SIDE_PANEL_WIDTH,
  MIN_TRACE_PANEL_WIDTH,
  RESEARCH_SIDE_RESIZE_HANDLE_WIDTH,
  maxResearchSidePanelWidth,
  researchSidePanelWidthAfterPointerMove
} from '../src/renderer/hooks/useResizableResearchSidePanel';

describe('renderer resizable sidebar helpers', () => {
  it('keeps sidebar width inside the supported interaction range', () => {
    expect(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 80)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 80)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(333.5)).toBe(333.5);
  });
});

describe('renderer resizable research sidebar helpers', () => {
  it('keeps the research sidebar inside its supported interaction range', () => {
    expect(clampResearchSidePanelWidth(DEFAULT_RESEARCH_SIDE_PANEL_WIDTH)).toBe(DEFAULT_RESEARCH_SIDE_PANEL_WIDTH);
    expect(clampResearchSidePanelWidth(MIN_RESEARCH_SIDE_PANEL_WIDTH - 80)).toBe(MIN_RESEARCH_SIDE_PANEL_WIDTH);
    expect(clampResearchSidePanelWidth(MAX_RESEARCH_SIDE_PANEL_WIDTH + 80)).toBe(MAX_RESEARCH_SIDE_PANEL_WIDTH);
  });

  it('widens when the divider moves left and narrows when it moves right', () => {
    expect(researchSidePanelWidthAfterPointerMove(360, 800, 760)).toBe(400);
    expect(researchSidePanelWidthAfterPointerMove(360, 800, 840)).toBe(320);
  });

  it('preserves a usable trace width when the window is narrow', () => {
    const containerWidth = 820;
    expect(maxResearchSidePanelWidth(containerWidth)).toBe(
      containerWidth - MIN_TRACE_PANEL_WIDTH - RESEARCH_SIDE_RESIZE_HANDLE_WIDTH
    );
    expect(clampResearchSidePanelWidth(600, maxResearchSidePanelWidth(containerWidth))).toBe(454);
  });
});
