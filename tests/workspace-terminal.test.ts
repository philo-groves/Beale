import { describe, expect, it, vi } from 'vitest';
import type { IDisposable, IPty } from 'node-pty';
import { defaultTerminalShell, WorkspaceTerminalService } from '../src/main/workspaceTerminalService';

interface FakePty extends IPty {
  emitData(data: string): void;
  emitExit(exitCode: number, signal?: number): void;
}

function fakePty(): FakePty {
  let dataHandler: ((data: string) => void) | null = null;
  let exitHandler: ((event: { exitCode: number; signal?: number }) => void) | null = null;
  return {
    pid: 42,
    process: 'shell',
    cols: 80,
    rows: 24,
    handleFlowControl: false,
    write: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
    onData(handler: (data: string) => void): IDisposable {
      dataHandler = handler;
      return { dispose: () => { dataHandler = null; } };
    },
    onExit(handler: (event: { exitCode: number; signal?: number }) => void): IDisposable {
      exitHandler = handler;
      return { dispose: () => { exitHandler = null; } };
    },
    emitData(data: string): void {
      dataHandler?.(data);
    },
    emitExit(exitCode: number, signal?: number): void {
      exitHandler?.({ exitCode, signal });
    }
  };
}

describe('workspace terminal service', () => {
  it('starts the shell in the primary workspace and streams owned session data', () => {
    const terminal = fakePty();
    const spawnPty = vi.fn(() => terminal);
    const dataEvents: unknown[] = [];
    const exitEvents: unknown[] = [];
    const service = new WorkspaceTerminalService({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      pathExists: () => true,
      spawnPty: spawnPty as never
    });

    const result = service.start(7, 'terminal_1', 'C:\\research\\parser', 100, 30, (event) => dataEvents.push(event), (event) => exitEvents.push(event));
    expect(result).toEqual({
      sessionId: 'terminal_1',
      cwd: 'C:\\research\\parser',
      shell: 'powershell.exe'
    });
    expect(spawnPty).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo'],
      expect.objectContaining({
        cwd: 'C:\\research\\parser',
        cols: 100,
        rows: 30,
        name: 'xterm-256color',
        useConpty: true,
        useConptyDll: true
      })
    );

    terminal.emitData('PS C:\\research\\parser> ');
    expect(dataEvents).toEqual([{ sessionId: 'terminal_1', data: 'PS C:\\research\\parser> ' }]);
    service.write(7, 'terminal_1', 'Get-Location\r');
    expect(terminal.write).toHaveBeenCalledWith('Get-Location\r');
    service.resize(7, 'terminal_1', 120, 40);
    expect(terminal.resize).toHaveBeenCalledWith(120, 40);

    terminal.emitExit(0);
    expect(exitEvents).toEqual([{ sessionId: 'terminal_1', exitCode: 0, signal: null }]);
    expect(() => service.write(7, 'terminal_1', 'dir\r')).toThrow('no longer available');
  });

  it('enforces terminal ownership, dimensions, input bounds, and one session per window', () => {
    const first = fakePty();
    const second = fakePty();
    const spawnPty = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const service = new WorkspaceTerminalService({
      platform: 'linux',
      env: { SHELL: '/bin/bash' },
      pathExists: () => true,
      spawnPty: spawnPty as never
    });
    const noData = (): void => undefined;
    service.start(3, 'first', '/research/parser', 80, 24, noData, noData);
    expect(() => service.write(4, 'first', 'pwd\r')).toThrow('no longer available');
    expect(() => service.resize(3, 'first', 0, 24)).toThrow('column count');
    expect(() => service.write(3, 'first', 'x'.repeat(65_537))).toThrow('Invalid terminal input');

    service.start(3, 'second', '/research/parser', 80, 24, noData, noData);
    expect(first.kill).toHaveBeenCalledOnce();
    service.close(3, 'second');
    expect(second.kill).toHaveBeenCalledOnce();
  });

  it('selects the platform shell without accepting a renderer-provided executable', () => {
    expect(defaultTerminalShell({ platform: 'darwin', env: { SHELL: '/bin/fish' } })).toEqual({
      executable: '/bin/fish',
      args: ['-l']
    });
    expect(defaultTerminalShell({ platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, pathExists: () => false })).toEqual({
      executable: 'C:\\Windows\\System32\\cmd.exe',
      args: []
    });
  });
});
