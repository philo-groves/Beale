import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkspaceEditorCatalog, WorkspaceEditorId } from '@shared/types';

interface EditorDefinition {
  id: WorkspaceEditorId;
  name: string;
  commands: string[];
  paths: string[];
  arguments?: (workspacePath: string) => string[];
}

interface DetectedEditor extends EditorDefinition {
  executablePath: string;
}

const execFileAsync = promisify(execFile);

export interface WorkspaceEditorDetectionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
  systemDefaultHint?: string | null;
}

export type WorkspaceEditorIconResolver = (path: string) => Promise<string | null>;

function compactPaths(paths: Array<string | null | undefined>): string[] {
  return paths.filter((path): path is string => Boolean(path));
}

function editorDefinitions(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): EditorDefinition[] {
  const localAppData = env.LOCALAPPDATA;
  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES;
  const programFilesX86 = env['ProgramFiles(x86)'];
  const home = env.USERPROFILE ?? env.HOME;
  const windowsPaths = (relativePaths: string[]): string[] => compactPaths(
    relativePaths.flatMap((relativePath) => [localAppData, programFiles, programFilesX86].map((root) => root ? join(root, relativePath) : null))
  );
  const macApplication = (name: string, binary: string): string[] => [
    `/Applications/${name}.app/Contents/${binary}`,
    ...(home ? [join(home, 'Applications', `${name}.app`, 'Contents', binary)] : [])
  ];

  const platformPaths = (windows: string[], mac: string[]): string[] =>
    platform === 'win32' ? windows : platform === 'darwin' ? mac : [];

  return [
    {
      id: 'vscode', name: 'Visual Studio Code', commands: ['code'],
      paths: platformPaths(
        compactPaths([
          localAppData ? join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
          ...windowsPaths(['Microsoft VS Code\\Code.exe'])
        ]),
        macApplication('Visual Studio Code', 'Resources/app/bin/code')
      )
    },
    {
      id: 'vscode-insiders', name: 'Visual Studio Code Insiders', commands: ['code-insiders'],
      paths: platformPaths(
        compactPaths([
          localAppData ? join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe') : null,
          ...windowsPaths(['Microsoft VS Code Insiders\\Code - Insiders.exe'])
        ]),
        macApplication('Visual Studio Code - Insiders', 'Resources/app/bin/code-insiders')
      )
    },
    {
      id: 'cursor', name: 'Cursor', commands: ['cursor'],
      paths: platformPaths(
        compactPaths([localAppData ? join(localAppData, 'Programs', 'cursor', 'Cursor.exe') : null]),
        macApplication('Cursor', 'Resources/app/bin/cursor')
      )
    },
    {
      id: 'windsurf', name: 'Windsurf', commands: ['windsurf'],
      paths: platformPaths(
        compactPaths([localAppData ? join(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe') : null]),
        macApplication('Windsurf', 'Resources/app/bin/windsurf')
      )
    },
    {
      id: 'visual-studio', name: 'Visual Studio', commands: ['devenv'],
      paths: platform === 'win32' ? compactPaths(
        ['Community', 'Professional', 'Enterprise'].flatMap((edition) => [programFiles, programFilesX86]
          .map((root) => root ? join(root, 'Microsoft Visual Studio', '2022', edition, 'Common7', 'IDE', 'devenv.exe') : null))
      ) : []
    },
    {
      id: 'intellij-idea', name: 'IntelliJ IDEA', commands: ['idea', 'idea64'],
      paths: platformPaths([], macApplication('IntelliJ IDEA', 'MacOS/idea'))
    },
    {
      id: 'webstorm', name: 'WebStorm', commands: ['webstorm', 'webstorm64'],
      paths: platformPaths([], macApplication('WebStorm', 'MacOS/webstorm'))
    },
    {
      id: 'pycharm', name: 'PyCharm', commands: ['pycharm', 'pycharm64'],
      paths: platformPaths([], macApplication('PyCharm', 'MacOS/pycharm'))
    },
    {
      id: 'rider', name: 'Rider', commands: ['rider', 'rider64'],
      paths: platformPaths([], macApplication('Rider', 'MacOS/rider'))
    },
    {
      id: 'sublime-text', name: 'Sublime Text', commands: ['subl', 'sublime_text'],
      paths: platformPaths(
        windowsPaths(['Sublime Text\\sublime_text.exe']),
        macApplication('Sublime Text', 'SharedSupport/bin/subl')
      )
    },
    {
      id: 'zed', name: 'Zed', commands: ['zed'],
      paths: platformPaths(
        compactPaths([localAppData ? join(localAppData, 'Programs', 'Zed', 'Zed.exe') : null]),
        macApplication('Zed', 'MacOS/zed')
      )
    }
  ];
}

function executableOnPath(command: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, pathExists: (path: string) => boolean): string | null {
  const pathDirectories = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const extensions = platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.COM;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const commandHasExtension = extname(command).length > 0;
  for (const directory of pathDirectories) {
    for (const extension of commandHasExtension ? [''] : extensions) {
      const candidate = join(directory.replace(/^"|"$/g, ''), `${command}${extension}`);
      if (pathExists(candidate)) return candidate;
    }
  }
  return null;
}

async function systemDefaultEditorHint(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<string | null> {
  const environmentHint = env.VISUAL?.trim() || env.EDITOR?.trim();
  if (environmentHint) return environmentHint;
  try {
    if (platform === 'win32') {
      const result = await execFileAsync('reg.exe', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.txt\\UserChoice',
        '/v',
        'ProgId'
      ], { encoding: 'utf8', windowsHide: true, timeout: 1500 });
      return result.stdout;
    }
    if (platform === 'linux') {
      const result = await execFileAsync('xdg-mime', ['query', 'default', 'text/plain'], { encoding: 'utf8', timeout: 1500 });
      return result.stdout.trim();
    }
  } catch {
    // System default discovery is best-effort; installed-editor fallback remains available.
  }
  return null;
}

function editorHintMatchScore(editor: EditorDefinition, hint: string): number {
  const normalized = hint.toLowerCase();
  const aliases: Record<WorkspaceEditorId, string[]> = {
    vscode: ['visual studio code', 'vscode', 'code.exe', 'com.microsoft.vscode'],
    'vscode-insiders': ['visual studio code insiders', 'code-insiders', 'vscode-insiders'],
    cursor: ['cursor', 'todesktop.230313mzl4w4u92'],
    windsurf: ['windsurf', 'codeium'],
    'visual-studio': ['visualstudio', 'devenv'],
    'intellij-idea': ['intellij', 'idea'],
    webstorm: ['webstorm'],
    pycharm: ['pycharm'],
    rider: ['rider'],
    'sublime-text': ['sublime'],
    zed: ['zed']
  };
  return aliases[editor.id].reduce((score, alias) => normalized.includes(alias) ? Math.max(score, alias.length) : score, 0);
}

function detectEditors(options: WorkspaceEditorDetectionOptions = {}): DetectedEditor[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  return editorDefinitions(platform, env).flatMap((editor) => {
    const executablePath = editor.paths.find(pathExists)
      ?? editor.commands.map((command) => executableOnPath(command, platform, env, pathExists)).find((path): path is string => path !== null)
      ?? null;
    return executablePath ? [{ ...editor, executablePath }] : [];
  });
}

export function getWorkspaceEditorCatalog(options: WorkspaceEditorDetectionOptions = {}): WorkspaceEditorCatalog {
  const env = options.env ?? process.env;
  const editors = detectEditors(options);
  const hint = options.systemDefaultHint === undefined
    ? env.VISUAL?.trim() || env.EDITOR?.trim() || null
    : options.systemDefaultHint;
  const defaultEditor = hint
    ? editors
        .map((editor) => ({ editor, score: editorHintMatchScore(editor, hint) }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)[0]?.editor ?? null
    : null;
  const selectedEditor = defaultEditor ?? editors.find((editor) => editor.id === 'vscode') ?? editors[0] ?? null;
  return {
    editors: editors.map(({ id, name }) => ({ id, name, iconDataUrl: null })),
    defaultEditorId: selectedEditor?.id ?? null
  };
}

function nativeIconPath(executablePath: string, platform: NodeJS.Platform): string {
  if (platform !== 'darwin') return executablePath;
  const appBundleEnd = executablePath.toLowerCase().indexOf('.app/');
  return appBundleEnd >= 0 ? executablePath.slice(0, appBundleEnd + 4) : executablePath;
}

export async function getWorkspaceEditorCatalogForHost(
  options: WorkspaceEditorDetectionOptions = {},
  resolveIconDataUrl?: WorkspaceEditorIconResolver
): Promise<WorkspaceEditorCatalog> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const systemDefaultHintOverride = options.systemDefaultHint === undefined
    ? await systemDefaultEditorHint(platform, env)
    : options.systemDefaultHint;
  const resolvedOptions = { ...options, platform, env, systemDefaultHint: systemDefaultHintOverride };
  const catalog = getWorkspaceEditorCatalog(resolvedOptions);
  if (!resolveIconDataUrl) return catalog;
  const detectedEditors = detectEditors(resolvedOptions);
  return {
    ...catalog,
    editors: await Promise.all(catalog.editors.map(async (editor) => {
      const detected = detectedEditors.find((candidate) => candidate.id === editor.id);
      if (!detected) return editor;
      try {
        return {
          ...editor,
          iconDataUrl: await resolveIconDataUrl(nativeIconPath(detected.executablePath, platform))
        };
      } catch {
        return editor;
      }
    }))
  };
}

export function openWorkspaceInEditor(
  editorId: WorkspaceEditorId,
  workspacePath: string,
  options: WorkspaceEditorDetectionOptions = {}
): Promise<void> {
  const editor = detectEditors(options).find((candidate) => candidate.id === editorId);
  if (!editor) throw new Error('The selected editor is no longer available.');
  if (!(options.pathExists ?? existsSync)(workspacePath)) throw new Error('The workspace directory is unavailable.');
  return new Promise((resolve, reject) => {
    const child = spawn(editor.executablePath, editor.arguments?.(workspacePath) ?? [workspacePath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
