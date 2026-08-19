import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditableReport } from '../src/renderer/features/reports/ReportsWorkspace';
import { SettingsSidebar, TicketingSettingsView } from '../src/renderer/features/settings/SettingsModal';
import type { HoneycrispReportSummary, TicketingSettings } from '../src/shared/types';

describe('renderer ticketing settings', () => {
  it('adds Ticketing to Agent Settings and defaults to local reports only', () => {
    const sidebar = renderToStaticMarkup(createElement(SettingsSidebar, {
      collapsed: false,
      section: 'ticketing',
      error: null,
      onBack: () => undefined,
      onChangeSection: () => undefined,
      onResizePointerDown: () => undefined
    }));
    const view = renderToStaticMarkup(createElement(TicketingSettingsView, {
      settings: localSettings(),
      targets: [],
      loading: false,
      error: null,
      onSetProvider: async () => undefined,
      onSetHumanInTheLoop: async () => undefined,
      onConfigureCredential: async () => undefined,
      onRemoveCredential: async () => undefined,
      onRefreshTargets: async () => undefined,
      onSetTarget: async () => undefined
    }));

    expect(sidebar).toContain('lucide-ticket');
    expect(sidebar).toContain('<span>Ticketing</span>');
    expect(view).toContain('<h2 id="ticketing-system-heading">Ticketing</h2>');
    expect(view).toMatch(/aria-label="Local Reports Only"[^>]*checked=""/u);
    expect(view).toContain('GitHub Issues');
    expect(view).toContain('Linear');
    expect(view).toContain('<h2 id="ticketing-automation-heading">Automation</h2>');
    expect(view).toMatch(/aria-label="Human In The Loop"[^>]*checked=""/u);
    expect(view).not.toContain('ticketing-connection-form');
  });

  it('shows host-only credential and discovered destination controls', () => {
    const settings: TicketingSettings = {
      ...localSettings(),
      provider: 'github',
      github: {
        credentialConfigured: true,
        credentialSource: 'managed',
        targetId: 'acme/parser',
        targetLabel: 'acme/parser'
      }
    };
    const html = renderToStaticMarkup(createElement(TicketingSettingsView, {
      settings,
      targets: [{ id: 'acme/parser', label: 'acme/parser' }],
      loading: false,
      error: null,
      onSetProvider: async () => undefined,
      onSetHumanInTheLoop: async () => undefined,
      onConfigureCredential: async () => undefined,
      onRemoveCredential: async () => undefined,
      onRefreshTargets: async () => undefined,
      onSetTarget: async () => undefined
    }));

    expect(html).toContain('Stored securely by Beale.');
    expect(html).toContain('aria-label="GitHub token"');
    expect(html).toContain('aria-label="Ticketing repository"');
    expect(html).toContain('<option value="acme/parser" selected="">acme/parser</option>');
  });

  it('offers one-click ticket creation only when an external system is selected', () => {
    const external = renderToStaticMarkup(createElement(EditableReport, {
      report: report(),
      document: { reportId: 'report-1', content: '# Finding' },
      loading: false,
      error: null,
      onChange: async () => undefined,
      onOpenSubmissionPacket: async () => undefined,
      ticketingSettings: {
        ...localSettings(),
        provider: 'linear' as const,
        linear: {
          credentialConfigured: true,
          credentialSource: 'managed',
          targetId: 'team-1',
          targetLabel: 'Security (SEC)'
        }
      },
      onSubmitTicket: async () => ({
        provider: 'linear' as const,
        ticketId: 'SEC-9',
        title: 'Parser vulnerability',
        url: 'https://linear.app/acme/issue/SEC-9'
      })
    }));
    const local = renderToStaticMarkup(createElement(EditableReport, {
      report: report(),
      document: { reportId: 'report-1', content: '# Finding' },
      loading: false,
      error: null,
      onChange: async () => undefined,
      onOpenSubmissionPacket: async () => undefined,
      ticketingSettings: localSettings()
    }));

    expect(external).toContain('Security (SEC)');
    expect(external).toContain('>Create ticket</button>');
    expect(local).not.toContain('report-ticketing-action');
  });
});

function localSettings(): TicketingSettings {
  const empty = { credentialConfigured: false, credentialSource: null, targetId: null, targetLabel: null } as const;
  return { provider: 'local', automation: { humanInTheLoop: true }, github: { ...empty }, linear: { ...empty } };
}

function report(): HoneycrispReportSummary {
  return {
    id: 'report-1',
    workspaceId: 'workspace-1',
    workspaceName: 'Parser',
    subjectId: null,
    subjectName: null,
    sessionId: null,
    title: 'Parser vulnerability',
    summary: '',
    status: 'complete',
    artifactId: 'artifact-1',
    submissionPacket: null,
    revision: 1,
    revisions: [],
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z'
  };
}
