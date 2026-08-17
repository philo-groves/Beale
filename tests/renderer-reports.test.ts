import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoneycrispReportSummary, ProviderSettings, ResearchProviderModelCatalog, WorkspaceRegistryEntry } from '@shared/types';
import { reportResourceProjectNotes } from '../src/main/honeycrispRunEngine';
import { EditableReport, ReportsIndex } from '../src/renderer/features/reports/ReportsWorkspace';
import {
  isReportResourceRun,
  reportChangeInstruction,
  reportMarkdownBlocks,
  reportSessionDefaultModelSelection,
  reportsForReportingScope,
  joinReportBlockSelection
} from '../src/renderer/view-models/reports';

const report: HoneycrispReportSummary = {
  id: 'report_parser',
  workspaceId: 'workspace_one',
  workspaceName: 'Parser',
  subjectId: 'subject_one',
  subjectName: 'Parser',
  sessionId: 'run_origin',
  title: 'Parser boundary confusion',
  summary: 'A verified parser boundary issue.',
  status: 'complete',
  artifactId: 'artifact_report',
  revision: 3,
  revisions: [],
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-16T12:00:00.000Z'
};

const workspace: WorkspaceRegistryEntry = {
  id: 'registry_workspace_one',
  workspacePath: 'C:\\workspaces\\parser',
  workspaceId: 'workspace_one',
  workspaceName: 'Parser',
  researchProfileId: 'security-research',
  scopeOwner: 'Parser',
  descriptionMarkdown: '',
  rulesMarkdown: '',
  expiresAt: null,
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-16T12:00:00.000Z',
  lastOpenedAt: '2026-08-16T12:00:00.000Z',
  runCount: 1,
  lastRunAt: '2026-08-16T12:00:00.000Z'
};

describe('reports resource views', () => {
  it('gives the report session and report equal workspace width', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);');
    expect(styles).toMatch(/\.report-session-document-scroll\s*\{[^}]*padding:\s*18px 24px 42px;/s);
  });

  it('keeps report refinement chat-only and visually continuous with the report pane', () => {
    const source = readFileSync(new URL('../src/renderer/features/reports/ReportsWorkspace.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(source).toContain('<CommentaryView');
    expect(source).not.toContain('<TraceView');
    expect(source).not.toContain('Report session view');
    expect(styles).not.toMatch(/\.report-session-chat\s*\{[^}]*border-right:/s);
    expect(styles).toMatch(/\.report-session-document\s*\{[^}]*background:\s*var\(--panel-column\)/s);
  });

  it('opens reports without starting an agent and offers a short review Tab suggestion', () => {
    const appSource = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    const reportSource = readFileSync(new URL('../src/renderer/features/reports/ReportsWorkspace.tsx', import.meta.url), 'utf8');
    const openHandler = appSource.slice(
      appSource.indexOf('const openReportSession'),
      appSource.indexOf('const startReportTurn')
    );
    expect(openHandler).not.toContain('startReportSession');
    expect(reportSource).toContain("initialSuggestion={selectedRunId ? undefined : 'Review this report.'}");
  });

  it('uses the default provider large model instead of the first catalog model', () => {
    const settings: ProviderSettings = {
      defaultProviderId: 'openai-codex',
      modelDefaults: {
        'openai-codex': {
          largeModel: 'gpt-5.6-sol',
          smallModel: 'gpt-5.4-mini',
          reasoningEffort: 'xhigh'
        }
      }
    };
    const catalogs: ResearchProviderModelCatalog[] = [{
      providerId: 'openai-codex',
      providerName: 'OpenAI',
      models: [
        { id: 'gpt-5.3-codex-spark', name: 'Codex Spark', reasoning: true, effortLevels: ['low', 'high'], contextWindow: 128_000, maxTokens: 16_000 },
        { id: 'gpt-5.6-sol', name: 'GPT-5.6', reasoning: true, effortLevels: ['high', 'xhigh'], contextWindow: 256_000, maxTokens: 32_000 }
      ]
    }];

    expect(reportSessionDefaultModelSelection(settings, catalogs)).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh'
    });
  });

  it('loads provider settings and the model catalog for an idle report view', () => {
    const appSource = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    expect(appSource).toContain("if (!newResearchOpen && !reportsOpen && !(settingsOpen && settingsSection === 'providers')) return;");
    expect(appSource).toContain("if (!newResearchOpen && !reportsOpen && !selectedRunId && !(settingsOpen && settingsSection === 'providers')) return;");
  });

  it('enables the safety selector before the first report message and applies it when starting the run', () => {
    const composerSource = readFileSync(new URL('../src/renderer/features/traces/TraceView.tsx', import.meta.url), 'utf8');
    const serviceSource = readFileSync(new URL('../src/main/workspaceService.ts', import.meta.url), 'utf8');
    expect(composerSource).toContain("disabled={busy || status === 'paused' || (!runId && !onInitialInstruction)}");
    expect(composerSource).toContain('onInitialInstruction?.(trimmedInstruction, modelSelection, shellSafetyMode)');
    expect(serviceSource).toContain('shellSafetyMode: normalizeShellSafetyMode(input.shellSafetyMode)');
  });

  it('supplies report artifact details and editing requirements as model context', () => {
    const serviceSource = readFileSync(new URL('../src/main/workspaceService.ts', import.meta.url), 'utf8');
    const notes = reportResourceProjectNotes({
      kind: 'report',
      resourceId: report.id,
      title: report.title,
      artifactId: report.artifactId,
      artifactRelativePath: '.honeycrisp/artifacts/report.md',
      revision: report.revision
    }).join('\n');
    expect(notes).toContain(report.title);
    expect(notes).toContain(report.artifactId);
    expect(notes).toContain('.honeycrisp/artifacts/report.md');
    expect(notes).toContain('current revision 3');
    expect(notes).toContain('report.revise');
    expect(serviceSource).toContain('promptMarkdown: instruction');
    expect(serviceSource).not.toContain('Open the existing workspace report');
  });

  it('keeps report editor runs out of ordinary workspace session surfaces', () => {
    expect(isReportResourceRun({ budget: { resourceContext: { kind: 'report', resourceId: report.id } } })).toBe(true);
    expect(isReportResourceRun({ budget: { maxMinutes: 10 } })).toBe(false);
  });

  it('places Reporting directly below Automations in the workspace sidenav', () => {
    const source = readFileSync(new URL('../src/renderer/features/workspaces/WorkspaceSidebar.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(source.indexOf('<span>Reporting</span>')).toBeGreaterThan(-1);
    expect(source.indexOf('<span>Reporting</span>')).toBeGreaterThan(source.indexOf('<span>Automations</span>'));
    expect(source.indexOf('<span>Reporting</span>')).toBeLessThan(source.indexOf('<span>Plugins</span>'));
    expect(styles).toMatch(/\.sidebar-utility-button\.active\s*\{[^}]*background:\s*var\(--panel\);/s);
    expect(styles).toMatch(/\.sidebar-utility-button\.active:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--panel\);/s);
  });

  it('renders the workspace report catalog and current report state', () => {
    const staleReport = { ...report, id: 'report_stale', title: 'Parser follow-up', status: 'stale' as const };
    const html = renderToStaticMarkup(createElement(ReportsIndex, {
      reports: [report, staleReport],
      workspaces: [workspace],
      selectedWorkspaceId: null,
      loading: false,
      error: null,
      onScopeChange: () => undefined,
      onOpenReport: () => undefined
    }));

    expect(html).toContain('All Workspaces');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('>Parser</span>');
    expect(html).toContain('Parser boundary confusion');
    expect(html).toContain('Parser follow-up');
    expect(html).toContain('A verified parser boundary issue.');
    expect(html).toContain('class="reports-index-row-workspace">Parser</small>');
    expect(html).toContain('Update 3');
    expect(html).toContain('<h2>1 Complete</h2>');
    expect(html).toContain('<h2>1 Stale</h2>');
    expect(html).not.toContain('reports-index-eyebrow');
    expect(html).not.toContain('<h1>Reports</h1>');
    expect(html).not.toContain('Understand, refine, and track');
  });

  it('matches Profile settings content spacing and symmetric tab padding', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(/\.reports-index\s*\{[^}]*width:\s*100%;[^}]*padding:\s*10px;/s);
    expect(styles).toMatch(/\.reports-index-tabs,[\s\S]*?\.reports-index-empty\s*\{[^}]*width:\s*100%;/s);
    expect(styles).toMatch(/\.reports-index-tab\.provider-settings-tab \.research-side-view-tab-activate\s*\{[^}]*padding:\s*0 9px;/s);
    expect(styles).toMatch(/\.settings-main-view\s*\{[^}]*padding:\s*10px;/s);
    expect(styles).toMatch(/\.profile-settings-tab \.research-side-view-tab-activate\s*\{[^}]*padding:\s*0 9px;/s);
  });

  it('uses detailed-sidenav status sections and divider rows instead of report cards', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(/\.reports-index-section-items\s*\{[^}]*border-top:\s*1px solid var\(--panel-border\);[^}]*border-bottom:\s*1px solid var\(--panel-border\);/s);
    expect(styles).toMatch(/\.reports-index-row\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s);
    expect(styles).toMatch(/\.reports-index-row:not\(:last-child\)\s*\{[^}]*border-bottom:\s*1px solid var\(--panel-border\);/s);
  });

  it('renders an explicit empty state before an agent creates a report', () => {
    const html = renderToStaticMarkup(createElement(ReportsIndex, {
      reports: [],
      workspaces: [workspace],
      selectedWorkspaceId: workspace.workspaceId,
      loading: false,
      error: null,
      onScopeChange: () => undefined,
      onOpenReport: () => undefined
    }));

    expect(html).toContain('No reports yet');
    expect(html).toContain('Reports created by agents during research sessions');
  });

  it('defaults Reporting to the selected workspace and otherwise supports all-workspace scope', () => {
    const appSource = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    const sidebarSource = readFileSync(new URL('../src/renderer/features/workspaces/WorkspaceSidebar.tsx', import.meta.url), 'utf8');
    const otherReport = { ...report, id: 'report_other', workspaceId: 'workspace_two', workspaceName: 'Other' };

    expect(reportsForReportingScope([report, otherReport], null)).toHaveLength(2);
    expect(reportsForReportingScope([report, otherReport], workspace.workspaceId)).toEqual([report]);
    expect(appSource).toContain('setReportingScopeWorkspaceId(snapshot?.workspace.workspaceId ?? null);');
    expect(appSource).toContain('{reportsOpen ? (');
    expect(sidebarSource).not.toMatch(/title="Reporting"[^>]*disabled=\{!snapshot\}/);
  });

  it('loads reporting data and report documents through workspace-independent host contracts', () => {
    const apiSource = readFileSync(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
    const serviceSource = readFileSync(new URL('../src/main/workspaceService.ts', import.meta.url), 'utf8');

    expect(apiSource).toContain('listReportingReports(): Promise<HoneycrispReportSummary[]>;');
    expect(apiSource).toContain('getHoneycrispReport(locator: HoneycrispReportLocator)');
    expect(serviceSource).toContain('public async listReportingReports(): Promise<HoneycrispReportSummary[]>');
    expect(serviceSource).toContain('workspaceId: workspace.workspaceId');
    expect(serviceSource).toContain('Report workspace is not registered');
  });

  it('makes report blocks targetable for inline change requests', () => {
    const html = renderToStaticMarkup(createElement(EditableReport, {
      report,
      document: { reportId: report.id, content: '# Summary\n\nVerified impact.\n\n## Evidence\n\n- verifier:pass' },
      loading: false,
      error: null,
      onChange: async () => undefined
    }));

    expect(html).toContain(`<header class="report-session-document-header"><h1>${report.title}</h1>`);
    expect(html).not.toContain('class="report-session-back"');
    expect(html).not.toContain('>Report</span>');
    expect(html).toContain('Editable report content');
    expect(html).toContain('Highlight report lines 1 through 1');
    expect(html).toContain('Shift-click joins a range; Ctrl-click adds or removes sections.');
  });

  it('joins report highlights with Shift and toggles them with Control', () => {
    const blockIds = ['one', 'two', 'three', 'four'];
    const shifted = joinReportBlockSelection({
      blockIds,
      selectedBlockIds: ['one'],
      anchorIndex: 0,
      blockIndex: 2,
      shiftKey: true,
      toggleKey: false
    });
    expect(shifted).toEqual({ blockIds: ['one', 'two', 'three'], anchorIndex: 0 });
    expect(joinReportBlockSelection({
      blockIds,
      selectedBlockIds: shifted.blockIds,
      anchorIndex: shifted.anchorIndex,
      blockIndex: 1,
      shiftKey: false,
      toggleKey: true
    }).blockIds).toEqual(['one', 'three']);
  });

  it('offers highlighted-only editing by default and optional report-wide editing', () => {
    const source = readFileSync(new URL('../src/renderer/features/reports/ReportsWorkspace.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(source.indexOf('<legend>Editable</legend>')).toBeGreaterThan(source.indexOf('<textarea'));
    expect(source).toContain('<span>Only the highlighted section</span>');
    expect(source).toContain('<span>Anywhere in the report</span>');
    expect(source).toContain("useState<ReportEditScope>('selection')");
    expect(source).toContain('<div className="report-inline-edit-scope-options">');
    expect(styles).toMatch(/\.report-inline-edit-scope-options\s*\{[^}]*display:\s*grid;[^}]*justify-items:\s*start;/s);
    expect(styles).toMatch(/\.report-inline-edit-scope label\s*\{[^}]*gap:\s*5px;[^}]*white-space:\s*nowrap;/s);
    expect(styles).toMatch(/\.report-inline-edit-scope input\s*\{[^}]*width:\s*14px;[^}]*flex:\s*0 0 14px;[^}]*padding:\s*0;/s);
  });

  it('keeps fenced markdown together and sends only the selected content and requested change', () => {
    const blocks = reportMarkdownBlocks('## Proof\n\n```python\nprint("ok")\n\nprint("still fenced")\n```\n\nImpact');
    expect(blocks).toHaveLength(3);
    expect(blocks[1]?.content).toContain('still fenced');

    const instruction = reportChangeInstruction([blocks[0]!, blocks[2]!], 'Clarify the affected versions.');
    expect(instruction).not.toContain(report.id);
    expect(instruction).not.toContain(report.title);
    expect(instruction).not.toContain('report.get');
    expect(instruction).toContain('Highlighted report lines: 1-1, 9-9.');
    expect(instruction).toContain('only the highlighted sections');
    expect(instruction).toContain('Clarify the affected versions.');
    expect(reportChangeInstruction(blocks[2]!, 'Reframe the report.', 'report')).toContain('anywhere in the report');
  });
});
