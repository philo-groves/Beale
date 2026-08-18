import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PluginManagerWorkspace } from '../src/renderer/features/plugins/PluginManagerWorkspace';

describe('plugin manager workspace', () => {
  it('uses the shared centered regular-weight loading state', () => {
    const html = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      state: null,
      loading: true,
      busy: false,
      error: null,
      repositoryUrl: '',
      onRepositoryUrlChange: () => undefined,
      onAddFilesystem: () => undefined,
      onAddRepository: () => undefined,
      onSetEnabled: () => undefined,
      onRemove: () => undefined
    }));

    expect(html).toContain('class="centered-loading-state"');
    expect(html).toContain('class="centered-loading-state-spinner"');
    expect(html).toContain('<span>Loading plugins…</span>');
    expect(html).not.toContain('<strong>Loading plugins');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const loadingStyles = styles.match(/\.centered-loading-state\s*\{([^}]*)\}/u)?.[1] ?? '';
    expect(loadingStyles).toContain('place-content: center');
    expect(loadingStyles).toContain('font-weight: 400');
  });

  it('renders the install controls and counted flat catalog in main content', () => {
    const html = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      state: null,
      loading: false,
      busy: false,
      error: null,
      repositoryUrl: '',
      onRepositoryUrlChange: () => undefined,
      onAddFilesystem: () => undefined,
      onAddRepository: () => undefined,
      onSetEnabled: () => undefined,
      onRemove: () => undefined
    }));

    expect(html).toContain('Add from Filesystem');
    expect(html).toContain('Add Repository');
    expect(html).toContain('<h2>0 Plugins</h2>');
    expect(html).toContain('No plugins installed');
  });

  it('keeps the built-in source tag without redundant bundled and server labels', () => {
    const html = renderToStaticMarkup(createElement(PluginManagerWorkspace, {
      state: {
        registryPath: 'C:\\plugins.json',
        pluginStorePath: 'C:\\plugins',
        specVersion: '1.0.0',
        plugins: [{
          id: 'beale-introspection-builtin',
          name: 'beale-introspection',
          version: '0.1.0',
          description: 'Built-in tools.',
          enabled: true,
          status: 'ready',
          source: { kind: 'builtin', path: 'C:\\plugins\\beale-introspection' },
          installedAt: '2026-08-17T00:00:00.000Z',
          updatedAt: '2026-08-17T00:00:00.000Z',
          skills: [],
          mcpServers: [{ name: 'beale', transport: 'stdio', command: 'node', url: null, valid: true, errors: [] }],
          warnings: [],
          errors: []
        }]
      },
      loading: false,
      busy: false,
      error: null,
      repositoryUrl: '',
      onRepositoryUrlChange: () => undefined,
      onAddFilesystem: () => undefined,
      onAddRepository: () => undefined,
      onSetEnabled: () => undefined,
      onRemove: () => undefined
    }));

    expect(html).toContain('<span>builtin</span>');
    expect(html).not.toContain('Bundled with Beale');
    expect(html).not.toContain('>beale</span>');
  });

  it('keeps plugin navigation out of the modal layer and marks it active in the sidebar', () => {
    const appSource = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    const modalSource = readFileSync(new URL('../src/renderer/app/AppModals.tsx', import.meta.url), 'utf8');
    const sidebarSource = readFileSync(new URL('../src/renderer/features/workspaces/WorkspaceSidebar.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

    expect(appSource).toContain('<PluginManagerWorkspace');
    expect(modalSource).not.toContain('PluginManager');
    expect(sidebarSource).toContain("sidebar-utility-button${pluginsActive ? ' active' : ''}");
    expect(styles).toMatch(/\.plugin-manager-card\s*\{[^}]*padding:\s*12px 2px;/s);
    expect(styles).toMatch(/\.plugin-manager-card:not\(:last-child\)\s*\{[^}]*border-bottom:\s*1px solid var\(--panel-border\);/s);
    expect(existsSync(new URL('../src/renderer/features/plugins/PluginManagerModal.tsx', import.meta.url))).toBe(false);
  });
});
