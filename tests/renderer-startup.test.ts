import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InitialAppShell } from '../src/renderer/app/InitialAppShell';
import { WorkspaceStartupView } from '../src/renderer/features/workspaces/WorkspaceStartupView';

describe('renderer startup', () => {
  it('ships a lightweight no-workspace shell before loading the workbench bundle', () => {
    const source = readFileSync(new URL('../src/renderer/main.tsx', import.meta.url), 'utf8');
    const html = renderToStaticMarkup(createElement(InitialAppShell));

    expect(source).toContain("lazy(() => import('./App')");
    expect(source).toContain('fallback={<InitialAppShell />}');
    expect(source).toContain('window.requestAnimationFrame(() => setWorkbenchReady(true))');
    expect(source).toContain('if (!workbenchReady) return <InitialAppShell />;');
    expect(source).toContain("import './startup.css';");
    expect(source).not.toContain("import './styles.css';");
    expect(html).toContain('No Workspace Selected');
    expect(html).toContain('Choose a known workspace');
    expect(html).toContain('class="new-research-welcome-icon"');
    expect(html).toContain('alt="Beale"');
    const workspaceContent = html.slice(html.indexOf('<main'));
    expect(workspaceContent.indexOf('new-research-welcome-icon')).toBeLessThan(workspaceContent.indexOf('No Workspace Selected'));
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('Starting Beale');
    expect(html).not.toContain('role="status"');
  });

  it('shows the ready no-workspace view without startup loading copy', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceStartupView, {
      onAddWorkspace: () => undefined
    }));
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const startupStyles = readFileSync(new URL('../src/renderer/startup.css', import.meta.url), 'utf8');
    const buttonStyles = styles.match(/\.workspace-startup-content button\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(html).toContain('No Workspace Selected');
    expect(html).toContain('Choose a known workspace');
    expect(html).toContain('class="new-research-welcome-icon"');
    expect(html).toContain('alt="Beale"');
    expect(html.indexOf('new-research-welcome-icon')).toBeLessThan(html.indexOf('No Workspace Selected'));
    expect(html).toContain('Add Workspace');
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('Loading workspaces');
    expect(html).not.toContain('Opening your last workspace');
    expect(html).not.toContain('role="status"');
    expect(buttonStyles).toContain('border: 0');
    expect(startupStyles).toMatch(/\.new-research-welcome-icon\s*\{[^}]*width: 140px;[^}]*height: 140px;/u);
  });

  it('loads registry state without restoring or snapshot-loading a workspace', () => {
    const runtime = readFileSync(
      new URL('../src/renderer/hooks/useWorkspaceRuntime.ts', import.meta.url),
      'utf8'
    );
    const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    const registryLoad = runtime.indexOf('ipc.getWorkspaceRegistry.initial');

    expect(runtime).toContain("useState<WorkspaceStartupPhase>('shell')");
    expect(runtime).toContain('const startupFrame = window.requestAnimationFrame');
    expect(registryLoad).toBeGreaterThan(0);
    expect(runtime).not.toContain("'workspace'");
    expect(runtime).not.toContain('nextRendererFrame');
    expect(runtime).not.toContain('restoreLastWorkspace');
    expect(runtime).not.toContain('ipc.getSnapshot.initial');
    expect(runtime).not.toContain('.getOpenAiStatus()');
    expect(main).toContain('IPC_CHANNELS.restoreLastWorkspace');
    expect(main).not.toMatch(/createWindow\(\);\s*setImmediate\(\(\) => \{\s*workspaceService\.openLastWorkspaceIfAvailable/u);
  });
});
