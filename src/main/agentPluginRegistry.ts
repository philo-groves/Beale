import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { materializeGitRepositoryAsync, normalizeSourceRepositoryUrl } from './sourceMaterializer';
import type {
  AgentPluginMcpServerSummary,
  AgentPluginMcpTransport,
  AgentPluginRecord,
  AgentPluginRegistryState,
  AgentPluginSkillSummary,
  AgentPluginSource
} from '@shared/types';

const AGENT_PLUGIN_SPEC_VERSION = '1.0.0';
const AGENT_PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const AGENT_PLUGIN_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const MANIFEST_ALLOWED_KEYS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions'
]);
const MCP_SERVER_ALLOWED_KEYS = new Set(['type', 'command', 'args', 'env', 'cwd', 'url', 'headers']);
const PLUGIN_NAME_RE = /^(?!.*--)(?!.*\.\.)[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;

interface StoredAgentPlugin {
  id: string;
  source: AgentPluginSource;
  enabled: boolean;
  installedAt: string;
}

interface AgentPluginRegistryFile {
  version: 1;
  plugins: StoredAgentPlugin[];
}

interface ParsedManifest {
  name: string;
  version: string | null;
  description: string | null;
  warnings: string[];
}

interface BuiltinAgentPluginDefinition {
  id: string;
  path: string;
  installedAt: string;
}

export interface AgentPluginRegistryOptions {
  builtinPlugins?: BuiltinAgentPluginDefinition[];
  runtimeEnvironment?: (plugin: AgentPluginRecord) => Record<string, string>;
}

export interface AgentPluginHoneycrispRuntime {
  runtimeDirectory: string;
  skillDirs: string[];
  selectedSkillIds: string[];
  mcpConfigPath: string | null;
  allowedMcpServers: string[];
  args: string[];
  warnings: string[];
}

export class AgentPluginRegistry {
  private readonly registryPath: string;
  private readonly pluginStorePath: string;
  private readonly pluginDataPath: string;
  private readonly runtimePath: string;
  private readonly runtimeMcpConfigPath: string;

  public constructor(
    private readonly registryDirectory: string,
    private readonly options: AgentPluginRegistryOptions = {}
  ) {
    mkdirSync(registryDirectory, { recursive: true });
    this.registryPath = join(registryDirectory, 'agent-plugins.json');
    this.pluginStorePath = resolve(registryDirectory, 'agent-plugin-repositories');
    this.pluginDataPath = join(registryDirectory, 'agent-plugin-data');
    this.runtimePath = join(registryDirectory, 'agent-plugin-runtime');
    this.runtimeMcpConfigPath = join(this.runtimePath, 'mcp.json');
    mkdirSync(this.pluginStorePath, { recursive: true });
    mkdirSync(this.pluginDataPath, { recursive: true });
    mkdirSync(this.runtimePath, { recursive: true });
  }

  public getState(): AgentPluginRegistryState {
    const registry = this.readRegistryWithBuiltins();
    return {
      registryPath: this.registryPath,
      pluginStorePath: this.pluginStorePath,
      specVersion: AGENT_PLUGIN_SPEC_VERSION,
      plugins: registry.plugins.map((stored) => this.materializeRecord(stored)).sort(comparePlugins)
    };
  }

  public getHoneycrispRuntime(): AgentPluginHoneycrispRuntime {
    const state = this.getState();
    const skillDirs: string[] = [];
    const selectedSkillIds: string[] = [];
    const mcpServers: Record<string, Record<string, unknown>> = {};
    const allowedMcpServers: string[] = [];
    const warnings: string[] = [];
    const usedMcpNames = new Set<string>();

    for (const plugin of state.plugins) {
      if (!plugin.enabled || plugin.status !== 'ready') continue;
      if (plugin.skills.length > 0) {
        skillDirs.push(containedPath(plugin.source.path, 'skills'));
        selectedSkillIds.push(...plugin.skills.map((skill) => skill.id));
      }
      const pluginDataRoot = resolve(this.pluginDataPath, plugin.id);
      mkdirSync(pluginDataRoot, { recursive: true });
      const parsedMcp = readMcpServers(plugin.source.path, warnings, []);
      if (!parsedMcp) continue;
      for (const [serverName, config] of Object.entries(parsedMcp)) {
        const summary = scanMcpServer(serverName, config, plugin.source.path, pluginDataRoot);
        if (!summary.valid) {
          warnings.push(`Plugin ${plugin.name} MCP server ${serverName} was skipped: ${summary.errors.join(' ')}`);
          continue;
        }
        const extraEnvironment = this.options.runtimeEnvironment?.(plugin) ?? {};
        const runtimeConfig = honeycrispMcpServerConfig(
          config,
          summary.transport,
          plugin.source.path,
          pluginDataRoot,
          extraEnvironment
        );
        if (!runtimeConfig) continue;
        const runtimeName = uniqueRuntimeMcpServerName(plugin.name, serverName, usedMcpNames);
        mcpServers[runtimeName] = runtimeConfig;
        allowedMcpServers.push(runtimeName);
      }
    }

    const args = [
      ...dedupeSorted(skillDirs).flatMap((path) => ['--skill-dir', path]),
      ...dedupeSorted(selectedSkillIds).flatMap((id) => ['--skill', id])
    ];
    const mcpConfigPath = allowedMcpServers.length > 0 ? this.runtimeMcpConfigPath : null;
    if (mcpConfigPath) {
      mkdirSync(this.runtimePath, { recursive: true });
      writeFileSync(
        mcpConfigPath,
        `${JSON.stringify({ servers: mcpServers }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
      args.push('--mcp-config', mcpConfigPath);
      for (const serverName of allowedMcpServers) {
        args.push('--allow-mcp-server', serverName);
      }
    }

    return {
      runtimeDirectory: this.runtimePath,
      skillDirs: dedupeSorted(skillDirs),
      selectedSkillIds: dedupeSorted(selectedSkillIds),
      mcpConfigPath,
      allowedMcpServers,
      args,
      warnings
    };
  }

  public addFromFilesystem(pluginRoot: string): AgentPluginRegistryState {
    const sourcePath = canonicalDirectory(pluginRoot);
    const manifest = readManifest(sourcePath);
    const now = new Date().toISOString();
    const registry = this.readRegistryFile();
    const id = pluginId(manifest.name, sourcePath);
    const existing = registry.plugins.find((plugin) => plugin.id === id);
    if (existing) {
      existing.source = { kind: 'filesystem', path: sourcePath };
      existing.enabled = true;
    } else {
      registry.plugins.push({
        id,
        source: { kind: 'filesystem', path: sourcePath },
        enabled: true,
        installedAt: now
      });
    }
    this.writeRegistryFile(registry);
    return this.getState();
  }

  public async addFromRepository(repositoryUrl: string): Promise<AgentPluginRegistryState> {
    const normalizedUrl = normalizeSourceRepositoryUrl(repositoryUrl);
    if (!normalizedUrl) {
      throw new Error('Enter a GitHub or GitLab repository URL over HTTPS.');
    }
    const materialized = await materializeGitRepositoryAsync(
      {
        url: normalizedUrl,
        label: normalizedUrl,
        sourceAssetId: 'agent-plugin-repository',
        sourceAssetKind: 'repo',
        sensitivity: 'public'
      },
      '',
      { repositoryStoreDirectory: this.pluginStorePath }
    );
    const sourcePath = canonicalDirectory(materialized.localPath);
    const manifest = readManifest(sourcePath);
    const now = new Date().toISOString();
    const registry = this.readRegistryFile();
    const id = pluginId(manifest.name, normalizedUrl);
    const existing = registry.plugins.find((plugin) => plugin.id === id);
    if (existing) {
      existing.source = { kind: 'repository', path: sourcePath, repositoryUrl: normalizedUrl };
      existing.enabled = true;
    } else {
      registry.plugins.push({
        id,
        source: { kind: 'repository', path: sourcePath, repositoryUrl: normalizedUrl },
        enabled: true,
        installedAt: now
      });
    }
    this.writeRegistryFile(registry);
    return this.getState();
  }

  public setEnabled(pluginIdValue: string, enabled: boolean): AgentPluginRegistryState {
    const registry = this.readRegistryFile();
    let plugin = registry.plugins.find((candidate) => candidate.id === pluginIdValue);
    if (!plugin) {
      const builtin = this.builtinPlugins().find((candidate) => candidate.id === pluginIdValue);
      if (!builtin) throw new Error('Plugin not found.');
      plugin = {
        id: builtin.id,
        source: { kind: 'builtin', path: builtin.path },
        enabled: true,
        installedAt: builtin.installedAt
      };
      registry.plugins.push(plugin);
    }
    plugin.enabled = enabled;
    this.writeRegistryFile(registry);
    return this.getState();
  }

  public remove(pluginIdValue: string): AgentPluginRegistryState {
    const registry = this.readRegistryFile();
    const plugin = this.readRegistryWithBuiltins().plugins.find((candidate) => candidate.id === pluginIdValue);
    if (!plugin) throw new Error('Plugin not found.');
    if (plugin.source.kind === 'builtin') throw new Error('Built-in plugins cannot be removed.');
    const next = {
      ...registry,
      plugins: registry.plugins.filter((candidate) => candidate.id !== pluginIdValue)
    };
    this.writeRegistryFile(next);
    if (plugin.source.kind === 'repository') {
      this.removeManagedRepository(plugin.source.path);
    }
    return this.getState();
  }

  private materializeRecord(stored: StoredAgentPlugin): AgentPluginRecord {
    const scanned = this.scanPlugin(stored.source.path, stored.id);
    return {
      ...scanned,
      id: stored.id,
      enabled: stored.enabled && scanned.status === 'ready',
      source: stored.source,
      installedAt: stored.installedAt,
      updatedAt: new Date().toISOString()
    };
  }

  private scanPlugin(pluginRoot: string, storedId: string | null): Omit<AgentPluginRecord, 'source' | 'installedAt' | 'updatedAt' | 'enabled' | 'id'> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let manifest: ParsedManifest;
    try {
      manifest = readManifest(pluginRoot);
      warnings.push(...manifest.warnings);
    } catch (error) {
      return {
        name: basenameFallback(pluginRoot),
        version: null,
        description: null,
        status: 'invalid',
        skills: [],
        mcpServers: [],
        warnings,
        errors: [errorMessage(error)]
      };
    }

    const pluginDataRoot = resolve(this.pluginDataPath, storedId ?? pluginId(manifest.name, pluginRoot));
    const skills = scanSkills(pluginRoot, warnings);
    const mcpServers = scanMcpServers(pluginRoot, pluginDataRoot, warnings, errors);
    const componentErrors = mcpServers.some((server) => !server.valid);
    return {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      status: errors.length > 0 || componentErrors ? 'invalid' : 'ready',
      skills,
      mcpServers,
      warnings,
      errors
    };
  }

  private readRegistryFile(): AgentPluginRegistryFile {
    if (!existsSync(this.registryPath)) return { version: 1, plugins: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.registryPath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object') return { version: 1, plugins: [] };
      const plugins = Array.isArray((parsed as { plugins?: unknown }).plugins)
        ? (parsed as { plugins: unknown[] }).plugins.map(normalizeStoredPlugin).filter((plugin): plugin is StoredAgentPlugin => Boolean(plugin))
        : [];
      return { version: 1, plugins };
    } catch {
      return { version: 1, plugins: [] };
    }
  }

  private readRegistryWithBuiltins(): AgentPluginRegistryFile {
    const registry = this.readRegistryFile();
    return {
      ...registry,
      plugins: mergeBuiltinPlugins(registry.plugins, this.builtinPlugins())
    };
  }

  private writeRegistryFile(registry: AgentPluginRegistryFile): void {
    mkdirSync(dirname(this.registryPath), { recursive: true });
    const tempPath = join(dirname(this.registryPath), `agent-plugins.${process.pid}.${randomUUID()}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.registryPath);
  }

  private removeManagedRepository(pluginPath: string): void {
    const resolved = resolve(pluginPath);
    if (!isContainedPath(this.pluginStorePath, resolved)) return;
    rmSync(resolved, { recursive: true, force: true });
  }

  private builtinPlugins(): BuiltinAgentPluginDefinition[] {
    return this.options.builtinPlugins ?? defaultBuiltinPlugins();
  }
}

function readManifest(pluginRoot: string): ParsedManifest {
  const manifestPath = containedPath(pluginRoot, 'plugin.json');
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    throw new Error('Agent Plugin manifest plugin.json was not found at the selected root.');
  }
  assertExistingPathContained(pluginRoot, manifestPath, 'plugin.json');
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Agent Plugin manifest must be a JSON object.');
  }
  const object = parsed as Record<string, unknown>;
  const schema = stringValue(object.$schema);
  const name = stringValue(object.name);
  const warnings = Object.keys(object)
    .filter((key) => !MANIFEST_ALLOWED_KEYS.has(key))
    .map((key) => `plugin.json contains unsupported field "${key}".`);
  if (schema !== AGENT_PLUGIN_SCHEMA) {
    throw new Error(`Agent Plugin manifest must use schema ${AGENT_PLUGIN_SCHEMA}.`);
  }
  if (!name || !PLUGIN_NAME_RE.test(name)) {
    throw new Error('Agent Plugin manifest must include a valid package-style name.');
  }
  return {
    name,
    version: stringValue(object.version),
    description: stringValue(object.description),
    warnings
  };
}

function scanSkills(pluginRoot: string, warnings: string[]): AgentPluginSkillSummary[] {
  const skillsRoot = containedPath(pluginRoot, 'skills');
  if (!existsSync(skillsRoot)) return [];
  if (!statSync(skillsRoot).isDirectory()) {
    warnings.push('skills exists but is not a directory, so skills were skipped.');
    return [];
  }
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const skillPath = containedPath(skillsRoot, entry.name);
      const skillMarkdownPath = containedPath(skillPath, 'SKILL.md');
      if (!existsSync(skillMarkdownPath) || !statSync(skillMarkdownPath).isFile()) {
        warnings.push(`Skill ${entry.name} was skipped because it does not contain SKILL.md.`);
        return [];
      }
      assertExistingPathContained(pluginRoot, skillMarkdownPath, `skills/${entry.name}/SKILL.md`);
      const metadata = parseSkillMarkdown(readFileSync(skillMarkdownPath, 'utf8'));
      return [{
        id: entry.name,
        name: metadata.name ?? entry.name,
        directoryName: entry.name,
        relativePath: `./skills/${entry.name}/SKILL.md`,
        description: metadata.description
      }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function scanMcpServers(pluginRoot: string, pluginDataRoot: string, warnings: string[], pluginErrors: string[]): AgentPluginMcpServerSummary[] {
  const mcpServers = readMcpServers(pluginRoot, warnings, pluginErrors);
  if (!mcpServers) return [];
  return Object.entries(mcpServers)
    .map(([name, config]) => scanMcpServer(name, config, pluginRoot, pluginDataRoot))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function readMcpServers(
  pluginRoot: string,
  warnings: string[],
  pluginErrors: string[]
): Record<string, unknown> | null {
  const mcpPath = containedPath(pluginRoot, 'mcp.json');
  if (!existsSync(mcpPath)) return null;
  if (!statSync(mcpPath).isFile()) {
    warnings.push('mcp.json exists but is not a file, so MCP servers were skipped.');
    return null;
  }
  assertExistingPathContained(pluginRoot, mcpPath, 'mcp.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(mcpPath, 'utf8')) as unknown;
  } catch (error) {
    pluginErrors.push(`mcp.json could not be parsed: ${errorMessage(error)}`);
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    pluginErrors.push('mcp.json must be a JSON object.');
    return null;
  }
  const object = parsed as Record<string, unknown>;
  if (stringValue(object.$schema) !== AGENT_PLUGIN_MCP_SCHEMA) {
    pluginErrors.push(`mcp.json must use schema ${AGENT_PLUGIN_MCP_SCHEMA}.`);
  }
  const mcpServers = object.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
    pluginErrors.push('mcp.json must include an mcpServers object.');
    return null;
  }
  return mcpServers as Record<string, unknown>;
}

function scanMcpServer(name: string, config: unknown, pluginRoot: string, pluginDataRoot: string): AgentPluginMcpServerSummary {
  const errors: string[] = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { name, transport: 'unknown', command: null, url: null, valid: false, errors: ['MCP server config must be an object.'] };
  }
  const object = config as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (!MCP_SERVER_ALLOWED_KEYS.has(key)) errors.push(`Unsupported MCP server field "${key}".`);
  }
  const transport = normalizeTransport(object);
  if (transport === 'stdio') {
    const command = stringValue(object.command);
    if (!command) errors.push('Stdio MCP server must include command.');
    else if (/\s/u.test(command)) errors.push('Stdio MCP command must be one token.');
    else if (looksLikePath(command) && !command.startsWith('./')) errors.push('Plugin-relative stdio commands must begin with ./');
    else if (command.startsWith('./')) validateContainedExpression(command, pluginRoot, pluginRoot, 'command', errors);
    validateStringArray(object.args, 'args', errors);
    validateStringRecord(object.env, 'env', errors);
    if (object.cwd !== undefined) validateCwd(object.cwd, pluginRoot, pluginDataRoot, errors);
    return { name, transport, command: command ?? null, url: null, valid: errors.length === 0, errors };
  }
  if (transport === 'streamable-http' || transport === 'sse') {
    const url = stringValue(object.url);
    if (!url) errors.push(`${transport} MCP server must include url.`);
    else validateMcpUrl(url, errors);
    validateStringRecord(object.headers, 'headers', errors);
    return { name, transport, command: null, url: url ?? null, valid: errors.length === 0, errors };
  }
  errors.push('MCP server type must be stdio, streamable-http, or sse.');
  return { name, transport, command: null, url: null, valid: false, errors };
}

function normalizeTransport(object: Record<string, unknown>): AgentPluginMcpTransport {
  const explicit = stringValue(object.type);
  if (explicit === 'stdio' || explicit === 'streamable-http' || explicit === 'sse') return explicit;
  if (!explicit && typeof object.command === 'string') return 'stdio';
  return 'unknown';
}

function validateCwd(value: unknown, pluginRoot: string, pluginDataRoot: string, errors: string[]): void {
  const cwd = stringValue(value);
  if (!cwd) {
    errors.push('cwd must be a string when provided.');
    return;
  }
  if (cwd.startsWith('${PLUGIN_ROOT}')) {
    validateContainedExpression(cwd.replace('${PLUGIN_ROOT}', '.'), pluginRoot, pluginRoot, 'cwd', errors);
    return;
  }
  if (cwd.startsWith('${PLUGIN_DATA}')) {
    validateContainedExpression(cwd.replace('${PLUGIN_DATA}', '.'), pluginDataRoot, pluginDataRoot, 'cwd', errors);
    return;
  }
  if (!cwd.startsWith('./')) {
    errors.push('cwd must be plugin-relative or rooted at ${PLUGIN_ROOT} or ${PLUGIN_DATA}.');
    return;
  }
  validateContainedExpression(cwd, pluginRoot, pluginRoot, 'cwd', errors);
}

function validateContainedExpression(value: string, root: string, containmentRoot: string, label: string, errors: string[]): void {
  const resolved = resolve(root, value);
  if (!isContainedPath(containmentRoot, resolved)) {
    errors.push(`${label} resolves outside its allowed root.`);
  }
}

function validateMcpUrl(value: string, errors: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    errors.push('MCP server url must be absolute.');
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    errors.push('MCP server url must use http or https.');
  }
  if (parsed.username || parsed.password || parsed.hash) {
    errors.push('MCP server url must not include credentials or a fragment.');
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    errors.push('Non-loopback MCP server urls must use https.');
  }
}

function honeycrispMcpServerConfig(
  config: unknown,
  transport: AgentPluginMcpTransport,
  pluginRoot: string,
  pluginDataRoot: string,
  extraEnvironment: Record<string, string> = {}
): Record<string, unknown> | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const object = config as Record<string, unknown>;
  if (transport === 'stdio') {
    const command = stringValue(object.command);
    if (!command) return null;
    const runtimeConfig: Record<string, unknown> = {
      type: 'stdio',
      command: command.startsWith('./') ? resolve(pluginRoot, command) : command
    };
    if (Array.isArray(object.args)) runtimeConfig.args = object.args.filter((arg): arg is string => typeof arg === 'string');
    if (isStringRecord(object.env)) {
      runtimeConfig.env = Object.fromEntries(
        Object.entries(object.env).map(([key, value]) => [
          key,
          expandPluginVariables(value, pluginRoot, pluginDataRoot, extraEnvironment)
        ])
      );
    }
    const cwd = stringValue(object.cwd);
    if (cwd) runtimeConfig.cwd = resolvePluginPathExpression(cwd, pluginRoot, pluginDataRoot);
    return runtimeConfig;
  }
  if (transport === 'streamable-http' || transport === 'sse') {
    const url = stringValue(object.url);
    if (!url) return null;
    const runtimeConfig: Record<string, unknown> = { type: transport, url };
    if (isStringRecord(object.headers)) runtimeConfig.headers = { ...object.headers };
    return runtimeConfig;
  }
  return null;
}

function resolvePluginPathExpression(value: string, pluginRoot: string, pluginDataRoot: string): string {
  if (value.startsWith('${PLUGIN_ROOT}')) {
    return resolveExpressionSuffix(pluginRoot, value.slice('${PLUGIN_ROOT}'.length));
  }
  if (value.startsWith('${PLUGIN_DATA}')) {
    return resolveExpressionSuffix(pluginDataRoot, value.slice('${PLUGIN_DATA}'.length));
  }
  return resolve(pluginRoot, value);
}

function resolveExpressionSuffix(root: string, suffix: string): string {
  const child = suffix.replace(/^[\\/]+/u, '');
  return child ? resolve(root, child) : resolve(root);
}

function expandPluginVariables(
  value: string,
  pluginRoot: string,
  pluginDataRoot: string,
  extraEnvironment: Record<string, string>
): string {
  let expanded = value
    .replaceAll('${PLUGIN_ROOT}', pluginRoot)
    .replaceAll('${PLUGIN_DATA}', pluginDataRoot);
  for (const [key, replacement] of Object.entries(extraEnvironment)) {
    expanded = expanded.replaceAll(`\${${key}}`, replacement);
  }
  return expanded;
}

function parseSkillMarkdown(markdown: string): { name: string | null; description: string | null } {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? '';
  return {
    name: frontmatterField(frontmatter, 'name'),
    description: frontmatterField(frontmatter, 'description')
  };
}

function frontmatterField(frontmatter: string, key: string): string | null {
  const pattern = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'imu');
  const value = frontmatter.match(pattern)?.[1]?.trim();
  if (!value) return null;
  return value.replace(/^['"]|['"]$/g, '').slice(0, 500);
}

function validateStringArray(value: unknown, label: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    errors.push(`${label} must be an array of strings when provided.`);
  }
}

function validateStringRecord(value: unknown, label: string, errors: string[]): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value as Record<string, unknown>).some((entry) => typeof entry !== 'string')) {
    errors.push(`${label} must be an object with string values when provided.`);
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string');
}

function uniqueRuntimeMcpServerName(pluginName: string, serverName: string, usedNames: Set<string>): string {
  const base = `${sanitizeRuntimeNamePart(pluginName, 'plugin')}.${sanitizeRuntimeNamePart(serverName, 'server')}`.slice(0, 180);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function sanitizeRuntimeNamePart(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  if (sanitized) return sanitized;
  return `${fallback}-${createHash('sha256').update(value).digest('hex').slice(0, 8)}`;
}

function dedupeSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalDirectory(path: string): string {
  const resolved = realpathSync.native(resolve(path));
  if (!statSync(resolved).isDirectory()) throw new Error('Selected plugin path is not a directory.');
  return resolved;
}

function containedPath(root: string, child: string): string {
  const resolved = resolve(root, child);
  if (!isContainedPath(root, resolved)) throw new Error(`Plugin path escapes its root: ${child}`);
  return resolved;
}

function assertExistingPathContained(root: string, path: string, label: string): void {
  const resolved = realpathSync.native(path);
  if (!isContainedPath(root, resolved)) throw new Error(`Plugin path escapes its root: ${label}`);
}

function isContainedPath(root: string, candidate: string): boolean {
  const base = resolve(root);
  const target = resolve(candidate);
  const diff = relative(base, target);
  return diff === '' || (!diff.startsWith('..') && !isAbsolute(diff));
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized.endsWith('.localhost');
}

function looksLikePath(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value.startsWith('.');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pluginId(name: string, source: string): string {
  const digest = createHash('sha256').update(`${name}\n${source}`).digest('hex').slice(0, 16);
  return `${name}-${digest}`;
}

function normalizeStoredPlugin(value: unknown): StoredAgentPlugin | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Partial<StoredAgentPlugin>;
  if (typeof object.id !== 'string' || !object.source || typeof object.source !== 'object') return null;
  const source = object.source;
  if ((source.kind !== 'filesystem' && source.kind !== 'repository' && source.kind !== 'builtin') || typeof source.path !== 'string') return null;
  return {
    id: object.id,
    source: {
      kind: source.kind,
      path: source.path,
      ...(typeof source.repositoryUrl === 'string' ? { repositoryUrl: source.repositoryUrl } : {})
    },
    enabled: object.enabled === true,
    installedAt: typeof object.installedAt === 'string' ? object.installedAt : new Date().toISOString()
  };
}

function mergeBuiltinPlugins(stored: StoredAgentPlugin[], builtins: BuiltinAgentPluginDefinition[]): StoredAgentPlugin[] {
  const next = [...stored];
  for (const builtin of builtins) {
    const existing = next.find((plugin) => plugin.id === builtin.id);
    if (existing) {
      existing.source = { kind: 'builtin', path: builtin.path };
      existing.installedAt = existing.installedAt || builtin.installedAt;
      continue;
    }
    next.push({
      id: builtin.id,
      source: { kind: 'builtin', path: builtin.path },
      enabled: true,
      installedAt: builtin.installedAt
    });
  }
  return next;
}

function defaultBuiltinPlugins(): BuiltinAgentPluginDefinition[] {
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

function comparePlugins(left: AgentPluginRecord, right: AgentPluginRecord): number {
  return left.name.localeCompare(right.name) || left.source.path.localeCompare(right.source.path);
}

function basenameFallback(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'Unknown plugin';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
