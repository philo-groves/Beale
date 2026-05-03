import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CreatedRunContext, ProjectStructureEntityRecord, ProjectStructureRelationRecord, WorkspaceDatabase } from './database';
import { ExecutorManager, normalizeNetworkProfile } from './executorManager';
import type { FunctionCallOutputItem } from './openaiAdapter';
import { redactJsonForModel } from './redaction';
import { runVerifierContract } from './verifierRunner';
import {
  findScopedExistingSourceCheckout,
  materializeGitRepository,
  materializeGitRepositoryAsync,
  normalizeSourceRepositoryUrl,
  selectSourceRepository,
  sourceRepositoryCandidates,
  type SourceRepositoryCandidate
} from './sourceMaterializer';
import { executeHostOperation, executeHostOperationAsync, isHostResearchSandbox, mapSandboxPathToHost } from './hostToolExecutor';
import type { GuestExecuteRequest, GuestExecuteResult } from './executorTypes';
import { cweEntryForId, inferCweMapping, normalizeCweConfidence, normalizeCweId } from './cweCatalog';
import { clampPriorityScore, priorityFactorsFromLabels, scorePriority } from './discoveryScoring';
import {
  claimCandidateFromFinding,
  claimCandidateFromHypothesis,
  duplicateReviewPayload,
  reviewClaimDuplicate,
  type ClaimCandidate,
  type DuplicateReview
} from './duplicateReview';
import type {
  ArtifactRecord,
  EvidenceRecord,
  FindingRecord,
  HypothesisRecord,
  ProjectSearchResult,
  ProjectSemanticSearchResult,
  RunDetail,
  ScopeAsset,
  ScopeAssetInput,
  TraceEventRecord,
  TraceEventType,
  TraceSource,
  VerifierContractRecord,
  VerifierRunRecord,
  WeaknessMappingInput,
  WeaknessMappingRecord
} from '@shared/types';

export interface OpenAiToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

export interface OpenAiFunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
  responseItemId?: string;
}

type ToolFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface ToolResult {
  status: 'success' | 'policy_blocked' | 'error';
  summary: string;
  payload: Record<string, unknown>;
  traceEventId?: string;
  artifactId?: string;
  eventType?: TraceEventType;
  source?: TraceSource;
}

interface ScopedFile {
  path: string;
  assetId: string;
  assetKind: ScopeAsset['kind'];
}

interface ScopedSearchRoot {
  path: string;
  asset: ScopeAsset;
  reason: string;
}

interface SearchAssemblyResult {
  matches: Array<Record<string, unknown>>;
  metadataMatches: number;
  semanticMatches: number;
  graphMatches: number;
  graphVariantMatches: number;
  diagnostics: SearchRetrievalDiagnostics;
}

interface SearchRetrievalDiagnostics {
  candidateCountsByLayer: Record<string, number>;
  mergedCandidateCountsByLayer: Record<string, number>;
  selectedCountsByLayer: Record<string, number>;
  dedupeCount: number;
  graphExpansionCount: number;
  topScoringSignals: Record<string, number>;
  selectedRelationshipFamilies: Record<string, number>;
  missingReasons: Array<Record<string, unknown>>;
  operationalHints: Array<Record<string, unknown>>;
  adaptiveFollowUp: Record<string, unknown> | null;
}

interface RetrievalCandidate {
  output: Record<string, unknown>;
  kind: string;
  entityType: string | null;
  entityId: string | null;
  sourcePath: string | null;
  range: string | null;
  namespace: string;
  score: number;
  signals: Record<string, number | string[]>;
  provenance: {
    source: string;
    matchedBy: string | null;
    seedEntityType?: string | null;
    seedEntityId?: string | null;
    graphEdgeKind?: string | null;
  };
}

interface SearchCollection {
  files: ScopedFile[];
  roots: ScopedSearchRoot[];
  targetResolution: string;
  unmaterializedSource: SourceRepositoryCandidate | null;
}

interface SearchQueryPlan {
  raw: string;
  rawLower: string;
  terms: string[];
  regex: RegExp | null;
  mode: 'literal' | 'regex_or_terms' | 'terms';
  intents: SearchQueryIntent[];
}

type SearchQueryIntent = 'symbol_lookup' | 'route_api_lookup' | 'auth_permission_question' | 'sink_data_flow_question' | 'binary_orientation' | 'prior_research_memory' | 'variant_similarity_search';

interface RetrievalFeedbackContext {
  readPathCounts: Map<string, number>;
  verifiedEntityKeys: Set<string>;
  correctedNegativeEntityKeys: Set<string>;
}

interface RequestedLineRange {
  start: number;
  end: number;
  requestedEnd: number | null;
  capped: boolean;
}

interface CodeBrowserTextSelection {
  text: string;
  binaryDerived: boolean;
  lineStart: number | null;
  lineEnd: number | null;
  truncated: boolean;
  largeFile: boolean;
  nextLineStart: number | null;
  contentHash: string | null;
  contentHashScope: 'full_file' | 'excerpt' | null;
}

interface GuestToolResult {
  result: GuestExecuteResult;
  artifactId: string | null;
  importedHostPath: string | null;
  requestedNetworkProfile: 'offline' | 'scoped' | 'elevated';
  networkProfile: 'offline' | 'scoped' | 'elevated';
  hostExecution: boolean;
  executionSubstrate: 'host' | 'disposable_guest_vm';
  hostCwd?: string;
  hostTargetPath?: string | null;
  hostArtifactPath?: string | null;
}

interface DebuggerSummary {
  gdbAvailable: boolean;
  crashed: boolean;
  signal: string | null;
  frames: string[];
  registersCaptured: boolean;
  unavailableReason: string | null;
  targetMissing: boolean;
}

const TOOL_NAMES = ['source', 'search', 'code_browser', 'resource_lookup', 'program_lookup', 'python', 'debugger', 'artifact', 'evidence', 'hypothesis', 'finding', 'verifier'] as const;
type ToolName = (typeof TOOL_NAMES)[number];
type ResourceLookupKind = 'any' | 'artifact' | 'evidence' | 'finding' | 'hypothesis' | 'verifier_run' | 'verifier_contract' | 'trace_event';

interface ProgramLookupOptions {
  fetch?: ToolFetch;
}

interface ResourceLookupRecord {
  kind: Exclude<ResourceLookupKind, 'any'>;
  id: string;
  label: string;
  searchText: string;
  payload: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

const LOCAL_ASSET_KINDS: ReadonlySet<ScopeAsset['kind']> = new Set(['path', 'repo', 'binary', 'documentation', 'other']);
const SKIPPED_DIRS = new Set(['.beale', '.git', 'node_modules', 'dist', 'out', 'coverage', '.cache']);
const MAX_SEARCH_FILES = 5000;
const MAX_SEARCH_MATCHES = 40;
const GRAPH_VARIANT_EDGE_KINDS = [
  'calls',
  'routes_to',
  'handles_with',
  'uses_middleware',
  'checks_permission',
  'reaches_sink',
  'imports_symbol',
  'exports_symbol',
  'contains_string',
  'references_url',
  'references_permission',
  'affects_component',
  'classified_as_cwe',
  'supports_hypothesis',
  'supports_finding',
  'supported_by_evidence',
  'verifies_finding',
  'verified_by_contract',
  'verifier_passed_hypothesis',
  'verifier_passed_finding'
] as const;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_BROWSER_LINES = 180;
const MAX_EXCERPT_CHARS = 16_000;
const MAX_LARGE_BROWSER_SCAN_BYTES = 32 * 1024 * 1024;
const MAX_MODEL_ARTIFACT_BYTES = 256 * 1024;

export function bealeToolDefinitions(): OpenAiToolDefinition[] {
  return [
    tool('source', 'Materialize an in-scope source repository into the Beale workspace with a host-safe shallow git clone. Use before source search when a scoped repo is not checked out yet.', {
      repository: stringProp('In-scope repository URL or label, such as https://github.com/org/repo or a scoped source label'),
      ref: stringProp('Optional branch, tag, or commit to checkout after clone; use an empty string for the default branch')
    }),
    tool('search', 'Search scoped workspace metadata, source text, binary-derived strings, artifact summaries, and hybrid-ranked local semantic chunks when available. Supports plain terms, exact phrases, and simple regex/| alternatives. Does not perform target execution.', {
      query: stringProp('Search query. Use concise terms or simple regex alternatives, for example Route|pathPrefix|HttpRoutes.'),
      target: stringProp('Scoped target label, repository URL, materialized path, artifact id, or component hint; use an empty string when not needed')
    }),
    tool('code_browser', 'Read bounded chunks from scoped source, text artifacts, or binary-derived strings. If a file is large or truncated, continue with line_start/line_end chunks from nextLineStart.', {
      path: stringProp('Scoped file path or artifact id'),
      symbol: stringProp('Symbol or text anchor; use an empty string when not needed'),
      line_start: stringProp('Optional 1-based start line for chunked reads; use an empty string when not needed'),
      line_end: stringProp('Optional 1-based inclusive end line for chunked reads; use an empty string when not needed')
    }),
    tool('resource_lookup', 'Look up Beale run resources by id or text. Use this for artifact_, evidence_, finding_, hypothesis_, verifier_run_, verifier contract, and trace ids instead of searching target source code for Beale ids.', {
      resource_id: stringProp('Exact Beale resource id to look up; use an empty string to search or list resources'),
      kind: stringProp('Resource kind: any, artifact, evidence, finding, hypothesis, verifier_run, verifier_contract, or trace_event. Use any when unsure.'),
      query: stringProp('Optional text query across current-run resource ids, titles, summaries, and metadata; use an empty string when resource_id is provided')
    }),
    tool('program_lookup', 'Fetch bounded public vulnerability program metadata without scraping application JavaScript. Use for HackerOne handles/URLs and policy URLs such as MSRC or Apple before live testing; records one timestamped scope artifact and returns concise operational guidance.', {
      provider: stringProp('Program provider: auto, hackerone, msrc, apple, or url. Use auto unless the provider is known.'),
      identifier: stringProp('Program handle, program URL, or public policy URL. Examples: gitlab, https://hackerone.com/gitlab, https://www.microsoft.com/msrc/bounty, https://security.apple.com/bounty/.'),
      query: stringProp('Optional target, domain, or keyword to check against returned metadata; use an empty string when not needed.')
    }),
    tool('python', 'Run a small Python analysis operation in the active session sandbox. Default sessions run on the host; VM sessions run inside a disposable guest.', {
      task: stringProp('Analysis task'),
      script: stringProp('Python script to run in the active sandbox'),
      artifact_path: stringProp('Path to collect as an artifact after execution; use an empty string when not needed')
    }),
    tool('debugger', 'Run a wrapper-first debugger observation in the active session sandbox. Default sessions run on the host; VM sessions run inside a disposable guest.', {
      operation: stringProp('Debugger operation, such as crash_summary or gdb_probe'),
      target: stringProp('Target executable path in the active sandbox'),
      input_path: stringProp('Input path for crash reproduction; use an empty string when not needed')
    }),
    tool('artifact', 'Preserve generated research output or evidence metadata in the content-addressed artifact store.', {
      name: stringProp('Artifact name'),
      content: stringProp('Artifact content or bounded summary'),
      kind: stringProp('Artifact kind')
    }),
    tool('evidence', 'Create an evidence record that links a tool observation, artifact, or verifier run to a hypothesis or finding.', {
      kind: stringProp('Evidence kind, such as artifact, trace, verifier, reproduction, static_analysis, or dynamic_observation'),
      summary: stringProp('Short evidence summary. Must describe the actual artifact, trace, or verifier observation.'),
      hypothesis_id: stringProp('Hypothesis id to link; use an empty string when not linked'),
      finding_id: stringProp('Finding id to link; use an empty string when not linked'),
      artifact_id: stringProp('Artifact id backing this evidence; use an empty string when not applicable'),
      trace_event_id: stringProp('Non-model trace event id backing this evidence; use an empty string when not applicable'),
      verifier_run_id: stringProp('Verifier run id backing this evidence; use an empty string when not applicable')
    }),
    tool('hypothesis', 'Create or update a vulnerability hypothesis in Beale state. This records model-proposed research state, not verified target truth.', {
      hypothesis_id: stringProp('Existing hypothesis id to update; use an empty string to create a new hypothesis'),
      state: stringProp('State, such as needs_evidence, reproduced, dismissed, out_of_scope, duplicate, or open'),
      title: stringProp('Short hypothesis title'),
      description: stringProp('Hypothesis details and rationale'),
      component: stringProp('Affected component or surface'),
      bug_class: stringProp('Bug class, such as authz, injection, secret_leak, memory_corruption, or resource_exhaustion'),
      primary_cwe_id: stringProp('Primary CWE id, such as CWE-862. Use an empty string or needs_classification when uncertain. Do not invent CWE ids.'),
      primary_cwe_name: stringProp('Primary CWE name when known; use an empty string to let Beale fill from its local catalog.'),
      alternate_cwe_ids_json: stringProp('JSON array of alternate CWE ids or objects with cwe_id/cwe_name; use [] when none.'),
      cwe_mapping_confidence: stringProp('CWE mapping confidence: low, medium, or high. Use low when uncertain.'),
      cwe_mapping_rationale: stringProp('Short rationale for the CWE mapping; use an empty string when no mapping is proposed.'),
      attacker_reachability: stringProp('Reachability label, preferably prefixed with 0-4'),
      impact: stringProp('Impact label, preferably prefixed with 0-4'),
      evidence_confidence: stringProp('Evidence confidence label, preferably prefixed with 0-4'),
      exploit_practicality: stringProp('Exploit practicality label, preferably prefixed with 0-4'),
      scope_confidence: stringProp('Scope confidence label, preferably prefixed with 0-4')
    }),
    tool('finding', 'Create or update a finding record. Verified and reportable findings require a passing real verifier run id; reportable also means reachability and exploitability are certain enough for disclosure review.', {
      finding_id: stringProp('Existing finding id to update; use an empty string to create a new finding'),
      hypothesis_id: stringProp('Linked hypothesis id; use an empty string when not linked'),
      state: stringProp('State, such as needs_evidence, reproduced, verified, reportable, disclosure_ready, false_positive, out_of_scope, dismissed, or duplicate'),
      title: stringProp('Short finding title'),
      summary: stringProp('Finding summary'),
      primary_cwe_id: stringProp('Primary CWE id, such as CWE-862. Use an empty string or needs_classification when uncertain. Do not invent CWE ids.'),
      primary_cwe_name: stringProp('Primary CWE name when known; use an empty string to let Beale fill from its local catalog.'),
      alternate_cwe_ids_json: stringProp('JSON array of alternate CWE ids or objects with cwe_id/cwe_name; use [] when none.'),
      cwe_mapping_confidence: stringProp('CWE mapping confidence: low, medium, or high. Findings approaching disclosure should use medium or high only when justified.'),
      cwe_mapping_rationale: stringProp('Short rationale for the CWE mapping; use an empty string when no mapping is proposed.'),
      affected_assets_json: stringProp('JSON object describing affected assets or components; use {} when unknown'),
      affected_versions_json: stringProp('JSON object describing affected versions or commits; use {} when unknown'),
      impact: stringProp('Impact explanation'),
      verified_by_verifier_run_id: stringProp('Passing real verifier run id when state is verified or reportable; otherwise use an empty string')
    }),
    tool('verifier', 'Record a verifier contract and structured pass, fail, or inconclusive evidence state.', {
      hypothesis: stringProp('Hypothesis or finding identifier'),
      expectation: stringProp('Expected observation'),
      artifact_id: stringProp('Existing Beale artifact id that backs the expectation; use an empty string when not available. To inspect verifier output after execution, use the returned artifact_id, not the raw artifact_path.'),
      trace_event_id: stringProp('Trace event id that backs the expectation; use an empty string when not available'),
      verifier_script: stringProp('Shell script to execute in the active session sandbox; use an empty string to only declare the contract'),
      artifact_path: stringProp('Sandbox temporary path to collect after verifier execution; use an empty string when not needed. Beale will return a content-addressed artifact_id for later code_browser/resource_lookup reads.'),
      expected_stdout: stringProp('Substring expected in verifier stdout for pass; use an empty string when not needed')
    })
  ];
}

export class BealeToolRouter {
  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly executor: ExecutorManager | null = null,
    private readonly options: ProgramLookupOptions = {}
  ) {}

  public execute(context: CreatedRunContext, call: OpenAiFunctionCall): FunctionCallOutputItem {
    const args = parseArguments(call.argumentsJson);
    const result = this.executeInternal(context, call, args);
    return this.functionCallOutput(call, result);
  }

  public async executeAsync(context: CreatedRunContext, call: OpenAiFunctionCall): Promise<FunctionCallOutputItem> {
    const args = parseArguments(call.argumentsJson);
    const result = await this.executeInternalAsync(context, call, args);
    return this.functionCallOutput(call, result);
  }

  private functionCallOutput(call: OpenAiFunctionCall, result: ToolResult): FunctionCallOutputItem {
    return {
      type: 'function_call_output',
      call_id: call.callId,
      output: JSON.stringify(
        redactJsonForModel({
          status: result.status,
          summary: result.summary,
          trace_event_id: result.traceEventId,
          artifact_id: result.artifactId,
          payload: result.payload
        })
      )
    };
  }

  private async executeInternalAsync(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): Promise<ToolResult> {
    if (!isToolName(call.name)) {
      return this.recordError(context, call, args, `Unknown Beale tool requested: ${call.name}`);
    }

    const toolName = call.name;
    const destination = extractDestination(toolName, args);
    if (destination && !this.destinationAllowed(destination)) {
      return this.recordToolPolicyBlock(context, call, args, `Blocked out-of-scope tool destination: ${destination}`, {
        destination
      });
    }
    const policy = this.toolPolicy(toolName);

    const toolCallId = this.db.createToolCall({
      runId: context.run.id,
      attemptId: context.attempt.id,
      toolName,
      toolVersion: 'structured-tools-v1',
      input: {
        openaiCallId: call.callId,
        responseItemId: call.responseItemId ?? null,
        arguments: args,
        policy
      },
      status: 'completed',
      resultSummary: `Structured ${toolName} call accepted by Beale tool router.`,
      result: { toolName, normalizedInTrace: true },
      vmContextId: context.vmContext.id
    });

    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_call',
      source: 'model',
      summary: `OpenAI requested Beale tool: ${toolName}.`,
      payload: {
        openaiCallId: call.callId,
        responseItemId: call.responseItemId ?? null,
        arguments: args,
        policy
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });

    let result: ToolResult;
    try {
      result = await this.dispatchAsync(context, toolName, call, args);
    } catch (error) {
      result = {
        status: 'error',
        summary: `${toolName} failed: ${errorMessage(error)}`,
        payload: {
          observationBacked: false,
          error: errorMessage(error)
        }
      };
    }

    return this.finishToolResult(context, toolCallId, result);
  }

  private executeInternal(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    if (!isToolName(call.name)) {
      return this.recordError(context, call, args, `Unknown Beale tool requested: ${call.name}`);
    }

    const toolName = call.name;
    const destination = extractDestination(toolName, args);
    if (destination && !this.destinationAllowed(destination)) {
      return this.recordToolPolicyBlock(context, call, args, `Blocked out-of-scope tool destination: ${destination}`, {
        destination
      });
    }
    const policy = this.toolPolicy(toolName);

    const toolCallId = this.db.createToolCall({
      runId: context.run.id,
      attemptId: context.attempt.id,
      toolName,
      toolVersion: 'structured-tools-v1',
      input: {
        openaiCallId: call.callId,
        responseItemId: call.responseItemId ?? null,
        arguments: args,
        policy
      },
      status: 'completed',
      resultSummary: `Structured ${toolName} call accepted by Beale tool router.`,
      result: { toolName, normalizedInTrace: true },
      vmContextId: context.vmContext.id
    });

    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_call',
      source: 'model',
      summary: `OpenAI requested Beale tool: ${toolName}.`,
      payload: {
        openaiCallId: call.callId,
        responseItemId: call.responseItemId ?? null,
        arguments: args,
        policy
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });

    let result: ToolResult;
    try {
      result = this.dispatch(context, toolName, call, args);
    } catch (error) {
      result = {
        status: 'error',
        summary: `${toolName} failed: ${errorMessage(error)}`,
        payload: {
          observationBacked: false,
          error: errorMessage(error)
        }
      };
    }

    return this.finishToolResult(context, toolCallId, result);
  }

  private finishToolResult(context: CreatedRunContext, toolCallId: string, result: ToolResult): ToolResult {
    if (result.traceEventId) {
      this.db.linkToolCallTrace(toolCallId, result.traceEventId);
      return result;
    }
    const event = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: result.eventType ?? (result.artifactId ? 'artifact_created' : 'tool_result'),
      source: result.source ?? 'tool',
      summary: result.summary,
      payload: result.payload,
      artifactId: result.artifactId,
      toolCallId,
      vmContextId: context.vmContext.id
    });
    this.db.linkToolCallTrace(toolCallId, event.id);
    if (result.artifactId) {
      this.db.setArtifactProvenance(result.artifactId, event.id);
    }
    if (event.type === 'hypothesis_event' && typeof result.payload.hypothesisId === 'string') {
      this.db.setHypothesisTrace(result.payload.hypothesisId, event.id);
    }
    return { ...result, traceEventId: event.id };
  }

  private async dispatchAsync(context: CreatedRunContext, toolName: ToolName, call: OpenAiFunctionCall, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName === 'source') return this.materializeSourceAsync(context, args);
    if (toolName === 'program_lookup') return this.lookupProgramPolicy(args);
    if (toolName === 'python') return this.runPythonAsync(context, call, args);
    return this.dispatch(context, toolName, call, args);
  }

  private dispatch(context: CreatedRunContext, toolName: ToolName, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    switch (toolName) {
      case 'source':
        return this.materializeSource(context, args);
      case 'search':
        return this.searchScopedMaterial(context, args);
      case 'code_browser':
        return this.browseCode(context, call, args);
      case 'resource_lookup':
        return this.lookupRunResource(context, args);
      case 'program_lookup':
        return {
          status: 'error',
          summary: 'program_lookup requires asynchronous tool execution.',
          payload: {
            observationBacked: false,
            recoveryHint: 'Retry program_lookup through the OpenAI run engine or another async tool caller.'
          }
        };
      case 'python':
        return this.runPython(context, call, args);
      case 'debugger':
        return this.runDebuggerWrapper(context, call, args);
      case 'artifact':
        return this.preserveArtifact(args);
      case 'evidence':
        return this.recordEvidence(context, args);
      case 'hypothesis':
        return this.recordHypothesis(context, args);
      case 'finding':
        return this.recordFinding(context, args);
      case 'verifier':
        return this.recordVerifier(context, args);
    }
  }

  private programClaimCandidates(context: CreatedRunContext): ClaimCandidate[] {
    const hypotheses = this.db.listProgramHypothesesForRun(context.run.id);
    const hypothesesById = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]));
    const findings = this.db.listProgramFindingsForRun(context.run.id);
    return [
      ...findings.map((finding) => claimCandidateFromFinding(finding, finding.hypothesisId ? hypothesesById.get(finding.hypothesisId) ?? null : null)),
      ...hypotheses.map((hypothesis) => claimCandidateFromHypothesis(hypothesis))
    ];
  }

  private programFindingCandidates(context: CreatedRunContext): ClaimCandidate[] {
    const hypotheses = this.db.listProgramHypothesesForRun(context.run.id);
    const hypothesesById = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]));
    return this.db
      .listProgramFindingsForRun(context.run.id)
      .map((finding) => claimCandidateFromFinding(finding, finding.hypothesisId ? hypothesesById.get(finding.hypothesisId) ?? null : null));
  }

  private preferFindingAnchorForDuplicateReview(context: CreatedRunContext, review: DuplicateReview): DuplicateReview {
    if (review.outcome !== 'duplicate' || review.matchedEntityKind !== 'hypothesis' || !review.matchedEntityId) return review;
    const linkedFinding = this.db
      .listProgramFindingsForRun(context.run.id)
      .find((finding) => finding.hypothesisId === review.matchedEntityId && !negativeClaimState(finding.state));
    if (!linkedFinding) return review;
    return {
      ...review,
      matchedEntityKind: 'finding',
      matchedEntityId: linkedFinding.id,
      rationale: `${review.rationale} Anchored duplicate feedback to linked finding ${linkedFinding.id}.`,
      recommendedNextAction: `Do not create a new record. Add evidence to finding ${linkedFinding.id}, test a distinct variant, or investigate chaining.`
    };
  }

  private searchScopedMaterial(context: CreatedRunContext, args: Record<string, unknown>): ToolResult {
    const query = stringValue(args.query, '').trim();
    const targetHint = stringValue(args.target, '').trim();
    if (!query) {
      return {
        status: 'error',
        summary: 'Search requires a non-empty query.',
        payload: { observationBacked: false, error: 'missing_query' }
      };
    }

    const collection = this.collectScopedFiles(targetHint);
    const files = collection.files;
    const sourceCandidates = sourceRepositoryCandidates(this.db.getActiveScope());
    const queryPlan = buildSearchQueryPlan(query);
    const fileMatches: Array<Record<string, unknown>> = [];
    let skippedFiles = 0;

    for (const file of files) {
      if (fileMatches.length >= MAX_SEARCH_MATCHES) break;
      const loaded = readScopedText(file.path);
      if (!loaded) {
        skippedFiles += 1;
        continue;
      }
      const lines = loaded.text.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!lineMatchesSearchQuery(line, queryPlan)) continue;
        fileMatches.push({
          kind: 'file',
          path: file.path,
          assetId: file.assetId,
          assetKind: file.assetKind,
          line: loaded.binaryDerived ? null : index + 1,
          range: loaded.binaryDerived ? 'binary_strings' : `${index + 1}`,
          binaryDerived: loaded.binaryDerived,
          matchedBy: searchMatchDescription(line, queryPlan),
          snippet: trimSnippet(line)
        });
        if (fileMatches.length >= MAX_SEARCH_MATCHES) break;
      }
    }

    const artifactMatches = this.searchRunArtifacts(context, queryPlan, MAX_SEARCH_MATCHES);
    const metadataMatches = this.searchProjectMetadata(context, query, MAX_SEARCH_MATCHES);
    const semanticMatches = this.searchProjectSemantic(context, query, MAX_SEARCH_MATCHES);
    const directPhaseASeeds = this.selectPhaseASeedMatches({ fileMatches, artifactMatches, metadataMatches, semanticMatches, graphMatches: [] }, 24, queryPlan);
    const phaseAGraphMatches = this.searchProjectGraph(context, directPhaseASeeds, MAX_SEARCH_MATCHES);
    const phaseAGraphVariantMatches = this.searchProjectGraphVariants(context, [...directPhaseASeeds, ...phaseAGraphMatches], MAX_SEARCH_MATCHES);
    const phaseASeeds = this.selectPhaseASeedMatches(
      {
        fileMatches,
        artifactMatches,
        metadataMatches,
        semanticMatches,
        graphMatches: [...phaseAGraphMatches, ...phaseAGraphVariantMatches]
      },
      16,
      queryPlan
    );
    const sourceStructureSeeds = this.searchSourceStructureSeeds(context, phaseASeeds, 8);
    const sourceInventorySeeds = this.searchSourceInventorySeeds(context, phaseASeeds, 8);
    const phaseBSeeds = [...phaseASeeds, ...sourceStructureSeeds, ...sourceInventorySeeds];
    const phaseBGraphMatches = this.searchProjectGraph(context, phaseBSeeds, MAX_SEARCH_MATCHES);
    const phaseBGraphVariantMatches = this.searchProjectGraphVariants(context, [...phaseBSeeds, ...phaseBGraphMatches], MAX_SEARCH_MATCHES);
    const initialGraphMatches = [...phaseAGraphMatches, ...phaseAGraphVariantMatches, ...phaseBGraphMatches, ...phaseBGraphVariantMatches];
    const adaptiveFollowUp = this.adaptiveFollowUpSearch(context, queryPlan, {
      fileMatches,
      artifactMatches,
      metadataMatches,
      semanticMatches,
      graphMatches: initialGraphMatches
    });
    const combinedMetadataMatches = [...metadataMatches, ...adaptiveFollowUp.metadataMatches];
    const combinedSemanticMatches = [...semanticMatches, ...adaptiveFollowUp.semanticMatches];
    const graphMatches = [...initialGraphMatches, ...adaptiveFollowUp.graphMatches];
    const feedbackSummary = this.db.getProjectRetrievalFeedbackSummary(context.run.scopeVersionId);
    const searchAssembly = this.assembleRankedSearchMatches({
      fileMatches,
      artifactMatches,
      metadataMatches: combinedMetadataMatches,
      semanticMatches: combinedSemanticMatches,
      graphMatches,
      queryPlan,
      adaptiveFollowUp: adaptiveFollowUp.diagnostics,
      feedback: retrievalFeedbackContext(feedbackSummary)
    });
    const matches = searchAssembly.matches;
    const inventorySummary = this.db.getProjectInventorySummary(context.run.scopeVersionId);
    const structureSummary = this.db.getProjectStructureSummary(context.run.scopeVersionId);
    const graphSummary = this.db.getProjectGraphSummary(context.run.scopeVersionId);
    const semanticSummary = this.db.getProjectSemanticSummary(context.run.scopeVersionId);
    const sourceHint =
      files.length === 0 && collection.unmaterializedSource
        ? `Scoped repository ${collection.unmaterializedSource.url} is not materialized. Use the source tool, then retry search.`
        : files.length === 0 && sourceCandidates.length > 0
          ? 'No local source files were available for this target. Use the source tool to materialize an in-scope repository, or search with an empty target.'
          : null;
    const missingReasons = this.retrievalMissingReasons({
      queryPlan,
      diagnostics: searchAssembly.diagnostics,
      inventorySummary,
      structureSummary,
      graphSummary,
      semanticSummary
    });
    const retrievalDiagnostics = {
      ...searchAssembly.diagnostics,
      feedback: {
        readPathCount: Object.keys(feedbackSummary.readPathCounts).length,
        verifiedEntityCount: feedbackSummary.verifiedEntityKeys.length,
        correctedNegativeEntityCount: feedbackSummary.correctedNegativeEntityKeys.length
      },
      missingReasons,
      operationalHints: this.retrievalOperationalHints({
        queryPlan,
        diagnostics: searchAssembly.diagnostics,
        inventorySummary,
        structureSummary,
        graphSummary,
        semanticSummary,
        sourceHint,
        missingReasons
      })
    };

    const summary =
      sourceHint ??
      `Examined ${files.length} file${files.length === 1 ? '' : 's'} and returned ${matches.length} match${matches.length === 1 ? '' : 'es'}.`;

    return {
      status: 'success',
      summary,
      payload: {
        observationBacked: true,
        simulated: false,
        query,
        queryMode: queryPlan.mode,
        queryTerms: queryPlan.terms,
        queryIntents: queryPlan.intents,
        targetHint,
        targetResolution: collection.targetResolution,
        rootsConsidered: collection.roots.map((root) => ({
          path: root.path,
          assetId: root.asset.id,
          assetKind: root.asset.kind,
          reason: root.reason
        })),
        filesConsidered: files.length,
        skippedFiles,
        metadataMatches: searchAssembly.metadataMatches,
        semanticMatches: searchAssembly.semanticMatches,
        graphMatches: searchAssembly.graphMatches,
        graphVariantMatches: searchAssembly.graphVariantMatches,
        retrievalDiagnostics,
        projectInventory: inventorySummary,
        projectStructure: structureSummary,
        projectGraph: graphSummary,
        projectSemantic: semanticSummary,
        sourceRepositoriesAvailable: this.sourceRepositoryStatuses(sourceCandidates),
        sourceAcquisitionHint: sourceHint,
        matches
      }
    };
  }

  private materializeSource(context: CreatedRunContext, args: Record<string, unknown>): ToolResult {
    const repository = stringValue(args.repository, '').trim();
    const ref = stringValue(args.ref, '').trim();
    const scope = this.db.getActiveScope();
    const selection = selectSourceRepository(scope, repository);
    if (!selection.candidate) {
      return {
        status: 'error',
        summary:
          selection.reason === 'ambiguous'
            ? 'Source repository request was ambiguous; choose one scoped repository URL.'
            : 'Source repository is not recorded in active program scope.',
        payload: {
          observationBacked: false,
          requestedRepository: repository,
          reason: selection.reason,
          availableRepositories: selection.candidates.map((candidate) => ({ label: candidate.label, url: candidate.url }))
        }
      };
    }

    const materialized = materializeGitRepository(selection.candidate, this.db.getDatabasePath(), ref);
    const nextScope = this.ensureLocalSourceInScope(selection.candidate.sourceAssetId, selection.candidate.sensitivity, materialized.localPath, materialized.repositoryUrl, materialized.head);

    return {
      status: 'success',
      summary: `Source repository materialized for scoped analysis: ${selection.candidate.url}.`,
      payload: {
        observationBacked: true,
        simulated: false,
        targetExecution: false,
        hostSetup: true,
        repositoryUrl: materialized.repositoryUrl,
        localPath: materialized.localPath,
        cloned: materialized.cloned,
        ref: materialized.ref,
        head: materialized.head,
        sourceAssetId: selection.candidate.sourceAssetId,
        activeScopeVersion: nextScope.version,
        indexingDeferred: true,
        indexingHint: 'Project inventory, structure, semantic, and graph indexing are deferred after source materialization; search can scan the materialized source directly until indexing catches up.',
        searchNext: true
      }
    };
  }

  private async materializeSourceAsync(context: CreatedRunContext, args: Record<string, unknown>): Promise<ToolResult> {
    const repository = stringValue(args.repository, '').trim();
    const ref = stringValue(args.ref, '').trim();
    const scope = this.db.getActiveScope();
    const selection = selectSourceRepository(scope, repository);
    if (!selection.candidate) {
      return {
        status: 'error',
        summary:
          selection.reason === 'ambiguous'
            ? 'Source repository request was ambiguous; choose one scoped repository URL.'
            : 'Source repository is not recorded in active program scope.',
        payload: {
          observationBacked: false,
          requestedRepository: repository,
          reason: selection.reason,
          availableRepositories: selection.candidates.map((candidate) => ({ label: candidate.label, url: candidate.url }))
        }
      };
    }

    const materialized = await materializeGitRepositoryAsync(selection.candidate, this.db.getDatabasePath(), ref);
    const nextScope = this.ensureLocalSourceInScope(selection.candidate.sourceAssetId, selection.candidate.sensitivity, materialized.localPath, materialized.repositoryUrl, materialized.head);

    return {
      status: 'success',
      summary: `Source repository materialized for scoped analysis: ${selection.candidate.url}.`,
      payload: {
        observationBacked: true,
        simulated: false,
        targetExecution: false,
        hostSetup: true,
        repositoryUrl: materialized.repositoryUrl,
        localPath: materialized.localPath,
        cloned: materialized.cloned,
        ref: materialized.ref,
        head: materialized.head,
        sourceAssetId: selection.candidate.sourceAssetId,
        activeScopeVersion: nextScope.version,
        indexingDeferred: true,
        indexingHint: 'Project inventory, structure, semantic, and graph indexing are deferred after source materialization; search can scan the materialized source directly until indexing catches up.',
        searchNext: true
      }
    };
  }

  private browseCode(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    const requestedPath = stringValue(args.path, '').trim();
    const symbol = stringValue(args.symbol, '').trim();
    if (!requestedPath) {
      return {
        status: 'error',
        summary: 'Code browser requires a scoped file path or artifact id.',
        payload: { observationBacked: false, error: 'missing_path' }
      };
    }

    const requestedResourceKind = inferResourceLookupKind(requestedPath);
    const artifactTarget = this.artifactReadTarget(context, requestedPath);
    if (!artifactTarget && requestedResourceKind && requestedResourceKind !== 'artifact') {
      return {
        status: 'error',
        summary: `Code browser cannot read ${resourceKindLabel(requestedResourceKind)} ids; use resource_lookup for Beale resource state.`,
        payload: {
          observationBacked: false,
          error: 'unsupported_resource_id_for_code_browser',
          resourceId: requestedPath,
          resourceKind: requestedResourceKind,
          recoveryHint: `Call resource_lookup with resource_id "${requestedPath}" and kind "${requestedResourceKind}".`
        }
      };
    }
    if (!artifactTarget && requestedResourceKind === 'artifact') {
      return {
        status: 'error',
        summary: 'Code browser artifact id was not found in this run.',
        payload: {
          observationBacked: false,
          error: 'unknown_artifact',
          artifactId: requestedPath,
          recoveryHint: 'Use resource_lookup with kind artifact or query the current run resources to find the correct artifact id.'
        }
      };
    }

    const filePath = artifactTarget?.path ?? resolve(requestedPath);
    if (!artifactTarget && !this.isScopedLocalPath(filePath)) {
      this.ensureExistingCheckoutPathInScope(filePath);
    }
    if (!artifactTarget && !this.isScopedLocalPath(filePath)) {
      return this.recordToolPolicyBlock(context, call, args, 'Path is outside the active program scope.', {
        path: requestedPath,
        reason: 'path_outside_active_scope',
        recoveryHint: requestedPath.startsWith('/tmp/')
          ? 'If this is a verifier or Python artifact_path, use the returned Beale artifact_id with code_browser or resource_lookup instead of the raw /tmp path.'
          : 'Use search to locate an in-scope source path, or use resource_lookup when the value is a Beale resource id.'
      });
    }

    const stat = safeStat(filePath);
    if (!stat) {
      return {
        status: 'error',
        summary: artifactTarget ? 'Code browser artifact content is missing from the artifact store.' : 'Code browser path was not found in scoped source.',
        payload: {
          observationBacked: false,
          path: requestedPath,
          sourcePath: filePath,
          error: artifactTarget ? 'artifact_content_missing' : 'path_not_found',
          recoveryHint: artifactTarget
            ? 'The artifact record exists, but its content file is missing; use resource_lookup to inspect artifact metadata or rerun the producing tool.'
            : 'Search scoped source for the file name, symbol, or nearby component, then retry code_browser with a returned path.'
        }
      };
    }
    if (stat.isDirectory()) {
      return {
        status: 'error',
        summary: 'Code browser received a directory path, not a file.',
        payload: {
          observationBacked: false,
          path: requestedPath,
          sourcePath: filePath,
          error: 'directory_not_file',
          recoveryHint: 'Use search with the directory as target to find candidate files, then call code_browser on a specific file.'
        }
      };
    }
    if (!stat.isFile()) {
      return {
        status: 'error',
        summary: 'Code browser can only read regular files and Beale artifacts.',
        payload: {
          observationBacked: false,
          path: requestedPath,
          sourcePath: filePath,
          error: 'unsupported_path_type',
          recoveryHint: 'Use search to locate a regular source or text artifact file.'
        }
      };
    }

    const requestedRange = requestedLineRangeFromArgs(args);
    const structureEntity = !artifactTarget && symbol ? this.db.findProjectStructureEntity(context.run.scopeVersionId, filePath, symbol, { refreshInventory: false }) : null;
    const structureRange = structureEntity && !requestedRange ? requestedLineRangeFromProjectStructureEntity(structureEntity) : null;
    const selection = readCodeBrowserText(filePath, symbol, requestedRange ?? structureRange);
    if (!selection) {
      const readFailure = codeBrowserReadFailure(filePath, stat.size);
      return {
        status: 'error',
        summary: readFailure.summary,
        payload: {
          observationBacked: false,
          path: requestedPath,
          sourcePath: filePath,
          fileSizeBytes: stat.size,
          error: readFailure.error,
          recoveryHint: readFailure.recoveryHint
        }
      };
    }

    const selected = selection.text ? selection.text.split(/\r?\n/) : [];
    const startLine = selection.lineStart ?? 1;
    const endLine = selection.lineEnd ?? Math.max(startLine, startLine + selected.length - 1);
    const excerpt = selected.map((line, index) => `${startLine + index}: ${line}`).join('\n').slice(0, MAX_EXCERPT_CHARS);
    const structureNavigation = artifactTarget ? null : this.projectStructureNavigation(context, filePath, symbol, structureEntity, selection);

    return {
      status: 'success',
      summary: `Code browser returned ${Math.max(0, endLine - startLine + 1)} bounded line${endLine === startLine ? '' : 's'}${structureEntity ? ' from the structural index.' : '.'}`,
      payload: {
        observationBacked: true,
        simulated: false,
        path: artifactTarget?.artifactId ?? filePath,
        sourcePath: filePath,
        symbol,
        binaryDerived: selection.binaryDerived,
        contentHash: selection.contentHash,
        contentHashScope: selection.contentHashScope,
        lineStart: selection.binaryDerived ? null : selection.lineStart,
        lineEnd: selection.binaryDerived ? null : selection.lineEnd,
        requestedLineStart: requestedRange?.start ?? null,
        requestedLineEnd: requestedRange?.requestedEnd ?? null,
        rangeCapped: requestedRange?.capped ?? false,
        largeFile: selection.largeFile,
        nextLineStart: selection.nextLineStart,
        truncated: selection.truncated || excerpt.length >= MAX_EXCERPT_CHARS,
        structureNavigation,
        excerpt
      }
    };
  }

  private lookupRunResource(context: CreatedRunContext, args: Record<string, unknown>): ToolResult {
    const resourceId = stringValue(args.resource_id, '').trim();
    const query = stringValue(args.query, '').trim();
    const requestedKind = normalizeResourceLookupKind(stringValue(args.kind, 'any'));
    const detail = this.db.getRunDetail(context.run.id);
    const resources = runResourceLookupRecords(detail);
    const counts = resourceCounts(resources);
    const inferredKind = resourceId ? inferResourceLookupKind(resourceId) : null;
    const effectiveKind = requestedKind === 'any' && inferredKind ? inferredKind : requestedKind;
    const kindFiltered = resources.filter((resource) => effectiveKind === 'any' || resource.kind === effectiveKind);

    let matches: ResourceLookupRecord[];
    if (resourceId) {
      matches = kindFiltered.filter((resource) => resource.id === resourceId);
    } else if (query) {
      matches = kindFiltered.filter((resource) => resourceMatchesQuery(resource, query));
    } else {
      matches = kindFiltered.slice().sort(compareResourceRecency).slice(0, 20);
    }

    const limitedMatches = matches.slice(0, 20).map((resource) => resource.payload);
    const exactMiss = Boolean(resourceId && matches.length === 0);
    return {
      status: exactMiss ? 'error' : 'success',
      summary: exactMiss
        ? `No current-run Beale resource found for id ${resourceId}.`
        : resourceId
          ? `Resource lookup found ${matches[0]?.kind ?? 'resource'} ${resourceId}.`
          : `Resource lookup returned ${limitedMatches.length} of ${matches.length} matching current-run resource${matches.length === 1 ? '' : 's'}.`,
      payload: {
        observationBacked: true,
        runId: context.run.id,
        resourceId: resourceId || null,
        requestedKind,
        effectiveKind,
        query: query || null,
        totalMatches: matches.length,
        returnedMatches: limitedMatches.length,
        counts,
        matches: limitedMatches,
        recoveryHint: exactMiss
          ? 'Use resource_lookup with kind any and a text query, or inspect current artifacts/evidence/verifier runs by kind. Do not search target source code for Beale resource ids.'
          : 'Use code_browser with an artifact id when you need artifact content. Use resource_lookup for verifier_run, evidence, finding, hypothesis, and trace metadata.'
      }
    };
  }

  private async lookupProgramPolicy(args: Record<string, unknown>): Promise<ToolResult> {
    const provider = normalizeProgramLookupProvider(stringValue(args.provider, 'auto'));
    const requestedIdentifier = stringValue(args.identifier, '').trim();
    const query = stringValue(args.query, '').trim();
    const activeHackerOneHint = this.activeHackerOneProgramLookupHint();
    const useActiveHackerOneHint = shouldUseActiveHackerOneHint(provider, requestedIdentifier, activeHackerOneHint);
    const identifier = useActiveHackerOneHint && activeHackerOneHint ? activeHackerOneHint.sourceUrl || activeHackerOneHint.handle : requestedIdentifier;
    if (!identifier) {
      return {
        status: 'error',
        summary: 'Program lookup requires an identifier or URL, or an active program imported from a supported provider.',
        payload: {
          observationBacked: false,
          error: 'missing_program_identifier',
          activeProgramProviderHint: activeHackerOneHint ? { provider: 'hackerone', handle: activeHackerOneHint.handle, sourceUrl: activeHackerOneHint.sourceUrl } : null
        }
      };
    }
    const detected = useActiveHackerOneHint ? 'hackerone' : provider === 'auto' ? detectProgramLookupProvider(identifier) : provider;
    const fetcher = this.options.fetch ?? fetch;
    if (detected === 'hackerone') {
      return this.lookupHackerOneProgramPolicy(fetcher, identifier, query, {
        requestedIdentifier,
        activeProgramHintUsed: useActiveHackerOneHint,
        activeProgramHint: activeHackerOneHint
      });
    }
    return this.lookupGenericProgramPolicy(fetcher, detected, identifier, query);
  }

  private activeHackerOneProgramLookupHint(): { handle: string; sourceUrl: string; programName: string } | null {
    const scope = this.db.getActiveScope();
    for (const asset of scope.assets) {
      if (asset.attributes?.source !== 'hackerone') continue;
      const handle =
        stringValue(asset.attributes.hackerOneHandle, '') ||
        stringValue(asset.attributes.hackeroneHandle, '') ||
        stringValue(asset.attributes.hackerOneProgramHandle, '') ||
        hackerOneHandleFromUrl(stringValue(asset.attributes.hackerOneSourceUrl, '') || stringValue(asset.attributes.sourceUrl, '') || stringValue(asset.attributes.url, ''));
      if (!handle) continue;
      const sourceUrl =
        stringValue(asset.attributes.hackerOneSourceUrl, '') ||
        stringValue(asset.attributes.sourceUrl, '') ||
        `https://hackerone.com/${handle}`;
      return { handle, sourceUrl, programName: scope.programName };
    }
    const rulesHandle = hackerOneHandleFromUrl(scope.rulesMarkdown);
    return rulesHandle ? { handle: rulesHandle, sourceUrl: `https://hackerone.com/${rulesHandle}`, programName: scope.programName } : null;
  }

  private async lookupHackerOneProgramPolicy(
    fetcher: ToolFetch,
    identifier: string,
    query: string,
    options: { requestedIdentifier?: string; activeProgramHintUsed?: boolean; activeProgramHint?: { handle: string; sourceUrl: string; programName: string } | null } = {}
  ): Promise<ToolResult> {
    const handle = normalizeHackerOneProgramIdentifier(identifier);
    if (!handle) {
      return {
        status: 'error',
        summary: 'HackerOne lookup requires a handle or HackerOne program URL.',
        payload: {
          observationBacked: false,
          provider: 'hackerone',
          error: 'missing_hackerone_handle'
        }
      };
    }
    const response = await fetcher('https://hackerone.com/graphql', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'Beale/0.1 program_lookup'
      },
      body: JSON.stringify({
        query: PROGRAM_LOOKUP_HACKERONE_QUERY,
        variables: { handle }
      })
    });
    if (!response.ok) {
      return {
        status: 'error',
        summary: `HackerOne program lookup failed with HTTP ${response.status}.`,
        payload: {
          observationBacked: false,
          provider: 'hackerone',
          handle,
          error: `http_${response.status}`
        }
      };
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    if (errors.length > 0) {
      return {
        status: 'error',
        summary: 'HackerOne program lookup returned errors.',
        payload: {
          observationBacked: false,
          provider: 'hackerone',
          handle,
          errors: errors.slice(0, 5)
        }
      };
    }
    const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? (payload.data as Record<string, unknown>) : {};
    const team = data.team && typeof data.team === 'object' && !Array.isArray(data.team) ? (data.team as Record<string, unknown>) : null;
    if (!team) {
      return {
        status: 'error',
        summary: `HackerOne program not found: ${handle}.`,
        payload: {
          observationBacked: false,
          provider: 'hackerone',
          handle,
          error: 'program_not_found'
        }
      };
    }
    const scopeContainer = team.structured_scopes && typeof team.structured_scopes === 'object' && !Array.isArray(team.structured_scopes) ? (team.structured_scopes as Record<string, unknown>) : {};
    const scopeNodes = Array.isArray(scopeContainer.nodes) ? scopeContainer.nodes.filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === 'object' && !Array.isArray(node)) : [];
    const assets = scopeNodes.slice(0, 120).map(programLookupHackerOneAsset).filter((asset): asset is Record<string, unknown> => Boolean(asset));
    const queryMatches = programLookupQueryMatches(query, assets, [stringValue(team.name, ''), stringValue(team.handle, ''), stringValue(team.url, '')]);
    const inScopeCount = assets.filter((asset) => asset.direction === 'in_scope').length;
    const outOfScopeCount = assets.filter((asset) => asset.direction === 'out_of_scope').length;
    return {
      status: 'success',
      summary: `HackerOne program lookup returned ${assets.length} structured scope asset${assets.length === 1 ? '' : 's'} for ${stringValue(team.name, handle)}.`,
      payload: {
        observationBacked: true,
        provider: 'hackerone',
        lookupMethod: 'public_graphql',
        checkedAt: new Date().toISOString(),
        requestedIdentifier: options.requestedIdentifier ?? identifier,
        activeProgramHintUsed: options.activeProgramHintUsed === true,
        activeProgramHint: options.activeProgramHint ? { handle: options.activeProgramHint.handle, sourceUrl: options.activeProgramHint.sourceUrl, programName: options.activeProgramHint.programName } : null,
        handle: stringValue(team.handle, handle),
        sourceUrl: stringValue(team.url, `https://hackerone.com/${handle}`),
        programName: stringValue(team.name, handle),
        submissionState: stringValue(team.submission_state, ''),
        totalScopeCount: numberValue(scopeContainer.total_count, assets.length),
        returnedScopeCount: assets.length,
        inScopeCount,
        outOfScopeCount,
        query,
        queryMatches,
        assets,
        operationalGuidance: [
          'Use this result as the bounded scope-verification artifact for this target.',
          'Do not scrape HackerOne JavaScript unless this lookup is unavailable or lacks the needed public fields.',
          'Move to target mapping or hypothesis testing after recording scope evidence.'
        ]
      }
    };
  }

  private async lookupGenericProgramPolicy(fetcher: ToolFetch, provider: string, identifier: string, query: string): Promise<ToolResult> {
    const url = normalizeProgramPolicyUrl(provider, identifier);
    if (!url) {
      return {
        status: 'error',
        summary: 'Program lookup requires a URL for this provider.',
        payload: {
          observationBacked: false,
          provider,
          error: 'missing_program_url'
        }
      };
    }
    const response = await fetcher(url, {
      method: 'GET',
      headers: {
        accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
        'user-agent': 'Beale/0.1 program_lookup'
      }
    });
    if (!response.ok) {
      return {
        status: 'error',
        summary: `Program policy lookup failed with HTTP ${response.status}.`,
        payload: {
          observationBacked: false,
          provider,
          sourceUrl: url,
          error: `http_${response.status}`
        }
      };
    }
    const contentType = response.headers.get('content-type') ?? '';
    const body = (await response.text()).slice(0, 240_000);
    const extracted = extractProgramPolicyPage(body, url, contentType);
    const queryMatches = programLookupQueryMatches(query, extracted.assets, [extracted.title, extracted.description, url]);
    return {
      status: 'success',
      summary: `Program policy lookup fetched ${provider} policy page${extracted.title ? `: ${extracted.title}` : ''}.`,
      payload: {
        observationBacked: true,
        provider,
        lookupMethod: 'bounded_policy_url_fetch',
        checkedAt: new Date().toISOString(),
        sourceUrl: url,
        title: extracted.title,
        description: extracted.description,
        query,
        queryMatches,
        assets: extracted.assets,
        policyLinks: extracted.policyLinks,
        notableText: extracted.notableText,
        operationalGuidance: [
          'Use this result as bounded public policy context, not as proof that every listed-looking host is in scope.',
          'If the page does not expose structured scope, validate target eligibility manually from the returned policy text before live testing.',
          'Do not scrape application JavaScript for program metadata unless this policy page points to a documented data source.'
        ]
      }
    };
  }

  private runPython(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    const script = stringValue(args.script, '').trim();
    if (!script) {
      return {
        status: 'error',
        summary: 'Python requires a non-empty guest script.',
        payload: { observationBacked: false, error: 'missing_script' }
      };
    }
    const artifactPath = stringValue(args.artifact_path, '').trim();
    const networkProfile = guestToolNetworkProfile(context);
    const execution = this.executeInActiveSandbox(context, {
      operationKind: 'python',
      command: ['python3', '-c', script],
      cwd: '/workspace',
      env: {
        BEALE_TARGET_PATH: '/workspace/target'
      },
      timeoutMs: 60_000,
      networkProfile,
      expectedOutput: artifactPath ? 'artifact' : 'summary'
    }, artifactPath || null);

    return this.pythonExecutionResult(context, args, script, execution);
  }

  private async runPythonAsync(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): Promise<ToolResult> {
    const script = stringValue(args.script, '').trim();
    if (!script) {
      return {
        status: 'error',
        summary: 'Python requires a non-empty guest script.',
        payload: { observationBacked: false, error: 'missing_script' }
      };
    }
    const artifactPath = stringValue(args.artifact_path, '').trim();
    const networkProfile = guestToolNetworkProfile(context);
    const execution = await this.executeInActiveSandboxAsync(context, {
      operationKind: 'python',
      command: ['python3', '-c', script],
      cwd: '/workspace',
      env: {
        BEALE_TARGET_PATH: '/workspace/target'
      },
      timeoutMs: 60_000,
      networkProfile,
      expectedOutput: artifactPath ? 'artifact' : 'summary'
    }, artifactPath || null);

    return this.pythonExecutionResult(context, args, script, execution);
  }

  private pythonExecutionResult(context: CreatedRunContext, args: Record<string, unknown>, script: string, execution: GuestToolResult): ToolResult {
    return {
      status: execution.result.status === 'success' ? 'success' : 'error',
      summary: `${execution.hostExecution ? 'Host' : 'Guest'} python operation finished with ${execution.result.status}.`,
      artifactId: execution.artifactId ?? undefined,
      payload: {
        observationBacked: true,
        simulated: false,
        hostExecution: execution.hostExecution,
        executionSubstrate: execution.executionSubstrate,
        task: stringValue(args.task, ''),
        scriptHash: createHash('sha256').update(script).digest('hex'),
        status: execution.result.status,
        exitCode: execution.result.exitCode,
        signal: execution.result.signal,
        durationMs: execution.result.durationMs,
        stdoutSummary: execution.result.stdoutSummary,
        stderrSummary: execution.result.stderrSummary,
        structured: execution.result.structured,
        candidateArtifactCount: execution.result.candidateArtifacts.length,
        exportedArtifactId: execution.artifactId,
        importedHostPath: execution.importedHostPath,
        hostCwd: execution.hostCwd ?? null,
        hostTargetPath: execution.hostTargetPath ?? null,
        hostArtifactPath: execution.hostArtifactPath ?? null,
        requestedNetworkProfile: execution.requestedNetworkProfile,
        networkProfile: execution.networkProfile,
        runNetworkProfile: normalizeNetworkProfile(context.run.networkProfile)
      }
    };
  }

  private runDebuggerWrapper(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    const operation = stringValue(args.operation, 'gdb_probe');
    const target = this.sandboxPathForContext(context, stringValue(args.target, '/workspace/target'));
    const inputPath = this.sandboxPathForContext(context, stringValue(args.input_path, '').trim());
    const transcriptPath = '/tmp/beale-debugger-transcript.txt';
    const shellCommand = [
      'set -eu',
      'transcript="${BEALE_DEBUGGER_TRANSCRIPT:-/tmp/beale-debugger-transcript.txt}"',
      'operation="${BEALE_DEBUG_OPERATION:-gdb_probe}"',
      'target="${BEALE_DEBUG_TARGET:-/workspace/target}"',
      'input_path="${BEALE_DEBUG_INPUT_PATH:-}"',
      ': > "$transcript"',
      'if ! command -v gdb >/dev/null 2>&1; then',
      '  echo "BEALE_DEBUGGER_GDB_UNAVAILABLE gdb unavailable in guest image" | tee -a "$transcript"',
      '  exit 127',
      'fi',
      'if [ ! -e "$target" ]; then',
      '  echo "BEALE_DEBUGGER_TARGET_MISSING $target" | tee -a "$transcript"',
      '  exit 2',
      'fi',
      'status=0',
      'if [ "$operation" = "crash_summary" ] || [ "$operation" = "run" ]; then',
      '  if [ -n "$input_path" ]; then',
      '    gdb --batch -ex "set pagination off" -ex run -ex bt -ex "info registers" --args "$target" "$input_path" > "$transcript" 2>&1 || status=$?',
      '  else',
      '    gdb --batch -ex "set pagination off" -ex run -ex bt -ex "info registers" --args "$target" > "$transcript" 2>&1 || status=$?',
      '  fi',
      'else',
      '  gdb --batch -ex "set pagination off" -ex "file $target" -ex "info files" > "$transcript" 2>&1 || status=$?',
      'fi',
      'sed -n "1,200p" "$transcript"',
      'exit "$status"'
    ].join('\n');

    const networkProfile = guestToolNetworkProfile(context);
    const execution = this.executeInActiveSandbox(context, {
      operationKind: 'shell',
      command: ['sh', '-lc', shellCommand],
      cwd: '/workspace',
      env: {
        BEALE_DEBUG_OPERATION: operation,
        BEALE_DEBUG_TARGET: target,
        BEALE_DEBUG_INPUT_PATH: inputPath,
        BEALE_DEBUGGER_TRANSCRIPT: transcriptPath
      },
      timeoutMs: 30_000,
      networkProfile,
      expectedOutput: 'summary'
    }, transcriptPath);

    const debuggerSummary = parseDebuggerSummary(execution.result.stdoutSummary, execution.result.stderrSummary, execution.result.exitCode);
    const wrapperSucceeded = execution.result.status === 'success' && debuggerSummary.gdbAvailable;

    return {
      status: wrapperSucceeded ? 'success' : 'error',
      summary: `${execution.hostExecution ? 'Host' : 'Guest'} debugger wrapper operation finished with ${execution.result.status}.`,
      artifactId: execution.artifactId ?? undefined,
      payload: {
        observationBacked: true,
        simulated: false,
        hostExecution: execution.hostExecution,
        executionSubstrate: execution.executionSubstrate,
        wrapper: 'gdb_batch_probe',
        operation,
        target,
        inputPath,
        status: execution.result.status,
        exitCode: execution.result.exitCode,
        stdoutSummary: execution.result.stdoutSummary,
        stderrSummary: execution.result.stderrSummary,
        structured: execution.result.structured,
        debugger: debuggerSummary,
        exportedArtifactId: execution.artifactId,
        importedHostPath: execution.importedHostPath,
        hostCwd: execution.hostCwd ?? null,
        hostTargetPath: execution.hostTargetPath ?? null,
        hostArtifactPath: execution.hostArtifactPath ?? null,
        requestedNetworkProfile: execution.requestedNetworkProfile,
        networkProfile: execution.networkProfile,
        runNetworkProfile: normalizeNetworkProfile(context.run.networkProfile)
      }
    };
  }

  private preserveArtifact(args: Record<string, unknown>): ToolResult {
    const name = stringValue(args.name, 'beale-artifact.txt');
    const content = stringValue(args.content, '');
    const kind = stringValue(args.kind, 'model_generated_artifact');
    const buffer = Buffer.from(content, 'utf8');
    if (buffer.byteLength > MAX_MODEL_ARTIFACT_BYTES) {
      return {
        status: 'error',
        summary: 'Artifact content exceeded the model-provided artifact size bound.',
        payload: {
          observationBacked: false,
          name,
          sizeBytes: buffer.byteLength,
          maxBytes: MAX_MODEL_ARTIFACT_BYTES
        }
      };
    }

    const artifact = this.db.createArtifact({
      kind,
      mimeType: 'text/plain',
      sensitivity: 'internal',
      modelVisible: true,
      source: 'model_generated',
      metadata: {
        name,
        openaiToolCall: true,
        observationBacked: false,
        durableEvidenceRequiresVerifier: true
      },
      content: buffer
    });

    return {
      status: 'success',
      summary: `Artifact tool preserved content-addressed artifact: ${name}.`,
      artifactId: artifact.id,
      payload: {
        observationBacked: false,
        simulated: false,
        claimStatus: 'model_generated',
        artifactId: artifact.id,
        sha256: artifact.sha256,
        relativePath: artifact.relativePath,
        name,
        kind
      }
    };
  }

  private recordEvidence(context: CreatedRunContext, args: Record<string, unknown>): ToolResult {
    const detail = this.db.getRunDetail(context.run.id);
    const hypothesisId = nonEmptyStringValue(args.hypothesis_id);
    const findingId = nonEmptyStringValue(args.finding_id);
    const artifactId = nonEmptyStringValue(args.artifact_id);
    const traceEventId = nonEmptyStringValue(args.trace_event_id);
    const verifierRunId = nonEmptyStringValue(args.verifier_run_id);
    const summary = stringValue(args.summary, '').trim() || 'Evidence recorded by model.';
    const kind = stringValue(args.kind, 'evidence').trim() || 'evidence';

    if (hypothesisId && !detail.hypotheses.some((hypothesis) => hypothesis.id === hypothesisId)) {
      return { status: 'error', summary: 'Evidence references an unknown hypothesis.', payload: { observationBacked: false, error: 'unknown_hypothesis', hypothesisId } };
    }
    if (findingId && !detail.findings.some((finding) => finding.id === findingId)) {
      return { status: 'error', summary: 'Evidence references an unknown finding.', payload: { observationBacked: false, error: 'unknown_finding', findingId } };
    }
    if (artifactId && !detail.artifacts.some((artifact) => artifact.id === artifactId)) {
      return { status: 'error', summary: 'Evidence references an unknown artifact.', payload: { observationBacked: false, error: 'unknown_artifact', artifactId } };
    }
    const traceEvent = traceEventId ? detail.traceEvents.find((event) => event.id === traceEventId) ?? null : null;
    if (traceEventId && !traceEvent) {
      return { status: 'error', summary: 'Evidence references an unknown trace event.', payload: { observationBacked: false, error: 'unknown_trace_event', traceEventId } };
    }
    if (traceEvent && traceEvent.source === 'model' && !traceEvent.artifactId) {
      return { status: 'error', summary: 'Evidence cannot be backed only by a model message.', payload: { observationBacked: false, error: 'model_trace_not_evidence', traceEventId } };
    }
    if (verifierRunId && !detail.verifierRuns.some((run) => run.id === verifierRunId)) {
      return { status: 'error', summary: 'Evidence references an unknown verifier run.', payload: { observationBacked: false, error: 'unknown_verifier_run', verifierRunId } };
    }
    if (!artifactId && !traceEventId && !verifierRunId) {
      return { status: 'error', summary: 'Evidence requires an artifact, trace event, or verifier run reference.', payload: { observationBacked: false, error: 'missing_evidence_reference' } };
    }

    const evidence = this.db.createEvidence({
      runId: context.run.id,
      hypothesisId,
      findingId,
      kind,
      summary,
      artifactId,
      observationTraceEventId: traceEventId,
      verifierRunId
    });

    return {
      status: 'success',
      summary: `Evidence recorded: ${summaryForTitle(summary)}.`,
      eventType: 'artifact_created',
      source: 'tool',
      payload: {
        observationBacked: true,
        evidenceId: evidence.id,
        kind: evidence.kind,
        summary: evidence.summary,
        hypothesisId,
        findingId,
        artifactId,
        traceEventId,
        verifierRunId
      }
    };
  }

  private recordHypothesis(context: CreatedRunContext, args: Record<string, unknown>): ToolResult {
    const detail = this.db.getRunDetail(context.run.id);
    const hypothesisId = nonEmptyStringValue(args.hypothesis_id);
    const existing = hypothesisId ? detail.hypotheses.find((hypothesis) => hypothesis.id === hypothesisId) ?? null : null;
    if (hypothesisId && !existing) {
      return { status: 'error', summary: 'Hypothesis update references an unknown hypothesis.', payload: { observationBacked: false, error: 'unknown_hypothesis', hypothesisId } };
    }

    const state = stringValue(args.state, existing?.state ?? 'needs_evidence').trim() || existing?.state || 'needs_evidence';
    const title = stringValue(args.title, existing?.title ?? '').trim() || existing?.title || 'Untitled hypothesis';
    const descriptionMarkdown = stringValue(args.description, existing?.descriptionMarkdown ?? '').trim() || existing?.descriptionMarkdown || 'No description provided.';
    const component = stringValue(args.component, existing?.component ?? '').trim() || existing?.component || 'Unknown component';
    const bugClass = stringValue(args.bug_class, existing?.bugClass ?? '').trim() || existing?.bugClass || 'unclassified';
    const attackerReachability = stringValue(args.attacker_reachability, existing?.attackerReachability ?? '').trim() || existing?.attackerReachability || '1 unspecified reachability';
    const impact = stringValue(args.impact, existing?.impact ?? '').trim() || existing?.impact || '1 unspecified impact';
    const evidenceConfidence = stringValue(args.evidence_confidence, existing?.evidenceConfidence ?? '').trim() || existing?.evidenceConfidence || '0 hypothesis only';
    const exploitPracticality = stringValue(args.exploit_practicality, existing?.exploitPracticality ?? '').trim() || existing?.exploitPracticality || '1 unspecified practicality';
    const scopeConfidence = stringValue(args.scope_confidence, existing?.scopeConfidence ?? '').trim() || existing?.scopeConfidence || '1 likely in scope';
    const priorityScore = scorePriority(
      priorityFactorsFromLabels({
        attackerReachability,
        impact,
        evidenceConfidence,
        exploitPracticality,
        scopeConfidence
      })
    );
    const cweMappings = cweMappingsForToolArgs(args, existing?.cweMappings, {
      bugClass,
      title,
      descriptionMarkdown,
      impactMarkdown: impact
    });

    const duplicateReview =
      existing === null
        ? reviewClaimDuplicate(
            {
              entityKind: 'hypothesis',
              title,
              bodyMarkdown: descriptionMarkdown,
              component,
              bugClass,
              impactMarkdown: impact,
              cweMappings: cweMappings ?? []
            },
            this.programClaimCandidates(context)
          )
        : null;
    const effectiveDuplicateReview = duplicateReview ? this.preferFindingAnchorForDuplicateReview(context, duplicateReview) : null;
    if (effectiveDuplicateReview?.outcome === 'duplicate') {
      return {
        status: 'success',
        summary: `Duplicate hypothesis blocked before creation: ${title}.`,
        eventType: 'hypothesis_event',
        source: 'system',
        payload: {
          observationBacked: false,
          claimStatus: 'duplicate_review',
          action: 'duplicate_blocked',
          proposedTitle: title,
          proposedComponent: component,
          proposedBugClass: bugClass,
          matchedEntityKind: effectiveDuplicateReview.matchedEntityKind,
          matchedEntityId: effectiveDuplicateReview.matchedEntityId,
          duplicateReview: duplicateReviewPayload(effectiveDuplicateReview)
        }
      };
    }

    const hypothesis = existing
      ? this.db.updateHypothesis(existing.id, {
          state,
          title,
          descriptionMarkdown,
          component,
          bugClass,
          priorityScore,
          attackerReachability,
          impact,
          evidenceConfidence,
          exploitPracticality,
          scopeConfidence,
          ...(cweMappings ? { cweMappings } : {})
        })
      : this.db.createHypothesis({
          runId: context.run.id,
          state,
          title,
          descriptionMarkdown,
          component,
          bugClass,
          priorityScore,
          attackerReachability,
          impact,
          evidenceConfidence,
          exploitPracticality,
          scopeConfidence,
          ...(cweMappings ? { cweMappings } : {})
        });
    const promotedFindings = this.db.ensureFindingsForReproducedHypotheses(context.run.id, {
      attemptId: context.attempt.id,
      vmContextId: context.vmContext.id,
      modelVisible: true,
      reason: 'hypothesis_state_reproduced_with_real_verifier_evidence'
    });

    return {
      status: 'success',
      summary: `${existing ? 'Hypothesis updated' : 'Hypothesis created'}: ${hypothesis.title}.`,
      eventType: 'hypothesis_event',
      source: 'model',
      payload: {
        observationBacked: false,
        claimStatus: 'model_proposed_hypothesis',
        action: existing ? 'update' : 'create',
        hypothesisId: hypothesis.id,
        title: hypothesis.title,
        state: hypothesis.state,
        component: hypothesis.component,
        bugClass: hypothesis.bugClass,
        impact: hypothesis.impact,
        cweMappings: cwePayload(hypothesis.cweMappings),
        priorityScore: hypothesis.priorityScore,
        duplicateReview: duplicateReview ? duplicateReviewPayload(duplicateReview) : null,
        autoPromotedFindingIds: promotedFindings.map((finding) => finding.id)
      }
    };
  }

  private recordFinding(context: CreatedRunContext, args: Record<string, unknown>): ToolResult {
    const detail = this.db.getRunDetail(context.run.id);
    const findingId = nonEmptyStringValue(args.finding_id);
    const hypothesisId = nonEmptyStringValue(args.hypothesis_id);
    const verifierRunId = nonEmptyStringValue(args.verified_by_verifier_run_id);
    const existing = findingId ? detail.findings.find((finding) => finding.id === findingId) ?? null : null;
    if (findingId && !existing) {
      return { status: 'error', summary: 'Finding update references an unknown finding.', payload: { observationBacked: false, error: 'unknown_finding', findingId } };
    }
    if (hypothesisId && !detail.hypotheses.some((hypothesis) => hypothesis.id === hypothesisId)) {
      return { status: 'error', summary: 'Finding references an unknown hypothesis.', payload: { observationBacked: false, error: 'unknown_hypothesis', hypothesisId } };
    }

    const state = stringValue(args.state, existing?.state ?? 'needs_evidence').trim() || existing?.state || 'needs_evidence';
    if (findingStateRequiresVerifier(state) && !verifierRunId && !existing?.verifiedByVerifierRunId) {
      return {
        status: 'error',
        summary:
          state === 'reportable'
            ? 'Reportable findings require a passing real verifier run id and certain reachability/exploitability.'
            : 'Verified findings require a passing real verifier run id.',
        payload: { observationBacked: false, error: `missing_${state}_by_verifier_run_id` }
      };
    }

    const title = stringValue(args.title, existing?.title ?? '').trim() || existing?.title || 'Untitled finding';
    const summaryMarkdown = stringValue(args.summary, existing?.summaryMarkdown ?? '').trim() || existing?.summaryMarkdown || 'No summary provided.';
    const affectedAssets = jsonRecordFromString(args.affected_assets_json, existing?.affectedAssets ?? {});
    const affectedVersions = jsonRecordFromString(args.affected_versions_json, existing?.affectedVersions ?? {});
    const impactMarkdown = stringValue(args.impact, existing?.impactMarkdown ?? '').trim() || existing?.impactMarkdown || 'Impact not yet assessed.';
    const linkedHypothesisId = hypothesisId || existing?.hypothesisId || '';
    const linkedHypothesis = linkedHypothesisId ? detail.hypotheses.find((hypothesis) => hypothesis.id === linkedHypothesisId) ?? null : null;
    const priorityScore = clampPriorityScore(linkedHypothesis?.priorityScore ?? existing?.priorityScore ?? 0);
    const cweMappings = cweMappingsForToolArgs(args, existing?.cweMappings, {
      bugClass: linkedHypothesis?.bugClass ?? '',
      title,
      descriptionMarkdown: summaryMarkdown,
      impactMarkdown
    });

    const duplicateReview =
      existing === null
        ? reviewClaimDuplicate(
            {
              entityKind: 'finding',
              title,
              bodyMarkdown: summaryMarkdown,
              component: componentFromAffectedAssets(affectedAssets) || linkedHypothesis?.component || '',
              bugClass: linkedHypothesis?.bugClass ?? '',
              impactMarkdown,
              affectedAssets,
              cweMappings: cweMappings ?? []
            },
            this.programFindingCandidates(context)
          )
        : null;
    if (duplicateReview?.outcome === 'duplicate' && duplicateReview.matchedEntityKind === 'finding' && duplicateReview.matchedEntityId) {
      if (linkedHypothesisId) {
        this.db.linkHypothesisEvidenceToFinding(context.run.id, linkedHypothesisId, duplicateReview.matchedEntityId);
        this.db.updateHypothesisReview(linkedHypothesisId, { state: 'duplicate' });
      }
      return {
        status: 'success',
        summary: `Duplicate finding blocked before creation: ${title}.`,
        eventType: 'finding_event',
        source: 'system',
        payload: {
          observationBacked: findingStateIsObservationBacked(state),
          claimStatus: 'duplicate_review',
          action: 'duplicate_blocked',
          findingId: duplicateReview.matchedEntityId,
          hypothesisId: linkedHypothesisId || null,
          proposedTitle: title,
          state,
          matchedFindingId: duplicateReview.matchedEntityId,
          duplicateReview: duplicateReviewPayload(duplicateReview)
        }
      };
    }

    const finding = existing
      ? this.db.updateFinding(existing.id, {
          hypothesisId: hypothesisId || existing.hypothesisId,
          state,
          title,
          summaryMarkdown,
          affectedAssets,
          affectedVersions,
          impactMarkdown,
          priorityScore,
          verifiedByVerifierRunId: verifierRunId || existing.verifiedByVerifierRunId,
          ...(cweMappings ? { cweMappings } : {})
        })
      : this.db.createFinding({
          runId: context.run.id,
          hypothesisId,
          state,
          title,
          summaryMarkdown,
          affectedAssets,
          affectedVersions,
          impactMarkdown,
          priorityScore,
          verifiedByVerifierRunId: verifierRunId,
          ...(cweMappings ? { cweMappings } : {})
        });

    return {
      status: 'success',
      summary: `${existing ? 'Finding updated' : 'Finding created'}: ${finding.title}.`,
      eventType: 'finding_event',
      source: 'model',
      payload: {
        observationBacked: findingStateIsObservationBacked(state),
        claimStatus: state === 'reportable' ? 'reportable_finding' : state === 'verified' ? 'verifier_backed_finding' : 'model_proposed_finding',
        action: existing ? 'update' : 'create',
        findingId: finding.id,
        hypothesisId: finding.hypothesisId,
        title: finding.title,
        state: finding.state,
        priorityScore: finding.priorityScore,
        cweMappings: cwePayload(finding.cweMappings),
        verifiedByVerifierRunId: finding.verifiedByVerifierRunId,
        duplicateReview: duplicateReview ? duplicateReviewPayload(duplicateReview) : null
      }
    };
  }

  private recordVerifier(context: CreatedRunContext, args: Record<string, unknown>): ToolResult {
    const artifactId = stringValue(args.artifact_id, '').trim();
    const traceEventId = stringValue(args.trace_event_id, '').trim();
    const verifierScript = stringValue(args.verifier_script, '').trim();
    const verifierArtifactPath = stringValue(args.artifact_path, '').trim();
    const expectedStdout = stringValue(args.expected_stdout, '').trim();
    const detail = this.db.getRunDetail(context.run.id);
    const referencedArtifact = artifactId ? detail.artifacts.find((artifact) => artifact.id === artifactId) ?? null : null;
    const referencedTrace = traceEventId ? detail.traceEvents.find((event) => event.id === traceEventId) ?? null : null;
    const hasEvidenceReference = Boolean(referencedArtifact || referencedTrace);

    const contract = this.db.createVerifierContract({
      runId: context.run.id,
      mode: 'reproduction',
      status: 'declared',
      setupStepsMarkdown: 'Use Beale controlled guest execution and scoped artifacts only.',
      triggerStepsMarkdown: stringValue(args.expectation, 'No trigger steps declared.'),
      targetStates: { vmContextId: context.vmContext.id },
      expectedObservations: {
        hypothesis: stringValue(args.hypothesis, ''),
        expectation: stringValue(args.expectation, ''),
        artifactId: referencedArtifact?.id ?? null,
        traceEventId: referencedTrace?.id ?? null
      },
      invariants: {
        hostDatabaseMounted: false,
        openAiCredentialsMounted: false,
        findingsRequireEvidenceReferences: true
      },
      artifactsToCollect: {
        artifactId: referencedArtifact?.id ?? null,
        traceEventId: referencedTrace?.id ?? null,
        verifierOutput: verifierArtifactPath || null
      },
      passCriteria: {
        requiresObservedBehavior: true,
        requiresTraceOrArtifactReference: true,
        verifier: verifierScript
          ? {
              operationKind: 'shell',
              script: verifierScript,
              expectedExitCode: 0,
              expectedStdoutIncludes: expectedStdout,
              artifactPath: verifierArtifactPath,
              timeoutMs: 30_000
            }
          : null
      }
    });

    if (verifierScript) {
      const outcome = runVerifierContract(this.db, this.executor, context.run.id, contract, context.attempt.id, context.vmContext.id, 'OpenAI verifier tool execution.');
      return {
        status: outcome.verifierRun.status === 'error' ? 'error' : 'success',
        summary: `Verifier contract executed with ${outcome.verifierRun.status}; finding promotion remains gated by real pass results.`,
        traceEventId: outcome.traceEventId,
        artifactId: outcome.artifactId ?? undefined,
        eventType: 'verifier_result',
        source: 'verifier',
        payload: {
          observationBacked: outcome.verifierRun.status !== 'error',
          simulated: false,
          verifierRunId: outcome.verifierRun.id,
          contractId: contract.id,
          status: outcome.verifierRun.status,
          realExecution: outcome.verifierRun.result.realExecution === true,
          vmExecution: outcome.verifierRun.result.vmExecution === true,
          hostExecution: outcome.verifierRun.result.hostExecution === true,
          promotedFinding: false,
          artifactId: outcome.artifactId,
          readHint: outcome.artifactId
            ? `Use code_browser with path "${outcome.artifactId}" or resource_lookup with resource_id "${outcome.artifactId}" to inspect verifier output. Do not use the raw artifact_path.`
            : 'No verifier output artifact was collected; use resource_lookup on the verifier_run id for status and contract metadata.'
        }
      };
    }

    const status = 'inconclusive';
    const blockedIssue = hasEvidenceReference ? 'requires_reproduction_contract_execution' : 'missing_trace_or_artifact_reference';
    const verifierRun = this.db.createVerifierRun({
      contractId: contract.id,
      runId: context.run.id,
      attemptId: context.attempt.id,
      vmContextId: context.vmContext.id,
      status,
      blockedIssue,
      behaviorPreserved: 'inconclusive',
      diagnosticsClean: 'inconclusive',
      regressionTests: 'not_run',
      result: {
        observationBacked: true,
        realExecution: false,
        vmExecution: false,
        artifactId: referencedArtifact?.id ?? null,
        traceEventId: referencedTrace?.id ?? null,
        evidenceReferencePresent: hasEvidenceReference,
        promotedFinding: false
      }
    });

    return {
      status: 'success',
      summary: `Verifier recorded ${status} result; finding promotion remains gated.`,
      eventType: 'verifier_result',
      source: 'verifier',
      payload: {
        observationBacked: true,
        simulated: false,
        verifierRunId: verifierRun.id,
        contractId: contract.id,
        status,
        blockedIssue,
        evidenceReferences: {
          artifactId: referencedArtifact?.id ?? null,
          traceEventId: referencedTrace?.id ?? null
        },
        promotedFinding: false,
        readHint: referencedArtifact
          ? `Use code_browser with path "${referencedArtifact.id}" to inspect the referenced artifact.`
          : 'This verifier declaration has no output artifact yet; execute a verifier_script with artifact_path to collect one.'
      }
    };
  }

  private executeInActiveSandbox(context: CreatedRunContext, request: GuestExecuteRequest, artifactPath: string | null): GuestToolResult {
    const requestedNetworkProfile = request.networkProfile;
    if (isHostResearchSandbox(context.run.sandboxProfile)) {
      const artifactKind = request.operationKind === 'python' ? 'python_generated_output' : 'debugger_output';
      const execution = executeHostOperation(this.db, context, request, artifactPath, artifactKind);
      return {
        result: execution.result,
        artifactId: execution.artifactId,
        importedHostPath: null,
        requestedNetworkProfile,
        networkProfile: requestedNetworkProfile,
        hostExecution: true,
        executionSubstrate: 'host',
        hostCwd: execution.cwd,
        hostTargetPath: execution.targetPath,
        hostArtifactPath: execution.artifactPath
      };
    }

    if (!this.executor) {
      throw new Error('VM executor is not available to the OpenAI tool router.');
    }

    const status = this.executor.getStatus();
    if (!status.available) {
      throw new Error(status.reason ?? 'VM executor is not available.');
    }

    const importSpec = this.firstScopedImport();
    const networkProfile = this.executor.resolveNetworkProfile(requestedNetworkProfile);
    let contextCreated = false;
    try {
      this.executor.createContext(context, 'beale-default-toolchain', 'clean', request.networkProfile);
      contextCreated = true;
      this.executor.cloneContext(context, 'clean', request.networkProfile);
      if (importSpec) {
        this.executor.importWorkspaceMaterial(context, {
          hostPath: importSpec.hostPath,
          guestPath: '/workspace/target',
          mode: 'read_only'
        });
      }
      const result = this.executor.executeGuestOperation(context, request);
      if (artifactPath && !status.supports.export) {
        throw new Error('Executor backend does not support guest artifact export.');
      }
      const artifactId =
        artifactPath
          ? this.executor.exportArtifact(context, {
              guestPath: artifactPath,
              kind: request.operationKind === 'python' ? 'python_generated_output' : 'debugger_output',
              mimeType: 'application/octet-stream',
              sensitivity: 'internal',
              modelVisible: true
            })
          : null;
      return {
        result,
        artifactId,
        importedHostPath: importSpec?.hostPath ?? null,
        requestedNetworkProfile,
        networkProfile,
        hostExecution: false,
        executionSubstrate: 'disposable_guest_vm'
      };
    } finally {
      if (contextCreated) {
        this.executor.destroyContext(context);
      }
    }
  }

  private async executeInActiveSandboxAsync(context: CreatedRunContext, request: GuestExecuteRequest, artifactPath: string | null): Promise<GuestToolResult> {
    const requestedNetworkProfile = request.networkProfile;
    if (isHostResearchSandbox(context.run.sandboxProfile)) {
      const artifactKind = request.operationKind === 'python' ? 'python_generated_output' : 'debugger_output';
      const execution = await executeHostOperationAsync(this.db, context, request, artifactPath, artifactKind);
      return {
        result: execution.result,
        artifactId: execution.artifactId,
        importedHostPath: null,
        requestedNetworkProfile,
        networkProfile: requestedNetworkProfile,
        hostExecution: true,
        executionSubstrate: 'host',
        hostCwd: execution.cwd,
        hostTargetPath: execution.targetPath,
        hostArtifactPath: execution.artifactPath
      };
    }

    return this.executeInActiveSandbox(context, request, artifactPath);
  }

  private collectScopedFiles(targetHint: string): SearchCollection {
    const rootResolution = this.resolveSearchRoots(targetHint);
    const files: ScopedFile[] = [];
    for (const root of rootResolution.roots) {
      this.addScopedFiles(root.path, root.asset, files);
      if (files.length >= MAX_SEARCH_FILES) break;
    }
    return {
      files,
      roots: rootResolution.roots,
      targetResolution: rootResolution.targetResolution,
      unmaterializedSource: rootResolution.unmaterializedSource
    };
  }

  private resolveSearchRoots(targetHint: string): { roots: ScopedSearchRoot[]; targetResolution: string; unmaterializedSource: SourceRepositoryCandidate | null } {
    const scope = this.db.getActiveScope();
    const localAssets = scope.assets.filter(isScopedLocalAsset);
    const trimmedTarget = targetHint.trim();
    if (!trimmedTarget) {
      return {
        roots: dedupeSearchRoots(localAssets.map((asset) => ({ path: resolve(asset.value), asset, reason: 'all_local_scope' }))),
        targetResolution: localAssets.length > 0 ? 'all_local_scope' : 'no_local_scope',
        unmaterializedSource: null
      };
    }

    const byPath = this.searchRootsForPathHint(trimmedTarget, localAssets);
    if (byPath.length > 0) {
      return {
        roots: dedupeSearchRoots(byPath),
        targetResolution: 'local_path_target',
        unmaterializedSource: null
      };
    }

    const selection = selectSourceRepository(scope, trimmedTarget);
    if (selection.candidate) {
      const materialized = this.materializedSourceAsset(selection.candidate);
      return {
        roots: materialized ? [{ path: resolve(materialized.value), asset: materialized, reason: 'materialized_source_repository' }] : [],
        targetResolution: materialized ? 'materialized_source_repository' : 'source_repository_not_materialized',
        unmaterializedSource: materialized ? null : selection.candidate
      };
    }

    const normalizedHint = trimmedTarget.toLowerCase();
    const byMetadata = localAssets
      .filter((asset) => localAssetMatchesTargetHint(asset, normalizedHint))
      .map((asset) => ({ path: resolve(asset.value), asset, reason: 'local_asset_metadata_match' }));
    return {
      roots: dedupeSearchRoots(byMetadata),
      targetResolution: byMetadata.length > 0 ? 'local_asset_metadata_match' : 'target_not_found_in_local_scope',
      unmaterializedSource: null
    };
  }

  private searchRootsForPathHint(targetHint: string, localAssets: ScopeAsset[]): ScopedSearchRoot[] {
    if (!isAbsolute(targetHint) && !targetHint.startsWith('.')) return [];
    const resolvedTarget = resolve(targetHint);
    let assets = localAssets;
    if (!assets.some((asset) => isWithinPath(resolvedTarget, resolve(asset.value)) || isWithinPath(resolve(asset.value), resolvedTarget))) {
      const nextScope = this.ensureExistingCheckoutPathInScope(resolvedTarget);
      if (nextScope) {
        assets = nextScope.assets.filter(isScopedLocalAsset);
      }
    }
    return assets.flatMap((asset) => {
      const assetRoot = resolve(asset.value);
      if (isWithinPath(resolvedTarget, assetRoot)) {
        return existsSync(resolvedTarget) ? [{ path: resolvedTarget, asset, reason: 'explicit_path_inside_scope' }] : [];
      }
      if (isWithinPath(assetRoot, resolvedTarget)) {
        return [{ path: assetRoot, asset, reason: 'explicit_path_parent_of_scope' }];
      }
      return [];
    });
  }

  private materializedSourceAsset(candidate: SourceRepositoryCandidate): ScopeAsset | null {
    const candidateUrl = normalizeSourceRepositoryUrl(candidate.url);
    return (
      this.db
        .getActiveScope()
        .assets.find(
          (asset) =>
            isScopedLocalAsset(asset) &&
            (stringAttribute(asset.attributes?.sourceAssetId) === candidate.sourceAssetId ||
              sameRepository(candidateUrl, stringAttribute(asset.attributes?.repositoryUrl)) ||
              sameRepository(candidateUrl, asset.value))
        ) ?? null
    );
  }

  private ensureExistingCheckoutPathInScope(pathHint: string): ReturnType<WorkspaceDatabase['getActiveScope']> | null {
    const existing = findScopedExistingSourceCheckout(this.db.getActiveScope(), this.db.getDatabasePath(), pathHint);
    if (!existing) return null;
    return this.ensureLocalSourceInScope(existing.candidate.sourceAssetId, existing.candidate.sensitivity, existing.localPath, existing.candidate.url, existing.head);
  }

  private sourceRepositoryStatuses(candidates: SourceRepositoryCandidate[]): Array<Record<string, unknown>> {
    return candidates.map((candidate) => {
      const local = this.materializedSourceAsset(candidate);
      return {
        label: candidate.label,
        url: candidate.url,
        materialized: Boolean(local),
        localPath: local?.value ?? null
      };
    });
  }

  private addScopedFiles(path: string, asset: ScopeAsset, files: ScopedFile[]): void {
    if (files.length >= MAX_SEARCH_FILES) return;
    const stat = safeStat(path);
    if (!stat) return;
    if (stat.isFile()) {
      files.push({ path, assetId: asset.id, assetKind: asset.kind });
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of readdirSync(path)) {
      if (SKIPPED_DIRS.has(entry)) continue;
      this.addScopedFiles(join(path, entry), asset, files);
      if (files.length >= MAX_SEARCH_FILES) break;
    }
  }

  private searchRunArtifacts(context: CreatedRunContext, queryPlan: SearchQueryPlan, remaining: number): Array<Record<string, unknown>> {
    if (remaining <= 0) return [];
    const detail = this.db.getRunDetail(context.run.id);
    const matches: Array<Record<string, unknown>> = [];
    for (const artifact of detail.artifacts) {
      const haystack = `${artifact.id} ${artifact.kind} ${artifact.sha256} ${JSON.stringify(artifact.metadata)}`;
      if (!lineMatchesSearchQuery(haystack, queryPlan)) continue;
      matches.push({
        kind: 'artifact',
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        sha256: artifact.sha256,
        snippet: trimSnippet(`${artifact.kind} ${artifact.id} ${artifact.sha256}`)
      });
      if (matches.length >= remaining) return matches;
    }
    return matches;
  }

  private searchProjectMetadata(context: CreatedRunContext, query: string, remaining: number): Array<Record<string, unknown>> {
    if (remaining <= 0) return [];
    return this.db.searchProjectDocumentsForRun(context.run.id, query, remaining, { refreshInventory: false }).map((result) => this.projectSearchResultToToolMatch(result));
  }

  private searchProjectSemantic(context: CreatedRunContext, query: string, remaining: number): Array<Record<string, unknown>> {
    if (remaining <= 0) return [];
    return this.db
      .searchProjectSemanticChunksForRun(context.run.id, query, Math.min(8, remaining), { refreshIndex: false })
      .map((result) => this.projectSemanticSearchResultToToolMatch(result));
  }

  private searchProjectGraph(context: CreatedRunContext, seeds: Array<Record<string, unknown>>, remaining: number): Array<Record<string, unknown>> {
    if (remaining <= 0 || seeds.length === 0) return [];
    const candidates: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const seed of this.graphSearchSeeds(seeds, 8)) {
      if (candidates.length >= Math.min(6, remaining)) break;
      const entityType = stringValue(seed.entityType, '');
      const entityId = stringValue(seed.entityId, '');
      if (!entityType || !entityId) continue;
      const neighborhood = this.db.getProjectGraphNeighborhood(context.run.scopeVersionId, entityType, entityId, { depth: 1, limit: 24, refresh: false });
      if (neighborhood.status !== 'hit') continue;
      const seedNodeId = neighborhood.root?.id ?? '';
      for (const edge of neighborhood.edges) {
        if (candidates.length >= Math.min(6, remaining)) break;
        const adjacentNodeId = edge.sourceNodeId === seedNodeId ? edge.targetNodeId : edge.sourceNodeId;
        if (!adjacentNodeId) {
          const key = `graph_edge:${edge.id}`;
          if (!seen.has(key) && edge.targetLabel) {
            seen.add(key);
            candidates.push(this.projectGraphEdgeToToolMatch(edge, seed));
          }
          continue;
        }
        if (adjacentNodeId === seedNodeId) continue;
        const node = neighborhood.nodes.find((candidate) => candidate.id === adjacentNodeId);
        if (!node || node.entityType === 'scope_version') continue;
        const key = `${node.entityType}:${node.entityId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(this.projectGraphNodeToToolMatch(node, edge, seed));
      }
    }
    return candidates;
  }

  private searchProjectGraphVariants(context: CreatedRunContext, seeds: Array<Record<string, unknown>>, remaining: number): Array<Record<string, unknown>> {
    if (remaining <= 0 || seeds.length === 0) return [];
    const candidates: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const seed of this.graphSearchSeeds(seeds, 10)) {
      if (candidates.length >= Math.min(8, remaining)) break;
      const entityType = stringValue(seed.entityType, '');
      const entityId = stringValue(seed.entityId, '');
      if (!entityType || !entityId) continue;
      const neighborhood = this.db.getProjectGraphNeighborhood(context.run.scopeVersionId, entityType, entityId, { depth: 1, edgeKinds: [...GRAPH_VARIANT_EDGE_KINDS], limit: 16, refresh: false });
      if (neighborhood.status !== 'hit' || !neighborhood.root) continue;
      const variants = this.db.listProjectGraphVariantNodesForNode(context.run.scopeVersionId, neighborhood.root.id, {
        edgeKinds: [...GRAPH_VARIANT_EDGE_KINDS],
        limit: 16,
        refresh: false
      });
      for (const variant of variants) {
        if (candidates.length >= Math.min(8, remaining)) break;
        if (variant.node.id === neighborhood.root.id || variant.node.entityType === 'scope_version') continue;
        const key = `${variant.node.entityType}:${variant.node.entityId}:${variant.edge.edgeKind}:${variant.edge.targetEntityType}:${variant.edge.targetEntityId ?? variant.edge.targetLabel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(this.projectGraphVariantNodeToToolMatch(variant.node, variant.edge, seed));
      }
      const sourcePath = stringValue(seed.sourcePath, '') || stringValue(seed.path, '');
      if (!sourcePath) continue;
      const componentNodes = this.db.findProjectGraphNodes(context.run.scopeVersionId, sourcePath, { entityType: 'research_component', limit: 3, refresh: false });
      for (const componentNode of componentNodes) {
        if (candidates.length >= Math.min(8, remaining)) break;
        const componentNeighborhood = this.db.getProjectGraphNeighborhood(context.run.scopeVersionId, componentNode.entityType, componentNode.entityId, {
          depth: 1,
          edgeKinds: ['affects_component'],
          limit: 16,
          refresh: false
        });
        for (const edge of componentNeighborhood.edges) {
          if (candidates.length >= Math.min(8, remaining)) break;
          const adjacentNodeId = edge.sourceNodeId === componentNode.id ? edge.targetNodeId : edge.sourceNodeId;
          if (!adjacentNodeId || adjacentNodeId === componentNode.id) continue;
          const node = componentNeighborhood.nodes.find((candidate) => candidate.id === adjacentNodeId);
          if (!node || (node.entityType !== 'hypothesis' && node.entityType !== 'finding')) continue;
          const key = `${node.entityType}:${node.entityId}:${edge.edgeKind}:${componentNode.entityId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(this.projectGraphVariantNodeToToolMatch(node, edge, seed));
        }
      }
    }
    return candidates;
  }

  private graphSearchSeeds(seeds: Array<Record<string, unknown>>, limit: number): Array<Record<string, unknown>> {
    const graphBackedSeeds = seeds.filter((seed) => {
      const entityType = stringValue(seed.entityType, '');
      const entityId = stringValue(seed.entityId, '');
      return entityType.length > 0 && entityId.length > 0 && entityType !== 'file' && entityType !== 'artifact';
    });
    const fallbackSeeds = seeds.filter((seed) => !graphBackedSeeds.includes(seed));
    return [...graphBackedSeeds, ...fallbackSeeds].slice(0, Math.max(1, limit));
  }

  private selectPhaseASeedMatches(
    input: {
      fileMatches: Array<Record<string, unknown>>;
      artifactMatches: Array<Record<string, unknown>>;
      metadataMatches: Array<Record<string, unknown>>;
      semanticMatches: Array<Record<string, unknown>>;
      graphMatches: Array<Record<string, unknown>>;
    },
    limit: number,
    queryPlan: SearchQueryPlan
  ): Array<Record<string, unknown>> {
    const candidates: RetrievalCandidate[] = [];
    const candidatePoolLimit = Math.max(limit * 3, limit);
    this.appendUniqueRetrievalCandidates(candidates, input.fileMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);
    this.appendUniqueRetrievalCandidates(candidates, input.artifactMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);
    this.appendUniqueRetrievalCandidates(candidates, input.metadataMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);
    this.appendUniqueRetrievalCandidates(candidates, input.semanticMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);
    this.appendUniqueRetrievalCandidates(candidates, input.graphMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);
    return candidates
      .map((candidate, index) => {
        const score = this.retrievalCandidateScore(candidate, { graphEntityKeys: new Set(), graphSourcePaths: new Set(), seedEntityKeys: new Set(), queryPlan, feedback: emptyRetrievalFeedbackContext() });
        return { candidate, score: score.total, index };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, Math.max(1, limit))
      .map((entry) => entry.candidate.output);
  }

  private searchSourceStructureSeeds(context: CreatedRunContext, seeds: Array<Record<string, unknown>>, limit: number): Array<Record<string, unknown>> {
    const matches: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const seed of seeds) {
      if (matches.length >= limit) break;
      if (stringValue(seed.entityType, '') && stringValue(seed.entityId, '')) continue;
      const sourcePath = stringValue(seed.sourcePath, '') || stringValue(seed.path, '');
      const line = numberValue(seed.line, 0);
      if (!sourcePath || line <= 0) continue;
      const entity = this.db.findProjectStructureEntityContainingLine(context.run.scopeVersionId, sourcePath, line, { refreshInventory: false });
      if (!entity) continue;
      const seedEntities = [
        entity,
        ...this.db.listProjectStructureEntitiesInRange(context.run.scopeVersionId, sourcePath, entity.lineStart, entity.lineEnd, 12, { refreshInventory: false })
      ];
      for (const seedEntity of seedEntities) {
        if (matches.length >= limit) break;
        if (seen.has(seedEntity.id)) continue;
        seen.add(seedEntity.id);
        matches.push(this.projectStructureEntityToToolMatch(seedEntity, seedEntity.id === entity.id ? 'source_hit_structure_seed' : 'source_hit_contained_structure_seed'));
      }
    }
    return matches;
  }

  private searchSourceInventorySeeds(context: CreatedRunContext, seeds: Array<Record<string, unknown>>, limit: number): Array<Record<string, unknown>> {
    const matches: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const seed of seeds) {
      if (matches.length >= limit) break;
      const entityType = stringValue(seed.entityType, '');
      const entityId = stringValue(seed.entityId, '');
      if (entityType === 'inventory_item' && entityId) continue;
      const binaryDerived = seed.binaryDerived === true || stringValue(seed.namespace, '') === 'binary' || stringValue(seed.range, '') === 'binary_strings';
      if (!binaryDerived) continue;
      const sourcePath = stringValue(seed.sourcePath, '') || stringValue(seed.path, '');
      if (!sourcePath) continue;
      const item = this.db.findProjectInventoryItemByPath(context.run.scopeVersionId, sourcePath, { refreshInventory: false });
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      matches.push(this.projectInventoryItemToToolMatch(item, 'source_hit_inventory_seed'));
    }
    return matches;
  }

  private adaptiveFollowUpSearch(
    context: CreatedRunContext,
    queryPlan: SearchQueryPlan,
    current: {
      fileMatches: Array<Record<string, unknown>>;
      artifactMatches: Array<Record<string, unknown>>;
      metadataMatches: Array<Record<string, unknown>>;
      semanticMatches: Array<Record<string, unknown>>;
      graphMatches: Array<Record<string, unknown>>;
    }
  ): {
    metadataMatches: Array<Record<string, unknown>>;
    semanticMatches: Array<Record<string, unknown>>;
    graphMatches: Array<Record<string, unknown>>;
    diagnostics: Record<string, unknown> | null;
  } {
    const reasons = this.adaptiveFollowUpReasons(current);
    if (reasons.length === 0) return { metadataMatches: [], semanticMatches: [], graphMatches: [], diagnostics: null };
    const followUpQuery = this.adaptiveFollowUpQuery(queryPlan);
    if (!followUpQuery || followUpQuery.toLowerCase() === queryPlan.rawLower) return { metadataMatches: [], semanticMatches: [], graphMatches: [], diagnostics: null };
    const followUpPlan = buildSearchQueryPlan(followUpQuery);
    const metadataMatches = this.tagAdaptiveFollowUpMatches(this.searchProjectMetadata(context, followUpQuery, 12), followUpQuery, reasons);
    const semanticMatches = this.tagAdaptiveFollowUpMatches(this.searchProjectSemantic(context, followUpQuery, 8), followUpQuery, reasons);
    const seeds = this.selectPhaseASeedMatches(
      {
        fileMatches: [],
        artifactMatches: [],
        metadataMatches,
        semanticMatches,
        graphMatches: []
      },
      8,
      followUpPlan
    );
    const graphMatches = this.tagAdaptiveFollowUpMatches(
      [...this.searchProjectGraph(context, seeds, 12), ...this.searchProjectGraphVariants(context, seeds, 12)],
      followUpQuery,
      reasons
    );
    return {
      metadataMatches,
      semanticMatches,
      graphMatches,
      diagnostics: {
        triggered: true,
        query: followUpQuery,
        reasons,
        addedCountsByLayer: {
          metadata: metadataMatches.length,
          semantic: semanticMatches.length,
          graph: graphMatches.filter((match) => stringValue(match.kind, '') === 'graph').length,
          graph_variant: graphMatches.filter((match) => stringValue(match.kind, '') === 'graph_variant').length,
          total: metadataMatches.length + semanticMatches.length + graphMatches.length
        }
      }
    };
  }

  private adaptiveFollowUpReasons(current: {
    fileMatches: Array<Record<string, unknown>>;
    artifactMatches: Array<Record<string, unknown>>;
    metadataMatches: Array<Record<string, unknown>>;
    semanticMatches: Array<Record<string, unknown>>;
    graphMatches: Array<Record<string, unknown>>;
  }): string[] {
    const reasons: string[] = [];
    if (current.semanticMatches.length === 0) reasons.push('no_semantic_hits');
    if (current.graphMatches.length === 0) reasons.push('no_graph_hits');
    const sourcePaths = new Set(current.fileMatches.map((match) => stringValue(match.path, '') || stringValue(match.sourcePath, '')).filter(Boolean));
    const onlySameFileLexical =
      current.fileMatches.length >= 4 &&
      sourcePaths.size === 1 &&
      current.metadataMatches.length + current.semanticMatches.length + current.graphMatches.length === 0;
    if (onlySameFileLexical) reasons.push('same_file_lexical_only');
    return reasons;
  }

  private adaptiveFollowUpQuery(queryPlan: SearchQueryPlan): string {
    const terms: string[] = [];
    if (queryPlan.intents.includes('symbol_lookup')) terms.push('definition', 'reference', 'call');
    if (queryPlan.intents.includes('route_api_lookup')) terms.push('route', 'handler', 'controller', 'middleware');
    if (queryPlan.intents.includes('auth_permission_question')) terms.push('authorization', 'permission', 'guard', 'middleware');
    if (queryPlan.intents.includes('sink_data_flow_question')) terms.push('sink', 'query', 'parse', 'model');
    if (queryPlan.intents.includes('binary_orientation')) terms.push('import', 'export', 'string', 'url', 'permission', 'symbol');
    if (queryPlan.intents.includes('prior_research_memory')) terms.push('hypothesis', 'finding', 'evidence', 'verifier', 'cwe');
    if (queryPlan.intents.includes('variant_similarity_search')) terms.push('similar', 'related', 'variant', 'sibling');
    if (terms.length === 0) terms.push('definition', 'reference', 'related');
    return uniqueStrings([queryPlan.raw, ...terms]).join(' ').slice(0, 240);
  }

  private tagAdaptiveFollowUpMatches(matches: Array<Record<string, unknown>>, query: string, reasons: string[]): Array<Record<string, unknown>> {
    return matches.map((match) => ({
      ...match,
      adaptiveFollowUp: true,
      adaptiveFollowUpQuery: query,
      adaptiveFollowUpReasons: reasons
    }));
  }

  private assembleRankedSearchMatches(input: {
    fileMatches: Array<Record<string, unknown>>;
    artifactMatches: Array<Record<string, unknown>>;
    metadataMatches: Array<Record<string, unknown>>;
    semanticMatches: Array<Record<string, unknown>>;
    graphMatches: Array<Record<string, unknown>>;
    queryPlan: SearchQueryPlan;
    adaptiveFollowUp?: Record<string, unknown> | null;
    feedback: RetrievalFeedbackContext;
  }): SearchAssemblyResult {
    const candidatePool: RetrievalCandidate[] = [];
    const candidatePoolLimit = MAX_SEARCH_MATCHES * 4;
    const rawCandidateCount = input.fileMatches.length + input.artifactMatches.length + input.metadataMatches.length + input.semanticMatches.length + input.graphMatches.length;
    const graphVariantInputCount = input.graphMatches.filter((match) => stringValue(match.kind, '') === 'graph_variant').length;
    const graphProximityInputCount = input.graphMatches.length - graphVariantInputCount;
    this.appendUniqueRetrievalCandidates(candidatePool, input.fileMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);
    this.appendUniqueRetrievalCandidates(candidatePool, input.artifactMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);
    this.appendUniqueRetrievalCandidates(candidatePool, input.metadataMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);
    this.appendUniqueRetrievalCandidates(candidatePool, input.semanticMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);
    this.appendUniqueRetrievalCandidates(candidatePool, input.graphMatches.map((match) => this.searchMatchToRetrievalCandidate(match)), candidatePoolLimit);

    const graphCandidates = input.graphMatches.map((match) => this.searchMatchToRetrievalCandidate(match));
    const graphEntityKeys = new Set(graphCandidates.map((candidate) => this.retrievalCandidateEntityKey(candidate)).filter(Boolean));
    const graphSourcePaths = new Set(graphCandidates.map((candidate) => candidate.sourcePath).filter((value): value is string => Boolean(value)));
    const seedEntityKeys = new Set(
      graphCandidates
        .map((candidate) => `${candidate.provenance.seedEntityType ?? ''}:${candidate.provenance.seedEntityId ?? ''}`)
        .filter((key) => key !== ':')
    );
    const scored: Array<{ candidate: RetrievalCandidate; score: number; index: number }> = candidatePool.map((candidate, index) => {
      const score = this.retrievalCandidateScore(candidate, { graphEntityKeys, graphSourcePaths, seedEntityKeys, queryPlan: input.queryPlan, feedback: input.feedback });
      return {
        candidate: {
          ...candidate,
          score: score.total,
          signals: score.signals,
          output: {
            ...candidate.output,
            retrievalScore: score.total,
            retrievalSignals: score.signals
          }
        },
        score: score.total,
        index
      };
    });
    scored.sort((left, right) => right.score - left.score || left.index - right.index);

    const selected = this.diversifyRetrievalCandidates(scored, input.queryPlan);
    if (!selected.some((candidate) => candidate.kind === 'graph')) {
      const graphCandidate = scored.find((entry) => entry.candidate.kind === 'graph' && !this.retrievalCandidateIsDuplicate(selected, entry.candidate))?.candidate;
      if (graphCandidate) {
        if (selected.length < MAX_SEARCH_MATCHES) {
          selected.push(graphCandidate);
        } else {
          const replaceIndex = selected.findLastIndex((candidate) => candidate.kind === 'graph_variant' || numberValue(candidate.signals.graphProximity, 0) <= 0);
          if (replaceIndex >= 0) selected[replaceIndex] = graphCandidate;
        }
      }
    }
    const matches = this.annotateReadBudgetHints(selected).map((candidate) => candidate.output);

    return {
      matches,
      metadataMatches: selected.filter((match) => match.kind === 'metadata').length,
      semanticMatches: selected.filter((match) => match.kind === 'semantic').length,
      graphMatches: selected.filter((match) => match.kind === 'graph' || match.kind === 'graph_variant').length,
      graphVariantMatches: selected.filter((match) => match.kind === 'graph_variant').length,
      diagnostics: {
        candidateCountsByLayer: {
          file: input.fileMatches.length,
          artifact: input.artifactMatches.length,
          metadata: input.metadataMatches.length,
          semantic: input.semanticMatches.length,
          graph: graphProximityInputCount,
          graph_variant: graphVariantInputCount,
          total: rawCandidateCount
        },
        mergedCandidateCountsByLayer: this.retrievalLayerCounts(candidatePool),
        selectedCountsByLayer: this.retrievalLayerCounts(selected),
        dedupeCount: Math.max(0, rawCandidateCount - candidatePool.length),
        graphExpansionCount: input.graphMatches.length,
        topScoringSignals: this.topRetrievalSignalTotals(selected, 8),
        selectedRelationshipFamilies: this.retrievalRelationshipFamilyCounts(selected),
        missingReasons: [],
        operationalHints: [],
        adaptiveFollowUp: input.adaptiveFollowUp ?? null
      }
    };
  }

  private graphEdgeRetrievalWeight(edgeKind: string): number {
    if (['reaches_sink', 'checks_permission', 'routes_to', 'handles_with', 'uses_middleware'].includes(edgeKind)) return 18;
    if (['calls', 'imports', 'exports', 'defines'].includes(edgeKind)) return 12;
    if (['affects_component', 'classified_as_cwe', 'supports_hypothesis', 'supports_finding', 'supported_by_evidence', 'verifies_hypothesis', 'verifies_finding', 'verified_by_contract', 'verifier_passed_hypothesis', 'verifier_passed_finding', 'backed_by_evidence', 'observed_in_trace'].includes(edgeKind)) return 14;
    return 8;
  }

  private annotateReadBudgetHints(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
    let priority = 1;
    return candidates.map((candidate, index) => {
      if (priority > 5) return candidate;
      const hint = this.retrievalReadHint(candidate, index, priority);
      if (!hint) return candidate;
      priority += 1;
      return {
        ...candidate,
        output: {
          ...candidate.output,
          readPriority: hint.priority,
          readReason: hint.reason,
          suggestedNextRead: hint.suggestedNextRead
        }
      };
    });
  }

  private retrievalReadHint(
    candidate: RetrievalCandidate,
    index: number,
    priority: number
  ): { priority: number; reason: string; suggestedNextRead: Record<string, unknown> } | null {
    const path = candidate.sourcePath ?? stringValue(candidate.output.path, '');
    if (!path) return null;
    if (candidate.entityType && ['hypothesis', 'finding', 'evidence', 'verifier_run', 'verifier_contract', 'trace_event'].includes(candidate.entityType)) return null;
    const range = retrievalCandidateLineRange(candidate);
    const symbol = stringValue(candidate.output.structureName, '') || (candidate.entityType === 'structure_entity' ? stringValue(candidate.output.title, '').replace(/^\w+\s+/, '') : '');
    const binaryDerived = candidate.output.binaryDerived === true || candidate.namespace === 'binary' || candidate.range === 'binary_strings';
    const lineStart = range && !binaryDerived ? Math.max(1, range.start - 20) : null;
    const lineEnd = range && !binaryDerived ? Math.min(range.end + 40, lineStart ? lineStart + MAX_BROWSER_LINES - 1 : range.end + 40) : null;
    const suggestedNextRead: Record<string, unknown> = {
      tool: 'code_browser',
      args: {
        path,
        symbol: symbol && !binaryDerived ? symbol : '',
        line_start: lineStart ? String(lineStart) : '',
        line_end: lineEnd ? String(lineEnd) : ''
      }
    };
    return {
      priority,
      reason: this.retrievalReadReason(candidate, index),
      suggestedNextRead
    };
  }

  private retrievalReadReason(candidate: RetrievalCandidate, index: number): string {
    const reasons = arrayOfStrings(candidate.signals.reasons);
    if (index === 0) return `Top ranked retrieval result${reasons.length > 0 ? `: ${reasons.slice(0, 3).join(', ')}` : ''}.`;
    const edgeKinds = uniqueStrings([candidate.provenance.graphEdgeKind ?? '', stringValue(candidate.output.graphEdgeKind, ''), ...arrayOfStrings(candidate.output.retrievalGraphEdgeKinds)]);
    if (edgeKinds.length > 0) return `Read to inspect graph-related context via ${edgeKinds.slice(0, 3).join(', ')}.`;
    if (arrayOfStrings(candidate.output.retrievalMergedSources).length > 1) return `Read because multiple retrieval layers agree: ${arrayOfStrings(candidate.output.retrievalMergedSources).slice(0, 3).join(', ')}.`;
    if (candidate.kind === 'semantic') return 'Read because semantic retrieval found relevant local context.';
    return reasons.length > 0 ? `Read to validate ${reasons.slice(0, 3).join(', ')}.` : 'Read to validate this retrieved location.';
  }

  private diversifyRetrievalCandidates(scored: Array<{ candidate: RetrievalCandidate; score: number; index: number }>, queryPlan: SearchQueryPlan): RetrievalCandidate[] {
    const selected: RetrievalCandidate[] = [];
    const deferred: Array<{ candidate: RetrievalCandidate; score: number; index: number }> = [];
    const sourcePathCounts = new Map<string, number>();
    const familyCounts = new Map<string, number>();
    const sourcePathCap = this.retrievalSourcePathCap(queryPlan);
    const familyCap = this.retrievalFamilyCap(queryPlan);
    const top = scored[0]?.candidate;
    if (top) {
      selected.push(top);
      this.incrementDiversificationCounts(top, sourcePathCounts, familyCounts);
    }
    for (const entry of scored.slice(top ? 1 : 0)) {
      if (selected.length >= MAX_SEARCH_MATCHES) break;
      const sourcePath = entry.candidate.sourcePath ?? '';
      const sourcePathCount = sourcePath ? sourcePathCounts.get(sourcePath) ?? 0 : 0;
      const family = this.retrievalRelationshipFamily(entry.candidate);
      const familyCount = familyCounts.get(family) ?? 0;
      const graphScore = numberValue(entry.candidate.signals.graphProximity, 0);
      const intentScore = numberValue(entry.candidate.signals.queryIntent, 0);
      const exactScore = numberValue(entry.candidate.signals.exactIdentifierPath, 0);
      const canExceedSourceCap = graphScore > 0 || intentScore >= 8 || exactScore >= 14;
      const canExceedFamilyCap = exactScore >= 14 || intentScore >= 10;
      if (sourcePath && sourcePathCount >= sourcePathCap && !canExceedSourceCap && selected.length < MAX_SEARCH_MATCHES - 8) {
        deferred.push(entry);
        continue;
      }
      if (familyCount >= familyCap && !canExceedFamilyCap && selected.length < MAX_SEARCH_MATCHES - 8) {
        deferred.push(entry);
        continue;
      }
      selected.push(entry.candidate);
      this.incrementDiversificationCounts(entry.candidate, sourcePathCounts, familyCounts);
    }
    for (const entry of deferred) {
      if (selected.length >= MAX_SEARCH_MATCHES) break;
      const sourcePath = entry.candidate.sourcePath ?? '';
      const sourcePathCount = sourcePath ? sourcePathCounts.get(sourcePath) ?? 0 : 0;
      if (sourcePath && sourcePathCount >= sourcePathCap + 2 && selected.length < MAX_SEARCH_MATCHES - 2) continue;
      selected.push(entry.candidate);
      this.incrementDiversificationCounts(entry.candidate, sourcePathCounts, familyCounts);
    }
    return selected;
  }

  private incrementDiversificationCounts(candidate: RetrievalCandidate, sourcePathCounts: Map<string, number>, familyCounts: Map<string, number>): void {
    if (candidate.sourcePath) sourcePathCounts.set(candidate.sourcePath, (sourcePathCounts.get(candidate.sourcePath) ?? 0) + 1);
    const family = this.retrievalRelationshipFamily(candidate);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }

  private retrievalLayerCounts(candidates: RetrievalCandidate[]): Record<string, number> {
    const counts: Record<string, number> = { file: 0, artifact: 0, metadata: 0, semantic: 0, graph: 0, graph_variant: 0, total: candidates.length };
    for (const candidate of candidates) {
      const layers = uniqueStrings([candidate.kind, ...arrayOfStrings(candidate.output.retrievalMergedKinds)]);
      for (const layer of layers) {
        if (layer in counts) counts[layer] += 1;
      }
    }
    return counts;
  }

  private topRetrievalSignalTotals(candidates: RetrievalCandidate[], limit: number): Record<string, number> {
    const totals = new Map<string, number>();
    for (const candidate of candidates) {
      for (const [key, value] of Object.entries(candidate.signals)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        totals.set(key, roundRetrievalScore((totals.get(key) ?? 0) + value));
      }
    }
    return Object.fromEntries([...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit));
  }

  private retrievalRelationshipFamilyCounts(candidates: RetrievalCandidate[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const candidate of candidates) {
      const family = this.retrievalRelationshipFamily(candidate);
      counts[family] = (counts[family] ?? 0) + 1;
    }
    return counts;
  }

  private retrievalMissingReasons(input: {
    queryPlan: SearchQueryPlan;
    diagnostics: SearchRetrievalDiagnostics;
    inventorySummary: ReturnType<WorkspaceDatabase['getProjectInventorySummary']>;
    structureSummary: ReturnType<WorkspaceDatabase['getProjectStructureSummary']>;
    graphSummary: ReturnType<WorkspaceDatabase['getProjectGraphSummary']>;
    semanticSummary: ReturnType<WorkspaceDatabase['getProjectSemanticSummary']>;
  }): Array<Record<string, unknown>> {
    const reasons: Array<Record<string, unknown>> = [];
    const candidateCounts = input.diagnostics.candidateCountsByLayer;
    const selectedCounts = input.diagnostics.selectedCountsByLayer;
    if (input.semanticSummary.status !== 'ready') {
      reasons.push({
        code: `semantic_index_${input.semanticSummary.status}`,
        message: `Semantic index is ${input.semanticSummary.status}; semantic retrieval may be incomplete.`,
        status: input.semanticSummary.status,
        enabled: input.semanticSummary.enabled,
        chunkCount: input.semanticSummary.chunkCount,
        sourceDocumentCount: input.semanticSummary.sourceDocumentCount,
        indexedSourceDocumentCount: input.semanticSummary.indexedSourceDocumentCount,
        jobReason: input.semanticSummary.jobReason,
        lastError: input.semanticSummary.lastError
      });
    }
    if (numberValue(candidateCounts.semantic, 0) > 0 && numberValue(selectedCounts.semantic, 0) === 0) {
      reasons.push({
        code: 'semantic_candidates_not_selected',
        message: 'Semantic candidates were available but ranking, merge, or diversification did not select a standalone semantic result.',
        candidateCount: candidateCounts.semantic
      });
    }
    if (input.graphSummary.status !== 'ready') {
      reasons.push({
        code: `graph_index_${input.graphSummary.status}`,
        message: `Graph index is ${input.graphSummary.status}; graph retrieval may be incomplete.`,
        status: input.graphSummary.status,
        nodeCount: input.graphSummary.nodeCount,
        edgeCount: input.graphSummary.edgeCount,
        staleReasons: input.graphSummary.staleReasons,
        rebuildReason: input.graphSummary.rebuildReason
      });
    } else if (input.graphSummary.nodeCount > 0 && input.diagnostics.graphExpansionCount === 0) {
      reasons.push({
        code: 'graph_ready_no_expansion',
        message: 'Graph is ready but no graph expansion candidates were produced; top candidates may lack entity ids or matching graph nodes.',
        nodeCount: input.graphSummary.nodeCount,
        edgeCount: input.graphSummary.edgeCount
      });
    }
    if (input.queryPlan.intents.includes('route_api_lookup')) {
      if (input.structureSummary.routeCount === 0) {
        reasons.push({
          code: 'route_intent_no_routes_indexed',
          message: 'Query was classified as route/API lookup, but no route entities are indexed.',
          indexedFileCount: input.structureSummary.indexedFileCount,
          entityCount: input.structureSummary.entityCount
        });
      }
      if ((input.graphSummary.edgeFamilyCounts.routes_to ?? 0) === 0 && (input.graphSummary.edgeFamilyCounts.handles_with ?? 0) === 0) {
        reasons.push({
          code: 'route_intent_no_route_graph_edges',
          message: 'Query was classified as route/API lookup, but graph has no route/controller edges.',
          routesToEdges: input.graphSummary.edgeFamilyCounts.routes_to ?? 0,
          handlesWithEdges: input.graphSummary.edgeFamilyCounts.handles_with ?? 0
        });
      }
    }
    if (input.queryPlan.intents.includes('auth_permission_question') && (input.graphSummary.edgeFamilyCounts.checks_permission ?? 0) === 0 && (input.graphSummary.edgeFamilyCounts.references_permission ?? 0) === 0) {
      reasons.push({
        code: 'auth_intent_no_permission_edges',
        message: 'Query was classified as auth/permission, but graph has no permission-check edges.',
        checksPermissionEdges: input.graphSummary.edgeFamilyCounts.checks_permission ?? 0,
        referencesPermissionEdges: input.graphSummary.edgeFamilyCounts.references_permission ?? 0
      });
    }
    if (input.queryPlan.intents.includes('sink_data_flow_question') && (input.graphSummary.edgeFamilyCounts.reaches_sink ?? 0) === 0 && (input.graphSummary.edgeFamilyCounts.reads_model ?? 0) === 0 && (input.graphSummary.edgeFamilyCounts.writes_model ?? 0) === 0) {
      reasons.push({
        code: 'sink_intent_no_data_flow_edges',
        message: 'Query was classified as sink/data-flow, but graph has no sink or model read/write edges.',
        reachesSinkEdges: input.graphSummary.edgeFamilyCounts.reaches_sink ?? 0,
        readsModelEdges: input.graphSummary.edgeFamilyCounts.reads_model ?? 0,
        writesModelEdges: input.graphSummary.edgeFamilyCounts.writes_model ?? 0
      });
    }
    if (input.queryPlan.intents.includes('binary_orientation') && input.inventorySummary.binaryCount === 0 && (input.graphSummary.edgeFamilyCounts.imports_symbol ?? 0) === 0 && (input.graphSummary.edgeFamilyCounts.exports_symbol ?? 0) === 0 && (input.graphSummary.edgeFamilyCounts.contains_string ?? 0) === 0) {
      reasons.push({
        code: 'binary_intent_no_binary_index',
        message: 'Query was classified as binary orientation, but no scoped binaries or binary graph edges are indexed.',
        binaryCount: input.inventorySummary.binaryCount
      });
    }
    if (input.queryPlan.intents.includes('prior_research_memory') && (input.graphSummary.nodeFamilyCounts.hypothesis ?? 0) === 0 && (input.graphSummary.nodeFamilyCounts.finding ?? 0) === 0 && (input.graphSummary.nodeFamilyCounts.evidence ?? 0) === 0) {
      reasons.push({
        code: 'research_memory_intent_no_memory_nodes',
        message: 'Query was classified as prior research memory, but graph has no hypothesis, finding, or evidence nodes.',
        hypothesisNodes: input.graphSummary.nodeFamilyCounts.hypothesis ?? 0,
        findingNodes: input.graphSummary.nodeFamilyCounts.finding ?? 0,
        evidenceNodes: input.graphSummary.nodeFamilyCounts.evidence ?? 0
      });
    }
    if (input.queryPlan.intents.includes('variant_similarity_search') && numberValue(candidateCounts.graph_variant, 0) === 0) {
      reasons.push({
        code: 'variant_intent_no_variant_candidates',
        message: 'Query was classified as variant/similarity search, but no graph-variant candidates were produced.',
        graphExpansionCount: input.diagnostics.graphExpansionCount
      });
    }
    return reasons;
  }

  private retrievalOperationalHints(input: {
    queryPlan: SearchQueryPlan;
    diagnostics: SearchRetrievalDiagnostics;
    inventorySummary: ReturnType<WorkspaceDatabase['getProjectInventorySummary']>;
    structureSummary: ReturnType<WorkspaceDatabase['getProjectStructureSummary']>;
    graphSummary: ReturnType<WorkspaceDatabase['getProjectGraphSummary']>;
    semanticSummary: ReturnType<WorkspaceDatabase['getProjectSemanticSummary']>;
    sourceHint: string | null;
    missingReasons: Array<Record<string, unknown>>;
  }): Array<Record<string, unknown>> {
    const hints: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const add = (layer: string, code: string, message: string, action: string, details: Record<string, unknown> = {}) => {
      if (seen.has(code)) return;
      seen.add(code);
      hints.push({ layer, code, message, action, ...details });
    };

    if (input.sourceHint) {
      add('source', 'materialize_source', input.sourceHint, 'Use the source tool to materialize the scoped repository, then rerun search.');
    }
    if (input.inventorySummary.itemCount === 0 && !input.inventorySummary.indexedAt) {
      add('inventory', 'run_indexing', 'Project inventory is empty.', 'Run project indexing or materialize source before relying on metadata, structure, semantic, or graph retrieval.');
    }
    if (input.structureSummary.status !== 'ready' || input.structureSummary.entityCount === 0) {
      add('structure', 'run_structural_indexing', `Structural index is ${input.structureSummary.status}.`, 'Run indexing so route, symbol, call-site, sink, and permission entities are available.', {
        status: input.structureSummary.status,
        entityCount: input.structureSummary.entityCount,
        indexedFileCount: input.structureSummary.indexedFileCount
      });
    }

    if (input.semanticSummary.status === 'disabled') {
      add('semantic', 'enable_semantic_index', 'Semantic index is disabled.', 'Enable semantic indexing for the program if semantic or concept search is needed.');
    } else if (input.semanticSummary.status === 'empty') {
      add('semantic', 'run_semantic_indexing', 'Semantic index is empty.', 'Run semantic indexing from Settings or wait for the background indexer to populate chunks.', {
        sourceDocumentCount: input.semanticSummary.sourceDocumentCount
      });
    } else if (input.semanticSummary.status === 'stale') {
      add('semantic', 'rebuild_semantic_index', 'Semantic index is stale.', 'Rebuild semantic indexing so new or changed project documents are searchable.', {
        indexedSourceDocumentCount: input.semanticSummary.indexedSourceDocumentCount,
        sourceDocumentCount: input.semanticSummary.sourceDocumentCount
      });
    } else if (input.semanticSummary.status === 'queued' || input.semanticSummary.status === 'indexing') {
      add('semantic', 'wait_for_semantic_indexing', `Semantic index is ${input.semanticSummary.status}.`, 'Wait for the background semantic indexer to finish, then rerun search.', {
        progressProcessed: input.semanticSummary.progressProcessed,
        progressTotal: input.semanticSummary.progressTotal
      });
    } else if (input.semanticSummary.status === 'error') {
      add('semantic', 'inspect_semantic_index_error', 'Semantic indexing failed.', 'Inspect semantic index status and retry rebuild after resolving the error.', {
        lastError: input.semanticSummary.lastError
      });
    }

    if (input.graphSummary.status === 'empty') {
      add('graph', 'run_graph_indexing', 'Graph index is empty.', 'Run indexing so graph proximity and variant retrieval can use inventory, structure, and research-memory relationships.');
    } else if (input.graphSummary.status === 'stale') {
      add('graph', 'rebuild_graph_index', 'Graph index is stale.', 'Rebuild graph indexing before relying on graph retrieval.', {
        staleReasons: input.graphSummary.staleReasons,
        rebuildReason: input.graphSummary.rebuildReason
      });
    } else if (input.graphSummary.status !== 'ready') {
      add('graph', 'inspect_graph_index', `Graph index is ${input.graphSummary.status}.`, 'Inspect graph status before relying on graph retrieval.');
    } else if (input.graphSummary.nodeCount > 0 && input.diagnostics.graphExpansionCount === 0) {
      add('graph', 'no_graph_seed_entities', 'Graph is ready but search produced no graph expansion.', 'Search for a precise symbol, route, file, or research-memory term that maps to indexed graph entities.', {
        nodeCount: input.graphSummary.nodeCount,
        edgeCount: input.graphSummary.edgeCount
      });
    }

    if (input.queryPlan.intents.includes('route_api_lookup')) {
      if (input.structureSummary.routeCount === 0) {
        add('structure', 'no_route_entities', 'No route entities are indexed.', 'Run structural indexing or verify the target uses a supported route framework.');
      }
      if ((input.graphSummary.edgeFamilyCounts.routes_to ?? 0) === 0) {
        add('graph', 'graph_has_no_routes_to_edges', 'Graph has no routes_to edges.', 'Run graph indexing after structural route extraction, or verify route/controller extraction supports this framework.', {
          handlesWithEdges: input.graphSummary.edgeFamilyCounts.handles_with ?? 0
        });
      }
    }
    if (input.queryPlan.intents.includes('auth_permission_question') && (input.graphSummary.edgeFamilyCounts.checks_permission ?? 0) === 0 && (input.graphSummary.edgeFamilyCounts.references_permission ?? 0) === 0) {
      add('graph', 'graph_has_no_permission_edges', 'Graph has no permission-check edges.', 'Run structural and graph indexing, or inspect whether permission checks use unsupported framework patterns.');
    }
    if (input.queryPlan.intents.includes('sink_data_flow_question') && (input.graphSummary.edgeFamilyCounts.reaches_sink ?? 0) === 0 && (input.graphSummary.edgeFamilyCounts.reads_model ?? 0) === 0 && (input.graphSummary.edgeFamilyCounts.writes_model ?? 0) === 0) {
      add('graph', 'graph_has_no_sink_or_model_edges', 'Graph has no sink or model read/write edges.', 'Run structural and graph indexing, or inspect whether sink/model patterns are unsupported.');
    }
    if (input.queryPlan.intents.includes('binary_orientation') && input.inventorySummary.binaryCount === 0) {
      add('inventory', 'no_binaries_indexed', 'No scoped binaries are indexed.', 'Import or scope binary artifacts before relying on binary orientation search.');
    }
    if (input.queryPlan.intents.includes('prior_research_memory') && (input.graphSummary.nodeFamilyCounts.hypothesis ?? 0) === 0 && (input.graphSummary.nodeFamilyCounts.finding ?? 0) === 0 && (input.graphSummary.nodeFamilyCounts.evidence ?? 0) === 0) {
      add('research_memory', 'no_research_memory_nodes', 'No research-memory graph nodes are indexed.', 'Create or import hypotheses, findings, or evidence before relying on prior research traversal.');
    }
    if (input.queryPlan.intents.includes('variant_similarity_search') && numberValue(input.diagnostics.candidateCountsByLayer.graph_variant, 0) === 0) {
      add('graph', 'no_variant_candidates', 'No graph-backed variant candidates were produced.', 'Seed the search with an indexed route, handler, sink, permission, binary symbol, hypothesis, or finding.');
    }

    for (const reason of input.missingReasons) {
      const code = stringValue(reason.code, '');
      if (code === 'semantic_candidates_not_selected') {
        add('ranking', 'semantic_candidates_not_selected', 'Semantic candidates were available but not selected.', 'Broaden the query or inspect retrievalSignals to see whether exact, graph, or negative-confidence signals dominated.');
      }
    }
    return hints.slice(0, 12);
  }

  private retrievalSourcePathCap(queryPlan: SearchQueryPlan): number {
    const asksForOneThing =
      queryPlan.intents.includes('symbol_lookup') &&
      !queryPlan.intents.includes('route_api_lookup') &&
      !queryPlan.intents.includes('variant_similarity_search') &&
      queryPlan.terms.length <= 3;
    const fileLike = /(?:^|\s|\/)[\w.-]+\.(?:[a-z0-9]{1,8})(?:\s|$)/i.test(queryPlan.raw);
    return asksForOneThing || fileLike ? 10 : 4;
  }

  private retrievalFamilyCap(queryPlan: SearchQueryPlan): number {
    return queryPlan.intents.includes('variant_similarity_search') ? 6 : 5;
  }

  private retrievalRelationshipFamily(candidate: RetrievalCandidate): string {
    const edgeKinds = uniqueStrings([candidate.provenance.graphEdgeKind ?? '', stringValue(candidate.output.graphEdgeKind, ''), ...arrayOfStrings(candidate.output.retrievalGraphEdgeKinds)]);
    if (edgeKinds.some((edgeKind) => ['routes_to', 'handles_with', 'uses_middleware'].includes(edgeKind))) return 'route_controller';
    if (edgeKinds.some((edgeKind) => ['checks_permission', 'references_permission'].includes(edgeKind))) return 'auth_permission';
    if (edgeKinds.some((edgeKind) => ['reaches_sink', 'reads_model', 'writes_model', 'parses_body', 'serializes_response'].includes(edgeKind))) return 'sink_data_flow';
    if (edgeKinds.some((edgeKind) => ['imports_symbol', 'exports_symbol', 'contains_string', 'references_url'].includes(edgeKind))) return 'binary_orientation';
    if (edgeKinds.some((edgeKind) => ['affects_component', 'classified_as_cwe', 'supports_hypothesis', 'supports_finding', 'supported_by_evidence', 'verifies_finding', 'backs_evidence'].includes(edgeKind))) return 'research_memory';
    if (candidate.kind === 'semantic' || arrayOfStrings(candidate.output.retrievalMergedKinds).includes('semantic')) return 'semantic';
    if (candidate.entityType === 'structure_entity' || candidate.namespace === 'structure') return 'structure';
    if (candidate.kind === 'file') return 'lexical';
    return candidate.kind || 'other';
  }

  private searchMatchToRetrievalCandidate(match: Record<string, unknown>): RetrievalCandidate {
    const kind = stringValue(match.kind, 'unknown');
    const entityType = stringValue(match.entityType, '') || this.inferSearchMatchEntityType(match);
    const entityId = stringValue(match.entityId, '') || this.inferSearchMatchEntityId(match, entityType);
    const sourcePath = stringValue(match.sourcePath, '') || stringValue(match.path, '') || null;
    const range = stringValue(match.range, '') || (numberValue(match.line, 0) > 0 ? String(numberValue(match.line, 0)) : null);
    const namespace = stringValue(match.namespace, '') || this.searchMatchNamespace(match);
    return {
      output: match,
      kind,
      entityType: entityType || null,
      entityId: entityId || null,
      sourcePath,
      range,
      namespace,
      score: 0,
      signals: {},
      provenance: {
        source: kind,
        matchedBy: stringValue(match.matchedBy, '') || null,
        seedEntityType: stringValue(match.seedEntityType, '') || null,
        seedEntityId: stringValue(match.seedEntityId, '') || null,
        graphEdgeKind: stringValue(match.graphEdgeKind, '') || null
      }
    };
  }

  private inferSearchMatchEntityType(match: Record<string, unknown>): string {
    const kind = stringValue(match.kind, '');
    if (kind === 'file') return 'file';
    if (kind === 'artifact') return 'artifact';
    return '';
  }

  private inferSearchMatchEntityId(match: Record<string, unknown>, entityType: string): string {
    if (entityType === 'file') {
      const path = stringValue(match.path, '') || stringValue(match.sourcePath, '');
      const range = stringValue(match.range, '');
      const snippet = stringValue(match.snippet, '');
      return path ? `file:${path}:${range}:${snippet}` : '';
    }
    if (entityType === 'artifact') return stringValue(match.artifactId, '');
    return '';
  }

  private searchMatchNamespace(match: Record<string, unknown>): string {
    const kind = stringValue(match.kind, '');
    if (kind === 'file') return stringValue(match.binaryDerived, '') === 'true' || match.binaryDerived === true ? 'binary' : 'source';
    if (kind === 'artifact') return 'artifact';
    if (kind === 'metadata') {
      const entityType = stringValue(match.entityType, '');
      if (entityType === 'structure_entity') return 'structure';
      if (entityType === 'inventory_item') return 'inventory';
      return 'metadata';
    }
    if (kind === 'graph' || kind === 'graph_variant') return 'graph';
    return kind || 'unknown';
  }

  private retrievalCandidateScore(
    candidate: RetrievalCandidate,
    graphContext: { graphEntityKeys: Set<string>; graphSourcePaths: Set<string>; seedEntityKeys: Set<string>; queryPlan: SearchQueryPlan; feedback: RetrievalFeedbackContext }
  ): { total: number; signals: Record<string, number | string[]> } {
    const entityKey = this.retrievalCandidateEntityKey(candidate);
    const graphSeedBoost = entityKey && graphContext.seedEntityKeys.has(entityKey) ? 8 : 0;
    const mergedGraphEdgeKinds = arrayOfStrings(candidate.output.retrievalGraphEdgeKinds);
    const graphProximity =
      candidate.kind === 'graph' || candidate.kind === 'graph_variant'
        ? this.graphEdgeRetrievalWeight(candidate.provenance.graphEdgeKind ?? '')
        : mergedGraphEdgeKinds.length > 0
          ? Math.max(...mergedGraphEdgeKinds.map((edgeKind) => this.graphEdgeRetrievalWeight(edgeKind)))
        : (entityKey && graphContext.graphEntityKeys.has(entityKey)) || (candidate.sourcePath && graphContext.graphSourcePaths.has(candidate.sourcePath))
          ? 6
          : 0;
    const textRelevance = this.retrievalTextRelevanceScore(candidate, graphContext.queryPlan);
    const exactIdentifierPath = this.retrievalExactIdentifierPathScore(candidate, graphContext.queryPlan);
    const structuralFit = this.retrievalStructuralFitScore(candidate);
    const semanticSimilarity = this.retrievalSemanticSimilarityScore(candidate);
    const researchMemory = this.retrievalResearchMemoryScore(candidate);
    const securityRelevance = this.retrievalSecurityRelevanceScore(candidate);
    const scopeConfidence = this.retrievalScopeConfidenceScore(candidate);
    const recency = this.retrievalRecencyScore(candidate);
    const queryIntent = this.retrievalQueryIntentScore(candidate, graphContext.queryPlan);
    const sourceType = this.retrievalSourceTypeScore(candidate);
    const linePrecision = numberValue(candidate.output.line, 0) > 0 || candidate.range ? 2 : 0;
    const sourceBacked = candidate.sourcePath ? 2 : 0;
    const learningFeedback = this.retrievalLearningFeedbackScore(candidate, graphContext.feedback);
    const negativeConfidence = this.retrievalNegativeConfidencePenalty(candidate);
    const total = roundRetrievalScore(
      textRelevance +
        exactIdentifierPath +
        structuralFit +
        semanticSimilarity +
        graphSeedBoost +
        graphProximity +
        researchMemory +
        securityRelevance +
        scopeConfidence +
        recency +
        queryIntent +
        sourceType +
        linePrecision +
        sourceBacked -
        negativeConfidence +
        learningFeedback
    );
    const reasons = [
      textRelevance > 0 ? 'text relevance' : '',
      exactIdentifierPath > 0 ? 'exact identifier/path match' : '',
      structuralFit > 0 ? 'structural fit' : '',
      semanticSimilarity > 0 ? 'semantic similarity' : '',
      graphSeedBoost > 0 ? 'graph seed' : '',
      graphProximity > 0 ? 'graph proximity' : '',
      researchMemory > 0 ? 'evidence/research-memory linkage' : '',
      securityRelevance > 0 ? 'security relevance' : '',
      scopeConfidence > 0 ? 'scope confidence' : '',
      recency > 0 ? 'recency' : '',
      queryIntent > 0 ? 'query intent fit' : '',
      linePrecision > 0 ? 'line/range provenance' : '',
      sourceBacked > 0 ? 'source-backed' : '',
      learningFeedback > 0 ? 'cross-run learning feedback' : '',
      learningFeedback < 0 ? 'negative cross-run feedback' : '',
      negativeConfidence > 0 ? 'negative/low-confidence research state' : ''
    ].filter(Boolean);
    return {
      total,
      signals: {
        textRelevance,
        exactIdentifierPath,
        structuralFit,
        semanticSimilarity,
        graphSeed: graphSeedBoost,
        graphProximity,
        researchMemory,
        securityRelevance,
        scopeConfidence,
        recency,
        queryIntent,
        queryIntents: graphContext.queryPlan.intents,
        sourceType,
        linePrecision,
        sourceBacked,
        learningFeedback,
        negativeConfidence,
        reasons
      }
    };
  }

  private retrievalTextRelevanceScore(candidate: RetrievalCandidate, queryPlan: SearchQueryPlan): number {
    const text = this.retrievalCandidateSearchText(candidate);
    if (!text) return 0;
    const lower = text.toLowerCase();
    const rawLower = queryPlan.rawLower.trim();
    const exactQuery = rawLower && lower.includes(rawLower) ? 10 : 0;
    const matchedTerms = queryPlan.terms.filter((term) => lower.includes(term.toLowerCase()));
    const coverage = queryPlan.terms.length > 0 ? matchedTerms.length / queryPlan.terms.length : 0;
    const matchedBy = stringValue(candidate.output.matchedBy, '');
    const sourceMatch = matchedBy && matchedBy !== 'project_metadata_fts' && matchedBy !== 'project_semantic_hybrid_local_hash' ? 3 : 0;
    const ftsRank = candidate.kind === 'metadata' ? Math.min(4, Math.max(0, numberValue(candidate.output.rank, 0) / 3)) : 0;
    return roundRetrievalScore(Math.min(22, exactQuery + coverage * 9 + Math.min(3, matchedTerms.length) + sourceMatch + ftsRank));
  }

  private retrievalExactIdentifierPathScore(candidate: RetrievalCandidate, queryPlan: SearchQueryPlan): number {
    const raw = normalizeRetrievalIdentifier(queryPlan.raw);
    const terms = queryPlan.terms.map((term) => normalizeRetrievalIdentifier(term)).filter(Boolean);
    if (!raw && terms.length === 0) return 0;
    const path = normalizeRetrievalIdentifier(candidate.sourcePath ?? '');
    const basenameText = normalizeRetrievalIdentifier(candidate.sourcePath ? basename(candidate.sourcePath) : '');
    const title = normalizeRetrievalIdentifier(stringValue(candidate.output.title, ''));
    const name = normalizeRetrievalIdentifier(stringValue(candidate.output.structureName, '') || stringValue(candidate.output.graphTargetLabel, ''));
    const entityId = normalizeRetrievalIdentifier(candidate.entityId ?? '');
    const exactTargets = [path, basenameText, title, name, entityId].filter(Boolean);
    if (raw && exactTargets.some((target) => target === raw || target.endsWith(raw) || target.includes(raw))) return 18;
    const hits = terms.filter((term) => exactTargets.some((target) => target === term || target.includes(term))).length;
    return roundRetrievalScore(Math.min(14, hits * 4));
  }

  private retrievalStructuralFitScore(candidate: RetrievalCandidate): number {
    const entityKind = stringValue(candidate.output.entityKind, '') || stringValue(candidate.output.nodeKind, '') || stringValue(candidate.output.metadata && (candidate.output.metadata as Record<string, unknown>).entityKind, '');
    const structuralKinds = new Set([
      'route',
      'function',
      'method',
      'class',
      'type',
      'call_site',
      'sink',
      'security_marker',
      'permission_marker',
      'model_read',
      'model_write',
      'request_body_parse',
      'response_serialization',
      'binary_imported_symbol',
      'binary_exported_symbol',
      'binary_string',
      'mobile_permission',
      'web_endpoint',
      'graphql_operation'
    ]);
    const structureEntity = candidate.entityType === 'structure_entity' || candidate.namespace === 'structure';
    const entityKindScore = structuralKinds.has(entityKind) ? 8 : structureEntity ? 5 : 0;
    const routeControllerModel = ['route', 'handles_with', 'routes_to', 'reads_model', 'writes_model'].includes(stringValue(candidate.output.graphEdgeKind, '')) ? 4 : 0;
    const preciseRange = numberValue(candidate.output.line, 0) > 0 || Boolean(candidate.range) ? 2 : 0;
    return Math.min(14, entityKindScore + routeControllerModel + preciseRange);
  }

  private retrievalSemanticSimilarityScore(candidate: RetrievalCandidate): number {
    if (candidate.kind !== 'semantic' && !arrayOfStrings(candidate.output.retrievalMergedKinds).includes('semantic')) return 0;
    const semanticScore = Math.min(16, Math.max(numberValue(candidate.output.semanticScore, 0), numberValue(candidate.output.retrievalSemanticScore, 0)) * 16);
    const vectorScore = Math.min(5, Math.max(numberValue(candidate.output.vectorScore, 0), numberValue(candidate.output.retrievalVectorScore, 0)) * 5);
    const lexicalScore = Math.min(4, Math.max(numberValue(candidate.output.lexicalScore, 0), numberValue(candidate.output.retrievalLexicalScore, 0)) * 4);
    return roundRetrievalScore(Math.min(22, semanticScore + vectorScore + lexicalScore));
  }

  private retrievalResearchMemoryScore(candidate: RetrievalCandidate): number {
    const entityType = candidate.entityType ?? '';
    const edgeKinds = uniqueStrings([candidate.provenance.graphEdgeKind ?? '', ...arrayOfStrings(candidate.output.retrievalGraphEdgeKinds)]);
    const metadata = retrievalMetadata(candidate);
    const researchEntity = ['hypothesis', 'finding', 'evidence', 'verifier_run', 'verifier_contract', 'artifact', 'trace_event'].includes(entityType) ? 6 : 0;
    const evidenceEdge = edgeKinds.some((edgeKind) => [
      'affects_component',
      'classified_as_cwe',
      'supports_hypothesis',
      'supports_finding',
      'supported_by_evidence',
      'verifies_hypothesis',
      'verifies_finding',
      'verified_by_contract',
      'verifier_passed_hypothesis',
      'verifier_passed_finding',
      'backs_evidence',
      'observed_in_trace'
    ].includes(edgeKind))
      ? 8
      : 0;
    const linked = ['hypothesisId', 'findingId', 'artifactId', 'verifierRunId', 'observationTraceEventId'].some((key) => Boolean(metadata[key])) ? 4 : 0;
    const priority = Math.min(4, Math.max(0, numberValue(metadata.priorityScore, 0) / 8));
    return roundRetrievalScore(Math.min(16, researchEntity + evidenceEdge + linked + priority));
  }

  private retrievalNegativeConfidencePenalty(candidate: RetrievalCandidate): number {
    const metadata = retrievalMetadata(candidate);
    const semanticRanking = metadata.semanticRanking && typeof metadata.semanticRanking === 'object' && !Array.isArray(metadata.semanticRanking) ? (metadata.semanticRanking as Record<string, unknown>) : {};
    const states = uniqueStrings([
      stringValue(metadata.state, ''),
      stringValue(candidate.output.state, ''),
      ...this.retrievalStatesFromNodeKind(candidate)
    ]).map((state) => state.trim().toLowerCase().replace(/-/g, '_'));
    let penalty = 0;
    if (states.some((state) => state === 'duplicate')) penalty += 10;
    if (states.some((state) => ['dismissed', 'false_positive', 'invalid', 'not_reproducible', 'out_of_scope'].includes(state))) penalty += 14;
    if (states.some((state) => ['needs_evidence', 'open', 'unverified'].includes(state))) penalty += 3;
    if (metadata.duplicateOf || candidate.provenance.graphEdgeKind === 'duplicates' || arrayOfStrings(candidate.output.retrievalGraphEdgeKinds).includes('duplicates')) penalty += 6;
    if (candidate.provenance.graphEdgeKind?.startsWith('has_duplicate') || arrayOfStrings(candidate.output.retrievalGraphEdgeKinds).some((edgeKind) => edgeKind.startsWith('has_duplicate'))) penalty += 3;
    penalty += Math.min(10, numberValue(semanticRanking.duplicateRiskPenalty, 0) * 40);
    const evidenceConfidence = Number.parseFloat(stringValue(metadata.evidenceConfidence, ''));
    if (Number.isFinite(evidenceConfidence) && evidenceConfidence <= 0) penalty += 2;
    const scopeConfidence = Number.parseFloat(stringValue(metadata.scopeConfidence, ''));
    if (Number.isFinite(scopeConfidence) && scopeConfidence <= 0) penalty += 2;
    return roundRetrievalScore(Math.min(22, penalty));
  }

  private retrievalLearningFeedbackScore(candidate: RetrievalCandidate, feedback: RetrievalFeedbackContext): number {
    let score = 0;
    if (candidate.sourcePath) {
      score += Math.min(6, (feedback.readPathCounts.get(candidate.sourcePath) ?? 0) * 2);
    }
    const entityKey = this.retrievalCandidateEntityKey(candidate);
    if (entityKey && feedback.verifiedEntityKeys.has(entityKey)) score += 8;
    if (entityKey && feedback.correctedNegativeEntityKeys.has(entityKey)) score -= 4;
    for (const contributor of retrievalCandidateContributors(candidate)) {
      const contributorEntityType = stringValue(contributor.entityType, '');
      const contributorEntityId = stringValue(contributor.entityId, '');
      const contributorSourcePath = stringValue(contributor.sourcePath, '') || stringValue(contributor.path, '');
      const contributorEntityKey = contributorEntityType && contributorEntityId ? `${contributorEntityType}:${contributorEntityId}` : '';
      if (contributorSourcePath) score += Math.min(2, feedback.readPathCounts.get(contributorSourcePath) ?? 0);
      if (contributorEntityKey && feedback.verifiedEntityKeys.has(contributorEntityKey)) score += 4;
      if (contributorEntityKey && feedback.correctedNegativeEntityKeys.has(contributorEntityKey)) score -= 2;
    }
    return roundRetrievalScore(Math.max(-8, Math.min(12, score)));
  }

  private retrievalStatesFromNodeKind(candidate: RetrievalCandidate): string[] {
    const values = [stringValue(candidate.output.nodeKind, ''), stringValue(retrievalMetadata(candidate).nodeKind, '')];
    return values.flatMap((value) => {
      const [, state] = /^(?:hypothesis|finding):(.+)$/.exec(value) ?? [];
      return state ? [state] : [];
    });
  }

  private retrievalSecurityRelevanceScore(candidate: RetrievalCandidate): number {
    const text = this.retrievalCandidateSearchText(candidate).toLowerCase();
    const entityKind = stringValue(candidate.output.entityKind, '') || stringValue(retrievalMetadata(candidate).entityKind, '');
    const edgeKinds = uniqueStrings([candidate.provenance.graphEdgeKind ?? '', ...arrayOfStrings(candidate.output.retrievalGraphEdgeKinds)]);
    let score = 0;
    if (['sink', 'security_marker', 'permission_marker', 'mobile_permission', 'binary_imported_symbol', 'binary_string'].includes(entityKind)) score += 8;
    if (edgeKinds.some((edgeKind) => ['checks_permission', 'reaches_sink', 'references_permission'].includes(edgeKind))) score += 8;
    const securityTerms = ['auth', 'permission', 'token', 'secret', 'sink', 'cwe', 'vulnerability', 'exploit', 'injection', 'xss', 'ssrf', 'deserialization', 'path traversal', 'crypto'];
    const hits = securityTerms.filter((term) => text.includes(term)).length;
    score += Math.min(8, hits * 2);
    const semanticSecurity = numberValue(retrievalMetadata(candidate).semanticRanking && (retrievalMetadata(candidate).semanticRanking as Record<string, unknown>).securityScore, 0);
    score += Math.min(4, semanticSecurity * 10);
    return roundRetrievalScore(Math.min(16, score));
  }

  private retrievalScopeConfidenceScore(candidate: RetrievalCandidate): number {
    const metadata = retrievalMetadata(candidate);
    const scopeConfidence = stringValue(metadata.scopeConfidence, '');
    const evidenceConfidence = stringValue(metadata.evidenceConfidence, '');
    const prefixedScope = Number.parseFloat(scopeConfidence);
    const prefixedEvidence = Number.parseFloat(evidenceConfidence);
    const explicitScope = Number.isFinite(prefixedScope) ? Math.min(4, Math.max(0, prefixedScope)) : scopeConfidence ? 1 : 0;
    const explicitEvidence = Number.isFinite(prefixedEvidence) ? Math.min(3, Math.max(0, prefixedEvidence)) : evidenceConfidence ? 1 : 0;
    const sourceBacked = candidate.sourcePath ? 2 : 0;
    const runBacked = stringValue(candidate.output.runId, '') || stringValue(metadata.runId, '') ? 1 : 0;
    return roundRetrievalScore(Math.min(8, explicitScope + explicitEvidence + sourceBacked + runBacked));
  }

  private retrievalRecencyScore(candidate: RetrievalCandidate): number {
    const metadata = retrievalMetadata(candidate);
    const timestamp =
      stringValue(candidate.output.updatedAt, '') ||
      stringValue(candidate.output.indexedAt, '') ||
      stringValue(candidate.output.createdAt, '') ||
      stringValue(metadata.updatedAt, '') ||
      stringValue(metadata.indexedAt, '') ||
      stringValue(metadata.createdAt, '');
    if (!timestamp) return 0;
    const parsed = Date.parse(timestamp);
    if (!Number.isFinite(parsed)) return 0;
    const ageMs = Math.max(0, Date.now() - parsed);
    const dayMs = 24 * 60 * 60 * 1000;
    if (ageMs <= dayMs) return 4;
    if (ageMs <= 7 * dayMs) return 3;
    if (ageMs <= 30 * dayMs) return 2;
    if (ageMs <= 180 * dayMs) return 1;
    return 0;
  }

  private retrievalQueryIntentScore(candidate: RetrievalCandidate, queryPlan: SearchQueryPlan): number {
    if (queryPlan.intents.length === 0) return 0;
    const scores = queryPlan.intents.map((intent) => this.retrievalSingleQueryIntentScore(candidate, intent));
    return Math.min(12, Math.max(...scores, 0));
  }

  private retrievalSingleQueryIntentScore(candidate: RetrievalCandidate, intent: SearchQueryIntent): number {
    const entityType = candidate.entityType ?? '';
    const entityKind = stringValue(candidate.output.entityKind, '') || stringValue(retrievalMetadata(candidate).entityKind, '');
    const edgeKinds = uniqueStrings([candidate.provenance.graphEdgeKind ?? '', stringValue(candidate.output.graphEdgeKind, ''), ...arrayOfStrings(candidate.output.retrievalGraphEdgeKinds)]);
    const namespace = candidate.namespace;
    const text = this.retrievalCandidateSearchText(candidate).toLowerCase();
    if (intent === 'symbol_lookup') {
      if (['function', 'method', 'class', 'type', 'call_site', 'export', 'import', 'binary_symbol', 'binary_imported_symbol', 'binary_exported_symbol'].includes(entityKind)) return 10;
      if (entityType === 'structure_entity') return 6;
      if (candidate.kind === 'file') return 4;
      return 0;
    }
    if (intent === 'route_api_lookup') {
      if (['route', 'web_endpoint', 'graphql_operation'].includes(entityKind)) return 10;
      if (edgeKinds.some((edgeKind) => ['routes_to', 'handles_with', 'uses_middleware'].includes(edgeKind))) return 8;
      if (text.includes('/api') || text.includes('endpoint') || text.includes('controller')) return 4;
      return 0;
    }
    if (intent === 'auth_permission_question') {
      if (['security_marker', 'permission_marker', 'mobile_permission'].includes(entityKind)) return 10;
      if (edgeKinds.some((edgeKind) => ['checks_permission', 'references_permission', 'uses_middleware'].includes(edgeKind))) return 9;
      if (text.includes('auth') || text.includes('permission') || text.includes('guard')) return 5;
      return 0;
    }
    if (intent === 'sink_data_flow_question') {
      if (['sink', 'model_read', 'model_write', 'request_body_parse', 'response_serialization'].includes(entityKind)) return 10;
      if (edgeKinds.some((edgeKind) => ['reaches_sink', 'reads_model', 'writes_model', 'parses_body', 'serializes_response', 'calls'].includes(edgeKind))) return 8;
      if (text.includes('sink') || text.includes('query') || text.includes('flow')) return 4;
      return 0;
    }
    if (intent === 'binary_orientation') {
      if (namespace === 'binary' || stringValue(candidate.output.resourceKind, '') === 'binary') return 8;
      if (['binary_symbol', 'binary_imported_symbol', 'binary_exported_symbol', 'binary_string', 'mobile_permission'].includes(entityKind)) return 10;
      if (edgeKinds.some((edgeKind) => ['imports_symbol', 'exports_symbol', 'contains_string', 'references_url', 'references_permission'].includes(edgeKind))) return 8;
      return 0;
    }
    if (intent === 'prior_research_memory') {
      if (['hypothesis', 'finding', 'evidence', 'verifier_run', 'verifier_contract', 'artifact', 'trace_event'].includes(entityType)) return 10;
      if (edgeKinds.some((edgeKind) => ['affects_component', 'classified_as_cwe', 'supports_hypothesis', 'supports_finding', 'supported_by_evidence', 'verifies_finding', 'backs_evidence'].includes(edgeKind))) return 8;
      return 0;
    }
    if (intent === 'variant_similarity_search') {
      if (candidate.kind === 'graph_variant' || arrayOfStrings(candidate.output.retrievalMergedKinds).includes('graph_variant')) return 10;
      if (edgeKinds.length > 0) return 6;
      if (candidate.kind === 'semantic') return 4;
      return 0;
    }
    return 0;
  }

  private retrievalSourceTypeScore(candidate: RetrievalCandidate): number {
    const mergedKinds = arrayOfStrings(candidate.output.retrievalMergedKinds);
    if (mergedKinds.includes('file') && (mergedKinds.includes('metadata') || mergedKinds.includes('semantic') || mergedKinds.includes('graph') || mergedKinds.includes('graph_variant'))) return 11;
    if (candidate.kind === 'file') return 10;
    if (candidate.kind === 'artifact') return 8;
    if (candidate.kind === 'metadata') return 7;
    if (candidate.kind === 'semantic') return 6;
    if (candidate.kind === 'graph_variant') return 5;
    if (candidate.kind === 'graph') return 5;
    return 2;
  }

  private retrievalCandidateSearchText(candidate: RetrievalCandidate): string {
    const metadata = retrievalMetadata(candidate);
    return [
      candidate.kind,
      candidate.entityType ?? '',
      candidate.entityId ?? '',
      candidate.sourcePath ?? '',
      candidate.namespace,
      stringValue(candidate.output.title, ''),
      stringValue(candidate.output.structureName, ''),
      stringValue(candidate.output.entityKind, ''),
      stringValue(candidate.output.nodeKind, ''),
      stringValue(candidate.output.graphEdgeKind, ''),
      stringValue(candidate.output.graphTargetLabel, ''),
      stringValue(candidate.output.variantTargetLabel, ''),
      stringValue(candidate.output.snippet, ''),
      stringValue(candidate.output.rankReason, ''),
      stringValue(candidate.output.matchedBy, ''),
      JSON.stringify(metadata)
    ].join('\n');
  }

  private retrievalCandidateEntityKey(candidate: RetrievalCandidate): string {
    return candidate.entityType && candidate.entityId ? `${candidate.entityType}:${candidate.entityId}` : '';
  }

  private appendUniqueRetrievalCandidates(matches: RetrievalCandidate[], candidates: RetrievalCandidate[], limit: number): number {
    let added = 0;
    for (const candidate of candidates) {
      const mergeIndex = matches.findIndex((match) => this.retrievalCandidatesShouldMerge(match, candidate));
      if (mergeIndex >= 0) {
        matches[mergeIndex] = this.mergeRetrievalCandidates(matches[mergeIndex], candidate);
        continue;
      }
      if (matches.length >= limit) break;
      matches.push(candidate);
      added += 1;
    }
    return added;
  }

  private retrievalCandidateIsDuplicate(existing: RetrievalCandidate[], candidate: RetrievalCandidate): boolean {
    return existing.some((match) => this.retrievalCandidatesShouldMerge(match, candidate));
  }

  private retrievalCandidatesShouldMerge(left: RetrievalCandidate, right: RetrievalCandidate): boolean {
    const leftArtifactId = stringValue(left.output.artifactId, '') || (left.entityType === 'artifact' ? left.entityId ?? '' : '');
    const rightArtifactId = stringValue(right.output.artifactId, '') || (right.entityType === 'artifact' ? right.entityId ?? '' : '');
    if (leftArtifactId && rightArtifactId && leftArtifactId === rightArtifactId) return true;

    const leftEntityKey = this.retrievalCandidateMergeEntityKey(left);
    const rightEntityKey = this.retrievalCandidateMergeEntityKey(right);
    if (leftEntityKey && rightEntityKey && leftEntityKey === rightEntityKey) return true;

    const leftStable = this.retrievalCandidateStableKey(left);
    const rightStable = this.retrievalCandidateStableKey(right);
    if (leftStable && rightStable && leftStable === rightStable) return true;

    return this.retrievalCandidatesSameLocation(left, right);
  }

  private retrievalCandidateMergeEntityKey(candidate: RetrievalCandidate): string {
    if (!candidate.entityType || !candidate.entityId) return '';
    if (candidate.entityType === 'file') return '';
    if (candidate.entityType === 'graph_edge') return '';
    return `${candidate.entityType}:${candidate.entityId}`;
  }

  private retrievalCandidatesSameLocation(left: RetrievalCandidate, right: RetrievalCandidate): boolean {
    if (!left.sourcePath || !right.sourcePath || left.sourcePath !== right.sourcePath) return false;
    const leftRange = retrievalCandidateLineRange(left);
    const rightRange = retrievalCandidateLineRange(right);
    if (!leftRange || !rightRange) return false;
    if (!rangesOverlap(leftRange, rightRange)) return false;
    if (left.entityType === 'inventory_item' || right.entityType === 'inventory_item') return false;
    if (left.kind === 'file' && right.kind === 'file') return leftRange.start === rightRange.start && leftRange.end === rightRange.end;
    return this.retrievalCandidateRichness(left) !== this.retrievalCandidateRichness(right) || left.entityType === right.entityType;
  }

  private mergeRetrievalCandidates(left: RetrievalCandidate, right: RetrievalCandidate): RetrievalCandidate {
    const primary = this.retrievalCandidateRichness(right) > this.retrievalCandidateRichness(left) ? right : left;
    const secondary = primary === left ? right : left;
    const output = this.mergeRetrievalCandidateOutput(primary, secondary);
    return {
      ...primary,
      sourcePath: primary.sourcePath ?? secondary.sourcePath,
      range: primary.range ?? secondary.range,
      namespace: primary.namespace || secondary.namespace,
      output,
      provenance: {
        source: primary.provenance.source,
        matchedBy: primary.provenance.matchedBy ?? secondary.provenance.matchedBy,
        seedEntityType: primary.provenance.seedEntityType ?? secondary.provenance.seedEntityType,
        seedEntityId: primary.provenance.seedEntityId ?? secondary.provenance.seedEntityId,
        graphEdgeKind: primary.provenance.graphEdgeKind ?? secondary.provenance.graphEdgeKind
      }
    };
  }

  private mergeRetrievalCandidateOutput(primary: RetrievalCandidate, secondary: RetrievalCandidate): Record<string, unknown> {
    const contributors = [...retrievalCandidateContributors(primary), ...retrievalCandidateContributors(secondary)];
    const mergedKinds = uniqueStrings([primary.kind, secondary.kind, ...arrayOfStrings(primary.output.retrievalMergedKinds), ...arrayOfStrings(secondary.output.retrievalMergedKinds)]);
    const mergedSources = uniqueStrings([
      retrievalContributionSource(primary),
      retrievalContributionSource(secondary),
      ...arrayOfStrings(primary.output.retrievalMergedSources),
      ...arrayOfStrings(secondary.output.retrievalMergedSources)
    ]);
    const graphEdgeKinds = uniqueStrings([
      stringValue(primary.output.graphEdgeKind, ''),
      stringValue(secondary.output.graphEdgeKind, ''),
      ...arrayOfStrings(primary.output.retrievalGraphEdgeKinds),
      ...arrayOfStrings(secondary.output.retrievalGraphEdgeKinds)
    ]);
    const semanticScore = Math.max(numberValue(primary.output.semanticScore, 0), numberValue(secondary.output.semanticScore, 0), numberValue(primary.output.retrievalSemanticScore, 0), numberValue(secondary.output.retrievalSemanticScore, 0));
    const vectorScore = Math.max(numberValue(primary.output.vectorScore, 0), numberValue(secondary.output.vectorScore, 0), numberValue(primary.output.retrievalVectorScore, 0), numberValue(secondary.output.retrievalVectorScore, 0));
    const lexicalScore = Math.max(numberValue(primary.output.lexicalScore, 0), numberValue(secondary.output.lexicalScore, 0), numberValue(primary.output.retrievalLexicalScore, 0), numberValue(secondary.output.retrievalLexicalScore, 0));
    return {
      ...primary.output,
      snippet: stringValue(primary.output.snippet, '') || stringValue(secondary.output.snippet, ''),
      retrievalMerged: true,
      retrievalMergedKinds: mergedKinds,
      retrievalMergedSources: mergedSources,
      retrievalGraphEdgeKinds: graphEdgeKinds,
      retrievalSemanticScore: semanticScore > 0 ? semanticScore : undefined,
      retrievalVectorScore: vectorScore > 0 ? vectorScore : undefined,
      retrievalLexicalScore: lexicalScore > 0 ? lexicalScore : undefined,
      retrievalContributors: contributors.slice(0, 8)
    };
  }

  private retrievalCandidateRichness(candidate: RetrievalCandidate): number {
    if (candidate.entityType && candidate.entityType !== 'file' && candidate.entityType !== 'graph_edge') {
      if (candidate.kind === 'metadata') return 80;
      if (candidate.kind === 'semantic') return 75;
      if (candidate.kind === 'graph_variant') return 70;
      if (candidate.kind === 'graph') return 68;
      return 65;
    }
    if (candidate.kind === 'artifact') return 55;
    if (candidate.kind === 'file') return 40;
    return 30;
  }

  private retrievalCandidateStableKey(candidate: RetrievalCandidate): string {
    if (candidate.kind === 'file') return `file:${candidate.sourcePath ?? ''}:${candidate.range ?? ''}:${stringValue(candidate.output.snippet, '')}`;
    if (candidate.kind === 'artifact') return `artifact:${candidate.entityId ?? ''}`;
    if (candidate.kind === 'metadata') return `metadata:${candidate.entityType ?? ''}:${candidate.entityId ?? ''}`;
    if (candidate.kind === 'semantic') return `semantic:${stringValue(candidate.output.chunkId, '')}`;
    if (candidate.kind === 'graph') return `graph:${candidate.entityType ?? ''}:${candidate.entityId ?? ''}`;
    if (candidate.kind === 'graph_variant') return `graph_variant:${candidate.entityType ?? ''}:${candidate.entityId ?? ''}:${candidate.provenance.graphEdgeKind ?? ''}`;
    return '';
  }

  private projectStructureEntityToToolMatch(entity: ProjectStructureEntityRecord, matchedBy: string): Record<string, unknown> {
    return {
      kind: 'metadata',
      entityType: 'structure_entity',
      entityId: entity.id,
      title: `${entity.entityKind} ${entity.name}`,
      sourcePath: entity.path,
      path: entity.path,
      line: entity.lineStart,
      range: `${entity.lineStart}${entity.lineEnd > entity.lineStart ? `-${entity.lineEnd}` : ''}`,
      entityKind: entity.entityKind,
      structureName: entity.name,
      matchedBy,
      snippet: trimSnippet(entity.signature || `${entity.entityKind} ${entity.name}`),
      metadata: {
        ...entity.metadata,
        structureEntityId: entity.id,
        inventoryItemId: entity.inventoryItemId,
        assetId: entity.assetId,
        entityKind: entity.entityKind,
        name: entity.name,
        signature: entity.signature,
        language: entity.language,
        lineStart: entity.lineStart,
        lineEnd: entity.lineEnd,
        parentId: entity.parentId
      }
    };
  }

  private projectInventoryItemToToolMatch(item: NonNullable<ReturnType<WorkspaceDatabase['findProjectInventoryItemByPath']>>, matchedBy: string): Record<string, unknown> {
    return {
      kind: 'metadata',
      entityType: 'inventory_item',
      entityId: item.id,
      title: `${item.itemKind} ${item.path}`,
      sourcePath: item.path,
      path: item.path,
      namespace: item.resourceKind,
      itemKind: item.itemKind,
      resourceKind: item.resourceKind,
      matchedBy,
      snippet: trimSnippet(`${item.resourceKind} ${item.path}`),
      metadata: {
        ...item.metadata,
        inventoryItemId: item.id,
        assetId: item.assetId,
        itemKind: item.itemKind,
        resourceKind: item.resourceKind,
        language: item.language,
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
        sensitivity: item.sensitivity
      }
    };
  }

  private projectSearchResultToToolMatch(result: ProjectSearchResult): Record<string, unknown> {
    const structureLineStart = result.entityType === 'structure_entity' ? numberValue(result.metadata.lineStart, 0) : 0;
    const structureLineEnd = result.entityType === 'structure_entity' ? numberValue(result.metadata.lineEnd, 0) : 0;
    return {
      kind: 'metadata',
      entityType: result.entityType,
      entityId: result.entityId,
      runId: result.runId,
      title: result.title,
      sourcePath: result.sourcePath,
      path: result.entityType === 'structure_entity' ? result.sourcePath : undefined,
      line: structureLineStart > 0 ? structureLineStart : undefined,
      range: structureLineStart > 0 ? `${structureLineStart}${structureLineEnd > structureLineStart ? `-${structureLineEnd}` : ''}` : undefined,
      entityKind: result.entityType === 'structure_entity' ? result.metadata.entityKind : undefined,
      structureName: result.entityType === 'structure_entity' ? result.metadata.name : undefined,
      matchedBy: 'project_metadata_fts',
      rank: result.rank,
      updatedAt: result.updatedAt,
      snippet: trimSnippet(result.snippet),
      metadata: result.metadata
    };
  }

  private projectSemanticSearchResultToToolMatch(result: ProjectSemanticSearchResult): Record<string, unknown> {
    const lineStart = numberValue(result.metadata.lineStart, 0);
    const lineEnd = numberValue(result.metadata.lineEnd, lineStart);
    const semanticSourceKind = stringValue(result.metadata.semanticSourceKind, '');
    const entityKind = stringValue(result.metadata.entityKind, '');
    const entityName = stringValue(result.metadata.entityName, stringValue(result.metadata.name, ''));
    return {
      kind: 'semantic',
      entityType: result.entityType,
      entityId: result.entityId,
      chunkId: result.chunkId,
      sourceDocumentId: result.sourceDocumentId,
      namespace: result.namespace,
      runId: result.runId,
      title: result.title,
      sourcePath: result.sourcePath,
      path: result.sourcePath ?? undefined,
      line: lineStart > 0 ? lineStart : undefined,
      range: lineStart > 0 ? `${lineStart}${lineEnd > lineStart ? `-${lineEnd}` : ''}` : undefined,
      semanticSourceKind: semanticSourceKind || undefined,
      entityKind: entityKind || undefined,
      structureName: entityName || undefined,
      matchedBy: 'project_semantic_hybrid_local_hash',
      semanticScore: result.score,
      vectorScore: result.vectorScore,
      lexicalScore: result.lexicalScore,
      titleScore: result.titleScore,
      namespaceScore: result.namespaceScore,
      entityScore: result.entityScore,
      matchedTerms: result.matchedTerms,
      rankReason: result.rankReason,
      snippet: trimSnippet(result.snippet),
      metadata: result.metadata
    };
  }

  private projectGraphNodeToToolMatch(node: ReturnType<WorkspaceDatabase['getProjectGraphNeighborhood']>['nodes'][number], edge: ReturnType<WorkspaceDatabase['getProjectGraphNeighborhood']>['edges'][number], seed: Record<string, unknown>): Record<string, unknown> {
    const lineStart = numberValue(node.metadata.lineStart, 0);
    const lineEnd = numberValue(node.metadata.lineEnd, lineStart);
    return {
      kind: 'graph',
      entityType: node.entityType,
      entityId: node.entityId,
      title: node.label,
      sourcePath: node.sourcePath,
      path: node.sourcePath ?? undefined,
      line: lineStart > 0 ? lineStart : undefined,
      range: lineStart > 0 ? `${lineStart}${lineEnd > lineStart ? `-${lineEnd}` : ''}` : undefined,
      nodeKind: node.nodeKind,
      matchedBy: 'project_graph_proximity',
      graphDistance: 1,
      graphEdgeKind: edge.edgeKind,
      seedEntityType: stringValue(seed.entityType, ''),
      seedEntityId: stringValue(seed.entityId, ''),
      rankReason: `Connected by graph edge ${edge.edgeKind} to ${stringValue(seed.title, stringValue(seed.structureName, 'search hit'))}.`,
      snippet: trimSnippet(`${node.nodeKind} ${node.label}`),
      metadata: {
        ...node.metadata,
        graphNodeId: node.id,
        graphEdgeId: edge.id,
        graphEdgeKind: edge.edgeKind,
        graphTargetLabel: edge.targetLabel
      }
    };
  }

  private projectGraphEdgeToToolMatch(edge: ReturnType<WorkspaceDatabase['getProjectGraphNeighborhood']>['edges'][number], seed: Record<string, unknown>): Record<string, unknown> {
    const sourcePath = stringValue(seed.sourcePath, '') || stringValue(seed.path, '');
    const line = numberValue(seed.line, 0);
    const range = stringValue(seed.range, '') || (line > 0 ? String(line) : '');
    const targetLabel = edge.targetLabel || stringValue(edge.metadata.targetName, '');
    return {
      kind: 'graph',
      entityType: 'graph_edge',
      entityId: edge.id,
      title: `${edge.edgeKind} ${targetLabel}`,
      sourcePath: sourcePath || undefined,
      path: sourcePath || undefined,
      line: line > 0 ? line : undefined,
      range: range || undefined,
      nodeKind: 'edge_target',
      matchedBy: 'project_graph_proximity',
      graphDistance: 1,
      graphEdgeKind: edge.edgeKind,
      graphTargetEntityType: edge.targetEntityType,
      graphTargetEntityId: edge.targetEntityId ?? undefined,
      graphTargetLabel: targetLabel,
      seedEntityType: stringValue(seed.entityType, ''),
      seedEntityId: stringValue(seed.entityId, ''),
      rankReason: `Connected by graph edge ${edge.edgeKind}${targetLabel ? ` to ${targetLabel}` : ''}.`,
      snippet: trimSnippet(`${edge.edgeKind}${targetLabel ? ` ${targetLabel}` : ''}`),
      metadata: {
        ...edge.metadata,
        graphEdgeId: edge.id,
        graphEdgeKind: edge.edgeKind,
        graphTargetLabel: edge.targetLabel
      }
    };
  }

  private projectGraphVariantNodeToToolMatch(
    node: ReturnType<WorkspaceDatabase['getProjectGraphNeighborhood']>['nodes'][number],
    edge: ReturnType<WorkspaceDatabase['getProjectGraphNeighborhood']>['edges'][number],
    seed: Record<string, unknown>
  ): Record<string, unknown> {
    const lineStart = numberValue(node.metadata.lineStart, 0);
    const lineEnd = numberValue(node.metadata.lineEnd, lineStart);
    const targetLabel = edge.targetLabel || stringValue(edge.metadata.targetName, '');
    return {
      kind: 'graph_variant',
      entityType: node.entityType,
      entityId: node.entityId,
      title: node.label,
      sourcePath: node.sourcePath,
      path: node.sourcePath ?? undefined,
      line: lineStart > 0 ? lineStart : undefined,
      range: lineStart > 0 ? `${lineStart}${lineEnd > lineStart ? `-${lineEnd}` : ''}` : undefined,
      nodeKind: node.nodeKind,
      matchedBy: 'project_graph_variant',
      graphDistance: 2,
      graphEdgeKind: edge.edgeKind,
      variantTargetEntityType: edge.targetEntityType,
      variantTargetEntityId: edge.targetEntityId ?? undefined,
      variantTargetLabel: targetLabel,
      seedEntityType: stringValue(seed.entityType, ''),
      seedEntityId: stringValue(seed.entityId, ''),
      rankReason: `Variant candidate sharing ${edge.edgeKind}${targetLabel ? ` target ${targetLabel}` : ''} with ${stringValue(seed.title, stringValue(seed.structureName, 'search hit'))}.`,
      snippet: trimSnippet(`${node.nodeKind} ${node.label}${targetLabel ? ` -> ${targetLabel}` : ''}`),
      metadata: {
        ...node.metadata,
        graphNodeId: node.id,
        graphEdgeId: edge.id,
        graphEdgeKind: edge.edgeKind,
        graphTargetLabel: edge.targetLabel,
        graphVariant: true
      }
    };
  }

  private projectStructureNavigation(
    context: CreatedRunContext,
    filePath: string,
    symbol: string,
    matchedEntity: ProjectStructureEntityRecord | null,
    selection: CodeBrowserTextSelection
  ): Record<string, unknown> {
    if (selection.binaryDerived || selection.lineStart === null || selection.lineEnd === null) {
      return {
        status: symbol ? 'unavailable' : 'not_requested',
        reason: selection.binaryDerived ? 'binary_derived_text' : 'missing_line_range'
      };
    }

    const rangeEntities = this.db
      .listProjectStructureEntitiesInRange(context.run.scopeVersionId, filePath, selection.lineStart, selection.lineEnd, 40, { refreshInventory: false })
      .filter((entity) => entity.id !== matchedEntity?.id);
    const containedEntities = rangeEntities
      .filter((entity) => entity.parentId === matchedEntity?.id || !matchedEntity)
      .slice(0, 20)
      .map(projectStructureEntityPayload);
    const outgoingRelations = matchedEntity
      ? this.db.listProjectStructureRelationsForEntity(context.run.scopeVersionId, matchedEntity.id, 40, { refreshInventory: false }).map(projectStructureRelationPayload)
      : [];
    const incomingReferences = matchedEntity
      ? this.db
          .listProjectStructureReferencesForTarget(context.run.scopeVersionId, { name: matchedEntity.name, entityId: matchedEntity.id }, 40, { refreshInventory: false })
          .filter((relation) => relation.sourceEntityId !== matchedEntity.id)
          .slice(0, 20)
          .map(projectStructureRelationPayload)
      : [];
    const graphNeighborhood = matchedEntity
      ? projectGraphNeighborhoodPayload(this.db.getProjectGraphNeighborhood(context.run.scopeVersionId, 'structure_entity', matchedEntity.id, { depth: 1, limit: 40, refresh: false }))
      : null;

    return {
      status: matchedEntity ? 'hit' : symbol ? 'miss' : 'range_context',
      requestedSymbol: symbol || null,
      entity: matchedEntity ? projectStructureEntityPayload(matchedEntity) : null,
      containedEntities,
      outgoingRelations,
      incomingReferences,
      graphNeighborhood
    };
  }

  private artifactReadTarget(context: CreatedRunContext, value: string): { artifactId: string; path: string } | null {
    const artifact = this.db.getRunDetail(context.run.id).artifacts.find((candidate) => candidate.id === value);
    if (!artifact) return null;
    const workspaceRoot = dirname(dirname(this.db.getDatabasePath()));
    return { artifactId: artifact.id, path: join(workspaceRoot, artifact.relativePath) };
  }

  private isScopedLocalPath(path: string): boolean {
    const resolved = resolve(path);
    if (pathContainsSegment(resolved, '.beale')) return false;
    return this.db.getActiveScope().assets.some((asset) => isScopedLocalAsset(asset) && isWithinPath(resolved, resolve(asset.value)));
  }

  private firstScopedImport(): { hostPath: string } | null {
    const asset = this.db.getActiveScope().assets.find((candidate) => isScopedLocalAsset(candidate) && existsSync(candidate.value));
    return asset ? { hostPath: resolve(asset.value) } : null;
  }

  private ensureLocalSourceInScope(sourceAssetId: string, sensitivity: string, localPath: string, repositoryUrl: string, head: string | null): ReturnType<WorkspaceDatabase['getActiveScope']> {
    const scope = this.db.getActiveScope();
    const resolvedLocalPath = resolve(localPath);
    if (scope.assets.some((asset) => asset.direction === 'in_scope' && isScopedLocalAsset(asset) && resolve(asset.value) === resolvedLocalPath)) {
      return scope;
    }
    const assets: ScopeAssetInput[] = scope.assets.map((asset) => ({
      direction: asset.direction,
      kind: asset.kind,
      value: asset.value,
      sensitivity: asset.sensitivity,
      attributes: asset.attributes
    }));
    assets.push({
      direction: 'in_scope',
      kind: 'repo',
      value: resolvedLocalPath,
      sensitivity,
      attributes: {
        source: 'beale_source_materializer',
        repositoryUrl,
        sourceAssetId,
        head
      }
    });
    return this.db.saveProgramScope(
      {
        programName: scope.programName,
        organizationName: scope.organizationName,
        descriptionMarkdown: scope.descriptionMarkdown,
        rulesMarkdown: scope.rulesMarkdown,
        networkProfile: scope.networkProfile,
        expiresAt: scope.expiresAt,
        assets
      },
      { refreshInventory: false }
    );
  }

  private toolPolicy(toolName: ToolName): Record<string, unknown> {
    switch (toolName) {
      case 'source':
        return { execution: 'host_safe_source_setup', targetExecution: false, liveNetwork: 'scoped_repository_clone', hostShell: false };
      case 'search':
      case 'code_browser':
        return { execution: 'host_scoped_read_only', targetExecution: false, liveNetwork: false };
      case 'resource_lookup':
        return { execution: 'host_run_resource_lookup', targetExecution: false, liveNetwork: false, currentRunOnly: true };
      case 'program_lookup':
        return { execution: 'host_public_program_lookup', targetExecution: false, liveNetwork: 'public_program_metadata', importsScope: false, bounded: true };
      case 'python':
      case 'debugger':
        return { execution: 'active_session_sandbox', defaultExecution: 'host_research_only', vmOption: 'local_disposable_vm', hostDatabaseMounted: false, openAiCredentialsMounted: false };
      case 'artifact':
        return { execution: 'host_artifact_store', contentAddressed: true, modelGeneratedContentIsNotObservation: true };
      case 'evidence':
        return { execution: 'host_evidence_record', requiresArtifactTraceOrVerifierReference: true };
      case 'hypothesis':
        return { execution: 'host_hypothesis_record', modelProposed: true, targetObservation: false };
      case 'finding':
        return { execution: 'host_finding_record', verifiedStateRequiresRealVerifierPass: true };
      case 'verifier':
        return { execution: 'host_verifier_records', promotionRequiresTraceOrArtifactEvidence: true };
    }
  }

  private sandboxPathForContext(context: CreatedRunContext, path: string): string {
    return isHostResearchSandbox(context.run.sandboxProfile) ? mapSandboxPathToHost(this.db, path, context) : path;
  }

  private recordToolPolicyBlock(
    context: CreatedRunContext,
    call: OpenAiFunctionCall,
    args: Record<string, unknown>,
    reason: string,
    payload: Record<string, unknown>
  ): ToolResult {
    const approval = this.db.createApproval({
      runId: context.run.id,
      attemptId: context.attempt.id,
      requestKind: 'tool_call',
      requestedAction: {
        toolName: call.name,
        openaiCallId: call.callId,
        arguments: args
      },
      decision: 'blocked',
      reason
    });
    const event = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'approval_event',
      source: 'policy',
      summary: `Policy blocked OpenAI tool call: ${call.name}.`,
      payload: {
        observationBacked: false,
        decision: 'blocked',
        reason,
        arguments: args,
        ...payload
      },
      approvalId: approval.id,
      vmContextId: context.vmContext.id
    });
    return {
      status: 'policy_blocked',
      summary: reason.startsWith('Blocked ') ? reason : `Policy blocked ${call.name}: ${reason}`,
      traceEventId: event.id,
      payload: {
        observationBacked: false,
        blocked: true,
        approvalId: approval.id,
        ...payload
      }
    };
  }

  private recordError(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>, message: string): ToolResult {
    const event = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_result',
      source: 'tool',
      summary: message,
      payload: {
        status: 'error',
        toolName: call.name,
        arguments: args
      },
      vmContextId: context.vmContext.id
    });
    return {
      status: 'error',
      summary: message,
      traceEventId: event.id,
      payload: { observationBacked: false, message }
    };
  }

  private destinationAllowed(destination: string): boolean {
    const scope = this.db.getActiveScope();
    const outOfScope = scope.assets.filter((asset) => asset.direction === 'out_of_scope').some((asset) => destination.includes(asset.value));
    if (outOfScope) return false;
    return scope.assets
      .filter((asset) => asset.direction === 'in_scope' && ['domain', 'host', 'service'].includes(asset.kind))
      .some((asset) => destination.includes(asset.value));
  }
}

function tool(name: ToolName, description: string, properties: Record<string, unknown>): OpenAiToolDefinition {
  return {
    type: 'function',
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false
    },
    strict: true
  };
}

function stringProp(description: string): Record<string, unknown> {
  return { type: 'string', description };
}

function parseArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsJson || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isToolName(value: string): value is ToolName {
  return TOOL_NAMES.includes(value as ToolName);
}

function extractDestination(toolName: ToolName, args: Record<string, unknown>): string | null {
  if (toolName === 'source' || toolName === 'search' || toolName === 'code_browser' || toolName === 'resource_lookup' || toolName === 'program_lookup') return null;
  const destination = args.destination ?? args.url ?? args.host ?? args.target;
  return typeof destination === 'string' && /^https?:\/\//.test(destination) ? destination : null;
}

const PROGRAM_LOOKUP_HACKERONE_QUERY = `
query BealeProgramLookup($handle: String!) {
  team(handle: $handle) {
    handle
    name
    url
    submission_state
    structured_scopes(first: 120) {
      total_count
      nodes {
        asset_type
        asset_identifier
        instruction
        eligible_for_bounty
        eligible_for_submission
        max_severity
        url
      }
    }
  }
}
`;

function normalizeProgramLookupProvider(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (['auto', 'hackerone', 'msrc', 'apple', 'url'].includes(normalized)) return normalized;
  return 'auto';
}

function shouldUseActiveHackerOneHint(
  provider: string,
  requestedIdentifier: string,
  hint: { handle: string; sourceUrl: string; programName: string } | null
): boolean {
  if (!hint || (provider !== 'auto' && provider !== 'hackerone')) return false;
  if (!requestedIdentifier.trim()) return true;
  if (/^https?:\/\//i.test(requestedIdentifier.trim())) return false;
  const requestedHandle = normalizeHackerOneProgramIdentifier(requestedIdentifier);
  return requestedHandle.toLowerCase() !== hint.handle.toLowerCase();
}

function detectProgramLookupProvider(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();
  if (normalized.includes('hackerone.com/') || /^[a-z0-9][a-z0-9_-]{1,80}$/i.test(identifier.trim())) return 'hackerone';
  if (normalized.includes('microsoft.com/msrc') || normalized.includes('msrc.microsoft.com')) return 'msrc';
  if (normalized.includes('security.apple.com') || normalized.includes('apple.com')) return 'apple';
  return 'url';
}

function hackerOneHandleFromUrl(value: string): string {
  const match = /hackerone\.com\/([^/?#\s]+)/i.exec(value);
  return match?.[1]?.trim() ?? '';
}

function normalizeHackerOneProgramIdentifier(identifier: string): string {
  return identifier
    .trim()
    .replace(/^https?:\/\/(?:www\.)?hackerone\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/, 1)[0]
    .trim();
}

function normalizeProgramPolicyUrl(provider: string, identifier: string): string | null {
  const trimmed = identifier.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (provider === 'msrc') return 'https://www.microsoft.com/msrc/bounty';
  if (provider === 'apple') return 'https://security.apple.com/bounty/';
  return null;
}

function programLookupHackerOneAsset(scope: Record<string, unknown>): Record<string, unknown> | null {
  const value = stringValue(scope.asset_identifier, '').trim();
  if (!value) return null;
  const assetType = stringValue(scope.asset_type, 'OTHER');
  return {
    direction: scope.eligible_for_submission === false ? 'out_of_scope' : 'in_scope',
    kind: programLookupAssetKind(assetType, value),
    value,
    assetType,
    instruction: stringValue(scope.instruction, ''),
    eligibleForBounty: scope.eligible_for_bounty === true,
    eligibleForSubmission: scope.eligible_for_submission !== false,
    maxSeverity: stringValue(scope.max_severity, ''),
    url: stringValue(scope.url, '')
  };
}

function programLookupAssetKind(assetType: string, value: string): string {
  const normalized = assetType.toUpperCase();
  if (normalized.includes('SOURCE')) return 'repo';
  if (normalized.includes('EXECUTABLE') || normalized.includes('BINARY')) return 'binary';
  if (normalized.includes('IP') || /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/.test(value)) return 'ip_range';
  if (normalized.includes('URL') || normalized.includes('DOMAIN') || value.includes('*') || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return 'domain';
  return 'other';
}

function extractProgramPolicyPage(
  body: string,
  sourceUrl: string,
  contentType: string
): { title: string; description: string; assets: Array<Record<string, unknown>>; policyLinks: Array<Record<string, unknown>>; notableText: string[] } {
  const text = contentType.includes('json') ? body : htmlToText(body);
  const title = contentType.includes('json') ? '' : decodeHtmlEntity(firstMatch(body, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = contentType.includes('json') ? '' : decodeHtmlEntity(firstMatch(body, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i));
  const assets = extractProgramLookupAssets(text);
  const policyLinks = extractProgramPolicyLinks(body, sourceUrl);
  const notableText = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 35 && /scope|eligible|bounty|reward|domain|credential|account|authorization|testing|out of scope/i.test(line))
    .slice(0, 30);
  return { title: title || sourceUrl, description, assets, policyLinks, notableText };
}

function extractProgramLookupAssets(text: string): Array<Record<string, unknown>> {
  const candidates = new Set<string>();
  for (const match of text.matchAll(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>)]*)?/gi)) {
    const value = match[0]?.replace(/[.,;:]+$/, '') ?? '';
    if (!value || value.length > 180) continue;
    candidates.add(value);
  }
  return [...candidates].slice(0, 80).map((value) => ({
    direction: 'unknown',
    kind: /^https?:\/\//i.test(value) ? 'url' : 'domain',
    value
  }));
}

function extractProgramPolicyLinks(body: string, sourceUrl: string): Array<Record<string, unknown>> {
  const links: Array<Record<string, unknown>> = [];
  for (const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1] ?? '';
    const label = htmlToText(match[2] ?? '').trim();
    if (!href || !/scope|bounty|program|security|research|policy|rules|reward|eligible/i.test(`${href} ${label}`)) continue;
    links.push({
      href: resolveProgramPolicyHref(href, sourceUrl),
      label: label.slice(0, 160)
    });
    if (links.length >= 30) break;
  }
  return links;
}

function resolveProgramPolicyHref(href: string, sourceUrl: string): string {
  try {
    return new URL(href, sourceUrl).toString();
  } catch {
    return href;
  }
}

function programLookupQueryMatches(query: string, assets: Array<Record<string, unknown>>, texts: string[]): Array<Record<string, unknown>> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];
  const matches: Array<Record<string, unknown>> = [];
  for (const asset of assets) {
    const haystack = JSON.stringify(asset).toLowerCase();
    if (terms.every((term) => haystack.includes(term))) matches.push(asset);
    if (matches.length >= 20) return matches;
  }
  const textHaystack = texts.join('\n').toLowerCase();
  if (terms.every((term) => textHaystack.includes(term))) matches.push({ kind: 'program_text', value: query });
  return matches.slice(0, 20);
}

function htmlToText(value: string): string {
  return decodeHtmlEntity(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '\n')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
  ).trim();
}

function firstMatch(value: string, pattern: RegExp): string {
  return pattern.exec(value)?.[1]?.trim() ?? '';
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeResourceLookupKind(value: string): ResourceLookupKind {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (
    normalized === 'artifact' ||
    normalized === 'evidence' ||
    normalized === 'finding' ||
    normalized === 'hypothesis' ||
    normalized === 'verifier_run' ||
    normalized === 'verifier_contract' ||
    normalized === 'trace_event'
  ) {
    return normalized;
  }
  if (normalized === 'trace') return 'trace_event';
  if (normalized === 'verifier') return 'verifier_contract';
  return 'any';
}

function findingStateRequiresVerifier(state: string): boolean {
  return state === 'verified' || state === 'reportable';
}

function findingStateIsObservationBacked(state: string): boolean {
  return state === 'verified' || state === 'reportable' || state === 'reproduced';
}

function inferResourceLookupKind(id: string): Exclude<ResourceLookupKind, 'any'> | null {
  if (/^artifact_[a-z0-9_]+/i.test(id)) return 'artifact';
  if (/^evidence_[a-z0-9_]+/i.test(id)) return 'evidence';
  if (/^finding_[a-z0-9_]+/i.test(id)) return 'finding';
  if (/^(?:hypothesis|hyp)_[a-z0-9_]+/i.test(id)) return 'hypothesis';
  if (/^verifier_run_[a-z0-9_]+/i.test(id)) return 'verifier_run';
  if (/^verifier_[a-z0-9_]+/i.test(id)) return 'verifier_contract';
  if (/^trace_[a-z0-9_]+/i.test(id)) return 'trace_event';
  return null;
}

function resourceKindLabel(kind: Exclude<ResourceLookupKind, 'any'>): string {
  return kind.replace(/_/g, ' ');
}

function runResourceLookupRecords(detail: RunDetail): ResourceLookupRecord[] {
  return [
    ...detail.artifacts.map(artifactResourceRecord),
    ...detail.evidence.map(evidenceResourceRecord),
    ...detail.findings.map(findingResourceRecord),
    ...detail.hypotheses.map(hypothesisResourceRecord),
    ...detail.verifierRuns.map(verifierRunResourceRecord),
    ...detail.verifierContracts.map(verifierContractResourceRecord),
    ...detail.traceEvents.map(traceEventResourceRecord)
  ];
}

function artifactResourceRecord(artifact: ArtifactRecord): ResourceLookupRecord {
  const payload = {
    kind: 'artifact',
    id: artifact.id,
    artifactKind: artifact.kind,
    sha256: artifact.sha256,
    relativePath: artifact.relativePath,
    sizeBytes: artifact.sizeBytes,
    mimeType: artifact.mimeType,
    sensitivity: artifact.sensitivity,
    modelVisible: artifact.modelVisible,
    source: artifact.source,
    provenanceTraceEventId: artifact.provenanceTraceEventId,
    metadata: artifact.metadata,
    readHint: `Use code_browser with path "${artifact.id}" to read this artifact's content. Do not use raw temporary paths from verifier output.`
  };
  return resourceRecord('artifact', artifact.id, `${artifact.kind} artifact`, payload, artifact.createdAt, null);
}

function evidenceResourceRecord(evidence: EvidenceRecord): ResourceLookupRecord {
  const payload = {
    kind: 'evidence',
    id: evidence.id,
    evidenceKind: evidence.kind,
    summary: evidence.summary,
    hypothesisId: evidence.hypothesisId,
    findingId: evidence.findingId,
    artifactId: evidence.artifactId,
    verifierRunId: evidence.verifierRunId,
    observationTraceEventId: evidence.observationTraceEventId
  };
  return resourceRecord('evidence', evidence.id, evidence.summary || `${evidence.kind} evidence`, payload, evidence.createdAt, null);
}

function findingResourceRecord(finding: FindingRecord): ResourceLookupRecord {
  const payload = {
    kind: 'finding',
    id: finding.id,
    state: finding.state,
    title: finding.title,
    summaryMarkdown: finding.summaryMarkdown,
    impactMarkdown: finding.impactMarkdown,
    affectedAssets: finding.affectedAssets,
    affectedVersions: finding.affectedVersions,
    priorityScore: finding.priorityScore,
    hypothesisId: finding.hypothesisId,
    verifiedByVerifierRunId: finding.verifiedByVerifierRunId,
    cweMappings: cwePayload(finding.cweMappings)
  };
  return resourceRecord('finding', finding.id, finding.title, payload, finding.createdAt, finding.updatedAt);
}

function hypothesisResourceRecord(hypothesis: HypothesisRecord): ResourceLookupRecord {
  const payload = {
    kind: 'hypothesis',
    id: hypothesis.id,
    state: hypothesis.state,
    title: hypothesis.title,
    descriptionMarkdown: hypothesis.descriptionMarkdown,
    component: hypothesis.component,
    bugClass: hypothesis.bugClass,
    priorityScore: hypothesis.priorityScore,
    attackerReachability: hypothesis.attackerReachability,
    impact: hypothesis.impact,
    evidenceConfidence: hypothesis.evidenceConfidence,
    exploitPracticality: hypothesis.exploitPracticality,
    scopeConfidence: hypothesis.scopeConfidence,
    createdTraceEventId: hypothesis.createdTraceEventId,
    cweMappings: cwePayload(hypothesis.cweMappings)
  };
  return resourceRecord('hypothesis', hypothesis.id, hypothesis.title, payload, hypothesis.createdAt, hypothesis.updatedAt);
}

function verifierRunResourceRecord(run: VerifierRunRecord): ResourceLookupRecord {
  const payload = {
    kind: 'verifier_run',
    id: run.id,
    contractId: run.contractId,
    status: run.status,
    blockedIssue: run.blockedIssue,
    behaviorPreserved: run.behaviorPreserved,
    diagnosticsClean: run.diagnosticsClean,
    regressionTests: run.regressionTests,
    vmContextId: run.vmContextId,
    result: run.result,
    artifactId: stringAttribute(run.result.artifactId),
    readHint: stringAttribute(run.result.artifactId)
      ? `Use code_browser with path "${stringAttribute(run.result.artifactId)}" to inspect verifier output artifact content.`
      : 'No verifier output artifact is linked to this verifier run.'
  };
  return resourceRecord('verifier_run', run.id, `${run.status} verifier run`, payload, run.startedAt, run.endedAt);
}

function verifierContractResourceRecord(contract: VerifierContractRecord): ResourceLookupRecord {
  const payload = {
    kind: 'verifier_contract',
    id: contract.id,
    status: contract.status,
    mode: contract.mode,
    hypothesisId: contract.hypothesisId,
    findingId: contract.findingId,
    expectedObservations: contract.expectedObservations,
    artifactsToCollect: contract.artifactsToCollect,
    passCriteria: contract.passCriteria
  };
  return resourceRecord('verifier_contract', contract.id, `${contract.mode} verifier contract`, payload, contract.createdAt, contract.updatedAt);
}

function traceEventResourceRecord(event: TraceEventRecord): ResourceLookupRecord {
  const payload = {
    kind: 'trace_event',
    id: event.id,
    sequence: event.sequence,
    type: event.type,
    source: event.source,
    summary: event.summary,
    payload: event.payload,
    artifactId: event.artifactId,
    toolCallId: event.toolCallId,
    approvalId: event.approvalId,
    modelVisible: event.modelVisible
  };
  return resourceRecord('trace_event', event.id, event.summary, payload, event.createdAt, null);
}

function resourceRecord(
  kind: Exclude<ResourceLookupKind, 'any'>,
  id: string,
  label: string,
  payload: Record<string, unknown>,
  createdAt: string | null,
  updatedAt: string | null
): ResourceLookupRecord {
  return {
    kind,
    id,
    label,
    searchText: `${kind}\n${id}\n${label}\n${JSON.stringify(payload)}`.toLowerCase(),
    payload,
    createdAt,
    updatedAt
  };
}

function resourceMatchesQuery(resource: ResourceLookupRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (resource.searchText.includes(normalized)) return true;
  const terms = normalized.split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every((term) => resource.searchText.includes(term));
}

function compareResourceRecency(left: ResourceLookupRecord, right: ResourceLookupRecord): number {
  return Date.parse(right.updatedAt ?? right.createdAt ?? '') - Date.parse(left.updatedAt ?? left.createdAt ?? '');
}

function resourceCounts(resources: ResourceLookupRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const resource of resources) counts[resource.kind] = (counts[resource.kind] ?? 0) + 1;
  return counts;
}

function roundRetrievalScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyRetrievalFeedbackContext(): RetrievalFeedbackContext {
  return {
    readPathCounts: new Map(),
    verifiedEntityKeys: new Set(),
    correctedNegativeEntityKeys: new Set()
  };
}

function retrievalFeedbackContext(summary: ReturnType<WorkspaceDatabase['getProjectRetrievalFeedbackSummary']>): RetrievalFeedbackContext {
  return {
    readPathCounts: new Map(Object.entries(summary.readPathCounts)),
    verifiedEntityKeys: new Set(summary.verifiedEntityKeys),
    correctedNegativeEntityKeys: new Set(summary.correctedNegativeEntityKeys)
  };
}

function retrievalMetadata(candidate: RetrievalCandidate): Record<string, unknown> {
  const metadata = candidate.output.metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
}

function retrievalCandidateLineRange(candidate: RetrievalCandidate): { start: number; end: number } | null {
  const line = numberValue(candidate.output.line, 0);
  if (line > 0) return { start: line, end: line };
  const range = candidate.range ?? stringValue(candidate.output.range, '');
  const match = /^(\d+)(?:-(\d+))?$/.exec(range);
  if (!match) return null;
  const start = Number.parseInt(match[1] ?? '', 10);
  const end = Number.parseInt(match[2] ?? match[1] ?? '', 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function rangesOverlap(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function retrievalContributionSource(candidate: RetrievalCandidate): string {
  if (candidate.kind === 'file') return 'direct_lexical_hit';
  if (candidate.kind === 'semantic') return 'semantic_hit';
  if (candidate.kind === 'graph_variant') return 'variant_hit';
  if (candidate.kind === 'graph') return 'graph_adjacent_hit';
  if (candidate.kind === 'metadata') return 'metadata_hit';
  return `${candidate.kind || 'unknown'}_hit`;
}

function retrievalCandidateContributors(candidate: RetrievalCandidate): Array<Record<string, unknown>> {
  const existing = candidate.output.retrievalContributors;
  if (Array.isArray(existing)) return existing.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
  return [
    {
      source: retrievalContributionSource(candidate),
      kind: candidate.kind,
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      sourcePath: candidate.sourcePath,
      range: candidate.range,
      matchedBy: candidate.provenance.matchedBy,
      graphEdgeKind: candidate.provenance.graphEdgeKind
    }
  ];
}

function normalizeRetrievalIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_.$/@:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nonEmptyStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function jsonRecordFromString(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : fallback;
  } catch {
    return fallback;
  }
}

function componentFromAffectedAssets(value: Record<string, unknown>): string {
  const direct = value.component ?? value.asset ?? value.endpoint ?? value.path ?? value.package;
  if (typeof direct === 'string') return direct.trim();
  const strings = flattenJsonStrings(value);
  return strings.slice(0, 4).join(' ');
}

function flattenJsonStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => flattenJsonStrings(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...flattenJsonStrings(entry)]);
  }
  return [];
}

function negativeClaimState(value: string): boolean {
  const state = value.trim().toLowerCase().replace(/-/g, '_');
  return state === 'dismissed' || state === 'false_positive' || state === 'out_of_scope';
}

function cweMappingsForToolArgs(
  args: Record<string, unknown>,
  existing: WeaknessMappingRecord[] | undefined,
  context: { bugClass: string; title: string; descriptionMarkdown: string; impactMarkdown: string }
): WeaknessMappingInput[] | undefined {
  const explicitMappings = explicitCweMappingsFromArgs(args);
  if (explicitMappings.length > 0) return explicitMappings;
  if (existing && existing.length > 0) return undefined;
  const inferred = inferCweMapping(context);
  return inferred ? [inferred] : undefined;
}

function explicitCweMappingsFromArgs(args: Record<string, unknown>): WeaknessMappingInput[] {
  const primaryCweId = normalizeCweId(args.primary_cwe_id);
  const confidence = normalizeCweConfidence(args.cwe_mapping_confidence, 'low');
  const rationale = stringValue(args.cwe_mapping_rationale, '').trim();
  const mappings: WeaknessMappingInput[] = [];

  if (primaryCweId) {
    const entry = cweEntryForId(primaryCweId);
    mappings.push({
      cweId: primaryCweId,
      cweName: stringValue(args.primary_cwe_name, '').trim() || entry?.name,
      mappingRole: 'primary',
      mappingStatus: entry?.mappingStatus ?? 'unknown',
      confidence,
      rationaleMarkdown: rationale || 'Mapped by the model from the observed weakness pattern.',
      source: 'model'
    });
  }

  for (const alternate of alternateCweInputs(args.alternate_cwe_ids_json)) {
    const cweId = normalizeCweId(alternate.cweId);
    if (!cweId || cweId === primaryCweId) continue;
    const entry = cweEntryForId(cweId);
    mappings.push({
      cweId,
      cweName: alternate.cweName || entry?.name,
      mappingRole: 'alternate',
      mappingStatus: entry?.mappingStatus ?? 'unknown',
      confidence,
      rationaleMarkdown: rationale || 'Alternate CWE candidate preserved for review.',
      source: 'model'
    });
  }

  return mappings;
}

function alternateCweInputs(value: unknown): Array<{ cweId: string; cweName?: string }> {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number') return { cweId: String(item) };
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const cweId = stringValue(record.cwe_id ?? record.cweId ?? record.id, '').trim();
          const cweName = stringValue(record.cwe_name ?? record.cweName ?? record.name, '').trim();
          return cweId ? { cweId, ...(cweName ? { cweName } : {}) } : null;
        }
        return null;
      })
      .filter((item): item is { cweId: string; cweName?: string } => Boolean(item));
  } catch {
    return [];
  }
}

function cwePayload(mappings: WeaknessMappingRecord[]): Array<Record<string, string>> {
  return mappings.map((mapping) => ({
    cweId: mapping.cweId,
    cweName: mapping.cweName,
    mappingRole: mapping.mappingRole,
    mappingStatus: mapping.mappingStatus,
    confidence: mapping.confidence,
    rationale: mapping.rationaleMarkdown
  }));
}

function summaryForTitle(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

function stringAttribute(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sameRepository(left: string | null, right: string): boolean {
  const normalizedRight = normalizeSourceRepositoryUrl(right);
  return Boolean(left && normalizedRight && left.toLowerCase() === normalizedRight.toLowerCase());
}

function localAssetMatchesTargetHint(asset: ScopeAsset, normalizedHint: string): boolean {
  const haystack = [
    asset.value,
    stringAttribute(asset.attributes?.repositoryUrl),
    stringAttribute(asset.attributes?.sourceAssetId),
    stringAttribute(asset.attributes?.instruction)
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(normalizedHint);
}

function dedupeSearchRoots(roots: ScopedSearchRoot[]): ScopedSearchRoot[] {
  const seen = new Set<string>();
  const deduped: ScopedSearchRoot[] = [];
  for (const root of roots) {
    const resolved = resolve(root.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    deduped.push({ ...root, path: resolved });
  }
  return deduped;
}

function buildSearchQueryPlan(query: string): SearchQueryPlan {
  const raw = query.trim();
  const regex = searchRegex(raw);
  const terms = searchTerms(raw);
  return {
    raw,
    rawLower: raw.toLowerCase(),
    terms,
    regex,
    mode: regex ? 'regex_or_terms' : terms.length > 1 ? 'terms' : 'literal',
    intents: classifySearchQueryIntents(raw, terms)
  };
}

function classifySearchQueryIntents(raw: string, terms: string[]): SearchQueryIntent[] {
  const haystack = `${raw} ${terms.join(' ')}`.toLowerCase();
  const intents: SearchQueryIntent[] = [];
  if (looksLikeSymbolLookup(raw, terms, haystack)) intents.push('symbol_lookup');
  if (/(^|\s)(get|post|put|patch|delete|options|head)\s+\/|\/api\b|endpoint|route|controller|graphql|rest\b|url\b/.test(haystack)) intents.push('route_api_lookup');
  if (/auth|authori[sz]e|permission|rbac|acl|guard|middleware|login|token|session|role\b|scope\b/.test(haystack)) intents.push('auth_permission_question');
  if (/sink|data[-\s]?flow|taint|source\s+to\s+sink|sql|query|exec|command|deserialize|template|redirect|ssrf|xss|injection|parser|parse|body|serialize|model|write|read/.test(haystack)) intents.push('sink_data_flow_question');
  if (/binary|apk|elf|mach-o|pe\b|jni|native|import|export|symbol|string|permission|android|url|so\b|dll\b|exe\b/.test(haystack)) intents.push('binary_orientation');
  if (/hypothesis|finding|evidence|verifier|repro|reproduced|verified|cwe|prior|previous|memory|artifact|trace|duplicate|dismissed/.test(haystack)) intents.push('prior_research_memory');
  if (/similar|variant|sibling|nearby|related|alternate|same|other|pattern|like this|else|analog/.test(haystack)) intents.push('variant_similarity_search');
  return uniqueStrings(intents) as SearchQueryIntent[];
}

function looksLikeSymbolLookup(raw: string, terms: string[], haystack: string): boolean {
  if (/symbol|function|method|class|type|interface|call(er|ee)?|definition|reference|handler/.test(haystack)) return true;
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(raw)) return true;
  if (/^[A-Za-z_$][\w$]*(?:::[A-Za-z_$][\w$]*)+$/.test(raw)) return true;
  if (/^[A-Za-z_$][\w$]*\([^)]*\)$/.test(raw)) return true;
  return terms.some((term) => /[a-z][A-Z]|_|::|\./.test(term)) && terms.length <= 3;
}

function searchRegex(query: string): RegExp | null {
  if (!/[|\\()[\]{}^$*+?]/.test(query)) return null;
  try {
    return new RegExp(query, 'i');
  } catch {
    return null;
  }
}

function searchTerms(query: string): string[] {
  const stopWords = new Set(['and', 'for', 'from', 'new', 'the', 'with']);
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_.$/@:-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !stopWords.has(term));
  return [...new Set(terms)].slice(0, 24);
}

function lineMatchesSearchQuery(line: string, plan: SearchQueryPlan): boolean {
  const lower = line.toLowerCase();
  if (plan.rawLower && lower.includes(plan.rawLower)) return true;
  if (plan.regex?.test(line)) return true;
  return plan.terms.some((term) => lower.includes(term));
}

function searchMatchDescription(line: string, plan: SearchQueryPlan): string {
  const lower = line.toLowerCase();
  if (plan.rawLower && lower.includes(plan.rawLower)) return 'literal';
  if (plan.regex?.test(line)) return 'regex';
  const term = plan.terms.find((candidate) => lower.includes(candidate));
  return term ? `term:${term}` : 'unknown';
}

function isScopedLocalAsset(asset: ScopeAsset): boolean {
  return asset.direction === 'in_scope' && LOCAL_ASSET_KINDS.has(asset.kind) && isAbsolute(asset.value) && existsSync(asset.value) && !looksLikeUrl(asset.value);
}

function readScopedText(path: string): { text: string; binaryDerived: boolean } | null {
  const stat = safeStat(path);
  if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) return null;
  const buffer = readFileSync(path);
  if (looksTextual(buffer)) {
    return { text: buffer.toString('utf8'), binaryDerived: false };
  }
  const strings = extractPrintableStrings(buffer);
  return strings ? { text: strings, binaryDerived: true } : null;
}

function readCodeBrowserText(path: string, symbol: string, requestedRange: RequestedLineRange | null): CodeBrowserTextSelection | null {
  const stat = safeStat(path);
  if (!stat?.isFile()) return null;

  if (stat.size <= MAX_FILE_BYTES) {
    const loaded = readScopedText(path);
    if (!loaded) return null;
    const lines = loaded.text.split(/\r?\n/);
    const range = selectLineRange(lines, symbol, requestedRange);
    const selected = range.end >= range.start ? lines.slice(range.start - 1, range.end) : [];
    const contentHash = createHash('sha256').update(loaded.text).digest('hex');
    return {
      text: selected.join('\n'),
      binaryDerived: loaded.binaryDerived,
      lineStart: loaded.binaryDerived ? null : range.start,
      lineEnd: loaded.binaryDerived ? null : range.end,
      truncated: selected.length >= MAX_BROWSER_LINES || requestedRange?.capped === true,
      largeFile: false,
      nextLineStart: range.end < lines.length ? range.end + 1 : null,
      contentHash,
      contentHashScope: 'full_file'
    };
  }

  return readLargeTextSelection(path, symbol, requestedRange);
}

function codeBrowserReadFailure(path: string, fileSizeBytes: number): { error: string; summary: string; recoveryHint: string } {
  if (fileSizeBytes <= MAX_FILE_BYTES) {
    const buffer = readFileSync(path);
    if (!looksTextual(buffer) && !extractPrintableStrings(buffer)) {
      return {
        error: 'binary_without_printable_strings',
        summary: 'Code browser could not read useful text from this binary file.',
        recoveryHint: 'Use debugger, strings-oriented search, or an artifact-specific parser instead of code_browser for this file.'
      };
    }
  } else {
    const fd = openSync(path, 'r');
    try {
      const sample = Buffer.alloc(Math.min(8192, fileSizeBytes));
      const sampleBytes = readSync(fd, sample, 0, sample.length, 0);
      if (!looksTextual(sample.subarray(0, sampleBytes))) {
        return {
          error: 'large_binary_or_non_text_file',
          summary: 'Code browser could not read this large non-text file as source.',
          recoveryHint: 'Use debugger, binary-derived strings search, or a dedicated parser for this file.'
        };
      }
    } finally {
      closeSync(fd);
    }
  }

  return {
    error: 'text_read_failed',
    summary: 'Code browser could not read the requested text range.',
    recoveryHint: 'Retry with an explicit line_start and line_end inside the file, or search for the symbol/path again and use the returned location.'
  };
}

function readLargeTextSelection(path: string, symbol: string, requestedRange: RequestedLineRange | null): CodeBrowserTextSelection | null {
  const stat = safeStat(path);
  if (!stat?.isFile()) return null;

  const fd = openSync(path, 'r');
  try {
    const fileSize = Number(stat.size);
    const sample = Buffer.alloc(Math.min(8192, fileSize));
    const sampleBytes = readSync(fd, sample, 0, sample.length, 0);
    if (!looksTextual(sample.subarray(0, sampleBytes))) return null;

    const selected: string[] = [];
    const firstLines: string[] = [];
    const priorLines: Array<{ lineNo: number; line: string }> = [];
    let targetStart: number | null = requestedRange?.start ?? (symbol ? null : 1);
    let targetEnd: number | null = requestedRange?.end ?? (symbol ? null : MAX_BROWSER_LINES);
    let selectedStart: number | null = null;
    let selectedEnd: number | null = null;
    let emittedChars = 0;
    let lineNo = 0;
    let position = 0;
    let leftover = '';
    let stopped = false;
    let scannedBytes = 0;
    const buffer = Buffer.allocUnsafe(64 * 1024);

    const appendSelectedLine = (currentLineNo: number, line: string): void => {
      if (selected.length >= MAX_BROWSER_LINES || emittedChars >= MAX_EXCERPT_CHARS) {
        stopped = true;
        return;
      }
      if (selectedStart === null) selectedStart = currentLineNo;
      selectedEnd = currentLineNo;
      selected.push(line);
      emittedChars += line.length + 1;
      if (selected.length >= MAX_BROWSER_LINES || emittedChars >= MAX_EXCERPT_CHARS || (targetEnd !== null && currentLineNo >= targetEnd)) {
        stopped = true;
      }
    };

    const processLine = (line: string): void => {
      lineNo += 1;
      if (firstLines.length < MAX_BROWSER_LINES) firstLines.push(line);

      if (targetStart === null && symbol) {
        priorLines.push({ lineNo, line });
        if (priorLines.length > 41) priorLines.shift();
        if (line.includes(symbol)) {
          targetStart = Math.max(1, lineNo - 40);
          targetEnd = targetStart + MAX_BROWSER_LINES - 1;
          for (const prior of priorLines) {
            if (prior.lineNo >= targetStart && prior.lineNo <= targetEnd) appendSelectedLine(prior.lineNo, prior.line);
          }
        }
        return;
      }

      if (targetStart !== null && targetEnd !== null) {
        if (lineNo >= targetStart && lineNo <= targetEnd) {
          appendSelectedLine(lineNo, line);
          return;
        }
        if (lineNo > targetEnd) stopped = true;
      }
    };

    while (!stopped && scannedBytes < MAX_LARGE_BROWSER_SCAN_BYTES) {
      const bytes = readSync(fd, buffer, 0, buffer.length, position);
      if (bytes <= 0) break;
      position += bytes;
      scannedBytes += bytes;
      const chunk = leftover + buffer.subarray(0, bytes).toString('utf8').replace(/\r\n?/g, '\n');
      const parts = chunk.split('\n');
      leftover = parts.pop() ?? '';
      for (const line of parts) {
        processLine(line);
        if (stopped) break;
      }
    }

    if (!stopped && leftover) processLine(leftover);

    const fallbackToFirstChunk = selected.length === 0 && firstLines.length > 0;
    const lines = fallbackToFirstChunk ? firstLines : selected;
    const lineStart = fallbackToFirstChunk ? 1 : selectedStart;
    const lineEnd = fallbackToFirstChunk ? firstLines.length : selectedEnd;
    if (!lineStart || !lineEnd) return null;

    const scannedWholeFile = scannedBytes >= fileSize;
    const hasMore = !scannedWholeFile || lineEnd < lineNo || stopped;
    const text = lines.join('\n');
    return {
      text,
      binaryDerived: false,
      lineStart,
      lineEnd,
      truncated: hasMore || requestedRange?.capped === true || emittedChars >= MAX_EXCERPT_CHARS || fallbackToFirstChunk,
      largeFile: true,
      nextLineStart: hasMore ? lineEnd + 1 : null,
      contentHash: createHash('sha256').update(`${path}:${lineStart}-${lineEnd}:${text}`).digest('hex'),
      contentHashScope: 'excerpt'
    };
  } finally {
    closeSync(fd);
  }
}

function requestedLineRangeFromProjectStructureEntity(entity: ProjectStructureEntityRecord): RequestedLineRange {
  const start = Math.max(1, entity.lineStart);
  const requestedEnd = Math.max(start, entity.lineEnd);
  const end = Math.min(requestedEnd, start + MAX_BROWSER_LINES - 1);
  return {
    start,
    end,
    requestedEnd,
    capped: end < requestedEnd
  };
}

function projectStructureEntityPayload(entity: ProjectStructureEntityRecord): Record<string, unknown> {
  return {
    id: entity.id,
    entityKind: entity.entityKind,
    name: entity.name,
    signature: entity.signature,
    path: entity.path,
    language: entity.language,
    lineStart: entity.lineStart,
    lineEnd: entity.lineEnd,
    parentId: entity.parentId,
    metadata: entity.metadata
  };
}

function projectStructureRelationPayload(relation: ProjectStructureRelationRecord): Record<string, unknown> {
  return {
    id: relation.id,
    sourceEntityId: relation.sourceEntityId,
    relationKind: relation.relationKind,
    targetKind: relation.targetKind,
    targetName: relation.targetName,
    targetEntityId: relation.targetEntityId,
    metadata: relation.metadata
  };
}

function projectGraphNeighborhoodPayload(neighborhood: ReturnType<WorkspaceDatabase['getProjectGraphNeighborhood']>): Record<string, unknown> {
  return {
    status: neighborhood.status,
    root: neighborhood.root
      ? {
          id: neighborhood.root.id,
          nodeKind: neighborhood.root.nodeKind,
          entityType: neighborhood.root.entityType,
          entityId: neighborhood.root.entityId,
          label: neighborhood.root.label,
          sourcePath: neighborhood.root.sourcePath
        }
      : null,
    depth: neighborhood.depth,
    nodes: neighborhood.nodes.slice(0, 20).map((node) => ({
      id: node.id,
      nodeKind: node.nodeKind,
      entityType: node.entityType,
      entityId: node.entityId,
      label: node.label,
      sourcePath: node.sourcePath
    })),
    edges: neighborhood.edges.slice(0, 40).map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      edgeKind: edge.edgeKind,
      targetNodeId: edge.targetNodeId,
      targetEntityType: edge.targetEntityType,
      targetEntityId: edge.targetEntityId,
      targetLabel: edge.targetLabel,
      metadata: edge.metadata
    }))
  };
}

function looksTextual(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  let suspicious = 0;
  for (const byte of buffer.subarray(0, Math.min(buffer.length, 8192))) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / Math.min(buffer.length, 8192) < 0.05;
}

function extractPrintableStrings(buffer: Buffer): string {
  const parts: string[] = [];
  let current = '';
  let emittedChars = 0;
  for (const byte of buffer) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
      continue;
    }
    if (current.length >= 4) {
      parts.push(current);
      emittedChars += current.length + 1;
    }
    current = '';
    if (emittedChars > MAX_EXCERPT_CHARS) break;
  }
  if (current.length >= 4 && emittedChars <= MAX_EXCERPT_CHARS) parts.push(current);
  return parts.join('\n').slice(0, MAX_EXCERPT_CHARS);
}

function requestedLineRangeFromArgs(args: Record<string, unknown>): RequestedLineRange | null {
  const start = optionalPositiveInteger(args.line_start ?? args.lineStart);
  const end = optionalPositiveInteger(args.line_end ?? args.lineEnd);
  if (!start && !end) return null;

  const normalizedStart = start ?? Math.max(1, (end ?? MAX_BROWSER_LINES) - MAX_BROWSER_LINES + 1);
  const requestedEnd = end ?? null;
  const normalizedEnd = Math.max(normalizedStart, end ?? normalizedStart + MAX_BROWSER_LINES - 1);
  const cappedEnd = Math.min(normalizedEnd, normalizedStart + MAX_BROWSER_LINES - 1);
  return {
    start: normalizedStart,
    end: cappedEnd,
    requestedEnd,
    capped: cappedEnd < normalizedEnd
  };
}

function optionalPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function selectLineRange(lines: string[], symbol: string, requestedRange: RequestedLineRange | null): { start: number; end: number } {
  if (lines.length === 0) return { start: 1, end: 0 };
  if (requestedRange) {
    const start = Math.min(requestedRange.start, lines.length);
    const end = Math.max(start, Math.min(requestedRange.end, lines.length));
    return { start, end };
  }

  if (symbol) {
    const index = lines.findIndex((line) => line.includes(symbol));
    if (index >= 0) {
      const start = Math.max(1, index + 1 - 40);
      return { start, end: Math.min(lines.length, start + MAX_BROWSER_LINES - 1) };
    }
  }
  return { start: 1, end: Math.min(lines.length, MAX_BROWSER_LINES) };
}

function trimSnippet(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 240);
}

function guestToolNetworkProfile(context: CreatedRunContext): 'offline' | 'scoped' | 'elevated' {
  return normalizeNetworkProfile(context.run.networkProfile);
}

function parseDebuggerSummary(stdout: string, stderr: string, exitCode: number | null): DebuggerSummary {
  const transcript = `${stdout}\n${stderr}`;
  const unavailable = transcript.includes('BEALE_DEBUGGER_GDB_UNAVAILABLE') || /gdb unavailable/i.test(transcript);
  const targetMissing = transcript.includes('BEALE_DEBUGGER_TARGET_MISSING');
  const signal = transcript.match(/Program received signal\s+(SIG[A-Z0-9_]+)/)?.[1] ?? null;
  const frames = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#\d+\s+/.test(line))
    .slice(0, 24);
  const registersCaptured = /^\s*(?:rax|rbx|rcx|rdx|rsi|rdi|rbp|rsp|rip|eax|ebx|ecx|edx|eip|pc|sp|lr)\s+/im.test(transcript);
  const unavailableReason = unavailable ? 'gdb_unavailable_in_guest' : exitCode === 127 ? 'debugger_command_not_found' : targetMissing ? 'target_missing' : null;

  return {
    gdbAvailable: !unavailable && exitCode !== 127,
    crashed: Boolean(signal),
    signal,
    frames,
    registersCaptured,
    unavailableReason,
    targetMissing
  };
}

function safeStat(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function isWithinPath(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function pathContainsSegment(path: string, segment: string): boolean {
  return path.split(/[\\/]+/).includes(segment);
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
}
