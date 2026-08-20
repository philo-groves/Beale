import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isLiveResearchRunStatus } from '../src/shared/types';
import type { HoneycrispMemorySummary, RunRow, ScopeAsset, SessionRunActivity } from '../src/shared/types';
import { MainSessionWorkspace } from '../src/renderer/features/sessions/MainSessionWorkspace';
import { promoteWorkspaceDirectory, WorkspaceDirectoriesField } from '../src/renderer/features/workspaces/WorkspaceDirectoriesWidget';
import {
  memoryCountSinceLastDream,
  memoryDreamHeat,
  memoryDreamingProgressLabel,
  workspaceDejunkHeat,
  workspaceResearchSurfaceKinds,
  workspaceResearchSurfaceItems,
  workspaceScopeDraftForConfigurationUpdate,
  workspaceCreationActivity,
  workspaceMemoryTypeGroups,
  workspaceTokenActivity,
  WorkspaceHousekeepingPanel,
  WorkspaceResourceDialog,
  WorkspaceUnderstandingView
} from '../src/renderer/features/workspaces/WorkspaceUnderstandingView';
import { buildWorkspaceTimeline } from '../src/renderer/view-models/workspaceTimeline';
import { testResearchProfile } from './researchProfileFixture';

const NOW = Date.parse('2026-08-12T12:00:00.000Z');

describe('workspace dashboard', () => {
  it('centers workspace forms, catalogs, and activity at the standard content width', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const dashboardStyles = styles.match(/\.workspace-dashboard\s*\{([^}]*)\}/)?.[1] ?? '';
    const tabsStyles = styles.match(/\.workspace-dashboard-tabs\s*\{([^}]*)\}/)?.[1] ?? '';
    const sharedPanelStyles = styles.match(/\.workspace-dashboard-panel\s*\{([^}]*)\}/)?.[1] ?? '';
    const overviewStyles = styles.match(/\.workspace-overview\s*\{([^}]*)\}/)?.[1] ?? '';
    const overviewLayoutStyles = styles.match(/\.workspace-overview-layout\s*\{([^}]*)\}/)?.[1] ?? '';
    const overviewFormStyles = styles.match(/\.workspace-overview-form\s*\{([^}]*)\}/)?.[1] ?? '';
    const overviewControlStyles = styles.match(/\.workspace-overview-control-row\s*\{([^}]*)\}/)?.[1] ?? '';
    const overviewRowDividerStyles = styles.match(/\.workspace-overview-form \.settings-form-control-list > \* \+ \*\s*\{([^}]*)\}/)?.[1] ?? '';
    const overviewFieldStyles = styles.match(/\.workspace-overview-form :is\(input, textarea\)\s*\{([^}]*)\}/)?.[1] ?? '';
    const guidanceHeadingStyles = styles.match(/\.workspace-guidance-field-heading\s*\{([^}]*)\}/)?.[1] ?? '';
    const guidanceSurfaceStyles = styles.match(/\.workspace-overview-form \.workspace-guidance-editor,\s*\.workspace-guidance-preview\s*\{([^}]*)\}/)?.[1] ?? '';
    const guidancePreviewStyles = [...styles.matchAll(/^\.workspace-guidance-preview\s*\{([^}]*)\}/gm)].at(-1)?.[1] ?? '';
    const overviewStatusStyles = styles.match(/\.workspace-overview-error,\s*\.workspace-overview-saving\s*\{([^}]*)\}/)?.[1] ?? '';
    const ruleComposerStyles = styles.match(/\.workspace-rule-composer\s*\{([^}]*)\}/)?.[1] ?? '';
    const ruleComposerButtonStyles = styles.match(/\.workspace-rule-composer button\s*\{([^}]*)\}/)?.[1] ?? '';
    const directoriesWidgetStyles = styles.match(/^\.workspace-directories-widget\s*\{([^}]*)\}/m)?.[1] ?? '';
    const directoriesFieldStyles = styles.match(/\.workspace-directories-field\s*\{([^}]*)\}/)?.[1] ?? '';
    const directoriesFieldControlStyles = styles.match(/\.workspace-directories-field-control\s*\{([^}]*)\}/)?.[1] ?? '';
    const directoriesInputStyles = styles.match(/\.workspace-directories-input-area\s*\{([^}]*)\}/)?.[1] ?? '';
    const directoryInputRowStyles = styles.match(/\.workspace-directories-input-row\s*\{([^}]*)\}/)?.[1] ?? '';
    const dividedDirectoryInputRowStyles = styles.match(/\.workspace-directories-input-row \+ \.workspace-directories-input-row\s*\{([^}]*)\}/)?.[1] ?? '';
    const primaryDirectoryIndicatorStyles = styles.match(/\.workspace-directory-primary-indicator::before\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceHeadingStyles = styles.match(/\.workspace-overview-layout\s*>\s*\.workspace-overview-heading,\s*\.workspace-activity-form\s*>\s*:is\(\.settings-form-heading\),\s*\.workspace-cleaning-form\s*>\s*:is\(\.settings-form-heading\)\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceHeatmapStyles = styles.match(/\.workspace-activity-grid-scroll\s*\{([^}]*)\}/)?.[1] ?? '';
    const overviewDisabledStyles = styles.match(/\.workspace-overview-form :is\(input, textarea\):disabled\s*\{([^}]*)\}/)?.[1] ?? '';
    const timelinePanelStyles = styles.match(/\.workspace-timeline-card\s*\{([^}]*)\}/)?.[1] ?? '';
    const activityFormStyles = styles.match(/\.workspace-activity-form\s*\{([^}]*)\}/)?.[1] ?? '';
    const chartStyles = styles.match(/\.workspace-timeline-chart\s*\{([^}]*)\}/)?.[1] ?? '';
    const axisStyles = styles.match(/\.workspace-timeline-axis\s*\{([^}]*)\}/)?.[1] ?? '';
    const timelineRowsStyles = styles.match(/\.workspace-timeline-rows\s*\{([^}]*)\}/)?.[1] ?? '';
    const timelineResultStyles = styles.match(/\.workspace-timeline-result\s*\{([^}]*)\}/)?.[1] ?? '';
    const timelineLegendButtonStyles = styles.match(/\.workspace-timeline-legend-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const surfaceAreaStyles = styles.match(/\.workspace-surface-area\s*\{([^}]*)\}/)?.[1] ?? '';
    const resourceTabsBarStyles = styles.match(/\.workspace-resource-tabs-bar\s*\{([^}]*)\}/)?.[1] ?? '';
    const resourceTabButtonStyles = styles.match(/\.workspace-resource-tab \.research-side-view-tab-activate\s*\{([^}]*)\}/)?.[1] ?? '';
    const repositoryCloneButtonStyles = styles.match(/\.workspace-repository-clone-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const surfaceScrollStyles = styles.match(/\.workspace-surface-scroll\s*\{([^}]*)\}/)?.[1] ?? '';
    const surfaceEmptyStyles = styles.match(/\.workspace-surface-empty\s*\{([^}]*)\}/)?.[1] ?? '';
    const surfaceListStyles = styles.match(/\.workspace-surface-list\s*\{([^}]*)\}/)?.[1] ?? '';
    const surfaceItemStyles = styles.match(/\.workspace-surface-item\s*\{([^}]*)\}/)?.[1] ?? '';
    const mainOnlyStyles = styles.match(/\.main-session-grid\.workspace-main-only\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceDetailColumnStyles = styles.match(/\.main-session-grid\.workspace-context\s+\.research-side-column\s*\{([^}]*)\}/)?.[1] ?? '';
    const hiddenWorkspaceDetailColumnStyles = styles.match(/\.main-session-grid\.workspace-context\.workspace-main-only\s+\.research-side-column\s*\{([^}]*)\}/)?.[1] ?? '';
    const catalogViewStyles = styles.match(/\.workspace-catalog-view\s*\{([^}]*)\}/)?.[1] ?? '';
    const catalogListStyles = styles.match(/\.workspace-catalog-view\s*>\s*\.workspace-catalog-list\s*\{([^}]*)\}/)?.[1] ?? '';
    const cleaningFormStyles = styles.match(/\.workspace-cleaning-form\s*\{([^}]*)\}/)?.[1] ?? '';
    const removalFormStyles = styles.match(/\.settings-form-control-row\.workspace-removal-form\s*\{([^}]*)\}/)?.[1] ?? '';
    const removalControlsStyles = styles.match(/\.workspace-removal-controls\s*\{([^}]*)\}/)?.[1] ?? '';
    const removalActionStyles = styles.match(/\.workspace-removal-action\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceMemoryItemStyles = styles.match(/\.workspace-catalog-view\s*>\s*\.memory-catalog-list\s+\.memory-catalog-toggle\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceMemoryDescriptionStyles = styles.match(/\.workspace-catalog-view\s*>\s*\.memory-catalog-list\s+\.memory-catalog-item-description\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceRunbookItemStyles = styles.match(/\.workspace-catalog-view\s*>\s*\.runbook-catalog-list\s+\.runbook-catalog-item\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceRunbookPurposeStyles = styles.match(/\.workspace-catalog-view\s*>\s*\.runbook-catalog-list\s+\.runbook-catalog-purpose\s*\{([^}]*)\}/)?.[1] ?? '';
    const runbookItemStyles = styles.match(/^\.runbook-catalog-item\s*\{([^}]*)\}/m)?.[1] ?? '';
    const runbookIconStyles = styles.match(/^\.runbook-catalog-icon\s*\{([^}]*)\}/m)?.[1] ?? '';
    const workspaceMemorySectionStyles = styles.match(/\.workspace-memory-type-section\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceMemoryHeadingStyles = styles.match(/\.workspace-memory-type-section\s*>\s*h3\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceMemoryToggleStyles = styles.match(/\.workspace-memory-type-toggle\s*\{([^}]*)\}/)?.[1] ?? '';
    const sideStackStyles = styles.match(/\.workspace-side-stack\s*\{([^}]*)\}/)?.[1] ?? '';
    const dreamAreaStyles = styles.match(/\.workspace-dream-area\s*\{([^}]*)\}/)?.[1] ?? '';
    const dreamContentStyles = styles.match(/\.workspace-dream-content\s*\{([^}]*)\}/)?.[1] ?? '';
    const housekeepingCardStyles = styles.match(/\.workspace-dejunk-card,\s*\.workspace-dream-card\s*\{([^}]*)\}/)?.[1] ?? '';
    const housekeepingCountStyles = styles.match(/\.workspace-housekeeping-card-count\s*\{([^}]*)\}/)?.[1] ?? '';
    const mediumHeatCardStyles =
      styles.match(
        /\.app-shell\.session-heat-medium,\s*\.workspace-dream-card\[data-dream-heat="medium"\],\s*\.workspace-dejunk-card\[data-dejunk-heat="medium"\]\s*\{([^}]*)\}/
      )?.[1] ?? '';

    expect(dashboardStyles).toContain('grid-template-rows: 42px minmax(0, 1fr)');
    expect(tabsStyles).toContain('margin: 10px 10px 0');
    expect(sharedPanelStyles).toContain('min-height: 0');
    expect(sharedPanelStyles).toContain('height: 100%');
    expect(sharedPanelStyles).toContain('padding: 10px');
    expect(overviewStyles).toContain('overflow: auto');
    expect(overviewStyles).not.toContain('padding');
    expect(overviewLayoutStyles).toContain('width: 100%');
    expect(overviewLayoutStyles).toContain('--settings-view-font-size: 14px');
    expect(overviewLayoutStyles).toContain('max-width: var(--session-content-max-width)');
    expect(overviewLayoutStyles).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(overviewLayoutStyles).toContain("'heading'\n    'form'");
    expect(overviewLayoutStyles).toContain('margin-inline: auto');
    expect(overviewFormStyles).toContain('font-size: var(--settings-view-font-size)');
    expect(overviewControlStyles).toContain('font-size: var(--settings-view-font-size)');
    expect(overviewRowDividerStyles).toContain('border-top: 1px solid var(--line)');
    expect(overviewFieldStyles).toContain('font-size: var(--settings-view-font-size)');
    expect(guidanceHeadingStyles).toContain('justify-content: space-between');
    expect(guidanceSurfaceStyles).toContain('min-height: 150px');
    expect(guidanceSurfaceStyles).toContain('background: var(--panel-strong)');
    expect(guidancePreviewStyles).toContain('resize: vertical');
    expect(overviewStatusStyles).toContain('font-size: var(--settings-view-font-size)');
    expect(ruleComposerStyles).toContain('padding: 12px');
    expect(ruleComposerButtonStyles).toContain('padding: 0 10px');
    expect(directoriesWidgetStyles).toContain('background: transparent');
    expect(directoriesWidgetStyles).toContain('padding: 0');
    expect(directoriesFieldStyles).toContain('align-items: start');
    expect(directoriesFieldControlStyles).toContain('grid-template-columns: 26px auto');
    expect(directoriesInputStyles).toContain('width: 220px');
    expect(directoriesInputStyles).toContain('background: var(--panel-strong)');
    expect(directoriesInputStyles).toContain('resize: horizontal');
    expect(directoryInputRowStyles).toContain('grid-template-columns: minmax(0, 1fr) 26px');
    expect(dividedDirectoryInputRowStyles).toContain('border-top: 1px solid var(--line)');
    expect(primaryDirectoryIndicatorStyles).toContain('background: var(--green)');
    expect(workspaceHeadingStyles).toContain('padding-left: 0');
    expect(workspaceHeatmapStyles).toContain('padding-left: 0');
    expect(resourceTabButtonStyles).toContain('padding: 0 9px');
    expect(resourceTabButtonStyles).toContain('font-size: 1rem');
    expect(repositoryCloneButtonStyles).toContain('border: 0');
    expect(overviewDisabledStyles).toContain('background: var(--panel-strong)');
    expect(overviewDisabledStyles).toContain('color: var(--muted)');
    expect(overviewDisabledStyles).toContain('cursor: not-allowed');
    expect(styles).toContain('--memory-type-neutral: var(--muted)');
    expect(styles).not.toContain('--memory-type-primitive:');
    expect(timelinePanelStyles).not.toContain('border-bottom');
    expect(timelinePanelStyles).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(timelinePanelStyles).toContain('gap: 10px');
    expect(timelinePanelStyles).not.toContain('padding');
    expect(activityFormStyles).toContain('max-width: var(--session-content-max-width)');
    expect(activityFormStyles).toContain('margin-inline: auto');
    expect(cleaningFormStyles).toContain('max-width: var(--session-content-max-width)');
    expect(cleaningFormStyles).toContain('margin-inline: auto');
    expect(removalFormStyles).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(removalFormStyles).toContain('gap: 9px');
    expect(removalControlsStyles).toContain('grid-template-columns: minmax(180px, 220px) auto');
    expect(removalActionStyles).toContain('border: 0');
    expect(removalActionStyles).toContain('color: var(--red)');
    expect(chartStyles).toContain('grid-template-rows: 22px minmax(0, 1fr)');
    expect(chartStyles).toContain('max-width: var(--session-content-max-width)');
    expect(chartStyles).toContain('margin-inline: auto');
    expect(axisStyles).toContain('border-bottom: 1px solid var(--panel-border)');
    expect(axisStyles).not.toContain('padding-bottom');
    expect(timelineRowsStyles).toContain('padding-top: 8px');
    expect(timelineRowsStyles).not.toContain('scrollbar-gutter');
    expect(timelineResultStyles).toContain('justify-items: end');
    expect(timelineLegendButtonStyles).toContain('top: -6px');
    expect(surfaceAreaStyles).toContain('grid-template-rows: auto 40px minmax(0, 1fr)');
    expect(surfaceAreaStyles).not.toContain('padding');
    expect(resourceTabsBarStyles).toContain('max-width: var(--session-content-max-width)');
    expect(resourceTabsBarStyles).toContain('margin-inline: auto');
    expect(surfaceScrollStyles).toContain('max-width: var(--session-content-max-width)');
    expect(surfaceScrollStyles).toContain('margin-inline: auto');
    expect(surfaceEmptyStyles).toContain('max-width: var(--session-content-max-width)');
    expect(surfaceEmptyStyles).toContain('margin-inline: auto');
    expect(surfaceListStyles).not.toContain('scrollbar-gutter');
    expect(surfaceListStyles).toContain('gap: 10px');
    expect(surfaceItemStyles).toContain('min-height: 86px');
    expect(mainOnlyStyles).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(mainOnlyStyles).toContain('0 0');
    expect(workspaceDetailColumnStyles).toContain('transform: translateX(0)');
    expect(workspaceDetailColumnStyles).toContain('transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)');
    expect(hiddenWorkspaceDetailColumnStyles).toContain('transform: translateX(24px)');
    expect(hiddenWorkspaceDetailColumnStyles).toContain('opacity: 0');
    expect(catalogViewStyles).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(catalogViewStyles).toContain('overflow: hidden');
    expect(catalogListStyles).toContain('width: 100%');
    expect(catalogListStyles).toContain('max-width: var(--session-content-max-width)');
    expect(catalogListStyles).toContain('height: 100%');
    expect(catalogListStyles).toContain('margin-inline: auto');
    expect(workspaceMemoryItemStyles).toContain('padding-block: 7px');
    expect(workspaceMemoryDescriptionStyles).toContain('color: var(--muted)');
    expect(workspaceRunbookItemStyles).toContain('padding-block: 7px');
    expect(workspaceRunbookPurposeStyles).toContain('color: var(--muted)');
    expect(runbookItemStyles).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(runbookItemStyles).toContain('justify-content: stretch');
    expect(runbookIconStyles).toContain('color: var(--muted)');
    expect(runbookIconStyles).not.toContain('var(--runbook-status-color)');
    expect(workspaceMemorySectionStyles).not.toContain('border-top');
    expect(workspaceMemorySectionStyles).not.toContain('border-bottom');
    expect(workspaceMemoryHeadingStyles).toContain('padding: 8px var(--settings-form-inline-padding) 12px');
    expect(workspaceMemoryToggleStyles).toContain('width: max-content');
    expect(workspaceMemoryToggleStyles).toContain('justify-content: flex-start');
    expect(workspaceMemoryToggleStyles).toContain('padding: 5px var(--settings-form-inline-padding) 7px 0');
    expect(workspaceMemoryToggleStyles).toContain('background: transparent');
    expect(workspaceMemoryToggleStyles).not.toContain('border-top');
    expect(styles).toMatch(/:where\([\s\S]*\.main-commentary-list,[\s\S]*\.workspace-surface-list,[\s\S]*\)\s*\{\s*scrollbar-color: transparent transparent;/u);
    expect(styles).not.toContain('.workspace-housekeeping-header');
    expect(sideStackStyles).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(dreamAreaStyles).toContain('grid-template-rows: minmax(0, 1fr)');
    expect(dreamAreaStyles).toContain('padding: 8px 18px 18px');
    expect(dreamContentStyles).toContain('padding-top: 0');
    expect(dreamContentStyles).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(dreamContentStyles).toContain('grid-template-rows: repeat(2, minmax(0, 1fr))');
    expect(housekeepingCardStyles).toContain('width: 100%');
    expect(housekeepingCardStyles).toContain('height: 100%');
    expect(housekeepingCardStyles).toContain('position: relative');
    expect(housekeepingCardStyles).toContain('border: 0');
    expect(housekeepingCardStyles).toContain('border-radius: 34px');
    expect(housekeepingCardStyles).toContain('corner-shape: squircle');
    expect(housekeepingCardStyles).toContain('background: var(--workspace-card-surface)');
    expect(housekeepingCardStyles).not.toContain('--workspace-card-glass');
    expect(housekeepingCardStyles).not.toContain('outline');
    expect(mediumHeatCardStyles).toContain(
      '--session-heat-edge: color-mix(in srgb, var(--session-heat-medium-color) 48%, var(--panel-border))'
    );
    expect(mediumHeatCardStyles).toContain(
      '--workspace-card-surface: var(--session-heat-edge)'
    );
    expect(housekeepingCardStyles).not.toContain('backdrop-filter');
    expect(housekeepingCardStyles).not.toContain('box-shadow');
    expect(housekeepingCardStyles).not.toContain('gradient');
    expect(housekeepingCountStyles).toContain('position: absolute');
    expect(housekeepingCountStyles).toContain('top: 12px');
    expect(housekeepingCountStyles).toContain('right: 14px');
  });

  it('maps memories created since the latest dream to profile heat thresholds', () => {
    expect(memoryDreamHeat(19)).toBe('none');
    expect(memoryDreamHeat(20)).toBe('low');
    expect(memoryDreamHeat(49)).toBe('low');
    expect(memoryDreamHeat(50)).toBe('medium');
    expect(memoryDreamHeat(100)).toBe('high');
    expect(memoryDreamHeat(150)).toBe('critical');
    expect(workspaceDejunkHeat(9)).toBe('none');
    expect(workspaceDejunkHeat(10)).toBe('low');
    expect(workspaceDejunkHeat(50)).toBe('medium');
    expect(workspaceDejunkHeat(200)).toBe('high');
    expect(workspaceDejunkHeat(1_000)).toBe('critical');

    const memory = memorySummary({
      nodes: [
        { id: 'before', createdAt: '2026-08-12T09:00:00.000Z' },
        { id: 'after_one', createdAt: '2026-08-12T11:00:00.000Z' },
        { id: 'after_two', createdAt: '2026-08-12T12:00:00.000Z' }
      ],
      lastDreamCompletedAt: '2026-08-12T10:00:00.000Z'
    });
    expect(memoryCountSinceLastDream(memory)).toBe(2);
  });

  it('shows a disabled loading state while the filesystem summary is deferred', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceHousekeepingPanel, {
      busy: false,
      honeycrispMemory: memorySummary(),
      memoryDreamingInProgress: false,
      researchProfile: testResearchProfile(),
      runs: [],
      workspaceDejunk: {
        available: false,
        loading: true,
        newFileCount: 0,
        newFileCountCapped: false,
        baselineAt: '2026-08-12T12:00:00.000Z',
        lastRun: null
      },
      onRunMemoryDreaming: () => undefined
    }));

    expect(html).toContain('Loading workspace files…');
    expect(html).toContain('Loading…');
    expect(html).toContain('disabled=""');
  });

  it('shows seven workspace tabs while mounting only the initial overview panel', () => {
    const memory = memorySummary();
    const html = renderToStaticMarkup(createElement(MainSessionWorkspace, {
      detail: null,
      events: [],
      allEvents: [],
      providerModelCatalog: [],
      honeycrispMemory: memory,
      researchProfile: testResearchProfile(),
      researchSubjectName: 'Parser',
      workspacePath: '/workspaces/parser',
      workspaceDirectories: ['/workspaces/parser', 'C:\\Users\\alice\\shared'],
      workspaceName: 'Parser Workspace',
      runs: [],
      selectedRunId: null,
      researchDetailsOpen: false,
      selectedRunbookId: null,
      selectedRunbook: null,
      selectedRunbookDocument: null,
      runbookLoading: false,
      runbookError: null,
      selectedSubagentPath: null,
      searchHighlightQuery: '',
      busy: false,
      memoryDreamingInProgress: false,
      onRunMemoryDreaming: () => undefined,
      onResearchDetailsOpenChange: () => undefined,
      onOpenHoneycrispRunbook: () => undefined,
      onBackToRunbooks: () => undefined,
      onBackToSubagents: () => undefined,
      onSelectSubagent: () => undefined,
      onSelectNextStep: () => undefined,
      onSessionAction: () => undefined,
      onSteerInstruction: () => undefined
    }));

    expect(html).toContain('class="main-session-grid workspace-context workspace-main-only"');
    expect(html).toContain('class="workspace-dashboard"');
    expect(html.match(/class="workspace-dashboard-panel/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Workspace dashboard views"');
    expect(html).toContain('<span>Overview</span>');
    expect(html).toContain('<span>Activity</span>');
    expect(html).toContain('<span>Resources</span>');
    expect(html).toContain('<span>Rules</span>');
    expect(html).toContain('<span>Memory</span>');
    expect(html).toContain('<span>Runbooks</span>');
    expect(html).toContain('<span>Utilities</span>');
    expect(html.indexOf('<span>Runbooks</span>')).toBeLessThan(html.indexOf('<span>Rules</span>'));
    expect(html.indexOf('<span>Rules</span>')).toBeLessThan(html.indexOf('<span>Utilities</span>'));
    expect(html).toContain('lucide-layout-dashboard');
    expect(html).toContain('lucide-activity');
    expect(html).toContain('lucide-boxes');
    expect(html).toContain('lucide-list-checks');
    expect(html).toContain('lucide-brain');
    expect(html).toContain('lucide-book-open');
    expect(html).toContain('lucide-wrench');
    expect(html.match(/workspace-dashboard-tab-icon/g)).toHaveLength(7);
    expect(html).toContain('aria-controls="workspace-dashboard-overview-panel" aria-selected="true"');
    expect(html).not.toContain('id="workspace-dashboard-activity-panel"');
    expect(html).not.toContain('id="workspace-dashboard-resources-panel"');
    expect(html).not.toContain('id="workspace-dashboard-rules-panel"');
    expect(html).not.toContain('id="workspace-dashboard-memory-panel"');
    expect(html).not.toContain('id="workspace-dashboard-runbooks-panel"');
    expect(html).not.toContain('id="workspace-dashboard-utilities-panel"');
    expect(html).toContain('<h2 id="workspace-overview-heading">Parser Workspace</h2>');
    expect(html).toContain('class="settings-form-squircle" aria-labelledby="workspace-overview-heading"');
    expect(html).toContain('class="settings-form-control-row workspace-overview-control-row workspace-directories-field"');
    expect(html).not.toContain('class="workspace-directories-widget"');
    expect(html).toContain('<strong>Workspace Directories</strong>');
    expect(html).toContain('Local directories included in this workspace.');
    expect(html).toContain('aria-label="Workspace directories"');
    expect(html).toContain('title="/workspaces/parser"');
    expect(html).toContain('title="C:\\Users\\alice\\shared"');
    expect(html).toContain('class="workspace-directories-input-path">~/shared</span>');
    expect(html).toContain('aria-label="Primary directory"');
    expect(html).toContain('title="Primary directory"');
    expect(html).not.toContain('Make workspace directory primary');
    expect(html).not.toContain('title="Make primary directory"');
    expect(html).toContain('aria-label="Remove workspace directory C:\\Users\\alice\\shared"');
    expect(html).not.toContain('>Primary</small>');
    expect(html).toContain('aria-label="Add workspace directory"');
    expect(html).not.toContain('aria-label="Working Directory"');
    expect(html).toMatch(/aria-label="Research Profile"[^>]*disabled=""[^>]*value="Security"/u);
    expect(html).toMatch(/aria-label="Research Subject"[^>]*disabled=""[^>]*value="Parser"/u);
    expect(html).toMatch(/aria-label="Workspace Name"[^>]*required=""[^>]*value="Parser Workspace"/u);
    expect(html.indexOf('aria-label="Research Profile"')).toBeLessThan(html.indexOf('aria-label="Research Subject"'));
    expect(html.indexOf('aria-label="Research Subject"')).toBeLessThan(html.indexOf('aria-label="Workspace Name"'));
    expect(html.indexOf('aria-label="Workspace Name"')).toBeLessThan(html.indexOf('aria-label="Workspace directories"'));
    expect(html.indexOf('aria-label="Workspace directories"')).toBeLessThan(html.indexOf('aria-label="Workspace Guidance"'));
    expect(html).toContain('<strong>Workspace Guidance</strong>');
    expect(html).toContain('aria-label="Workspace Guidance"');
    expect(html).toContain('class="workspace-guidance-preview"');
    expect(html).toContain('title="Edit Workspace Guidance"');
    expect(html).toContain('Click to add workspace guidance.');
    expect(html).not.toContain('class="workspace-guidance-editor"');
    expect(html).not.toContain('>Show Markdown</button>');
    expect(html).toContain('AGENTS.md instructions.');
    expect(html).not.toContain('<strong>Scope &amp; Rules</strong>');
    expect(html).not.toContain('aria-label="Scope &amp; Rules"');
    expect(html).not.toContain('Save changes');
    expect(html).not.toContain('workspace-overview-actions');
    expect(html).not.toContain('>Surface</span>');
    expect(html).not.toContain('Research Surface');
    expect(html).not.toContain('Workspace inputs and coverage');
    expect(html).not.toContain('workspace-surface-card');
    expect(html).not.toContain('class="research-side-column');
    expect(html).not.toContain('class="research-side-resize-handle"');
    expect(html).not.toContain('aria-label="Workspace resource types"');
    expect(html).not.toContain('aria-label="Daily token usage over the past year"');
    expect(html).not.toContain('class="workspace-catalog-list memory-catalog-list');
    expect(html).not.toContain('class="workspace-catalog-list runbook-catalog-list');
    expect(html).not.toContain('>Dejunk Now</button>');
    expect(html).not.toContain('>Dream Now</button>');
  });

  it('shows a confirmed registry-only workspace removal form in Utilities', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      initialView: 'utilities',
      memoryDreamingInProgress: false,
      honeycrispMemory: memorySummary(),
      researchProfile: testResearchProfile(),
      workspaceName: 'Parser Workspace',
      runs: [],
      onRunMemoryDreaming: () => undefined,
      onRemoveWorkspace: async () => undefined
    }));

    expect(html).toContain('<h2>Parser Workspace Utilities</h2>');
    expect(html).toContain('<strong>Remove Workspace</strong>');
    expect(html).toContain('Unregisters this workspace from Beale only.');
    expect(html).toContain('Directories, .beale metadata, repository clones, scoped resources, and Honeycrisp memory remain on disk.');
    expect(html).toContain('aria-label="Type Parser Workspace to confirm workspace removal"');
    expect(html).toContain('placeholder="Type Parser Workspace to confirm"');
    expect(html).toMatch(/<button class="workspace-removal-action" disabled="" type="submit">Remove from Beale<\/button>/u);
  });

  it('uses the blank workspace directories field as the initial directory chooser', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceDirectoriesField, {
      directories: [],
      onAdd: () => undefined,
      onRemove: () => undefined
    }));

    expect(html).toContain('class="workspace-directories-input-area is-empty"');
    expect(html).toContain('aria-label="Choose workspace directory"');
    expect(html).not.toContain('aria-label="Add workspace directory"');
    expect(html).not.toContain('workspace-directories-input-row');
  });

  it('renders stored workspace guidance as markdown before editing', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      activeScope: {
        id: 'scope_guidance',
        version: 1,
        status: 'active',
        workspaceName: 'Parser Workspace',
        scopeOwner: 'Parser Team',
        descriptionMarkdown: '# Authorized targets\n\nUse **staging** only.',
        rulesMarkdown: '',
        activeFrom: '2026-08-12T00:00:00.000Z',
        expiresAt: null,
        createdAt: '2026-08-12T00:00:00.000Z',
        createdBy: 'local_user',
        assets: []
      },
      busy: false,
      honeycrispMemory: memorySummary(),
      memoryDreamingInProgress: false,
      onRunMemoryDreaming: () => undefined,
      runs: [],
      workspaceName: 'Parser Workspace'
    }));

    expect(html).toContain('class="workspace-guidance-preview"');
    expect(html).toContain('class="main-trace-markdown"');
    expect(html).toContain('<h1>Authorized targets</h1>');
    expect(html).toContain('Use <strong>staging</strong> only.');
  });

  it('promotes a workspace directory without dropping the storage root', () => {
    expect(promoteWorkspaceDirectory(
      ['/workspaces/parser', 'C:\\Users\\alice\\shared'],
      'C:\\Users\\alice\\shared\\'
    )).toEqual(['C:\\Users\\alice\\shared', '/workspaces/parser']);
  });

  it('preserves non-editable authorization and resource data when saving overview configuration', () => {
    const scope = {
      id: 'scope_overview',
      version: 3,
      status: 'active' as const,
      workspaceName: 'Parser Workspace',
      scopeOwner: 'Parser Team',
      descriptionMarkdown: 'Old description',
      rulesMarkdown: 'Old rules',
      activeFrom: '2026-08-12T00:00:00.000Z',
      expiresAt: '2026-12-31T00:00:00.000Z',
      createdAt: '2026-08-12T00:00:00.000Z',
      createdBy: 'local_user',
      assets: [{
        id: 'asset_parser',
        scopeVersionId: 'scope_overview',
        direction: 'in_scope' as const,
        kind: 'repo' as const,
        value: 'https://github.com/example/parser',
        sensitivity: 'public',
        attributes: {
          displayName: 'Parser',
          clonedDirectory: 'C:\\Users\\research\\repositories\\parser'
        },
        createdAt: '2026-08-12T00:00:00.000Z'
      }]
    };

    expect(workspaceScopeDraftForConfigurationUpdate(scope, {
      workspaceName: 'Parser Lab',
      descriptionMarkdown: 'New description'
    })).toEqual({
      workspaceName: 'Parser Lab',
      scopeOwner: 'Parser Team',
      descriptionMarkdown: 'New description',
      rulesMarkdown: '',
      expiresAt: '2026-12-31T00:00:00.000Z',
      assets: [{
        direction: 'in_scope',
        kind: 'repo',
        value: 'https://github.com/example/parser',
        sensitivity: 'public',
        attributes: {
          displayName: 'Parser',
          clonedDirectory: 'C:\\Users\\research\\repositories\\parser'
        }
      }]
    });
  });

  it('renders formal workspace rules as an append-only list', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      initialView: 'rules',
      memoryDreamingInProgress: false,
      honeycrispMemory: memorySummary(),
      workspaceName: 'Parser Workspace',
      workspaceRules: [{
        id: 'rule_one',
        workspaceId: 'workspace_parser',
        text: 'Do not test production accounts.',
        createdAt: '2026-08-12T00:00:00.000Z',
        createdBy: 'local_user'
      }],
      runs: [],
      onRunMemoryDreaming: () => undefined
    }));

    expect(html).toContain('id="workspace-dashboard-rules-panel"');
    expect(html).toContain('<h2>Parser Workspace Rules</h2>');
    expect(html).toContain('aria-label="New workspace rule"');
    expect(html).toContain('>Add Rule</button>');
    expect(html).toContain('<li>Do not test production accounts.</li>');
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('Remove rule');
  });

  it('aggregates one year of daily session token usage into logarithmic heat levels', () => {
    const low = runRow('run_low', [['2026-08-10T09:00:00.000Z', '2026-08-10T10:00:00.000Z']]);
    low.tokenUsage = { totalTokens: 100 };
    const high = runRow('run_high', [['2026-08-11T09:00:00.000Z', '2026-08-11T10:00:00.000Z']]);
    high.tokenUsage = { totalTokens: 10_000 };
    const sameDay = runRow('run_same_day', [['2026-08-11T11:00:00.000Z', '2026-08-11T12:00:00.000Z']]);
    sameDay.tokenUsage = { totalTokens: 5_000 };
    const outsideRange = runRow('run_old', [['2025-08-01T09:00:00.000Z', '2025-08-01T10:00:00.000Z']]);
    outsideRange.tokenUsage = { totalTokens: 50_000 };

    const activity = workspaceTokenActivity([low, high, sameDay, outsideRange], NOW);
    const lowDay = activity.days.find((day) => day.dateKey === '2026-08-10');
    const highDay = activity.days.find((day) => day.dateKey === '2026-08-11');

    expect(activity.days).toHaveLength(365);
    expect(activity.totalTokens).toBe(15_100);
    expect(lowDay).toMatchObject({ totalTokens: 100, heatLevel: 2 });
    expect(highDay).toMatchObject({ totalTokens: 15_000, heatLevel: 4 });
  });

  it('aggregates one year of daily creation activity', () => {
    const activity = workspaceCreationActivity([
      { createdAt: '2026-08-10T09:00:00.000Z' },
      { createdAt: '2026-08-10T12:00:00.000Z' },
      { createdAt: '2025-08-01T09:00:00.000Z' }
    ], NOW);

    expect(activity.days).toHaveLength(365);
    expect(activity.total).toBe(2);
    expect(activity.days.find((day) => day.dateKey === '2026-08-10')).toMatchObject({ value: 2, heatLevel: 4 });
  });

  it('groups workspace memories by type, ranks groups by configured heat, and limits collapsed lists to four rows', () => {
    const baseProfile = testResearchProfile();
    const finding = baseProfile.memory.types[0]!;
    const note = {
      ...finding,
      id: 'note',
      name: 'Note',
      pluralName: 'Notes',
      order: 20,
      sessionHeat: { draft: 'low' as const }
    };
    const neutral = {
      ...finding,
      id: 'neutral',
      name: 'Neutral',
      pluralName: 'Neutrals',
      order: 30,
      sessionHeat: {}
    };
    const profile = {
      ...baseProfile,
      memory: { ...baseProfile.memory, types: [finding, note, neutral] }
    };
    const memory = memorySummary({
      nodes: [
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `finding_${index}`,
          type: finding.id,
          status: 'confirmed',
          title: `Finding ${index}`,
          workspaces: [{ id: 'workspace_security', name: 'Security' }]
        })),
        {
          id: 'note_one',
          type: note.id,
          status: 'draft',
          title: 'Note one',
          workspaces: [{ id: 'workspace_security', name: 'Security' }]
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `neutral_${index}`,
          type: neutral.id,
          status: 'draft',
          title: `Neutral ${index}`,
          workspaces: [{ id: 'workspace_security', name: 'Security' }]
        }))
      ]
    });
    const sessionHeatPreferences = {
      heatOverrides: { [profile.id]: { [note.id]: { draft: 'critical' as const } } },
      paletteOverrides: {}
    };

    expect(workspaceMemoryTypeGroups(
      memory.nodes,
      profile.memory.types,
      profile.id,
      sessionHeatPreferences
    ).map((group) => group.type)).toEqual(['note', 'finding', 'neutral']);

    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      initialView: 'memory',
      memoryDreamingInProgress: false,
      honeycrispMemory: memory,
      researchProfile: profile,
      sessionHeatPreferences,
      workspaceName: 'Security',
      runs: [],
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));
    expect(html).toContain('<h3>1 Note</h3>');
    expect(html).toContain('<h3>5 Findings</h3>');
    expect(html).toContain('<h3>6 Neutrals</h3>');
    expect(html.indexOf('<h3>1 Note</h3>')).toBeLessThan(html.indexOf('<h3>5 Findings</h3>'));
    expect(html).toContain('aria-expanded="false" class="session-memory-type-toggle workspace-memory-type-toggle"');
    expect(html).toContain('>Show 1 more</button>');
    expect(html).toContain('>Show 2 more</button>');
    expect(html).toContain('class="workspace-memory-type-overflow" inert=""');
  });

  it('renders split work intervals and per-memory-type timeline markers', () => {
    const profile = testResearchProfile();
    const memoryType = profile.memory.types[0];
    const runs = [runRow('run_one', [
      ['2026-08-12T02:00:00.000Z', '2026-08-12T04:00:00.000Z'],
      ['2026-08-12T09:00:00.000Z', null]
    ])];
    const memory = memorySummary({
      nodes: [{
        id: 'memory_one',
        sessionIds: ['run_one'],
        type: memoryType.id,
        status: 'confirmed',
        title: 'Parser state transition',
        createdAt: '2026-08-12T10:00:00.000Z'
      }],
      runbooks: [{
        id: 'runbook_one',
        sessionId: 'run_one',
        title: 'Parser proof',
        revision: 2,
        revisions: [
          { revision: 1, sessionId: 'run_one', createdAt: '2026-08-12T10:30:00.000Z' },
          { revision: 2, sessionId: 'run_one', createdAt: '2026-08-12T11:00:00.000Z' }
        ]
      }],
      reports: [{
        id: 'report_one',
        sessionId: 'run_one',
        title: 'Parser result',
        revision: 1,
        revisions: [{ revision: 1, sessionId: 'run_one', createdAt: '2026-08-12T11:30:00.000Z' }]
      }]
    });
    const timeline = buildWorkspaceTimeline(runs, memory.nodes, memory.runbooks, memory.reports, profile.memory.types, NOW);
    const rows = timeline.rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.segments).toHaveLength(2);
    expect(rows[0]?.totalDurationMs).toBe(5 * 60 * 60 * 1_000);
    expect(timeline.windowDurationMs).toBe(4 * 60 * 60 * 1_000);
    expect(rows[0]?.segments[0]?.leftPercent).toBeCloseTo(0);
    expect(rows[0]?.segments[0]?.widthPercent).toBeCloseTo(25);
    expect((rows[0]?.segments[0]?.leftPercent ?? 0) + (rows[0]?.segments[0]?.widthPercent ?? 0))
      .toBeCloseTo(rows[0]?.segments[1]?.leftPercent ?? 0);
    expect(rows[0]?.segments[1]?.widthPercent).toBeCloseTo(75);
    expect((rows[0]?.segments[1]?.leftPercent ?? 0) + (rows[0]?.segments[1]?.widthPercent ?? 0))
      .toBeCloseTo(100);
    expect(rows[0]?.memoryMarkers).toEqual([
      expect.objectContaining({ id: 'memory_one', type: memoryType.id, status: 'confirmed' })
    ]);
    expect(rows[0]?.memoryMarkers[0]?.leftPercent).toBeCloseTo(50);
    expect(rows[0]?.runbookRevisionMarkers).toEqual([
      expect.objectContaining({ id: 'runbook_one:1', revision: 1 }),
      expect.objectContaining({ id: 'runbook_one:2', revision: 2 })
    ]);
    expect(rows[0]?.reportRevisionMarkers).toEqual([
      expect.objectContaining({ id: 'report_one:1', revision: 1 })
    ]);

    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      initialView: 'activity',
      workspaceDejunk: {
        available: true,
        newFileCount: 50,
        newFileCountCapped: false,
        baselineAt: '2026-08-12T08:00:00.000Z',
        lastRun: null
      },
      memoryDreamingInProgress: false,
      honeycrispMemory: memory,
      researchProfile: profile,
      workspaceName: 'Parser Workspace',
      runs,
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));

    expect(html).not.toContain('>Past 4 Hours<');
    expect(html).toContain('>-4h<');
    expect(html).toContain('>-3h<');
    expect(html).toContain('>Latest<');
    expect(html).toContain('Recent session');
    expect(html).toContain('type="button" class="workspace-timeline-session-label" title="Open Recent session"');
    expect(html).not.toContain('<strong>Recent session</strong>');
    expect(html).not.toContain('5h total');
    expect(html.match(/workspace-timeline-segment/g)).toHaveLength(2);
    expect(html).toContain(`workspace-timeline-memory-marker memory-type-${memoryType.id}`);
    expect(html).toContain('--memory-type-color:var(--session-heat-high-color)');
    expect(html).toContain(`memory recorded: Parser state transition`);
    expect(html.match(/workspace-timeline-runbook-marker/g)).toHaveLength(2);
    expect(html).toContain('Runbook update 2: Parser proof');
    expect(html).toContain('workspace-timeline-report-marker');
    expect(html).toContain('Report update 1: Parser result');
  });

  it('shows workspace sources with session, memory, and recency coverage', () => {
    const run = runRow('run_surface', [['2026-08-12T10:00:00.000Z', '2026-08-12T11:00:00.000Z']]);
    run.run.targetAssetId = 'asset_repo';
    const memory = memorySummary({
      nodes: [{ id: 'memory_repo', assetIds: ['asset_repo'], createdAt: '2026-08-12T11:30:00.000Z' }]
    });
    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      initialView: 'resources',
      memoryDreamingInProgress: false,
      honeycrispMemory: memory,
      activeScope: {
        id: 'scope_surface',
        version: 1,
        status: 'active',
        workspaceName: 'Parser Workspace',
        scopeOwner: 'Researcher',
        descriptionMarkdown: '',
        rulesMarkdown: '',
        activeFrom: '2026-08-12T00:00:00.000Z',
        expiresAt: null,
        createdAt: '2026-08-12T00:00:00.000Z',
        createdBy: 'user',
        assets: [{
          id: 'asset_repo',
          scopeVersionId: 'scope_surface',
          direction: 'in_scope',
          kind: 'repo',
          value: 'https://github.com/example/parser.git',
          sensitivity: 'public',
          attributes: {},
          createdAt: '2026-08-12T00:00:00.000Z'
        }]
      },
      researchProfile: testResearchProfile(),
      workspaceName: 'Parser Workspace',
      runs: [run],
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));

    expect(html).toContain('>parser</strong>');
    expect(html).toContain('class="workspace-surface-scroll"');
    expect(html).toContain('>Repository</span>');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-label="Add repository"');
    expect(html).toContain('>1 session</span>');
    expect(html).toContain('>1 memory</span>');
    expect(html).toContain('>Last 2h ago</span>');
    expect(html).toContain('>Not cloned</span>');
    expect(html).toContain('>Clone</span>');
    expect(html).toContain('title="Edit parser"');
    expect(workspaceResearchSurfaceKinds(workspaceResearchSurfaceItems([{
      id: 'asset_repo',
      scopeVersionId: 'scope_surface',
      direction: 'in_scope',
      kind: 'repo',
      value: 'https://github.com/example/parser.git',
      sensitivity: 'public',
      attributes: {},
      createdAt: '2026-08-12T00:00:00.000Z'
    }], [run], memory))).toEqual(['repo']);
  });

  it('prefills the resource dialog for editing and offers removal', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceResourceDialog, {
      initialAsset: {
        id: 'asset_repo',
        scopeVersionId: 'scope_surface',
        direction: 'out_of_scope',
        kind: 'repo',
        value: 'https://github.com/example/parser.git',
        sensitivity: 'restricted',
        attributes: {
          displayName: 'Parser',
          clonedDirectory: 'C:\\Users\\research\\repositories\\parser'
        },
        createdAt: '2026-08-12T00:00:00.000Z'
      },
      kind: 'repo',
      onClose: () => undefined,
      onRemove: async () => undefined,
      onSubmit: async () => undefined
    }));

    expect(html).toContain('>Edit Repository</h2>');
    expect(html).toContain('value="https://github.com/example/parser.git"');
    expect(html).toContain('value="Parser"');
    expect(html).toContain('>Cloned directory<input');
    expect(html).toContain('value="C:\\Users\\research\\repositories\\parser"');
    expect(html).toContain('<option value="out_of_scope" selected="">Out of scope</option>');
    expect(html).toContain('<option value="restricted" selected="">Restricted</option>');
    expect(html).toContain('workspace-resource-remove-button modal-footer-leading');
    expect(html).toContain('>Remove</span>');
    expect(html).toContain('>Save changes</button>');
  });

  it('labels materialized repository checkouts from repository metadata instead of the checkout folder', () => {
    const run = runRow('run_gitlab', [['2026-08-12T10:00:00.000Z', '2026-08-12T11:00:00.000Z']]);
    run.run.targetAssetId = 'asset_gitlab_disk';
    const memory = memorySummary({
      nodes: [{ id: 'memory_gitlab', assetIds: ['asset_gitlab_url'], createdAt: '2026-08-12T11:30:00.000Z' }]
    });
    const assets: ScopeAsset[] = [{
      id: 'asset_gitlab_url',
      scopeVersionId: 'scope_surface',
      direction: 'in_scope',
      kind: 'repo',
      value: 'https://gitlab.com/gitlab-org/gitlab',
      sensitivity: 'public',
      attributes: {
        repositoryUrl: 'https://gitlab.com/gitlab-org/gitlab',
        clonedDirectory: 'C:\\Users\\research\\.beale\\repositories\\gitlab.com_gitlab-org_gitlab\\default'
      },
      createdAt: '2026-08-12T00:00:00.000Z'
    }, {
      id: 'asset_gitlab_disk',
      scopeVersionId: 'scope_surface',
      direction: 'in_scope',
      kind: 'repo',
      value: 'C:\\Users\\research\\.beale\\repositories\\gitlab.com_gitlab-org_gitlab\\default',
      sensitivity: 'public',
      attributes: { repositoryUrl: 'https://gitlab.com/gitlab-org/gitlab', sourceAssetId: 'asset_gitlab_url' },
      createdAt: '2026-08-12T00:00:00.000Z'
    }, {
      id: 'asset_gitlab',
      scopeVersionId: 'scope_surface',
      direction: 'in_scope',
      kind: 'repo',
      value: 'C:\\Users\\research\\.beale\\repositories\\gitlab.com_gitlab-org_gitlab\\default',
      sensitivity: 'public',
      attributes: { repositoryUrl: 'https://gitlab.com/gitlab-org/gitlab' },
      createdAt: '2026-08-12T00:00:00.000Z'
    }, {
      id: 'asset_gitaly',
      scopeVersionId: 'scope_surface',
      direction: 'in_scope',
      kind: 'repo',
      value: 'C:\\Users\\research\\.beale\\repositories\\gitlab.com_gitlab-org_gitaly\\default',
      sensitivity: 'public',
      attributes: {},
      createdAt: '2026-08-12T00:00:00.000Z'
    }];

    const items = workspaceResearchSurfaceItems(assets, [run], memory);
    const labels = items.map((item) => item.label);

    expect(labels).toEqual(['gitaly', 'gitlab']);
    expect(labels).not.toContain('default');
    expect(items.find((item) => item.label === 'gitlab')).toMatchObject({
      sessionCount: 1,
      memoryCount: 1,
      repositoryCloned: true,
      repositoryCloneAssetId: 'asset_gitlab_url',
      repositoryLocalPath: 'C:\\Users\\research\\.beale\\repositories\\gitlab.com_gitlab-org_gitlab\\default'
    });
    expect(items.find((item) => item.label === 'gitlab')?.asset.value).toBe('https://gitlab.com/gitlab-org/gitlab');
  });

  it('routes repository cloning through the typed host IPC boundary', () => {
    const ipcSource = readFileSync(new URL('../src/shared/ipc.ts', import.meta.url), 'utf8');
    const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
    const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    const rendererSource = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

    expect(ipcSource).toContain("cloneWorkspaceRepository: 'beale:clone-workspace-repository'");
    expect(preloadSource).toContain('ipcRenderer.invoke(IPC_CHANNELS.cloneWorkspaceRepository, assetId)');
    expect(mainSource).toContain('workspaceService.cloneWorkspaceRepository(assetId)');
    expect(rendererSource).toContain('window.beale.cloneWorkspaceRepository(assetId)');
  });

  it('keeps terminal session runs immutable when the session is continued', () => {
    const continued = runRow('run_continued', [], { status: 'active' });
    continued.sessionRuns = [
      sessionRun('run_continued', 'attempt_failed', [
        ['2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z']
      ], { status: 'failed' }),
      sessionRun('run_continued', 'attempt_continued', [
        ['2026-08-12T10:00:00.000Z', null]
      ], { status: 'active' })
    ];

    const timeline = buildWorkspaceTimeline(
      [continued],
      [],
      [],
      [],
      testResearchProfile().memory.types,
      NOW
    );
    const failed = timeline.rows.find((row) => row.sessionRunId === 'attempt_failed');
    const active = timeline.rows.find((row) => row.sessionRunId === 'attempt_continued');

    expect(timeline.rows).toHaveLength(2);
    expect(failed).toMatchObject({ runId: 'run_continued', result: 'unexpected_error', totalDurationMs: 60 * 60 * 1_000 });
    expect(failed?.segments).toEqual([expect.objectContaining({ endedAt: '2026-08-12T09:00:00.000Z' })]);
    expect(active).toMatchObject({ runId: 'run_continued', result: null, totalDurationMs: 2 * 60 * 60 * 1_000 });
  });

  it('renders timeline symbols with color-matched borders and no outer halo', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const memoryMarkerStyles = styles.match(/\.workspace-timeline-memory-marker\s*\{([^}]*)\}/)?.[1] ?? '';
    const revisionMarkerStyles = styles.match(/\.workspace-timeline-runbook-marker,\s*\.workspace-timeline-report-marker\s*\{([^}]*)\}/)?.[1] ?? '';
    const resultMarkerStyles = styles.match(/\.workspace-timeline-result-symbol\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(memoryMarkerStyles).toContain('border: 1px solid color-mix(in srgb, var(--memory-type-color) 62%, var(--gray-05))');
    expect(memoryMarkerStyles).not.toContain('box-shadow:');
    expect(revisionMarkerStyles).toContain('border: 1px solid color-mix(in srgb, var(--workspace-timeline-artifact-color) 58%, var(--gray-05))');
    expect(revisionMarkerStyles).not.toContain('box-shadow:');
    expect(resultMarkerStyles).toContain('border: 1px solid color-mix(in srgb, var(--workspace-timeline-result-color) 58%, var(--gray-05))');
    expect(resultMarkerStyles).toContain('border-radius: 2px');
    expect(resultMarkerStyles).not.toContain('box-shadow:');
  });

  it('records natural, unexpected-error, and safeguard-error session results', () => {
    const interval: Array<[string, string | null]> = [['2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z']];
    const natural = runRow('run_natural', interval, { status: 'completed' });
    const unexpected = runRow('run_unexpected', interval, { status: 'failed' });
    const safeguard = runRow('run_safeguard', interval, { status: 'failed', terminationCause: 'safeguard' });
    const recovered = runRow('run_recovered', interval, { status: 'paused', terminationCause: 'workspace_recovery' });
    const active = runRow('run_active', [['2026-08-12T09:00:00.000Z', null]]);
    const timeline = buildWorkspaceTimeline(
      [natural, unexpected, safeguard, recovered, active],
      [],
      [],
      [],
      testResearchProfile().memory.types,
      NOW
    );
    const resultByRunId = new Map(timeline.rows.map((row) => [row.runId, row.result]));

    expect(resultByRunId).toEqual(new Map([
      ['run_active', null],
      ['run_natural', 'natural_end'],
      ['run_recovered', 'unexpected_error'],
      ['run_safeguard', 'safeguard_error'],
      ['run_unexpected', 'unexpected_error']
    ]));

    const html = renderToStaticMarkup(createElement(WorkspaceUnderstandingView, {
      busy: false,
      initialView: 'activity',
      memoryDreamingInProgress: false,
      honeycrispMemory: memorySummary(),
      researchProfile: testResearchProfile(),
      workspaceName: 'Parser Workspace',
      runs: [natural, unexpected, safeguard, recovered, active],
      nowMs: NOW,
      onRunMemoryDreaming: () => undefined
    }));

    expect(html).toContain('class="workspace-timeline-result-symbol is-natural-end"');
    expect(html).toContain('class="workspace-timeline-result-symbol is-unexpected-error"');
    expect(html).toContain('class="workspace-timeline-result-symbol is-safeguard-error"');
    expect(html).toContain('class="workspace-timeline-legend-row is-session-items"');
    expect(html).toContain('class="workspace-timeline-legend-row is-session-results"');
    const sessionItemsRow = html.match(/<div class="workspace-timeline-legend-row is-session-items">([\s\S]*?)<\/div>/)?.[1] ?? '';
    const sessionResultsRow = html.match(/<div class="workspace-timeline-legend-row is-session-results">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(sessionItemsRow).toContain('Work duration');
    expect(sessionItemsRow).toContain('Report update');
    expect(sessionItemsRow).not.toContain('No error');
    expect(sessionResultsRow).toContain('No error');
    expect(sessionResultsRow).toContain('Unexpected error');
    expect(sessionResultsRow).toContain('Safeguard error');
    expect(html).toContain('>No error</span>');
    expect(html.indexOf('>No error</span>')).toBeLessThan(html.indexOf('>Unexpected error</span>'));
    expect(html).toContain('>Safeguard error</span>');
  });

  it('uses the latest 4 cumulative activity hours and collapses wall-clock gaps', () => {
    const timeline = buildWorkspaceTimeline([
      runRow('run_one', [
        ['2026-08-01T00:00:00.000Z', '2026-08-01T08:00:00.000Z'],
        ['2026-08-12T00:00:00.000Z', '2026-08-12T08:00:00.000Z']
      ])
    ], [], [], [], testResearchProfile().memory.types, NOW);
    const rows = timeline.rows;

    expect(rows).toHaveLength(1);
    expect(timeline.windowDurationMs).toBe(4 * 60 * 60 * 1_000);
    expect(rows[0]?.windowDurationMs).toBe(4 * 60 * 60 * 1_000);
    expect(rows[0]?.segments).toHaveLength(1);
    expect(rows[0]?.segments[0]).toMatchObject({ leftPercent: 0 });
    expect(rows[0]?.segments[0]?.widthPercent).toBeCloseTo(100);
  });

  it('keeps concurrent sessions aligned without double-counting overlapping activity', () => {
    const timeline = buildWorkspaceTimeline([
      runRow('run_one', [['2026-08-12T00:00:00.000Z', '2026-08-12T04:00:00.000Z']]),
      runRow('run_two', [['2026-08-12T02:00:00.000Z', '2026-08-12T06:00:00.000Z']])
    ], [], [], [], testResearchProfile().memory.types, NOW);
    const first = timeline.rows.find((row) => row.runId === 'run_one');
    const second = timeline.rows.find((row) => row.runId === 'run_two');

    expect(timeline.windowDurationMs).toBe(4 * 60 * 60 * 1_000);
    expect(first?.segments[0]?.leftPercent).toBeCloseTo(0);
    expect(first?.segments[0]?.widthPercent).toBeCloseTo(50);
    expect(second?.segments[0]?.leftPercent).toBeCloseTo(0);
    expect(second?.segments[0]?.widthPercent).toBeCloseTo(100);
  });

  it('shows Dreaming progress and honors profiles with memory disabled', () => {
    const profile = testResearchProfile();
    const inProgressHtml = renderToStaticMarkup(createElement(WorkspaceHousekeepingPanel, {
      busy: true,
      memoryDreamingInProgress: true,
      honeycrispMemory: memorySummary(),
      researchProfile: profile,
      runs: [],
      onRunMemoryDreaming: () => undefined
    }));
    expect(inProgressHtml).toContain('Preparing…');
    expect(inProgressHtml).toContain('data-dream-phase="preparing"');
    expect(inProgressHtml).toContain('disabled=""');

    const correctingHtml = renderToStaticMarkup(createElement(WorkspaceHousekeepingPanel, {
      busy: true,
      memoryDreamingInProgress: true,
      memoryDreamingProgress: {
        workspaceId: 'workspace_one',
        phase: 'correcting',
        inputNodeCount: 12,
        inputSessionCount: 4,
        decisionCount: 0,
        updatedAt: '2026-08-12T12:00:00.000Z'
      },
      honeycrispMemory: memorySummary(),
      researchProfile: profile,
      runs: [],
      onRunMemoryDreaming: () => undefined
    }));
    expect(correctingHtml).toContain('Refining the plan…');
    expect(correctingHtml).toContain('data-dream-phase="correcting"');

    const disabledHtml = renderToStaticMarkup(createElement(WorkspaceHousekeepingPanel, {
      busy: false,
      memoryDreamingInProgress: false,
      honeycrispMemory: memorySummary(),
      researchProfile: {
        ...profile,
        capabilities: { ...profile.capabilities, memoryEnabled: false }
      },
      runs: [],
      onRunMemoryDreaming: () => undefined
    }));
    expect(disabledHtml).toContain('disabled="" title="Memory Dreaming is disabled by the active research profile"');
  });

  it('uses real Dreaming phase labels and borderless full-card housekeeping controls', () => {
    expect(memoryDreamingProgressLabel('gathering')).toBe('Gathering memories…');
    expect(memoryDreamingProgressLabel('compacting')).toBe('Compacting context…');
    expect(memoryDreamingProgressLabel('applying')).toBe('Applying changes…');
    expect(memoryDreamingProgressLabel('completed')).toBe('Dream complete');
    expect(memoryDreamingProgressLabel('failed')).toBe('Dream failed');

    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const buttonStyles = styles.match(/\.workspace-dejunk-card,\s*\.workspace-dream-card\s*\{([^}]*)\}/)?.[1] ?? '';
    const stateStyles = styles.match(/\.workspace-dream-state\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(buttonStyles).toContain('border: 0');
    expect(buttonStyles).toContain('cursor: pointer');
    expect(buttonStyles).not.toContain('background: #242424');
    expect(stateStyles).toContain('animation: workspace-dream-state-enter 240ms ease both');
    expect(styles).toContain('@keyframes workspace-dream-state-enter');
  });

  it('shows a disabled loading state while the workspace memory summary initializes', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceHousekeepingPanel, {
      busy: false,
      workspaceDejunk: null,
      memoryDreamingInProgress: false,
      honeycrispMemory: { ...memorySummary(), loading: true },
      researchProfile: testResearchProfile(),
      runs: [],
      onRunMemoryDreaming: () => undefined
    }));
    const dreamButton = html.match(/<button class="workspace-dream-card[^>]*>[\s\S]*?<\/button>/u)?.[0] ?? '';

    expect(dreamButton).toContain('disabled=""');
    expect(dreamButton).toContain('Loading workspace memory…');
    expect(dreamButton).toContain('Loading…');
  });

  it('allows Dejunk for paused sessions while blocking queued or active work', () => {
    expect(isLiveResearchRunStatus('paused')).toBe(false);
    expect(isLiveResearchRunStatus('queued')).toBe(true);
    expect(isLiveResearchRunStatus('active')).toBe(true);

    const renderHousekeeping = (status: RunRow['run']['status']): string => renderToStaticMarkup(createElement(WorkspaceHousekeepingPanel, {
      busy: false,
      workspaceDejunk: {
        available: true,
        newFileCount: 1,
        newFileCountCapped: false,
        baselineAt: '2026-08-12T08:00:00.000Z',
        lastRun: null
      },
      memoryDreamingInProgress: false,
      honeycrispMemory: memorySummary(),
      researchProfile: testResearchProfile(),
      runs: [runRow(`run_${status}`, [], { status })],
      onRunMemoryDreaming: () => undefined
    }));
    const pausedButton = renderHousekeeping('paused').match(/<button class="workspace-dejunk-card[^>]*>/u)?.[0] ?? '';
    const queuedButton = renderHousekeeping('queued').match(/<button class="workspace-dejunk-card[^>]*>/u)?.[0] ?? '';

    expect(pausedButton).not.toContain('disabled=""');
    expect(pausedButton).toContain('title="Organize loose research files and remove large reclaimable artifacts"');
    expect(queuedButton).toContain('disabled=""');
    expect(queuedButton).toContain('title="Dejunk is unavailable while a research session is active"');
  });
});

function runRow(
  id: string,
  intervals: Array<[startedAt: string, endedAt: string | null]>,
  outcome: {
    status?: RunRow['run']['status'];
    terminationCause?: SessionRunActivity['terminationCause'];
  } = {}
): RunRow {
  return {
    run: {
      id,
      scopeVersionId: 'scope_one',
      researchProfileSnapshotId: null,
      shellSafetyMode: 'auto_review',
      mode: 'dynamic',
      status: outcome.status ?? (intervals.at(-1)?.[1] === null ? 'active' : 'completed'),
      title: 'Recent session',
      promptMarkdown: '',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      attemptStrategy: 'breadth_first',
      sandboxProfile: 'host',
      targetAssetId: null,
      targetPath: null,
      budget: {},
      summary: '',
      finalDisposition: null,
      createdAt: intervals[0]?.[0] ?? new Date(NOW).toISOString(),
      startedAt: intervals[0]?.[0] ?? null,
      endedAt: intervals.at(-1)?.[1] ?? null
    },
    engine: 'honeycrisp',
    sessionRuns: intervals.length > 0
      ? [sessionRun(id, `attempt_${id}`, intervals, outcome)]
      : []
  };
}

function sessionRun(
  runId: string,
  attemptId: string,
  intervals: Array<[startedAt: string, endedAt: string | null]>,
  outcome: {
    status?: SessionRunActivity['status'];
    terminationCause?: SessionRunActivity['terminationCause'];
  } = {}
): SessionRunActivity {
  return {
    id: attemptId,
    runId,
    attemptId,
    status: outcome.status ?? (intervals.at(-1)?.[1] === null ? 'active' : 'completed'),
    terminationCause: outcome.terminationCause ?? null,
    activityIntervals: intervals.map(([startedAt, endedAt], index) => ({
      id: `activity_${attemptId}_${index}`,
      runId,
      attemptId,
      startedAt,
      endedAt
    }))
  };
}

function memorySummary(input: {
  nodes?: Array<Partial<HoneycrispMemorySummary['nodes'][number]>>;
  runbooks?: Array<Partial<HoneycrispMemorySummary['runbooks'][number]>>;
  reports?: Array<Partial<HoneycrispMemorySummary['reports'][number]>>;
  lastDreamCompletedAt?: string;
} = {}): HoneycrispMemorySummary {
  return {
    status: 'ready',
    source: 'honeycrisp_sqlite',
    contextWorkspaceId: 'workspace_security',
    contextSubjectId: 'subject_security',
    databasePath: '/memory.sqlite',
    storageRoot: '/storage',
    artifactDirectoryPath: '/artifacts',
    databaseSizeBytes: 1_024,
    nodeCount: input.nodes?.length ?? 0,
    edgeCount: 0,
    evidenceRefCount: 0,
    storageArtifactCount: 0,
    runbookCount: input.runbooks?.length ?? 0,
    reportCount: input.reports?.length ?? 0,
    latestNodeUpdatedAt: null,
    nodeTypeCounts: {},
    nodeStatusCounts: {},
    nodes: (input.nodes ?? []).map((node) => ({
      sessionIds: [],
      workspaces: [],
      subjectId: 'subject_security',
      subjectName: 'Security',
      summary: '',
      body: '',
      status: 'suspected',
      confidence: 0.5,
      assetIds: [],
      tags: [],
      attributes: {},
      evidenceRefs: [],
      updatedAt: node.createdAt ?? new Date(NOW).toISOString(),
      revision: 1,
      id: 'memory',
      type: 'other',
      title: 'Memory',
      createdAt: new Date(NOW).toISOString(),
      ...node
    })),
    edges: [],
    runbooks: (input.runbooks ?? []).map((runbook) => ({
      id: 'runbook',
      workspaceId: 'workspace_security',
      workspaceName: 'Security',
      subjectId: 'subject_security',
      subjectName: 'Security',
      sessionId: null,
      title: 'Runbook',
      purpose: '',
      status: 'active',
      artifactId: 'runbook',
      revision: 1,
      revisions: [],
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      ...runbook
    })),
    reports: (input.reports ?? []).map((report) => ({
      id: 'report',
      workspaceId: 'workspace_security',
      workspaceName: 'Security',
      subjectId: 'subject_security',
      subjectName: 'Security',
      sessionId: null,
      title: 'Report',
      summary: '',
      status: 'complete',
      artifactId: 'report',
      revision: 1,
      revisions: [],
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      ...report,
      submissionPacket: report.submissionPacket ?? null
    })),
    directories: [],
    lastError: null,
    dreaming: {
      available: true,
      scope: 'workspace',
      hiddenNodeCount: 0,
      restorableChangeCount: 0,
      lastRun: input.lastDreamCompletedAt ? {
        id: 'dream_one',
        status: 'completed',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        inputNodeCount: 1,
        inputSessionCount: 1,
        prunedNodeCount: 0,
        duplicateHiddenCount: 0,
        duplicateGroupCount: 0,
        reclassifiedNodeCount: 0,
        editedNodeCount: 0,
        createdAt: input.lastDreamCompletedAt,
        completedAt: input.lastDreamCompletedAt,
        restoredAt: null,
        errorMessage: null
      } : null,
      changes: []
    }
  };
}
