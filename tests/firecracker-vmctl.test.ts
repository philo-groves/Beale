import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Firecracker vmctl controller', () => {
  it('reports available capabilities when configured assets are present', () => {
    const { configPath } = fixtureConfig();
    const response = vmctl(configPath, 'list_capabilities', {});

    expect(response.ok).toBe(true);
    expect(response.result.available).toBe(true);
    expect(response.result.label).toBe('Firecracker VM executor');
    expect(response.result.supportedNetworkProfiles).toEqual(['offline']);
    expect(response.result.supports).toMatchObject({ clone: true, import: true, export: true, shell: true, python: true });
  });

  it('fails closed when required Firecracker assets are missing', () => {
    const { configPath, rootfsPath } = fixtureConfig();
    rmSync(rootfsPath);
    const response = vmctl(configPath, 'list_capabilities', {});

    expect(response.ok).toBe(true);
    expect(response.result.available).toBe(false);
    expect(response.result.reason).toContain('rootfs missing or inaccessible');
  });

  it('creates and resets context rootfs copies without booting a guest', () => {
    const { configPath, stateDir } = fixtureConfig();
    const basePayload = {
      vmContextId: 'vm_firecracker_test',
      runId: 'run_firecracker_test',
      attemptId: 'attempt_firecracker_test',
      scopeVersionId: 'scope_firecracker_test',
      snapshotRef: 'clean',
      networkProfile: 'offline'
    };

    expect(vmctl(configPath, 'create_context', basePayload).result.state).toBe('clean');
    const contextRootfs = join(stateDir, 'vm_firecracker_test', 'rootfs.ext4');
    expect(existsSync(contextRootfs)).toBe(true);

    writeFileSync(contextRootfs, 'mutated rootfs');
    expect(vmctl(configPath, 'clone_context', basePayload).result.reset).toBe(true);
    expect(readFileSync(contextRootfs, 'utf8')).toBe('base rootfs');
  });
});

function fixtureConfig(): { configPath: string; stateDir: string; rootfsPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beale-firecracker-vmctl-'));
  createdDirs.push(dir);
  const binDir = join(dir, 'bin');
  const imageDir = join(dir, 'images');
  const stateDir = join(dir, 'state');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(imageDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  const firecrackerBin = join(binDir, 'firecracker');
  const kernelPath = join(imageDir, 'vmlinux');
  const rootfsPath = join(imageDir, 'rootfs.ext4');
  const sshKey = join(dir, 'id_rsa');
  writeFileSync(firecrackerBin, '#!/bin/sh\nexit 0\n');
  chmodSync(firecrackerBin, 0o755);
  writeFileSync(kernelPath, 'kernel');
  writeFileSync(rootfsPath, 'base rootfs');
  writeFileSync(sshKey, 'private key fixture');

  const configPath = join(dir, 'config.json');
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        firecrackerBin,
        kernelImage: kernelPath,
        rootfsImage: rootfsPath,
        sshKey,
        stateDir,
        runtimeDir: join(dir, 'run'),
        skipKvmCheck: true,
        skipTapCheck: true,
        enableScopedNetwork: false
      },
      null,
      2
    )}\n`
  );
  return { configPath, stateDir, rootfsPath };
}

function vmctl(configPath: string, action: string, payload: Record<string, unknown>): { ok: boolean; result: Record<string, unknown>; error?: string } {
  const output = execFileSync(process.execPath, [join(process.cwd(), 'scripts/firecracker-vmctl.mjs'), '--config', configPath], {
    input: JSON.stringify({ protocolVersion: 1, action, payload }),
    encoding: 'utf8'
  });
  return JSON.parse(output);
}
