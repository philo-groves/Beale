import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BreakoutRoomRecord, HoneycrispMemoryEdgeSummary, HoneycrispMemoryNodeSummary, HoneycrispMemorySummary, HoneycrispReportSummary, HoneycrispRunbookDocument, HoneycrispRunbookSummary, ResearchProfile, RunDetail, TraceEventRecord } from '@shared/types';
import {
  BreakoutRoomCatalogItem,
  ResearchSidePanel,
  ResearchSideViewTabs,
  SubagentCatalogSection,
  MemoryTypeCatalogSection,
  RunbookCatalogItem,
  ReportCatalogItem,
  DEFAULT_MEMORY_LEVEL_FILTER,
  DEFAULT_RUNBOOK_SCOPE_FILTER,
  DEFAULT_WORKSPACE_MEMORY_LEVEL_FILTER,
  DEFAULT_WORKSPACE_RUNBOOK_SCOPE_FILTER,
  availableResearchSideViews,
  breakoutRoomCatalogGroups,
  filterBreakoutRoomCatalog,
  isLastOpenResearchSideView,
  filterRunbookCatalog,
  memoryLevelFiltersForViewSpace,
  researchViewSpaceLabel,
  researchSideViewsForProfile,
  researchSideNavigationForSelectedDetail,
  researchSideNavigationReducer,
  runbookScopeFiltersForViewSpace,
  restrictResearchSideNavigation,
  subagentModelDisplayName,
  type ResearchSideNavigationState
} from '../src/renderer/features/research/MemorySidePanel';
import { activeMemoryCount, filterMemoryCatalogNodes, groupMemoryRelationships, memoryCatalogGroupPreview, memoryCatalogStatusGroups, memoryCatalogUpdateKey, memoryTypeGroupsByHeat, memoryTypeSummaryPresentation, sessionMemoryActivitySummary, sessionMemoryCatalogNodes, sessionMemoryTypeSummaries } from '../src/renderer/view-models/memoryCatalog';
import { hasResearchProfileDetailFeatures, researchProfileFeatureAvailability } from '../src/renderer/view-models/researchProfileFeatures';
import { runbookCatalogGroups } from '../src/renderer/view-models/runbooks';
import { reportCatalogGroups } from '../src/renderer/view-models/reports';
import { memoryStatusPolarity } from '../src/renderer/features/research/MemoryStatusDot';
import { testResearchProfile } from './researchProfileFixture';

describe('renderer memory catalog', () => {
  it('maps profile memory status polarity to semantic dot colors', () => {
    const statuses = testResearchProfile().memory.statuses;
    expect(memoryStatusPolarity('draft', statuses)).toBe('neutral');
    expect(memoryStatusPolarity('confirmed', statuses)).toBe('positive');
    expect(memoryStatusPolarity('rejected')).toBe('negative');
    expect(memoryStatusPolarity('custom-status')).toBe('unknown');
  });

  it('uses agent response color for primary catalog labels while metadata remains muted', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const subagentNameStyles = styles.match(/\.subagent-catalog-name\s*\{([^}]*)\}/u)?.[1] ?? '';
    const subagentModelStyles = styles.match(/\.subagent-catalog-model\s*\{([^}]*)\}/u)?.[1] ?? '';
    const memoryNameStyles = styles.match(/\.memory-catalog-item-name\s*\{([^}]*)\}/u)?.[1] ?? '';
    const runbookAndReportNameStyles = styles.match(/\.runbook-catalog-item:not\(\.breakout-room-catalog-item\) \.runbook-catalog-name\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(subagentNameStyles).toContain('color: var(--text)');
    expect(subagentModelStyles).toContain('color: var(--muted)');
    expect(memoryNameStyles).toContain('color: var(--text)');
    expect(runbookAndReportNameStyles).toContain('color: var(--text)');
  });

  it('uses response-colored text and dividers instead of catalog hover backgrounds', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const subagentHoverStyles = styles.match(/\.subagent-catalog-item:is\(:hover, :focus-visible\)\s*\{([^}]*)\}/u)?.[1] ?? '';
    const memoryHoverStyles = styles.match(/\.memory-catalog-item:hover\s*\{([^}]*)\}/u)?.[1] ?? '';
    const runbookHoverStyles = styles.match(/\.runbook-catalog-item:not\(\.breakout-room-catalog-item\):is\(:hover, :focus-visible\)\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(subagentHoverStyles).toContain('inset 0 1px var(--text)');
    expect(subagentHoverStyles).toContain('inset 0 -1px var(--text)');
    expect(memoryHoverStyles).toContain('background: transparent');
    expect(memoryHoverStyles).toContain('inset 0 1px var(--text)');
    expect(memoryHoverStyles).not.toContain('var(--gray-20)');
    expect(runbookHoverStyles).toContain('inset 0 1px var(--text)');
    expect(runbookHoverStyles).toContain('inset 0 -1px var(--text)');
    expect(styles).toMatch(/button\.subagent-catalog-item:hover:not\(:disabled\)[^{]*\{[^}]*background: transparent/u);
    expect(styles).toMatch(/button\.runbook-catalog-item:not\(\.breakout-room-catalog-item\):hover:not\(:disabled\)[^{]*\{[^}]*background: transparent/u);
    expect(styles).toMatch(/\.subagent-catalog-preview\s*\)\s*\{\s*color: var\(--text\)/u);
    expect(styles).toMatch(/\.memory-catalog-item-trailing\s*,[\s\S]*\.memory-catalog-item-type\s*,[\s\S]*\.memory-catalog-item-author-model\s*\)\s*\{\s*color: var\(--text\)/u);
    expect(styles).toMatch(/\btime\s*\)\s*\{\s*color: var\(--text\)/u);
  });

  it('uses provider catalog display names for subagent models with identifier fallback', () => {
    const catalogs = [{
      providerId: 'xai' as const,
      providerName: 'xAI',
      models: [{
        id: 'grok-4.6',
        name: 'Grok 4.6',
        reasoning: true,
        effortLevels: ['low' as const, 'high' as const],
        contextWindow: 500_000,
        maxTokens: 32_000
      }]
    }];

    expect(subagentModelDisplayName('xai', 'grok-4.6', catalogs)).toBe('Grok 4.6');
    expect(subagentModelDisplayName('xai', 'grok-legacy', catalogs)).toBe('grok-legacy');
    expect(subagentModelDisplayName(null, null, catalogs)).toBe('Unknown model');
  });

  it('renders subagent timestamps before spinner and dot status indicators', () => {
    const baseAgent = {
      id: 'agent_parser',
      path: '/root/parser_review',
      name: 'parser_review',
      provider: 'xai',
      model: 'grok-4.6',
      latestMessage: 'Checking the parser boundary.',
      createdAt: '2026-07-20T10:00:00.000Z',
      lastActiveAt: '2026-07-20T10:01:00.000Z'
    };
    const activeHtml = renderToStaticMarkup(createElement(SubagentCatalogSection, {
      agents: [{ ...baseAgent, status: 'running' as const }],
      nowMs: Date.parse('2026-07-20T12:00:00.000Z'),
      providerModelCatalog: [],
      label: 'Active',
      selectedPath: null,
      onSelect: () => undefined
    }));
    const completedHtml = renderToStaticMarkup(createElement(SubagentCatalogSection, {
      agents: [{ ...baseAgent, status: 'completed' as const }],
      nowMs: Date.parse('2026-07-20T12:00:00.000Z'),
      providerModelCatalog: [],
      label: 'Completed',
      selectedPath: null,
      onSelect: () => undefined
    }));

    expect(activeHtml.indexOf('<time')).toBeLessThan(activeHtml.indexOf('subagent-catalog-status is-active'));
    expect(activeHtml).toContain('>2h</time>');
    expect(activeHtml).toContain('subagent-catalog-status-spinner');
    expect(activeHtml).not.toContain('>Running</span>');
    expect(completedHtml.indexOf('<time')).toBeLessThan(completedHtml.indexOf('subagent-catalog-status is-success'));
    expect(completedHtml).not.toContain('subagent-catalog-status-spinner');
    expect(completedHtml).not.toContain('>Completed</span>');
  });

  it('defaults the detailed memory catalog to Session scope', () => {
    expect(DEFAULT_MEMORY_LEVEL_FILTER).toBe('session');
  });

  it('locks workspace detail views to workspace-or-broader scopes', () => {
    expect(DEFAULT_WORKSPACE_MEMORY_LEVEL_FILTER).toBe('workspace');
    expect(DEFAULT_WORKSPACE_RUNBOOK_SCOPE_FILTER).toBe('workspace');
    expect(memoryLevelFiltersForViewSpace('workspace')).toEqual(['workspace', 'subject']);
    expect(runbookScopeFiltersForViewSpace('workspace')).toEqual(['workspace']);
    expect(memoryLevelFiltersForViewSpace('session')).toEqual(['session', 'workspace', 'subject']);
    expect(runbookScopeFiltersForViewSpace('session')).toEqual(['session', 'workspace']);
    expect(researchViewSpaceLabel('session')).toBe('Session');
    expect(researchViewSpaceLabel('workspace')).toBe('Workspace');
  });

  it('defaults runbooks to Session scope and filters by recorded context', () => {
    expect(DEFAULT_RUNBOOK_SCOPE_FILTER).toBe('session');
    const currentSession = runbook({ id: 'current_session', sessionId: 'run_current' });
    const priorSession = runbook({ id: 'prior_session', sessionId: 'run_prior' });
    const otherWorkspace = runbook({ id: 'other_workspace', workspaceId: 'workspace_mdns', sessionId: 'run_current' });
    const runbooks = [currentSession, priorSession, otherWorkspace];

    expect(filterRunbookCatalog(runbooks, 'session', 'run_current', 'workspace_zsh')).toEqual([
      currentSession,
      otherWorkspace
    ]);
    expect(filterRunbookCatalog(runbooks, 'workspace', 'run_current', 'workspace_zsh')).toEqual([
      currentSession,
      priorSession
    ]);
    expect(filterRunbookCatalog(runbooks, 'workspace', 'run_current', 'workspace_zsh', 'prior')).toEqual([
      priorSession
    ]);
    expect(filterRunbookCatalog(runbooks, 'workspace', 'run_current', 'workspace_zsh', 'runbook purpose')).toEqual([
      currentSession,
      priorSession
    ]);
  });

  it('groups non-archived and archived runbooks newest-first', () => {
    const draft = runbook({ id: 'draft', status: 'draft', updatedAt: '2026-07-19T13:00:00.000Z' });
    const active = runbook({ id: 'active', status: 'active', updatedAt: '2026-07-19T15:00:00.000Z' });
    const completed = runbook({ id: 'completed', status: 'completed', updatedAt: '2026-07-19T14:00:00.000Z' });
    const archivedOlder = runbook({ id: 'archived_older', status: 'archived', updatedAt: '2026-07-19T12:00:00.000Z' });
    const archivedNewer = runbook({ id: 'archived_newer', status: 'archived', updatedAt: '2026-07-19T16:00:00.000Z' });
    expect(runbookCatalogGroups([draft, archivedOlder, completed, archivedNewer, active])).toEqual({
      active: [active, completed, draft],
      archived: [archivedNewer, archivedOlder]
    });

    const html = renderToStaticMarkup(createElement(RunbookCatalogItem, {
      compactTime: true,
      nowMs: Date.parse('2026-07-20T15:00:00.000Z'),
      runbook: active,
      selected: false,
      onOpen: () => undefined
    }));
    expect(html).toContain('class="runbook-catalog-item runbook-status-active "');
    expect(html).toContain('class="lucide lucide-book-open runbook-catalog-icon"');
    expect(html).toContain('class="runbook-catalog-name">Runbook title</span>');
    expect(html).toContain('class="runbook-catalog-heading-trailing"><span class="runbook-catalog-status">Active</span><time');
    expect(html).toMatch(/<time class="catalog-time-since" dateTime="2026-07-19T15:00:00\.000Z" title="[^"]+">1d<\/time>/u);
    expect(html).toContain('class="runbook-catalog-purpose">Runbook purpose</span>');
    expect(html).not.toContain('runbook-catalog-type');
    expect(html).not.toContain('memory-catalog-status');
  });

  it('groups Complete and Stale reports newest-first and renders report catalog rows', () => {
    const complete = report({ id: 'report_complete', title: 'A readable result', status: 'complete', updatedAt: '2026-07-20T12:00:00.000Z' });
    const stale = report({ id: 'report_stale', title: 'Old result', status: 'stale', updatedAt: '2026-07-19T12:00:00.000Z' });
    expect(reportCatalogGroups([stale, complete])).toEqual({ complete: [complete], stale: [stale] });
    const html = renderToStaticMarkup(createElement(ReportCatalogItem, {
      report: complete,
      nowMs: Date.parse('2026-07-22T12:00:00.000Z'),
      selected: false,
      onOpen: () => undefined
    }));
    expect(html).toContain('A readable result');
    expect(html).toContain('Complete');
    expect(html).toContain('A short report summary.');
    expect(html).toContain('>2d</time>');
  });

  it('filters and groups breakout rooms for the detailed Rooms catalog', () => {
    const active = breakoutRoom({ id: 'room_active', title: 'live parser review', status: 'active' });
    const completed = breakoutRoom({ id: 'room_completed', title: 'Completed proof review', status: 'completed' });
    const interrupted = breakoutRoom({ id: 'room_interrupted', title: 'Interrupted provider review', status: 'interrupted' });

    expect(filterBreakoutRoomCatalog([completed, interrupted, active], 'live')).toEqual([active]);
    expect(breakoutRoomCatalogGroups([completed, interrupted, active])).toEqual([
      { status: 'active', rooms: [active] },
      { status: 'completed', rooms: [completed] },
      { status: 'interrupted', rooms: [interrupted] }
    ]);

    const html = renderToStaticMarkup(createElement(BreakoutRoomCatalogItem, {
      room: active,
      nowMs: Date.parse('2026-07-19T14:04:00.000Z'),
      selected: false,
      onOpen: () => undefined
    }));
    expect(html).toContain('room-status-active');
    expect(html).toContain('lucide-messages-square');
    expect(html).toContain('Live Parser Review');
    expect(html).toContain('Active');
    expect(html).toContain('Review competing parser hypotheses.');
    expect(html).toContain('>2h</time>');
  });

  it('opens, activates, and closes detailed side views without losing neighboring tabs', () => {
    let state: ResearchSideNavigationState = { openViews: [], activeView: null };
    state = researchSideNavigationReducer(state, { type: 'open', view: 'memory' });
    state = researchSideNavigationReducer(state, { type: 'open', view: 'runbooks' });
    state = researchSideNavigationReducer(state, { type: 'open', view: 'subagents' });
    state = researchSideNavigationReducer(state, { type: 'activate', view: 'runbooks' });

    expect(state).toEqual({
      openViews: ['memory', 'runbooks', 'subagents'],
      activeView: 'runbooks'
    });

    state = researchSideNavigationReducer(state, { type: 'close', view: 'runbooks' });
    expect(state).toEqual({ openViews: ['memory', 'subagents'], activeView: 'subagents' });
    expect(availableResearchSideViews(state.openViews)).toEqual(['runbooks', 'reports', 'rooms']);

    state = researchSideNavigationReducer(state, { type: 'close', view: 'subagents' });
    state = researchSideNavigationReducer(state, { type: 'close', view: 'memory' });
    expect(state).toEqual({ openViews: [], activeView: null });
  });

  it('activates an externally selected subagent detail without stopping at the view chooser', () => {
    expect(researchSideNavigationForSelectedDetail(
      { openViews: [], activeView: null },
      '/root/parser_review',
      null,
      null,
      null,
      ['memory', 'runbooks', 'reports', 'rooms', 'subagents']
    )).toEqual({ openViews: ['subagents'], activeView: 'subagents' });

    expect(researchSideNavigationForSelectedDetail(
      { openViews: ['memory'], activeView: 'memory' },
      '/root/parser_review',
      null,
      null,
      null,
      ['memory', 'subagents']
    )).toEqual({ openViews: ['memory', 'subagents'], activeView: 'subagents' });
  });

  it('collapses only when the final detailed side view is closed', () => {
    expect(isLastOpenResearchSideView(['memory', 'runbooks'], 'memory')).toBe(false);
    expect(isLastOpenResearchSideView(['memory'], 'memory')).toBe(true);
    expect(isLastOpenResearchSideView([], 'memory')).toBe(false);
  });

  it('limits side navigation to run-pinned profile features while retaining null-profile legacy views', () => {
    const runbooksOnly = researchProfileWithFeatures({
      memoryEnabled: false,
      runbooksEnabled: true,
      reportsEnabled: false,
      collaborationEnabled: false
    });

    expect(researchSideViewsForProfile(null)).toEqual(['memory', 'runbooks', 'reports', 'rooms', 'subagents']);
    expect(researchProfileFeatureAvailability(null)).toEqual({ memory: true, runbooks: true, reports: true, collaboration: true });
    expect(researchSideViewsForProfile(runbooksOnly)).toEqual(['runbooks']);
    expect(hasResearchProfileDetailFeatures(runbooksOnly)).toBe(true);
    expect(hasResearchProfileDetailFeatures(researchProfileWithFeatures({
      memoryEnabled: false,
      runbooksEnabled: false,
      reportsEnabled: false,
      collaborationEnabled: false
    }))).toBe(false);
    expect(availableResearchSideViews([], ['runbooks'])).toEqual(['runbooks']);
    expect(restrictResearchSideNavigation({
        openViews: ['memory', 'runbooks', 'reports', 'rooms', 'subagents'],
      activeView: 'subagents'
    }, ['runbooks'])).toEqual({
      openViews: ['runbooks'],
      activeView: 'runbooks'
    });
  });

  it('renders icon-and-close tabs and hides the add-view button when every view is open', () => {
    const html = renderToStaticMarkup(createElement(ResearchSideViewTabs, {
      activeView: 'subagents',
      openViews: ['memory', 'runbooks', 'reports', 'rooms', 'subagents'],
      onActivate: () => undefined,
      onClose: () => undefined,
      onOpen: () => undefined
    }));

    expect(html).toContain('role="tablist"');
    expect(html).toContain('research-side-view-tabs-scrollable');
    expect(html).toContain('lucide-database');
    expect(html).toContain('lucide-book-open');
    expect(html).toContain('lucide-file-text');
    expect(html).toContain('lucide-messages-square');
    expect(html).toContain('lucide-bot');
    expect(html).toContain('aria-label="Close Memories"');
    expect(html).toContain('aria-label="Close Runbooks"');
    expect(html).toContain('aria-label="Close Reports"');
    expect(html).toContain('aria-label="Close Rooms"');
    expect(html).toContain('aria-label="Close Subagents"');
    expect(html).not.toContain('aria-label="Add session detail view"');
  });

  it('excludes stale memories from the active sidebar count', () => {
    expect(activeMemoryCount([
      memoryNode({ id: 'confirmed', status: 'confirmed' }),
      memoryNode({ id: 'suspected', status: 'suspected' }),
      memoryNode({ id: 'rejected', status: 'rejected' }),
      memoryNode({ id: 'stale', status: 'stale' })
    ])).toBe(3);
  });

  it('counts only profile statuses that remain active under recommendation semantics', () => {
    const statuses: ResearchProfile['memory']['statuses'] = [
      { id: 'working', name: 'Working', description: '', order: 10, polarity: 'neutral' },
      { id: 'blocked', name: 'Blocked', description: '', order: 20, polarity: 'negative' },
      { id: 'closed', name: 'Closed', description: '', order: 30, terminal: true, polarity: 'neutral' },
      { id: 'published', name: 'Published', description: '', order: 40, terminal: true, polarity: 'positive' }
    ];

    expect(activeMemoryCount([
      memoryNode({ id: 'working', status: 'working' }),
      memoryNode({ id: 'blocked', status: 'blocked' }),
      memoryNode({ id: 'closed', status: 'closed' }),
      memoryNode({ id: 'published', status: 'published' }),
      memoryNode({ id: 'unknown', status: 'unknown' })
    ], statuses)).toBe(2);
  });

  it('groups memory states without dropping drafts or stale records and previews five rows', () => {
    const draft = memoryNode({ id: 'draft', status: 'draft', updatedAt: '2026-07-19T13:00:00.000Z' });
    const suspected = memoryNode({ id: 'suspected', status: 'suspected', updatedAt: '2026-07-19T14:00:00.000Z' });
    const confirmed = memoryNode({ id: 'confirmed', status: 'confirmed' });
    const rejected = memoryNode({ id: 'rejected', status: 'rejected' });
    const stale = memoryNode({ id: 'stale', status: 'stale' });
    expect(memoryCatalogStatusGroups([draft, suspected, confirmed, rejected, stale])).toEqual({
      suspected: [suspected, draft],
      confirmed: [confirmed],
      rejected: [rejected, stale]
    });

    const nodes = [draft, suspected, confirmed, rejected, stale, draft, suspected];
    expect(memoryCatalogGroupPreview(nodes, false)).toEqual({ visibleNodes: nodes.slice(0, 5), hiddenCount: 2 });
    expect(memoryCatalogGroupPreview(nodes, true)).toEqual({ visibleNodes: nodes, hiddenCount: 0 });

    const sectionNodes = Array.from({ length: 7 }, (_, index) => memoryNode({
      authors: index === 0 ? [
        { provider: 'xai', model: 'grok-4.6' },
        { provider: 'anthropic', model: 'claude-opus-5' }
      ] : [],
      id: `suspected_${index + 1}`,
      title: `Suspected memory ${index + 1}`,
      summary: index === 0 ? 'Memory uses `parse_length` before allocation' : 'Memory summary',
      status: 'suspected'
    }));
    const memoryType = {
      ...summaryMemoryType('primitive', 10, { confirmed: 'high' }),
      name: 'Primitive',
      pluralName: 'Primitives'
    };
    const providerModelCatalog = [{
      providerId: 'xai' as const,
      providerName: 'xAI',
      models: [{
        id: 'grok-4.6',
        name: 'Grok 4.6',
        reasoning: true,
        effortLevels: ['low' as const, 'high' as const],
        contextWindow: 500_000,
        maxTokens: 32_000
      }]
    }, {
      providerId: 'anthropic' as const,
      providerName: 'Anthropic',
      models: [{
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        reasoning: true,
        effortLevels: ['low' as const, 'high' as const],
        contextWindow: 500_000,
        maxTokens: 32_000
      }]
    }];
    const html = renderToStaticMarkup(createElement(MemoryTypeCatalogSection, {
      nodes: sectionNodes,
      nowMs: Date.parse('2026-07-22T12:00:00.000Z'),
      type: 'primitive',
      memoryTypes: [memoryType],
      memoryStatuses: [{ id: 'suspected', name: 'Suspected', description: 'Needs confirmation.', order: 10, polarity: 'neutral' }],
      providerModelCatalog,
      expanded: false,
      selectedNodeId: null,
      onExpand: () => undefined,
      onOpen: () => undefined
    }));
    expect(html).toContain('7 Primitives');
    expect(html).toContain('data-memory-type="primitive"');
    expect(html).toContain('Show 2 More');
    expect(html).toContain('lucide-chevron-down');
    expect(html).toContain('Suspected memory 5');
    expect(html).not.toContain('Suspected memory 6');
    expect(html).toMatch(/class="memory-catalog-item-meta-line"><span class="memory-catalog-item-trailing">[\s\S]*?<span class="memory-catalog-item-primary"><span class="memory-catalog-item-name"/u);
    expect(html).not.toContain('memory-type-icon');
    expect(html).not.toContain('class="lucide lucide-database"');
    expect(html).toContain('class="memory-catalog-item-name" title="Suspected memory 1">Suspected memory 1</span>');
    expect(html).toContain('class="memory-catalog-item-trailing"><time');
    expect(html).toContain('>3d</time>');
    expect(html).toContain('class="memory-status-dot memory-status-neutral" data-memory-status="suspected" data-memory-status-polarity="neutral" role="img" aria-label="Status: Suspected" title="Suspected: Needs confirmation."');
    expect(html).toContain('class="memory-type-label memory-type-primitive memory-catalog-item-type" data-memory-heat="high"');
    expect(html).toContain('style="--memory-type-color:var(--session-heat-high-color)"');
    expect(html).toContain('class="memory-catalog-item-authors" aria-label="Model authors"');
    expect(html).toContain('class="memory-catalog-item-author" title="xai/grok-4.6"');
    expect(html).toContain('class="memory-catalog-item-author-provider"><svg aria-hidden="true"');
    expect(html).toContain('height="15"');
    expect(html).toContain('class="memory-catalog-item-author-model">Grok 4.6</span>');
    expect(html).toContain('class="memory-catalog-item-author" title="anthropic/claude-opus-5"');
    expect(html).toContain('class="memory-catalog-item-author-model">Opus 5</span>');
    expect(html.indexOf('title="xai/grok-4.6"')).toBeLessThan(html.indexOf('title="anthropic/claude-opus-5"'));
    expect(html).not.toContain('memory-catalog-item-separator');
    expect(html).not.toContain('main-trace-inline-code');
    expect(html).not.toContain('memory-catalog-item-description');
    expect(html).not.toContain('memory-catalog-status');

    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const compactNameStyles = styles.match(/\.memory-catalog-item\.is-compact \.memory-catalog-item-name\s*\{([^}]*)\}/u)?.[1] ?? '';
    const compactTrailingStyles = styles.match(/\.memory-catalog-item\.is-compact \.memory-catalog-item-trailing\s*\{([^}]*)\}/u)?.[1] ?? '';
    const authorListStyles = styles.match(/\.memory-catalog-item-authors\s*\{([^}]*)\}/u)?.[1] ?? '';
    const authorProviderStyles = styles.match(/\.memory-catalog-item-author-provider\s*\{([^}]*)\}/u)?.[1] ?? '';
    const authorModelStyles = styles.match(/\.memory-catalog-item-author-model\s*\{([^}]*)\}/u)?.[1] ?? '';
    expect(compactNameStyles).toContain('white-space: normal');
    expect(compactNameStyles).toContain('overflow-wrap: anywhere');
    expect(compactTrailingStyles).toContain('float: right');
    expect(authorListStyles).toContain('flex-wrap: wrap');
    expect(authorListStyles).toContain('gap: 6px');
    expect(authorProviderStyles).toContain('width: 16px');
    expect(authorProviderStyles).toContain('height: 18px');
    expect(authorModelStyles).toContain('font-size: 0.9rem');
  });

  it('groups sidenav memories by canonical type and sorts hotter types first', () => {
    const finding = summaryMemoryType('finding', 10, { confirmed: 'high' });
    const note = { ...summaryMemoryType('note', 20, { draft: 'low' }), aliases: ['observation'] };
    const neutral = summaryMemoryType('neutral', 30);
    const groups = memoryTypeGroupsByHeat([
      memoryNode({ id: 'neutral_one', type: 'neutral', status: 'draft' }),
      memoryNode({ id: 'neutral_two', type: 'neutral', status: 'draft' }),
      memoryNode({ id: 'finding_one', type: 'finding', status: 'confirmed' }),
      memoryNode({ id: 'note_one', type: 'observation', status: 'draft' })
    ], [finding, note, neutral], 'security-research', {
      'security-research': { note: { draft: 'critical' } }
    });

    expect(groups.map((group) => [group.type, group.nodes.map((node) => node.id)])).toEqual([
      ['note', ['note_one']],
      ['finding', ['finding_one']],
      ['neutral', ['neutral_one', 'neutral_two']]
    ]);
  });

  it('counts paired memory searches and updates once', () => {
    expect(sessionMemoryActivitySummary([])).toBe('');
    expect(sessionMemoryActivitySummary([
      memoryToolEvent('tool.requested', 'search_one', 'memory.search', 1),
      memoryToolEvent('tool.observed', 'search_one', 'memory.search', 2),
      memoryToolEvent('tool.requested', 'save_one', 'memory.save', 3),
      memoryToolEvent('tool.observed', 'save_one', 'memory.save', 4),
      memoryToolEvent('tool.requested', 'correct_one', 'memory.correct', 5)
    ])).toBe('1 Search, 2 Updates');
    expect(sessionMemoryActivitySummary([
      memoryToolEvent('tool.requested', 'search_one', 'memory.search', 1),
      memoryToolEvent('tool.observed', 'search_one', 'memory.search', 2),
      memoryToolEvent('tool.requested', 'search_two', 'memory.search', 3),
      memoryToolEvent('tool.observed', 'search_two', 'memory.search', 4)
    ])).toBe('2 Searches');
  });

  it('groups active memories into primitive, chain, sink, and other summaries', () => {
    expect(sessionMemoryTypeSummaries([
      memoryNode({ id: 'primitive_confirmed', type: 'primitive', status: 'confirmed' }),
      memoryNode({ id: 'primitive_suspected', type: 'primitive', status: 'suspected' }),
      memoryNode({ id: 'primitive_rejected', type: 'primitive', status: 'rejected' }),
      memoryNode({ id: 'chain_confirmed', type: 'chain', status: 'confirmed' }),
      memoryNode({ id: 'sink_confirmed', type: 'sink', status: 'confirmed' }),
      memoryNode({ id: 'sink_suspected', type: 'sink', status: 'suspected' }),
      memoryNode({ id: 'trajectory_confirmed', type: 'trajectory', status: 'confirmed' }),
      memoryNode({ id: 'trajectory_suspected', type: 'trajectory', status: 'suspected' }),
      memoryNode({ id: 'evidence_confirmed', type: 'evidence', status: 'confirmed' }),
      memoryNode({ id: 'evidence_suspected', type: 'evidence', status: 'suspected' }),
      memoryNode({ id: 'custom_signal', type: 'custom_signal', status: 'suspected' }),
      memoryNode({ id: 'custom_rejected', type: 'custom_signal', status: 'rejected' }),
      memoryNode({ id: 'stale_type', type: 'sink', status: 'stale' })
    ])).toEqual([
      { type: 'sink', count: 2, confirmedCount: 1, suspectedCount: 1, rejectedCount: 0, countLabel: '2 Sinks', statusLabel: '1 Confirmed, 1 Suspected' },
      { type: 'primitive', count: 3, confirmedCount: 1, suspectedCount: 1, rejectedCount: 1, countLabel: '3 Primitives', statusLabel: '1 Confirmed, 1 Suspected, 1 Rejected' },
      { type: 'chain', count: 1, confirmedCount: 1, suspectedCount: 0, rejectedCount: 0, countLabel: '1 Chain', statusLabel: '1 Confirmed' },
      { type: 'other', count: 6, confirmedCount: 2, suspectedCount: 3, rejectedCount: 1, countLabel: '6 Boring', statusLabel: '' }
    ]);
  });

  it('orders summary memory types by effective heat then count and expands the default limit for heat-impacting types', () => {
    const profile = testResearchProfile();
    const memory = {
      ...profile.memory,
      types: [
        summaryMemoryType('critical_override', 10, { confirmed: 'low' }),
        summaryMemoryType('high_many', 20, { confirmed: 'high' }),
        summaryMemoryType('high_few', 30, { confirmed: 'high' }),
        summaryMemoryType('medium', 40, { confirmed: 'medium' }),
        summaryMemoryType('low', 50, { confirmed: 'low' }),
        summaryMemoryType('none', 60)
      ]
    };
    const summaries = sessionMemoryTypeSummaries([
      ...Array.from({ length: 2 }, (_, index) => memoryNode({ id: `critical_${index}`, type: 'critical_override', status: 'confirmed' })),
      ...Array.from({ length: 5 }, (_, index) => memoryNode({ id: `high_many_${index}`, type: 'high_many', status: 'confirmed' })),
      memoryNode({ id: 'high_few', type: 'high_few', status: 'confirmed' }),
      memoryNode({ id: 'medium', type: 'medium', status: 'confirmed' }),
      memoryNode({ id: 'low', type: 'low', status: 'confirmed' }),
      ...Array.from({ length: 9 }, (_, index) => memoryNode({ id: `none_${index}`, type: 'none', status: 'confirmed' }))
    ], memory);

    const presentation = memoryTypeSummaryPresentation(summaries, memory, profile.id, {
      [profile.id]: { critical_override: { confirmed: 'critical' } }
    });

    expect(presentation.defaultVisibleCount).toBe(5);
    expect(presentation.summaries.map((summary) => summary.type)).toEqual([
      'critical_override',
      'high_many',
      'high_few',
      'medium',
      'low',
      'none'
    ]);
  });

  it('uses a vertically animated collapsed overflow for summary memory types', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const overflowStyles = styles.match(/\.session-memory-type-overflow\s*\{([^}]*)\}/u)?.[1] ?? '';
    const expandedStyles = styles.match(/\.session-memory-type-overflow\.expanded\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(overflowStyles).toContain('grid-template-rows: 0fr');
    expect(overflowStyles).toContain('transition: grid-template-rows 180ms ease');
    expect(expandedStyles).toContain('grid-template-rows: 1fr');
  });

  it('collapses summary memory types beyond the default limit behind a grey text action', () => {
    const profile = testResearchProfile();
    const researchProfile: ResearchProfile = {
      ...profile,
      memory: {
        ...profile.memory,
        types: Array.from({ length: 5 }, (_, index) => summaryMemoryType(`type_${index}`, index))
      }
    };
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      researchProfile,
      memory: {
        contextWorkspaceId: 'workspace_zsh',
        contextSubjectId: 'subject_apple',
        nodes: Array.from({ length: 5 }, (_, index) => memoryNode({
          id: `summary_${index}`,
          type: `type_${index}`,
          status: 'draft',
          sessionIds: ['run_current']
        })),
        edges: [],
        runbooks: [],
        reports: [],
        lastError: null
      } as unknown as HoneycrispMemorySummary
    })));

    expect(html).toContain('class="session-memory-type-overflow" aria-hidden="true" inert=""');
    expect(html).toContain('class="session-memory-type-toggle" aria-expanded="false">Show 1 more</button>');
  });

  it('shows a session-scoped summary card before the detailed catalog', () => {
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, {
      detail: summaryDetail(),
      events: [
        memoryToolEvent('tool.requested', 'search_one', 'memory.search', 1),
        memoryToolEvent('tool.observed', 'search_one', 'memory.search', 2),
        memoryToolEvent('tool.requested', 'save_one', 'memory.save', 3),
        memoryToolEvent('tool.observed', 'save_one', 'memory.save', 4),
        memoryToolEvent('tool.requested', 'correct_one', 'memory.correct', 5)
      ],
      memory: {
        contextWorkspaceId: 'workspace_zsh',
        contextSubjectId: 'subject_apple',
        nodes: [
          memoryNode({ id: 'session_one', sessionIds: ['run_current'], status: 'confirmed' }),
          memoryNode({ id: 'session_two', sessionIds: ['run_current'] }),
          memoryNode({ id: 'session_chain', sessionIds: ['run_current'], type: 'chain', status: 'confirmed' }),
          memoryNode({ id: 'session_sink', sessionIds: ['run_current'], type: 'sink' }),
          memoryNode({ id: 'session_other', sessionIds: ['run_current'], type: 'invariant' }),
          memoryNode({ id: 'session_other_rejected', sessionIds: ['run_current'], type: 'invariant', status: 'rejected' }),
          memoryNode({ id: 'session_stale', sessionIds: ['run_current'], status: 'stale' }),
          memoryNode({ id: 'workspace_one' })
        ],
        edges: [],
        runbooks: [
          runbook({ id: 'runbook_one', sessionId: 'run_current', revision: 2 }),
          runbook({ id: 'runbook_two', sessionId: 'run_current', revision: 3 }),
          runbook({ id: 'runbook_archived', sessionId: 'run_current', status: 'archived', revision: 7 }),
          runbook({ id: 'runbook_workspace', sessionId: null, revision: 11 })
        ],
        lastError: null
      } as unknown as HoneycrispMemorySummary,
      providerModelCatalog: [],
      runId: 'run_current',
      runStatus: null,
      selectedRunbook: null,
      selectedRunbookDocument: null,
      runbookLoading: false,
      runbookError: null,
      selectedSubagentPath: null,
      selectedRunbookId: null,
      searchHighlightQuery: '',
      onBackToRunbooks: () => undefined,
      onBackToSubagents: () => undefined,
      onOpenRunbook: () => undefined,
      onSelectSubagent: () => undefined
    }));

    expect(html).toContain('aria-label="Session summary"');
    expect(html).toContain('class="session-summary-title">Session</h2>');
    expect(html).toContain('class="session-duration-metric session-stat-tooltip session-summary-duration"');
    expect(html).toContain('aria-label="Session duration 00:05:00"');
    expect(html.match(/class="session-summary-divider"/g)).toHaveLength(2);
    expect(html).toContain('60k Tokens');
    expect(html).toContain('50k In, 10k Out');
    expect(html).toContain('80% Hit Rate');
    expect(html).toContain('40k Cached');
    expect(html).toContain('25% Context');
    expect(html).toContain('50k Used');
    expect(html).toContain('lucide-coins');
    expect(html).toContain('lucide-badge-percent');
    expect(html).toContain('lucide-gauge');
    expect(html).toContain('<span>6 Memories</span>');
    expect(html).toContain('class="session-summary-meta">1 Search, 2 Updates</span>');
    expect(html).toContain('class="session-memory-type-item"><span>2 Primitives</span><span class="session-summary-meta">1 Confirmed, 1 Suspected</span></div>');
    expect(html).toContain('class="session-memory-type-item"><span>1 Chain</span><span class="session-summary-meta">1 Confirmed</span></div>');
    expect(html).toContain('class="session-memory-type-item"><span>1 Sink</span><span class="session-summary-meta">1 Suspected</span></div>');
    expect(html).toContain('class="session-memory-type-item"><span>2 Boring</span></div>');
    expect(html).not.toContain('memory-type-label');
    expect(html).not.toContain('memory-type-dot');
    expect(html).not.toContain('0 Confirmed');
    expect(html).not.toContain('0 Suspected');
    expect(html).not.toContain('0 Rejected');
    expect(html.indexOf('>2 Boring</span>')).toBeLessThan(html.indexOf('>2 Primitives</span>'));
    expect(html.indexOf('>2 Primitives</span>')).toBeLessThan(html.indexOf('>1 Chain</span>'));
    expect(html.indexOf('>1 Chain</span>')).toBeLessThan(html.indexOf('>1 Sink</span>'));
    expect(html.match(/session-memory-type-item/g)).toHaveLength(4);
    expect(html).toContain('<span>3 Runbooks</span>');
    expect(html).toContain('class="session-summary-meta">12 Updates</span>');
    expect(html).not.toContain('<span>0 Subagents</span>');
    expect(html).not.toContain('<span>0 Rooms</span>');
    expect(html).not.toContain('0 Active');
    expect(html).not.toContain('0 Completed');
    expect(html.match(/session-summary-chevron/g)).toHaveLength(2);
    expect(html).not.toContain('<span>0 Reports</span>');
    expect(html).not.toContain('aria-label="Search memory"');
    const firstDividerIndex = html.indexOf('class="session-summary-divider"');
    const secondDividerIndex = html.indexOf('class="session-summary-divider"', firstDividerIndex + 1);
    expect(html.indexOf('60k Tokens')).toBeLessThan(firstDividerIndex);
    expect(html.indexOf('<span>3 Runbooks</span>')).toBeGreaterThan(firstDividerIndex);
    expect(html.indexOf('<span>3 Runbooks</span>')).toBeLessThan(secondDividerIndex);
    expect(html.indexOf('<span>6 Memories</span>')).toBeGreaterThan(secondDividerIndex);
    expect(html.indexOf('>1 Sink</span>')).toBeGreaterThan(secondDividerIndex);
  });

  it('shows non-empty session resource rows in the compact summary', () => {
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      detail: {
        ...summaryDetail(),
        breakoutRooms: [breakoutRoom({ id: 'room_active', status: 'active' })],
        breakoutRoomMembers: [],
        breakoutRoomMessages: []
      },
      events: [subagentCommentaryEvent()],
      memory: {
        contextWorkspaceId: 'workspace_zsh',
        contextSubjectId: 'subject_apple',
        nodes: [],
        edges: [],
        runbooks: [runbook()],
        reports: [report()],
        lastError: null
      } as unknown as HoneycrispMemorySummary
    })));

    expect(html).toContain('<span>1 Runbook</span>');
    expect(html).toContain('<span>1 Report</span>');
    expect(html).toContain('<span>1 Room</span>');
    expect(html).toContain('<span>1 Subagent</span>');
    expect(html).not.toMatch(/<span>1 (?:Runbooks|Reports|Rooms|Subagents)<\/span>/u);
    expect(html).toContain('class="session-summary-meta">1 Active</span>');
    expect(html.match(/session-summary-chevron/g)).toHaveLength(5);
  });

  it('shows a centered first-view chooser when the detailed sidenav has no open views', () => {
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({ expanded: true })));

    expect(html).toContain('class="main-session-side memory-catalog view-empty"');
    expect(html).toContain('aria-label="Choose a session detail view"');
    expect(html).toContain('lucide-database');
    expect(html).toContain('<span>Memories</span>');
    expect(html).toContain('lucide-book-open');
    expect(html).toContain('<span>Runbooks</span>');
    expect(html).toContain('lucide-messages-square');
    expect(html).toContain('<span>Rooms</span>');
    expect(html).toContain('lucide-bot');
    expect(html).toContain('<span>Subagents</span>');
    expect(html).not.toContain('aria-label="Session summary"');
    expect(html).not.toContain('aria-label="Open session detail views"');
  });

  it('shows only workspace-scoped research resources in the workspace summary', () => {
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      detail: null,
      events: [subagentCommentaryEvent()],
      memory: {
        contextWorkspaceId: 'workspace_zsh',
        contextSubjectId: 'subject_apple',
        nodes: [
          memoryNode({ id: 'workspace_one' }),
          memoryNode({ id: 'workspace_two', sessionIds: ['run_prior'], type: 'chain', status: 'confirmed' }),
          memoryNode({ id: 'other_workspace', workspaces: [{ id: 'workspace_mdns', name: 'mDNSResponder' }] }),
          memoryNode({ id: 'workspace_stale', status: 'stale' })
        ],
        edges: [],
        runbooks: [
          runbook({ id: 'workspace_current', sessionId: 'run_current', revision: 2 }),
          runbook({ id: 'workspace_prior', sessionId: 'run_prior', revision: 5 }),
          runbook({ id: 'other_workspace_runbook', workspaceId: 'workspace_mdns', revision: 11 })
        ],
        reports: [report({ id: 'workspace_report', revision: 3 })],
        lastError: null
      } as unknown as HoneycrispMemorySummary,
      runId: 'workspace:workspace_zsh',
      runStatus: null,
      viewSpace: 'workspace'
    })));

    expect(html).toContain('aria-label="Workspace summary"');
    expect(html).toContain('class="session-summary-title">Workspace</h2>');
    expect(html).toContain('<span>2 Runbooks</span>');
    expect(html).toContain('class="session-summary-meta">7 Updates</span>');
    expect(html).toContain('<span>1 Report</span>');
    expect(html).toContain('class="session-summary-meta">3 Updates</span>');
    expect(html).toContain('<span>2 Memories</span>');
    expect(html).toContain('class="session-memory-type-item"><span>1 Primitive</span><span class="session-summary-meta">1 Suspected</span></div>');
    expect(html).toContain('class="session-memory-type-item"><span>1 Chain</span><span class="session-summary-meta">1 Confirmed</span></div>');
    expect(html.match(/session-memory-type-item/g)).toHaveLength(2);
    expect(html.match(/session-summary-chevron/g)).toHaveLength(3);
    expect(html).not.toContain('<span>0 Reports</span>');
    expect(html).not.toContain('<span>Subagents</span>');
    expect(html).not.toContain('<span>Rooms</span>');
    expect(html).not.toContain('<span>1 Subagents</span>');
    expect(html).not.toContain('Session duration');
    expect(html).not.toContain('Tokens');
    expect(html).not.toContain('session-summary-metadata');
    expect(html).not.toContain('session-summary-divider');
  });

  it('uses plain navigation titles even when the profile uses research-prefixed nouns', () => {
    const profile = testResearchProfile();
    const researchLabelsProfile: ResearchProfile = {
      ...profile,
      workspace: { ...profile.workspace, workspaceNoun: 'Research Workspace' },
      presentation: { ...profile.presentation, sessionLabel: 'Research Session' }
    };
    const sessionHtml = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      researchProfile: researchLabelsProfile
    })));
    const workspaceHtml = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      detail: null,
      researchProfile: researchLabelsProfile,
      runId: 'workspace:workspace_zsh',
      viewSpace: 'workspace'
    })));

    expect(sessionHtml).toContain('aria-label="Session summary"');
    expect(sessionHtml).toContain('class="session-summary-title">Session</h2>');
    expect(sessionHtml).not.toContain('Research Session');
    expect(workspaceHtml).toContain('aria-label="Workspace summary"');
    expect(workspaceHtml).toContain('class="session-summary-title">Workspace</h2>');
    expect(workspaceHtml).not.toContain('Research Workspace');
  });

  it('uses workspace accessibility labels in the detailed workspace sidenav', () => {
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      detail: null,
      expanded: true,
      runId: 'workspace:workspace_zsh',
      selectedSubagentPath: '/root/parser_review',
      viewSpace: 'workspace'
    })));

    expect(html).toContain('aria-label="Workspace details"');
    expect(html).toContain('aria-label="Choose a workspace detail view"');
    expect(html).not.toContain('<span>Subagents</span>');
    expect(html).not.toContain('parser_review');
    expect(html).not.toContain('Back to Subagents');
    expect(html).not.toContain('Choose a session detail view');
  });

  it('hides disabled profile features without removing the remaining session summary', () => {
    const disabledProfile = researchProfileWithFeatures({
      memoryEnabled: false,
      runbooksEnabled: false,
      reportsEnabled: false,
      collaborationEnabled: false
    });
    const summaryHtml = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      researchProfile: disabledProfile
    })));

    expect(summaryHtml).toContain('aria-label="Session summary"');
    expect(summaryHtml).toContain('60k Tokens');
    expect(summaryHtml).not.toContain('<span>0 Memories</span>');
    expect(summaryHtml).not.toContain('<span>0 Runbooks</span>');
    expect(summaryHtml).not.toContain('<span>0 Reports</span>');
    expect(summaryHtml).not.toContain('<span>0 Subagents</span>');
    expect(summaryHtml).not.toContain('<span>0 Rooms</span>');
    expect(summaryHtml).not.toContain('session-summary-chevron');

    const runbooksOnlyHtml = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      expanded: true,
      researchProfile: researchProfileWithFeatures({
        memoryEnabled: false,
        runbooksEnabled: true,
        reportsEnabled: false,
        collaborationEnabled: false
      }),
      selectedSubagentPath: '/root/legacy_subagent'
    })));

    expect(runbooksOnlyHtml).toContain('aria-label="Choose a session detail view"');
    expect(runbooksOnlyHtml).toContain('<span>Runbooks</span>');
    expect(runbooksOnlyHtml).not.toContain('<span>Memories</span>');
    expect(runbooksOnlyHtml).not.toContain('<span>Subagents</span>');
    expect(runbooksOnlyHtml).not.toContain('<span>Rooms</span>');
    expect(runbooksOnlyHtml).not.toContain('Back to Subagents');
    expect(runbooksOnlyHtml).not.toContain('legacy_subagent');
  });

  it('replaces detail tabs with Back to Subagents and renders the selected subagent chat', () => {
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      events: [subagentCommentaryEvent()],
      selectedSubagentPath: '/root/parser_review'
    })));

    expect(html).toContain('Back to Subagents');
    expect(html).toContain('class="subagent-provider-icon" aria-label="Model: grok-4.6" title="grok-4.6"');
    expect(html).toContain('class="research-side-nested-name" title="Parser Review">Parser Review</span>');
    expect(html).toContain('Checking the parser boundary now.');
    expect(html).not.toContain('Open session detail views');
    expect(html).not.toContain('Add session detail view');
    expect(html).not.toContain('Back to Main');
  });

  it('opens a selected breakout room in the detailed right sidenav', () => {
    const room = breakoutRoom({ id: 'room_parser', title: 'parser challenge', status: 'active' });
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      detail: {
        ...summaryDetail(),
        breakoutRooms: [room],
        breakoutRoomMembers: [],
        breakoutRoomMessages: []
      },
      selectedBreakoutRoomId: room.id
    })));

    expect(html).toContain('view-rooms has-nested-view');
    expect(html).toContain('Back to Rooms');
    expect(html).toContain('title="Parser Challenge">Parser Challenge</span>');
    expect(html).toContain('aria-label="Breakout room: parser challenge"');
    expect(html).toContain('This room has no recorded messages yet.');
    expect(html).not.toContain('Open session detail views');
  });

  it('replaces detail tabs with Back to Runbooks and renders the selected runbook', () => {
    const selectedRunbook = runbook({ title: 'Live parser validation' });
    const selectedRunbookDocument: HoneycrispRunbookDocument = {
      runbookId: selectedRunbook.id,
      nbformat: 4,
      nbformatMinor: 5,
      language: 'typescript',
      revision: 1,
      latestRun: null,
      cells: [{
        id: 'cell_one',
        type: 'markdown',
        source: 'Latest runbook step.',
        language: null,
        executionCount: null,
        latestRun: null,
        outputs: []
      }]
    };
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      selectedRunbook,
      selectedRunbookDocument,
      selectedRunbookId: selectedRunbook.id
    })));

    expect(html).toContain('Back to Runbooks');
    expect(html).toContain('class="research-side-nested-name" title="Live parser validation">Live parser validation</span>');
    expect(html).toContain('Live parser validation');
    expect(html).toContain('Latest runbook step.');
    expect(html).not.toContain('Open session detail views');
    expect(html).not.toContain('Add session detail view');
    expect(html).not.toContain('Back to Main');
  });

  it('replaces detail tabs with Back to Reports and renders full Markdown content', () => {
    const selectedReport = report({ title: 'A shareable breakthrough', revision: 2 });
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, researchSidePanelProps({
      selectedReport,
      selectedReportDocument: { reportId: selectedReport.id, content: '# A shareable breakthrough\n\nHere is the plain-language result.' },
      selectedReportId: selectedReport.id
    })));

    expect(html).toContain('Back to Reports');
    expect(html).toContain('A shareable breakthrough');
    expect(html).toContain('Here is the plain-language result.');
    expect(html).toContain('Update 2');
    expect(html).not.toContain('Open session detail views');
  });

  it('filters across context identities, types, node text, tags, and references', () => {
    const sessionPrimitive = memoryNode({ id: 'session_primitive', sessionIds: ['run_current'], type: 'primitive', title: 'ZFTP length confusion', tags: ['parser'] });
    const workspacePrimitive = memoryNode({ id: 'workspace_primitive', sessionIds: ['run_older'], type: 'primitive', title: 'ZFTP workspace boundary', tags: ['parser'] });
    const currentSessionWorkspacePrimitive = memoryNode({ id: 'current_session_workspace_primitive', sessionIds: ['run_current'], type: 'primitive', title: 'Current parser state' });
    const subjectInvariant = memoryNode({
      id: 'subject_invariant',
      sessionIds: ['run_older'],
      workspaces: [{ id: 'workspace_mdns', name: 'mDNSResponder' }],
      type: 'invariant',
      title: 'Apple parser boundary',
      evidenceRefs: [{ id: 'ref_one', kind: 'code', pathBase: 'repository', path: 'Src/Modules/zftp.c', locator: {}, summary: 'Length check', createdAt: '2026-07-19T12:00:00.000Z' }]
    });
    const nodes = [sessionPrimitive, workspacePrimitive, currentSessionWorkspacePrimitive, subjectInvariant];
    const context = { sessionId: 'run_current', workspaceId: 'workspace_zsh', subjectId: 'subject_apple' };

    expect(sessionMemoryCatalogNodes(nodes, 'run_current')).toEqual([sessionPrimitive, currentSessionWorkspacePrimitive]);
    expect(filterMemoryCatalogNodes(nodes, { query: '', scope: 'session', type: 'all', ...context })).toEqual([currentSessionWorkspacePrimitive, sessionPrimitive]);
    expect(filterMemoryCatalogNodes(nodes, { query: '', scope: 'workspace', type: 'all', ...context })).toEqual([currentSessionWorkspacePrimitive, sessionPrimitive, workspacePrimitive]);
    expect(filterMemoryCatalogNodes(nodes, { query: '', scope: 'subject', type: 'all', ...context })).toEqual([currentSessionWorkspacePrimitive, sessionPrimitive, subjectInvariant, workspacePrimitive]);
    expect(filterMemoryCatalogNodes(nodes, { query: '', scope: 'all', type: 'invariant', ...context })).toEqual([subjectInvariant]);
    expect(filterMemoryCatalogNodes(nodes, { query: 'zftp.c', scope: 'all', type: 'all', ...context })).toEqual([subjectInvariant]);
    expect(filterMemoryCatalogNodes(nodes, { query: 'parser', scope: 'all', type: 'all', ...context })).toEqual([
      currentSessionWorkspacePrimitive,
      sessionPrimitive,
      subjectInvariant,
      workspacePrimitive
    ]);
  });

  it('indexes relationships at both endpoints and versions visible rows', () => {
    const edge = memoryEdge();
    const nodes = [memoryNode({ id: 'a' }), memoryNode({ id: 'b', updatedAt: '2026-07-19T13:00:00.000Z' })];
    const grouped = groupMemoryRelationships([edge]);

    expect(grouped.get('a')).toEqual([edge]);
    expect(grouped.get('b')).toEqual([edge]);
    expect(memoryCatalogUpdateKey(nodes)).toBe('a:2026-07-19T12:00:00.000Z|b:2026-07-19T13:00:00.000Z');
  });

  it('orders filtered memories chronologically with the newest at the bottom', () => {
    const newest = memoryNode({ id: 'newest', updatedAt: '2026-07-19T14:00:00.000Z' });
    const oldest = memoryNode({ id: 'oldest', updatedAt: '2026-07-19T10:00:00.000Z' });
    const middle = memoryNode({ id: 'middle', updatedAt: '2026-07-19T12:00:00.000Z' });
    const context = { query: '', scope: 'all' as const, type: 'all', sessionId: 'run_current', workspaceId: 'workspace_zsh', subjectId: 'subject_apple' };

    expect(filterMemoryCatalogNodes([newest, oldest, middle], context)).toEqual([oldest, middle, newest]);
  });
});

function memoryToolEvent(
  kind: 'tool.requested' | 'tool.observed',
  actionId: string,
  toolName: string,
  sequence: number
): TraceEventRecord {
  return {
    id: `trace_memory_${sequence}`,
    runId: 'run_current',
    attemptId: 'attempt_current',
    sequence,
    source: kind === 'tool.requested' ? 'model' : 'tool',
    type: kind === 'tool.requested' ? 'tool_call' : 'tool_result',
    summary: `Honeycrisp ${kind}: ${toolName}`,
    payload: {
      agentPath: '/root',
      honeycrispKind: kind,
      payload: { toolActionId: actionId, toolName, normalizedInputs: {} }
    },
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: `2026-07-19T12:0${sequence}:00.000Z`,
    artifactId: null,
    toolCallId: actionId,
    approvalId: null
  };
}
function breakoutRoom(overrides: Partial<BreakoutRoomRecord> = {}): BreakoutRoomRecord {
  return {
    id: 'room_test',
    runId: 'run_current',
    attemptId: 'attempt_current',
    name: 'parser_review',
    title: 'Parser review',
    purpose: 'Review competing parser hypotheses.',
    kind: 'validation',
    status: 'completed',
    phase: 'completed',
    challengeRound: 1,
    outcomeMarkdown: null,
    createdAt: '2026-07-19T12:01:00.000Z',
    closedAt: '2026-07-19T12:04:00.000Z',
    ...overrides
  };
}

function summaryDetail(): RunDetail {
  return {
    run: {
      id: 'run_current',
      status: 'completed',
      createdAt: '2026-07-19T12:00:00.000Z',
      startedAt: '2026-07-19T12:00:00.000Z',
      endedAt: '2026-07-19T12:05:00.000Z',
      mode: 'dynamic',
      attemptStrategy: 'breadth_first',
      title: '',
      promptMarkdown: ''
    },
    attempts: [],
    traceEvents: [
      {
        id: 'trace_usage',
        type: 'model_message',
        createdAt: '2026-07-19T12:04:00.000Z',
        payload: {
          usage: {
            input_tokens: 10_000,
            prompt_tokens: 50_000,
            cache_read_tokens: 40_000,
            total_tokens: 60_000,
            output_tokens: 10_000,
            source: 'reported input tokens'
          }
        }
      }
    ],
    transcriptMessages: [],
    hypotheses: [],
    artifacts: [],
    evidence: [],
    findings: [],
    verifierContracts: [],
    verifierRuns: [],
    modelSessions: [],
    contextCompactions: [],
    policyEvents: [],
    exports: []
  } as unknown as RunDetail;
}

function researchSidePanelProps(
  overrides: Partial<ComponentProps<typeof ResearchSidePanel>> = {}
): ComponentProps<typeof ResearchSidePanel> {
  return {
    detail: summaryDetail(),
    events: [],
    memory: null,
    providerModelCatalog: [],
    runId: 'run_current',
    runStatus: 'active',
    selectedRunbook: null,
    selectedRunbookDocument: null,
    selectedRunbookId: null,
    runbookLoading: false,
    runbookError: null,
    selectedSubagentPath: null,
    searchHighlightQuery: '',
    onBackToRunbooks: () => undefined,
    onBackToSubagents: () => undefined,
    onOpenRunbook: () => undefined,
    onSelectSubagent: () => undefined,
    ...overrides
  };
}

function researchProfileWithFeatures(
  features: Partial<ResearchProfile['capabilities']>
): ResearchProfile {
  const profile = testResearchProfile();
  return {
    ...profile,
    capabilities: {
      ...profile.capabilities,
      ...features
    }
  };
}

function summaryMemoryType(
  id: string,
  order: number,
  sessionHeat: ResearchProfile['memory']['types'][number]['sessionHeat'] = {}
): ResearchProfile['memory']['types'][number] {
  return {
    id,
    name: id,
    pluralName: `${id}s`,
    description: `${id} memory`,
    lifecycle: 'active',
    creatable: true,
    order,
    defaultStatus: 'draft',
    allowedStatuses: ['draft', 'confirmed'],
    sessionHeat
  };
}

function subagentCommentaryEvent(): TraceEventRecord {
  return {
    id: 'subagent_commentary',
    runId: 'run_current',
    attemptId: 'attempt_one',
    sequence: 1,
    source: 'model',
    type: 'model_message',
    summary: 'Subagent commentary.',
    payload: {
      agentPath: '/root/parser_review',
      provider: 'xai',
      model: 'grok-4.6',
      transcriptRole: 'assistant',
      transcriptSource: 'honeycrisp_commentary',
      messagePhase: 'commentary',
      text: 'Checking the parser boundary now.'
    },
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-07-19T12:01:00.000Z',
    artifactId: null,
    toolCallId: null,
    approvalId: null
  };
}

function memoryNode(overrides: Partial<HoneycrispMemoryNodeSummary> = {}): HoneycrispMemoryNodeSummary {
  return {
    id: 'node_one',
    sessionIds: [],
    workspaces: [{ id: 'workspace_zsh', name: 'Zsh' }],
    subjectId: 'subject_apple',
    subjectName: 'Apple',
    type: 'primitive',
    title: 'Memory title',
    summary: 'Memory summary',
    body: 'Memory body',
    status: 'suspected',
    confidence: 0.7,
    assetIds: [],
    tags: [],
    attributes: {},
    evidenceRefs: [],
    createdAt: '2026-07-19T12:00:00.000Z',
    updatedAt: '2026-07-19T12:00:00.000Z',
    revision: 1,
    ...overrides
  };
}

function runbook(overrides: Partial<HoneycrispRunbookSummary> = {}): HoneycrispRunbookSummary {
  return {
    id: 'runbook_one',
    workspaceId: 'workspace_zsh',
    workspaceName: 'Zsh',
    subjectId: 'subject_apple',
    subjectName: 'Apple',
    sessionId: 'run_current',
    title: 'Runbook title',
    purpose: 'Runbook purpose',
    status: 'active',
    artifactId: 'artifact_one',
    revision: 1,
    revisions: [],
    createdAt: '2026-07-19T12:00:00.000Z',
    updatedAt: '2026-07-19T12:00:00.000Z',
    ...overrides
  };
}

function report(overrides: Partial<HoneycrispReportSummary> = {}): HoneycrispReportSummary {
  return {
    id: 'report_one',
    workspaceId: 'workspace_zsh',
    workspaceName: 'Zsh',
    subjectId: 'subject_apple',
    subjectName: 'Apple',
    sessionId: 'run_current',
    title: 'Report title',
    summary: 'A short report summary.',
    status: 'complete',
    artifactId: 'report_one',
    revision: 1,
    revisions: [],
    createdAt: '2026-07-19T12:00:00.000Z',
    updatedAt: '2026-07-19T12:00:00.000Z',
    ...overrides,
    submissionPacket: overrides.submissionPacket ?? null
  };
}

function memoryEdge(): HoneycrispMemoryEdgeSummary {
  return {
    fromId: 'a',
    toId: 'b',
    relation: 'supports',
    note: '',
    createdAt: '2026-07-19T12:00:00.000Z',
    updatedAt: '2026-07-19T12:00:00.000Z'
  };
}
