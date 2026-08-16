import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface HoneycrispInvocation {
  command: string;
  prefixArgs: string[];
  cwd: string;
  configuredBy: 'env_command' | 'env_root' | 'sibling_root';
  usesNodeRuntime: boolean;
}

export function resolveHoneycrispInvocation(): HoneycrispInvocation {
  const command = process.env.BEALE_HONEYCRISP_COMMAND?.trim();
  if (command) {
    return {
      command,
      prefixArgs: parseEnvArgs('BEALE_HONEYCRISP_ARGS_JSON'),
      cwd: process.env.BEALE_HONEYCRISP_CWD?.trim() || process.cwd(),
      configuredBy: 'env_command',
      usesNodeRuntime: isPlainNodeExecutable(command)
    };
  }

  const root = process.env.BEALE_HONEYCRISP_ROOT?.trim() || resolve(process.cwd(), '..', 'honeycrisp');
  const cliPath = join(root, 'packages', 'cli', 'dist', 'cli.js');
  if (existsSync(cliPath)) {
    return {
      command: resolveHoneycrispNodeCommand(),
      prefixArgs: [cliPath],
      cwd: root,
      configuredBy: process.env.BEALE_HONEYCRISP_ROOT ? 'env_root' : 'sibling_root',
      usesNodeRuntime: true
    };
  }
  return {
    command: process.env.BEALE_HONEYCRISP_PNPM_COMMAND?.trim() || 'pnpm',
    prefixArgs: ['--dir', root, 'start'],
    cwd: root,
    configuredBy: process.env.BEALE_HONEYCRISP_ROOT ? 'env_root' : 'sibling_root',
    usesNodeRuntime: false
  };
}

function resolveHoneycrispNodeCommand(): string {
  const candidates = [
    process.env.BEALE_HONEYCRISP_NODE_COMMAND?.trim(),
    process.env.BEALE_NODE_COMMAND?.trim(),
    process.env.npm_node_execpath?.trim(),
    process.env.NODE?.trim(),
    'node',
    isPlainNodeExecutable(process.execPath) ? process.execPath : ''
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (nodeCommandAvailable(candidate)) return candidate;
  }
  return 'node';
}

function nodeCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true
  });
  return result.status === 0 && /^v\d+\.\d+\.\d+/.test(result.stdout.trim());
}

function isPlainNodeExecutable(path: string): boolean {
  const name = path.split(/[\\/]+/).at(-1)?.toLowerCase() ?? '';
  return name === 'node' || name === 'node.exe';
}

function parseEnvArgs(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error(`${name} must be a JSON array of strings.`);
  }
  return parsed;
}
