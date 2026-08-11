export const RESEARCH_PROFILE_SCHEMA_VERSION = 1 as const;

export type ResearchProfileAuthorizationMode = 'required_for_live_network' | 'optional';

export type ResearchProfileAttributeType = 'string' | 'number' | 'boolean';

export interface ResearchProfileAttributeDefinition {
  type: ResearchProfileAttributeType;
  description: string;
  pattern?: string;
  enum?: readonly (string | number | boolean)[];
}

export interface ResearchProfileMemoryRequirement {
  statuses?: readonly string[];
  requiredAttributes?: readonly string[];
  requireEvidence?: boolean;
  requireAssetLinks?: boolean;
  requiredNeighborTypes?: readonly string[];
}

export interface ResearchProfileMemoryType {
  id: string;
  name: string;
  pluralName: string;
  description: string;
  lifecycle: 'active' | 'retired';
  creatable: boolean;
  replacedBy?: string;
  requiresExplicitStatus?: boolean;
  aliases?: readonly string[];
  group?: string;
  icon?: string;
  color?: string;
  order: number;
  defaultStatus: string;
  allowedStatuses: readonly string[];
  contextWeight?: number;
  attributes?: Readonly<Record<string, ResearchProfileAttributeDefinition>>;
  requirements?: readonly ResearchProfileMemoryRequirement[];
}

export interface ResearchProfileMemoryStatus {
  id: string;
  name: string;
  description: string;
  order: number;
  terminal?: boolean;
  polarity?: 'positive' | 'neutral' | 'negative';
}

export interface ResearchProfileEvidenceKind {
  id: string;
  name: string;
  description: string;
  allowsPath?: boolean;
}

export interface ResearchProfileEvidencePathBase {
  id: string;
  name: string;
  description: string;
  pathFormat?: 'relative' | 'url' | 'either';
}

export interface ResearchProfileMemoryRelation {
  id: string;
  name: string;
  description: string;
}

export interface ResearchProfileMemory {
  types: readonly ResearchProfileMemoryType[];
  statuses: readonly ResearchProfileMemoryStatus[];
  evidenceKinds: readonly ResearchProfileEvidenceKind[];
  evidencePathBases: readonly ResearchProfileEvidencePathBase[];
  relations?: readonly ResearchProfileMemoryRelation[];
  defaultNodeLimit?: number;
  defaultCharacterBudget?: number;
}

export interface ResearchProfileAgentPrompt {
  role: string;
  posture: readonly string[];
  style: readonly string[];
  memoryInstructions: readonly string[];
  runbookInstructions: readonly string[];
}

export interface ResearchProfileWorkflow {
  id: string;
  name: string;
  description: string;
  goalSuggestionCount: number;
  goalSuggestionInstructions: readonly string[];
  promptInstructions: readonly string[];
  outputRequirements: readonly string[];
  default?: boolean;
}

export interface ResearchProfileCapabilities {
  defaultToolFamilies: readonly string[];
  disabledToolFamilies: readonly string[];
  allowedSideEffects: readonly ('none' | 'read' | 'write' | 'network' | 'process')[];
  selectedSkillIds: readonly string[];
  disabledSkillIds: readonly string[];
  allowedMcpServerIds: readonly string[];
  memoryEnabled: boolean;
  runbooksEnabled: boolean;
  collaborationEnabled: boolean;
}

export interface ResearchProfileWorkspace {
  workspaceNoun: string;
  subjectNoun: string;
  boundaryNoun: string;
  authorizationMode: ResearchProfileAuthorizationMode;
  boundaryInstructions: readonly string[];
  materialKinds: readonly string[];
}

export interface ResearchProfileModelJob {
  provider?: string;
  model?: string;
  effort?: string;
}

export interface ResearchProfileModelJobs {
  sessionTitle?: ResearchProfileModelJob;
  promptGeneration?: ResearchProfileModelJob;
  goalSuggestions?: ResearchProfileModelJob;
  memoryCuration?: ResearchProfileModelJob;
  shellReview?: ResearchProfileModelJob;
}

export interface ResearchProfilePresentation {
  newResearchLabel: string;
  memoryLabel: string;
  runbookLabel: string;
  sessionLabel: string;
}

export interface ResearchProfile {
  schemaVersion: typeof RESEARCH_PROFILE_SCHEMA_VERSION;
  id: string;
  version: string;
  name: string;
  description: string;
  agent: ResearchProfileAgentPrompt;
  memory: ResearchProfileMemory;
  workflows: readonly ResearchProfileWorkflow[];
  capabilities: ResearchProfileCapabilities;
  workspace: ResearchProfileWorkspace;
  modelJobs: ResearchProfileModelJobs;
  presentation: ResearchProfilePresentation;
}

export interface ResolvedResearchProfile {
  profile: ResearchProfile;
  hash: string;
  source: 'bundled-default' | 'workspace-default' | 'explicit';
  path?: string;
}

export interface ResearchProfileSnapshot {
  id: string;
  workspaceId: string;
  profileId: string;
  profileVersion: string;
  profileHash: string;
  source: ResolvedResearchProfile['source'];
  sourcePath: string | null;
  profile: ResearchProfile;
  active: boolean;
  createdAt: string;
}

const PROFILE_SOURCES = new Set<ResolvedResearchProfile['source']>([
  'bundled-default',
  'workspace-default',
  'explicit'
]);

const SIDE_EFFECTS = new Set<ResearchProfileCapabilities['allowedSideEffects'][number]>([
  'none',
  'read',
  'write',
  'network',
  'process'
]);

/** Decode the normalized Honeycrisp wire contract at the Beale host boundary. */
export function decodeResearchProfile(value: unknown): ResearchProfile {
  const input = objectValue(value, 'Research profile');
  if (input.schemaVersion !== RESEARCH_PROFILE_SCHEMA_VERSION) {
    throw new Error(`Unsupported research profile schemaVersion: ${String(input.schemaVersion)}`);
  }

  const agent = objectValue(input.agent, 'Research profile agent');
  const memory = objectValue(input.memory, 'Research profile memory');
  const capabilities = objectValue(input.capabilities, 'Research profile capabilities');
  const workspace = objectValue(input.workspace, 'Research profile workspace');
  const presentation = objectValue(input.presentation, 'Research profile presentation');
  const authorizationMode = workspace.authorizationMode;
  if (authorizationMode !== 'required_for_live_network' && authorizationMode !== 'optional') {
    throw new Error('Research profile workspace authorizationMode is invalid.');
  }
  const allowedSideEffects = stringArray(capabilities.allowedSideEffects, 'Research profile allowed side effects');
  if (allowedSideEffects.some((effect) => !SIDE_EFFECTS.has(effect as ResearchProfileCapabilities['allowedSideEffects'][number]))) {
    throw new Error('Research profile contains an unsupported side effect.');
  }

  const profile: ResearchProfile = {
    schemaVersion: RESEARCH_PROFILE_SCHEMA_VERSION,
    id: nonEmptyString(input.id, 'Research profile id'),
    version: nonEmptyString(input.version, 'Research profile version'),
    name: nonEmptyString(input.name, 'Research profile name'),
    description: nonEmptyString(input.description, 'Research profile description'),
    agent: {
      role: nonEmptyString(agent.role, 'Research profile agent role'),
      posture: stringArray(agent.posture, 'Research profile agent posture'),
      style: stringArray(agent.style, 'Research profile agent style'),
      memoryInstructions: stringArray(agent.memoryInstructions, 'Research profile memory instructions'),
      runbookInstructions: stringArray(agent.runbookInstructions, 'Research profile runbook instructions')
    },
    memory: {
      types: arrayValue(memory.types, 'Research profile memory types').map(decodeMemoryType),
      statuses: arrayValue(memory.statuses, 'Research profile memory statuses').map(decodeMemoryStatus),
      evidenceKinds: arrayValue(memory.evidenceKinds, 'Research profile evidence kinds').map(decodeEvidenceKind),
      evidencePathBases: arrayValue(memory.evidencePathBases, 'Research profile evidence path bases').map(decodeEvidencePathBase),
      ...(memory.relations === undefined
        ? {}
        : {
            relations: arrayValue(memory.relations, 'Research profile memory relations').map((entry) =>
              decodeNamedDescription(entry, 'Research profile memory relation')
            )
          }),
      ...optionalFiniteNumberProperty(memory, 'defaultNodeLimit', 'Research profile default node limit'),
      ...optionalFiniteNumberProperty(memory, 'defaultCharacterBudget', 'Research profile default character budget')
    },
    workflows: arrayValue(input.workflows, 'Research profile workflows').map(decodeWorkflow),
    capabilities: {
      defaultToolFamilies: stringArray(capabilities.defaultToolFamilies, 'Research profile default tool families'),
      disabledToolFamilies: stringArray(capabilities.disabledToolFamilies, 'Research profile disabled tool families'),
      allowedSideEffects: allowedSideEffects as ResearchProfileCapabilities['allowedSideEffects'],
      selectedSkillIds: stringArray(capabilities.selectedSkillIds, 'Research profile selected skill ids'),
      disabledSkillIds: stringArray(capabilities.disabledSkillIds, 'Research profile disabled skill ids'),
      allowedMcpServerIds: stringArray(capabilities.allowedMcpServerIds, 'Research profile allowed MCP server ids'),
      memoryEnabled: booleanValue(capabilities.memoryEnabled, 'Research profile memory enabled'),
      runbooksEnabled: booleanValue(capabilities.runbooksEnabled, 'Research profile runbooks enabled'),
      collaborationEnabled: booleanValue(capabilities.collaborationEnabled, 'Research profile collaboration enabled')
    },
    workspace: {
      workspaceNoun: nonEmptyString(workspace.workspaceNoun, 'Research profile workspace noun'),
      subjectNoun: nonEmptyString(workspace.subjectNoun, 'Research profile subject noun'),
      boundaryNoun: nonEmptyString(workspace.boundaryNoun, 'Research profile boundary noun'),
      authorizationMode,
      boundaryInstructions: stringArray(workspace.boundaryInstructions, 'Research profile boundary instructions'),
      materialKinds: stringArray(workspace.materialKinds, 'Research profile material kinds')
    },
    modelJobs: decodeModelJobs(input.modelJobs),
    presentation: {
      newResearchLabel: nonEmptyString(presentation.newResearchLabel, 'Research profile new research label'),
      memoryLabel: nonEmptyString(presentation.memoryLabel, 'Research profile memory label'),
      runbookLabel: nonEmptyString(presentation.runbookLabel, 'Research profile runbook label'),
      sessionLabel: nonEmptyString(presentation.sessionLabel, 'Research profile session label')
    }
  };
  if (
    profile.capabilities.memoryEnabled
    && !profile.memory.types.some((type) => type.lifecycle === 'active' && type.creatable)
  ) {
    throw new Error('A memory-enabled research profile requires at least one active, creatable memory type.');
  }
  return profile;
}

export function decodeResolvedResearchProfile(value: unknown): ResolvedResearchProfile {
  const input = objectValue(value, 'Resolved research profile');
  const source = input.source;
  if (typeof source !== 'string' || !PROFILE_SOURCES.has(source as ResolvedResearchProfile['source'])) {
    throw new Error('Resolved research profile source is invalid.');
  }
  const hash = nonEmptyString(input.hash, 'Resolved research profile hash');
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error('Resolved research profile hash must be a lowercase SHA-256 digest.');
  }
  return {
    profile: decodeResearchProfile(input.profile),
    hash,
    source: source as ResolvedResearchProfile['source'],
    ...(input.path === undefined ? {} : { path: nonEmptyString(input.path, 'Resolved research profile path') })
  };
}

export function decodeResearchProfileJson(value: string): ResearchProfile {
  return decodeResearchProfile(JSON.parse(value) as unknown);
}

/** Stable serialization matching Honeycrisp's version-one profile hash input. */
export function serializeResearchProfile(profile: ResearchProfile): string {
  return stableJson(profile);
}

function decodeMemoryType(value: unknown, index: number): ResearchProfileMemoryType {
  const input = objectValue(value, `Research profile memory type ${index}`);
  const lifecycle = input.lifecycle;
  if (lifecycle !== 'active' && lifecycle !== 'retired') {
    throw new Error(`Research profile memory type ${index} lifecycle is invalid.`);
  }
  const attributes = input.attributes === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(objectValue(input.attributes, `Research profile memory type ${index} attributes`)).map(([name, raw]) => [
          name,
          decodeAttribute(raw, `Research profile memory type ${index} attribute ${name}`)
        ])
      );
  return {
    id: nonEmptyString(input.id, `Research profile memory type ${index} id`),
    name: nonEmptyString(input.name, `Research profile memory type ${index} name`),
    pluralName: nonEmptyString(input.pluralName, `Research profile memory type ${index} plural name`),
    description: nonEmptyString(input.description, `Research profile memory type ${index} description`),
    lifecycle,
    creatable: booleanValue(input.creatable, `Research profile memory type ${index} creatable`),
    ...optionalStringProperty(input, 'replacedBy', `Research profile memory type ${index} replacement`),
    ...optionalBooleanProperty(input, 'requiresExplicitStatus', `Research profile memory type ${index} requiresExplicitStatus`),
    ...optionalStringArrayProperty(input, 'aliases', `Research profile memory type ${index} aliases`),
    ...optionalStringProperty(input, 'group', `Research profile memory type ${index} group`),
    ...optionalStringProperty(input, 'icon', `Research profile memory type ${index} icon`),
    ...optionalStringProperty(input, 'color', `Research profile memory type ${index} color`),
    order: finiteNumber(input.order, `Research profile memory type ${index} order`),
    defaultStatus: nonEmptyString(input.defaultStatus, `Research profile memory type ${index} default status`),
    allowedStatuses: stringArray(input.allowedStatuses, `Research profile memory type ${index} allowed statuses`),
    ...optionalFiniteNumberProperty(input, 'contextWeight', `Research profile memory type ${index} context weight`),
    ...(attributes === undefined ? {} : { attributes }),
    ...(input.requirements === undefined
      ? {}
      : {
          requirements: arrayValue(input.requirements, `Research profile memory type ${index} requirements`).map((requirement, requirementIndex) =>
            decodeMemoryRequirement(requirement, `Research profile memory type ${index} requirement ${requirementIndex}`)
          )
        })
  };
}

function decodeAttribute(value: unknown, label: string): ResearchProfileAttributeDefinition {
  const input = objectValue(value, label);
  if (input.type !== 'string' && input.type !== 'number' && input.type !== 'boolean') {
    throw new Error(`${label} type is invalid.`);
  }
  const enumValues = input.enum === undefined
    ? undefined
    : arrayValue(input.enum, `${label} enum`).map((entry) => {
        if (typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean') {
          throw new Error(`${label} enum contains an invalid value.`);
        }
        if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error(`${label} enum contains a non-finite number.`);
        return entry;
      });
  return {
    type: input.type,
    description: nonEmptyString(input.description, `${label} description`),
    ...optionalStringProperty(input, 'pattern', `${label} pattern`),
    ...(enumValues === undefined ? {} : { enum: enumValues })
  };
}

function decodeMemoryRequirement(value: unknown, label: string): ResearchProfileMemoryRequirement {
  const input = objectValue(value, label);
  return {
    ...optionalStringArrayProperty(input, 'statuses', `${label} statuses`),
    ...optionalStringArrayProperty(input, 'requiredAttributes', `${label} required attributes`),
    ...optionalBooleanProperty(input, 'requireEvidence', `${label} require evidence`),
    ...optionalBooleanProperty(input, 'requireAssetLinks', `${label} require asset links`),
    ...optionalStringArrayProperty(input, 'requiredNeighborTypes', `${label} required neighbor types`)
  };
}

function decodeMemoryStatus(value: unknown, index: number): ResearchProfileMemoryStatus {
  const input = objectValue(value, `Research profile memory status ${index}`);
  const polarity = input.polarity;
  if (polarity !== undefined && polarity !== 'positive' && polarity !== 'neutral' && polarity !== 'negative') {
    throw new Error(`Research profile memory status ${index} polarity is invalid.`);
  }
  return {
    ...decodeNamedDescription(input, `Research profile memory status ${index}`),
    order: finiteNumber(input.order, `Research profile memory status ${index} order`),
    ...optionalBooleanProperty(input, 'terminal', `Research profile memory status ${index} terminal`),
    ...(polarity === undefined ? {} : { polarity })
  };
}

function decodeEvidenceKind(value: unknown, index: number): ResearchProfileEvidenceKind {
  const input = objectValue(value, `Research profile evidence kind ${index}`);
  return {
    ...decodeNamedDescription(input, `Research profile evidence kind ${index}`),
    ...optionalBooleanProperty(input, 'allowsPath', `Research profile evidence kind ${index} allows path`)
  };
}

function decodeEvidencePathBase(value: unknown, index: number): ResearchProfileEvidencePathBase {
  const input = objectValue(value, `Research profile evidence path base ${index}`);
  const pathFormat = input.pathFormat;
  if (pathFormat !== undefined && pathFormat !== 'relative' && pathFormat !== 'url' && pathFormat !== 'either') {
    throw new Error(`Research profile evidence path base ${index} path format is invalid.`);
  }
  return {
    ...decodeNamedDescription(input, `Research profile evidence path base ${index}`),
    ...(pathFormat === undefined ? {} : { pathFormat })
  };
}

function decodeWorkflow(value: unknown, index: number): ResearchProfileWorkflow {
  const input = objectValue(value, `Research profile workflow ${index}`);
  const goalSuggestionCount = finiteNumber(input.goalSuggestionCount, `Research profile workflow ${index} goal suggestion count`);
  if (!Number.isSafeInteger(goalSuggestionCount) || goalSuggestionCount <= 0) {
    throw new Error(`Research profile workflow ${index} goal suggestion count must be a positive integer.`);
  }
  return {
    id: nonEmptyString(input.id, `Research profile workflow ${index} id`),
    name: nonEmptyString(input.name, `Research profile workflow ${index} name`),
    description: nonEmptyString(input.description, `Research profile workflow ${index} description`),
    goalSuggestionCount,
    goalSuggestionInstructions: stringArray(input.goalSuggestionInstructions, `Research profile workflow ${index} goal suggestion instructions`),
    promptInstructions: stringArray(input.promptInstructions, `Research profile workflow ${index} prompt instructions`),
    outputRequirements: stringArray(input.outputRequirements, `Research profile workflow ${index} output requirements`),
    ...optionalBooleanProperty(input, 'default', `Research profile workflow ${index} default`)
  };
}

function decodeModelJobs(value: unknown): ResearchProfileModelJobs {
  const input = objectValue(value, 'Research profile model jobs');
  const result: ResearchProfileModelJobs = {};
  for (const key of ['sessionTitle', 'promptGeneration', 'goalSuggestions', 'memoryCuration', 'shellReview'] as const) {
    if (input[key] === undefined) continue;
    const job = objectValue(input[key], `Research profile model job ${key}`);
    result[key] = {
      ...optionalStringProperty(job, 'provider', `Research profile model job ${key} provider`),
      ...optionalStringProperty(job, 'model', `Research profile model job ${key} model`),
      ...optionalStringProperty(job, 'effort', `Research profile model job ${key} effort`)
    };
  }
  return result;
}

function decodeNamedDescription(value: unknown, label: string): ResearchProfileEvidencePathBase {
  const input = objectValue(value, label);
  return {
    id: nonEmptyString(input.id, `${label} id`),
    name: nonEmptyString(input.name, `${label} name`),
    description: nonEmptyString(input.description, `${label} description`)
  };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return arrayValue(value, label).map((entry, index) => nonEmptyString(entry, `${label} ${index}`));
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function optionalStringProperty<K extends string>(
  input: Record<string, unknown>,
  key: K,
  label: string
): Partial<Record<K, string>> {
  return input[key] === undefined ? {} : { [key]: nonEmptyString(input[key], label) } as Record<K, string>;
}

function optionalStringArrayProperty<K extends string>(
  input: Record<string, unknown>,
  key: K,
  label: string
): Partial<Record<K, readonly string[]>> {
  return input[key] === undefined
    ? {}
    : { [key]: stringArray(input[key], label) } as unknown as Record<K, readonly string[]>;
}

function optionalFiniteNumberProperty<K extends string>(
  input: Record<string, unknown>,
  key: K,
  label: string
): Partial<Record<K, number>> {
  return input[key] === undefined ? {} : { [key]: finiteNumber(input[key], label) } as Record<K, number>;
}

function optionalBooleanProperty<K extends string>(
  input: Record<string, unknown>,
  key: K,
  label: string
): Partial<Record<K, boolean>> {
  return input[key] === undefined ? {} : { [key]: booleanValue(input[key], label) } as Record<K, boolean>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(',')}}`;
}
