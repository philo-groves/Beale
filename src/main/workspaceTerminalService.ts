import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { WorkspaceTerminalDataEvent, WorkspaceTerminalExitEvent, WorkspaceTerminalStartResult } from '@shared/types';

interface WorkspaceTerminalSession {
  ownerId: number;
  process: IPty;
}

export interface WorkspaceTerminalServiceOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
  spawnPty?: typeof pty.spawn;
}

function terminalDimension(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Terminal ${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function terminalSessionId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(value)) throw new Error('Invalid terminal session ID.');
  return value;
}

function terminalEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function defaultTerminalShell(options: WorkspaceTerminalServiceOptions = {}): { executable: string; args: string[] } {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  if (platform === 'win32') {
    const candidates = [
      env.ProgramFiles ? join(env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe') : null,
      env.SystemRoot ? join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : null,
      env.ComSpec ?? null
    ].filter((candidate): candidate is string => Boolean(candidate));
    const executable = candidates.find(pathExists) ?? env.ComSpec ?? 'powershell.exe';
    return { executable, args: basename(executable).toLowerCase().includes('powershell') || basename(executable).toLowerCase() === 'pwsh.exe' ? ['-NoLogo'] : [] };
  }
  const executable = env.SHELL?.trim() || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { executable, args: ['-l'] };
}

export class WorkspaceTerminalService {
  private readonly sessions = new Map<string, WorkspaceTerminalSession>();

  public constructor(private readonly options: WorkspaceTerminalServiceOptions = {}) {}

  public start(
    ownerId: number,
    sessionIdValue: string,
    workspacePath: string,
    columnsValue: number,
    rowsValue: number,
    onData: (event: WorkspaceTerminalDataEvent) => void,
    onExit: (event: WorkspaceTerminalExitEvent) => void
  ): WorkspaceTerminalStartResult {
    const sessionId = terminalSessionId(sessionIdValue);
    if (!(this.options.pathExists ?? existsSync)(workspacePath)) throw new Error('The workspace primary directory is unavailable.');
    const columns = terminalDimension(columnsValue, 2, 500, 'column count');
    const rows = terminalDimension(rowsValue, 1, 200, 'row count');
    this.closeOwner(ownerId);
    const shell = defaultTerminalShell(this.options);
    const platform = this.options.platform ?? process.platform;
    const terminalProcess = (this.options.spawnPty ?? pty.spawn)(shell.executable, shell.args, {
      name: 'xterm-256color',
      cols: columns,
      rows,
      cwd: workspacePath,
      env: terminalEnvironment(this.options.env ?? globalThis.process.env),
      ...(platform === 'win32' ? { useConpty: true, useConptyDll: true } : {})
    });
    this.sessions.set(sessionId, { ownerId, process: terminalProcess });
    terminalProcess.onData((data) => {
      if (this.sessions.get(sessionId)?.process === terminalProcess) onData({ sessionId, data });
    });
    terminalProcess.onExit(({ exitCode, signal }) => {
      if (this.sessions.get(sessionId)?.process !== terminalProcess) return;
      this.sessions.delete(sessionId);
      onExit({ sessionId, exitCode, signal: signal ?? null });
    });
    return { sessionId, cwd: workspacePath, shell: basename(shell.executable) };
  }

  public write(ownerId: number, sessionIdValue: string, data: string): void {
    const session = this.requireOwnedSession(ownerId, sessionIdValue);
    if (typeof data !== 'string' || data.length === 0 || data.length > 65_536) throw new Error('Invalid terminal input.');
    session.process.write(data);
  }

  public resize(ownerId: number, sessionIdValue: string, columnsValue: number, rowsValue: number): void {
    const session = this.requireOwnedSession(ownerId, sessionIdValue);
    session.process.resize(
      terminalDimension(columnsValue, 2, 500, 'column count'),
      terminalDimension(rowsValue, 1, 200, 'row count')
    );
  }

  public close(ownerId: number, sessionIdValue: string): void {
    const sessionId = terminalSessionId(sessionIdValue);
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) return;
    this.sessions.delete(sessionId);
    session.process.kill();
  }

  public closeOwner(ownerId: number): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.ownerId !== ownerId) continue;
      this.sessions.delete(sessionId);
      session.process.kill();
    }
  }

  public dispose(): void {
    for (const session of this.sessions.values()) session.process.kill();
    this.sessions.clear();
  }

  private requireOwnedSession(ownerId: number, sessionIdValue: string): WorkspaceTerminalSession {
    const session = this.sessions.get(terminalSessionId(sessionIdValue));
    if (!session || session.ownerId !== ownerId) throw new Error('The terminal session is no longer available.');
    return session;
  }
}
