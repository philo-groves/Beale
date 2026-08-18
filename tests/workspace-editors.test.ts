import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkspaceEditorCatalog, getWorkspaceEditorCatalogForHost } from '../src/main/workspaceEditors';

describe('workspace editor discovery', () => {
  it('returns only installed editors and honors the system default hint', () => {
    const localAppData = 'C:\\Users\\researcher\\AppData\\Local';
    const vscode = join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe');
    const cursor = join(localAppData, 'Programs', 'cursor', 'Cursor.exe');
    const available = new Set([vscode, cursor]);

    const catalog = getWorkspaceEditorCatalog({
      platform: 'win32',
      env: { LOCALAPPDATA: localAppData, PATH: '' },
      pathExists: (path) => available.has(path),
      systemDefaultHint: 'Applications\\Cursor.exe'
    });

    expect(catalog.editors).toEqual([
      { id: 'vscode', name: 'Visual Studio Code', iconDataUrl: null },
      { id: 'cursor', name: 'Cursor', iconDataUrl: null }
    ]);
    expect(catalog.defaultEditorId).toBe('cursor');
  });

  it('uses Visual Studio Code when the system does not identify a default editor', () => {
    const localAppData = 'C:\\Users\\researcher\\AppData\\Local';
    const vscode = join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe');
    const windsurf = join(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe');
    const available = new Set([vscode, windsurf]);

    const catalog = getWorkspaceEditorCatalog({
      platform: 'win32',
      env: { LOCALAPPDATA: localAppData, PATH: '' },
      pathExists: (path) => available.has(path),
      systemDefaultHint: null
    });

    expect(catalog.defaultEditorId).toBe('vscode');
  });

  it('prefers the more specific Insiders match over standard Visual Studio Code', () => {
    const localAppData = 'C:\\Users\\researcher\\AppData\\Local';
    const vscode = join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe');
    const insiders = join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe');
    const available = new Set([vscode, insiders]);

    const catalog = getWorkspaceEditorCatalog({
      platform: 'win32',
      env: { LOCALAPPDATA: localAppData, PATH: '' },
      pathExists: (path) => available.has(path),
      systemDefaultHint: 'Visual Studio Code Insiders'
    });

    expect(catalog.defaultEditorId).toBe('vscode-insiders');
  });

  it('detects editors installed on PATH without exposing executable paths', () => {
    const catalog = getWorkspaceEditorCatalog({
      platform: 'linux',
      env: { PATH: '/opt/bin:/usr/bin' },
      pathExists: (path) => path === join('/opt/bin', 'zed'),
      systemDefaultHint: 'dev.zed.Zed.desktop'
    });

    expect(catalog).toEqual({
      editors: [{ id: 'zed', name: 'Zed', iconDataUrl: null }],
      defaultEditorId: 'zed'
    });
    expect(JSON.stringify(catalog)).not.toContain('/opt/bin');
  });

  it('attaches native installed-app icons in the host catalog', async () => {
    const localAppData = 'C:\\Users\\researcher\\AppData\\Local';
    const cursor = join(localAppData, 'Programs', 'cursor', 'Cursor.exe');
    const iconPaths: string[] = [];

    const catalog = await getWorkspaceEditorCatalogForHost({
      platform: 'win32',
      env: { LOCALAPPDATA: localAppData, PATH: '' },
      pathExists: (path) => path === cursor,
      systemDefaultHint: 'Cursor'
    }, async (path) => {
      iconPaths.push(path);
      return 'data:image/png;base64,Y3Vyc29y';
    });

    expect(iconPaths).toEqual([cursor]);
    expect(catalog.editors).toEqual([{
      id: 'cursor',
      name: 'Cursor',
      iconDataUrl: 'data:image/png;base64,Y3Vyc29y'
    }]);
  });
});
