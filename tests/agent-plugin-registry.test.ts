import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentPluginRegistry } from '../src/main/agentPluginRegistry';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('AgentPluginRegistry', () => {
  it('installs filesystem plugins and persists enablement', () => {
    const registry = new AgentPluginRegistry(tempDir('beale-plugin-registry-'), { builtinPlugins: [] });
    const pluginRoot = validPluginRoot('filesystem-plugin');

    const installed = registry.addFromFilesystem(pluginRoot);
    expect(installed.plugins).toHaveLength(1);
    expect(installed.plugins[0].name).toBe('filesystem-plugin');
    expect(installed.plugins[0].enabled).toBe(true);
    expect(installed.plugins[0].skills).toEqual([
      {
        id: 'recon',
        name: 'Recon helper',
        directoryName: 'recon',
        relativePath: './skills/recon/SKILL.md',
        description: 'Find promising reconnaissance paths.'
      }
    ]);
    expect(installed.plugins[0].mcpServers).toMatchObject([
      {
        name: 'local',
        transport: 'stdio',
        command: './server.js',
        valid: true
      }
    ]);

    const disabled = registry.setEnabled(installed.plugins[0].id, false);
    expect(disabled.plugins[0].enabled).toBe(false);

    const reloaded = new AgentPluginRegistry(dirname(installed.registryPath), { builtinPlugins: [] });
    expect(reloaded.getState().plugins[0].enabled).toBe(false);

    const removed = registry.remove(installed.plugins[0].id);
    expect(removed.plugins).toHaveLength(0);
  });

  it('builds Honeycrisp runtime arguments from enabled plugins', () => {
    const registry = new AgentPluginRegistry(tempDir('beale-plugin-registry-'), { builtinPlugins: [] });
    const pluginRoot = validPluginRoot('filesystem-plugin');

    const installed = registry.addFromFilesystem(pluginRoot);
    const sourceRoot = installed.plugins[0].source.path;
    const runtime = registry.getHoneycrispRuntime();
    const mcpConfigPath = runtime.mcpConfigPath ?? '';
    const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8')) as {
      mcpServers: Record<string, { type: string; command: string; cwd: string }>;
    };

    expect(runtime.skillDirs).toEqual([join(sourceRoot, 'skills')]);
    expect(runtime.selectedSkillIds).toEqual(['recon']);
    expect(runtime.allowedMcpServers).toEqual(['filesystem-plugin.local']);
    expect(runtime.args).toEqual(expect.arrayContaining([
      '--skill-dir',
      join(sourceRoot, 'skills'),
      '--skill',
      'recon',
      '--mcp-config',
      mcpConfigPath,
      '--allow-mcp-server',
      'filesystem-plugin.local'
    ]));
    expect(mcpConfig.mcpServers['filesystem-plugin.local']).toMatchObject({
      type: 'stdio',
      command: join(sourceRoot, 'server.js'),
      cwd: sourceRoot
    });

    registry.setEnabled(installed.plugins[0].id, false);
    expect(registry.getHoneycrispRuntime()).toMatchObject({
      skillDirs: [],
      selectedSkillIds: [],
      mcpConfigPath: null,
      allowedMcpServers: [],
      args: []
    });
  });

  it('keeps manifest-valid plugins visible when an MCP component is invalid', () => {
    const registry = new AgentPluginRegistry(tempDir('beale-plugin-registry-'), { builtinPlugins: [] });
    const pluginRoot = validPluginRoot('component-errors');
    writeFileSync(join(pluginRoot, 'mcp.json'), JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        escape: {
          type: 'stdio',
          command: './server.js',
          cwd: '../outside'
        }
      }
    }), 'utf8');

    const state = registry.addFromFilesystem(pluginRoot);
    expect(state.plugins[0].status).toBe('invalid');
    expect(state.plugins[0].enabled).toBe(false);
    expect(state.plugins[0].mcpServers[0].errors).toContain('cwd must be plugin-relative or rooted at ${PLUGIN_ROOT} or ${PLUGIN_DATA}.');
  });

  it('rejects directories without the Agent Plugin manifest schema', () => {
    const registry = new AgentPluginRegistry(tempDir('beale-plugin-registry-'), { builtinPlugins: [] });
    const pluginRoot = tempDir('not-a-plugin-');
    writeFileSync(join(pluginRoot, 'plugin.json'), JSON.stringify({ name: 'not-a-plugin' }), 'utf8');

    expect(() => registry.addFromFilesystem(pluginRoot)).toThrow(
      'Agent Plugin manifest must use schema https://agent-plugins.org/schemas/1.0.0/plugin.schema.json.'
    );
  });

  it('includes the default Beale Introspection plugin and persists disablement', () => {
    const registry = new AgentPluginRegistry(tempDir('beale-plugin-registry-'), {
      runtimeEnvironment: (plugin) => {
        if (plugin.name !== 'beale-introspection') return {} as Record<string, string>;
        return {
          BEALE_INTROSPECTION_URL: 'http://127.0.0.1:12345',
          BEALE_INTROSPECTION_TOKEN: 'test-token'
        };
      }
    });

    const plugin = registry.getState().plugins.find((candidate) => candidate.name === 'beale-introspection');
    expect(plugin).toBeTruthy();
    expect(plugin?.enabled).toBe(true);
    expect(plugin?.source.kind).toBe('builtin');
    expect(plugin?.mcpServers).toMatchObject([
      {
        name: 'beale',
        transport: 'stdio',
        command: 'node',
        valid: true
      }
    ]);

    const runtime = registry.getHoneycrispRuntime();
    expect(runtime.allowedMcpServers).toEqual(['beale-introspection.beale']);
    expect(runtime.mcpConfigPath).toBeTruthy();
    const mcpConfig = JSON.parse(readFileSync(runtime.mcpConfigPath ?? '', 'utf8')) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(mcpConfig.mcpServers['beale-introspection.beale'].env).toEqual({
      BEALE_INTROSPECTION_URL: 'http://127.0.0.1:12345',
      BEALE_INTROSPECTION_TOKEN: 'test-token'
    });

    const disabled = registry.setEnabled(plugin!.id, false);
    expect(disabled.plugins.find((candidate) => candidate.id === plugin!.id)?.enabled).toBe(false);
    const reloaded = new AgentPluginRegistry(dirname(disabled.registryPath));
    expect(reloaded.getState().plugins.find((candidate) => candidate.id === plugin!.id)?.enabled).toBe(false);
    expect(() => registry.remove(plugin!.id)).toThrow('Built-in plugins cannot be removed.');
  });
});

function validPluginRoot(name: string): string {
  const pluginRoot = tempDir(`agent-plugin-${name}-`);
  writeFileSync(join(pluginRoot, 'plugin.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name,
    version: '0.1.0',
    description: 'Test plugin.'
  }), 'utf8');
  mkdirSync(join(pluginRoot, 'skills', 'recon'), { recursive: true });
  writeFileSync(join(pluginRoot, 'skills', 'recon', 'SKILL.md'), [
    '---',
    'name: Recon helper',
    'description: Find promising reconnaissance paths.',
    '---',
    '',
    'Use this skill for focused recon.'
  ].join('\n'), 'utf8');
  writeFileSync(join(pluginRoot, 'server.js'), '', 'utf8');
  writeFileSync(join(pluginRoot, 'mcp.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      local: {
        type: 'stdio',
        command: './server.js',
        args: [],
        env: {},
        cwd: './'
      }
    }
  }), 'utf8');
  return pluginRoot;
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}
