import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computerUseTargetBinary,
  reusableComputerUseTargetBinary
} from '../src/main/honeycrispRunEngine';
import { WorkspaceRegistry } from '../src/main/workspaceRegistry';

describe('computer-use permissions', () => {
  it('defaults to Every Action and persists Once Per Session', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-computer-use-settings-'));
    try {
      const registry = new WorkspaceRegistry(directory);
      expect(registry.getComputerUseSettings()).toEqual({ permissionMode: 'every_action' });
      expect(registry.setComputerUsePermissionMode('once_per_session')).toEqual({
        permissionMode: 'once_per_session'
      });
      registry.close();

      const reopened = new WorkspaceRegistry(directory);
      expect(reopened.getComputerUseSettings()).toEqual({ permissionMode: 'once_per_session' });
      expect(() => reopened.setComputerUsePermissionMode('always' as 'every_action')).toThrow(
        'Invalid computer-use permission mode.'
      );
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('normalizes a trustworthy Terminator process into a target-binary grant key', () => {
    expect(computerUseTargetBinary({ arguments: { process: 'Calculator.EXE' } })).toBe('calculator');
    expect(computerUseTargetBinary({ arguments: { process: 'Visual Studio Code' } })).toBeNull();
    expect(computerUseTargetBinary({ arguments: { title: 'Calculator' } })).toBeNull();
  });

  it('reuses a session grant only for the same target binary', () => {
    const approved = new Set(['calculator']);
    expect(reusableComputerUseTargetBinary(
      'once_per_session',
      approved,
      { arguments: { process: 'calculator.exe' } }
    )).toBe('calculator');
    expect(reusableComputerUseTargetBinary(
      'once_per_session',
      approved,
      { arguments: { process: 'notepad.exe' } }
    )).toBeNull();
    expect(reusableComputerUseTargetBinary(
      'every_action',
      approved,
      { arguments: { process: 'calculator.exe' } }
    )).toBeNull();
  });
});
