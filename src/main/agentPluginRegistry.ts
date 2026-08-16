import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentPluginRecord, AgentPluginRegistryState } from '@shared/types';
import {
  addHoneycrispPluginFromFilesystem,
  addHoneycrispPluginFromRepository,
  getHoneycrispPluginRuntime,
  listHoneycrispPlugins,
  removeHoneycrispPlugin,
  setHoneycrispPluginEnabled,
  type HoneycrispAgentPluginRuntime,
  type HoneycrispBuiltinPlugin
} from './honeycrispCliClient';

export interface AgentPluginRegistryOptions {
  builtinPlugins?: HoneycrispBuiltinPlugin[];
  runtimeEnvironment?: (plugin: AgentPluginRecord) => Record<string, string>;
}

export type AgentPluginHoneycrispRuntime = HoneycrispAgentPluginRuntime;

export class AgentPluginRegistry {
  public constructor(
    private readonly registryDirectory: string,
    private readonly options: AgentPluginRegistryOptions = {}
  ) {}

  public getState(): AgentPluginRegistryState {
    return listHoneycrispPlugins(this.baseInput());
  }

  public getHoneycrispRuntime(): AgentPluginHoneycrispRuntime {
    const state = this.getState();
    const runtimeEnvironment = Object.fromEntries(state.plugins.map((plugin) => [
      plugin.id,
      this.options.runtimeEnvironment?.(plugin) ?? {}
    ]));
    return getHoneycrispPluginRuntime({ ...this.baseInput(), runtimeEnvironment });
  }

  public addFromFilesystem(pluginRoot: string): AgentPluginRegistryState {
    return addHoneycrispPluginFromFilesystem({ ...this.baseInput(), pluginRoot });
  }

  public addFromRepository(repositoryUrl: string): Promise<AgentPluginRegistryState> {
    return addHoneycrispPluginFromRepository({ ...this.baseInput(), repositoryUrl });
  }

  public setEnabled(pluginId: string, enabled: boolean): AgentPluginRegistryState {
    return setHoneycrispPluginEnabled({ ...this.baseInput(), pluginId, enabled });
  }

  public remove(pluginId: string): AgentPluginRegistryState {
    return removeHoneycrispPlugin({ ...this.baseInput(), pluginId });
  }

  private baseInput(): Record<string, unknown> {
    return {
      registryDirectory: this.registryDirectory,
      builtinPlugins: this.options.builtinPlugins ?? defaultBuiltinPlugins()
    };
  }
}

function defaultBuiltinPlugins(): HoneycrispBuiltinPlugin[] {
  return [{
    id: 'beale-introspection-builtin',
    path: defaultBuiltinPluginPath('beale-introspection'),
    installedAt: '2026-08-14T00:00:00.000Z'
  }];
}

function defaultBuiltinPluginPath(directoryName: string): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    ...(resourcesPath ? [resolve(resourcesPath, 'agent-plugins', directoryName)] : []),
    resolve(process.cwd(), 'resources', 'agent-plugins', directoryName),
    resolve(__dirname, '..', '..', 'resources', 'agent-plugins', directoryName)
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates.at(-1)!;
}
