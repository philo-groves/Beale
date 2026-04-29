import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import { ExecutorManager, normalizeNetworkProfile } from './executorManager';
import type { FunctionCallOutputItem } from './openaiAdapter';
import { redactJsonForModel } from './redaction';
import { runVerifierContract } from './verifierRunner';
import { materializeGitRepository, normalizeGitHubRepositoryUrl, selectSourceRepository, sourceRepositoryCandidates, type SourceRepositoryCandidate } from './sourceMaterializer';
import { executeHostOperation, isHostResearchSandbox, mapSandboxPathToHost } from './hostToolExecutor';
import type { GuestExecuteRequest, GuestExecuteResult } from './executorTypes';
import { cweEntryForId, inferCweMapping, normalizeCweConfidence, normalizeCweId } from './cweCatalog';
import type { ScopeAsset, ScopeAssetInput, TraceEventType, TraceSource, WeaknessMappingInput, WeaknessMappingRecord } from '@shared/types';

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

const TOOL_NAMES = ['source', 'search', 'code_browser', 'python', 'debugger', 'artifact', 'evidence', 'hypothesis', 'finding', 'verifier'] as const;
type ToolName = (typeof TOOL_NAMES)[number];

const LOCAL_ASSET_KINDS: ReadonlySet<ScopeAsset['kind']> = new Set(['path', 'repo', 'binary', 'documentation', 'other']);
const SKIPPED_DIRS = new Set(['.beale', '.git', 'node_modules', 'dist', 'out', 'coverage', '.cache']);
const MAX_SEARCH_FILES = 5000;
const MAX_SEARCH_MATCHES = 40;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_BROWSER_LINES = 180;
const MAX_EXCERPT_CHARS = 16_000;
const MAX_MODEL_ARTIFACT_BYTES = 256 * 1024;

export function bealeToolDefinitions(): OpenAiToolDefinition[] {
  return [
    tool('source', 'Materialize an in-scope source repository into the Beale workspace with a host-safe shallow git clone. Use before source search when a scoped repo is not checked out yet.', {
      repository: stringProp('In-scope repository URL or label, such as https://github.com/org/repo or a scoped source label'),
      ref: stringProp('Optional branch, tag, or commit to checkout after clone; use an empty string for the default branch')
    }),
    tool('search', 'Search scoped workspace metadata, source text, binary-derived strings, and artifact summaries. Supports plain terms, exact phrases, and simple regex/| alternatives. Does not perform target execution.', {
      query: stringProp('Search query. Use concise terms or simple regex alternatives, for example Route|pathPrefix|HttpRoutes.'),
      target: stringProp('Scoped target label, repository URL, materialized path, artifact id, or component hint; use an empty string when not needed')
    }),
    tool('code_browser', 'Read bounded chunks from scoped source, text artifacts, or binary-derived strings.', {
      path: stringProp('Scoped file path or artifact id'),
      symbol: stringProp('Symbol or text anchor; use an empty string when not needed')
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
      scope_confidence: stringProp('Scope confidence label, preferably prefixed with 0-4'),
      priority_score: numberProp('Priority score. Use 0 when unknown.')
    }),
    tool('finding', 'Create or update a finding record. Verified findings require a passing real verifier run id.', {
      finding_id: stringProp('Existing finding id to update; use an empty string to create a new finding'),
      hypothesis_id: stringProp('Linked hypothesis id; use an empty string when not linked'),
      state: stringProp('State, such as needs_evidence, reproduced, verified, disclosure_ready, false_positive, out_of_scope, dismissed, or duplicate'),
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
      priority_score: numberProp('Priority score. Use 0 when unknown.'),
      verified_by_verifier_run_id: stringProp('Passing real verifier run id when state is verified; otherwise use an empty string')
    }),
    tool('verifier', 'Record a verifier contract and structured pass, fail, or inconclusive evidence state.', {
      hypothesis: stringProp('Hypothesis or finding identifier'),
      expectation: stringProp('Expected observation'),
      artifact_id: stringProp('Artifact id that backs the expectation; use an empty string when not available'),
      trace_event_id: stringProp('Trace event id that backs the expectation; use an empty string when not available'),
      verifier_script: stringProp('Shell script to execute in the active session sandbox; use an empty string to only declare the contract'),
      artifact_path: stringProp('Artifact path to export after verifier execution; use an empty string when not needed'),
      expected_stdout: stringProp('Substring expected in verifier stdout for pass; use an empty string when not needed')
    })
  ];
}

export class BealeToolRouter {
  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly executor: ExecutorManager | null = null
  ) {}

  public execute(context: CreatedRunContext, call: OpenAiFunctionCall): FunctionCallOutputItem {
    const args = parseArguments(call.argumentsJson);
    const result = this.executeInternal(context, call, args);
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

  private dispatch(context: CreatedRunContext, toolName: ToolName, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    switch (toolName) {
      case 'source':
        return this.materializeSource(context, args);
      case 'search':
        return this.searchScopedMaterial(context, args);
      case 'code_browser':
        return this.browseCode(context, call, args);
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
    const matches: Array<Record<string, unknown>> = [];
    let skippedFiles = 0;

    for (const file of files) {
      if (matches.length >= MAX_SEARCH_MATCHES) break;
      const loaded = readScopedText(file.path);
      if (!loaded) {
        skippedFiles += 1;
        continue;
      }
      const lines = loaded.text.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!lineMatchesSearchQuery(line, queryPlan)) continue;
        matches.push({
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
        if (matches.length >= MAX_SEARCH_MATCHES) break;
      }
    }

    matches.push(...this.searchRunArtifacts(context, queryPlan, MAX_SEARCH_MATCHES - matches.length));

    const sourceHint =
      files.length === 0 && collection.unmaterializedSource
        ? `Scoped repository ${collection.unmaterializedSource.url} is not materialized. Use the source tool, then retry search.`
        : files.length === 0 && sourceCandidates.length > 0
          ? 'No local source files were available for this target. Use the source tool to materialize an in-scope repository, or search with an empty target.'
          : null;
    const summary =
      sourceHint ??
      `Search examined ${files.length} scoped file${files.length === 1 ? '' : 's'} and returned ${matches.length} match${matches.length === 1 ? '' : 'es'}.`;

    return {
      status: 'success',
      summary,
      payload: {
        observationBacked: true,
        simulated: false,
        query,
        queryMode: queryPlan.mode,
        queryTerms: queryPlan.terms,
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

    const artifactTarget = this.artifactReadTarget(context, requestedPath);
    const filePath = artifactTarget?.path ?? resolve(requestedPath);
    if (!artifactTarget && !this.isScopedLocalPath(filePath)) {
      return this.recordToolPolicyBlock(context, call, args, 'Path is outside the active program scope.', {
        path: requestedPath,
        reason: 'path_outside_active_scope'
      });
    }

    const loaded = readScopedText(filePath);
    if (!loaded) {
      return {
        status: 'error',
        summary: 'Code browser could not read the requested bounded text.',
        payload: {
          observationBacked: false,
          path: requestedPath,
          reason: 'unreadable_or_too_large'
        }
      };
    }

    const lines = loaded.text.split(/\r?\n/);
    const range = selectLineRange(lines, symbol);
    const selected = lines.slice(range.start - 1, range.end);
    const excerpt = selected.map((line, index) => `${range.start + index}: ${line}`).join('\n').slice(0, MAX_EXCERPT_CHARS);
    const contentHash = createHash('sha256').update(loaded.text).digest('hex');

    return {
      status: 'success',
      summary: `Code browser returned ${range.end - range.start + 1} bounded line${range.end === range.start ? '' : 's'}.`,
      payload: {
        observationBacked: true,
        simulated: false,
        path: artifactTarget?.artifactId ?? filePath,
        sourcePath: filePath,
        symbol,
        binaryDerived: loaded.binaryDerived,
        contentHash,
        lineStart: loaded.binaryDerived ? null : range.start,
        lineEnd: loaded.binaryDerived ? null : range.end,
        truncated: excerpt.length >= MAX_EXCERPT_CHARS || lines.length > MAX_BROWSER_LINES,
        excerpt
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
    const priorityScore = numberValue(args.priority_score, existing?.priorityScore ?? 0);
    const attackerReachability = stringValue(args.attacker_reachability, existing?.attackerReachability ?? '').trim() || existing?.attackerReachability || '1 unspecified reachability';
    const impact = stringValue(args.impact, existing?.impact ?? '').trim() || existing?.impact || '1 unspecified impact';
    const evidenceConfidence = stringValue(args.evidence_confidence, existing?.evidenceConfidence ?? '').trim() || existing?.evidenceConfidence || '0 hypothesis only';
    const exploitPracticality = stringValue(args.exploit_practicality, existing?.exploitPracticality ?? '').trim() || existing?.exploitPracticality || '1 unspecified practicality';
    const scopeConfidence = stringValue(args.scope_confidence, existing?.scopeConfidence ?? '').trim() || existing?.scopeConfidence || '1 likely in scope';
    const cweMappings = cweMappingsForToolArgs(args, existing?.cweMappings, {
      bugClass,
      title,
      descriptionMarkdown,
      impactMarkdown: impact
    });

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
        cweMappings: cwePayload(hypothesis.cweMappings),
        priorityScore: hypothesis.priorityScore,
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
    if (state === 'verified' && !verifierRunId && !existing?.verifiedByVerifierRunId) {
      return { status: 'error', summary: 'Verified findings require a passing real verifier run id.', payload: { observationBacked: false, error: 'missing_verified_by_verifier_run_id' } };
    }

    const title = stringValue(args.title, existing?.title ?? '').trim() || existing?.title || 'Untitled finding';
    const summaryMarkdown = stringValue(args.summary, existing?.summaryMarkdown ?? '').trim() || existing?.summaryMarkdown || 'No summary provided.';
    const affectedAssets = jsonRecordFromString(args.affected_assets_json, existing?.affectedAssets ?? {});
    const affectedVersions = jsonRecordFromString(args.affected_versions_json, existing?.affectedVersions ?? {});
    const impactMarkdown = stringValue(args.impact, existing?.impactMarkdown ?? '').trim() || existing?.impactMarkdown || 'Impact not yet assessed.';
    const priorityScore = numberValue(args.priority_score, existing?.priorityScore ?? 0);
    const linkedHypothesis = hypothesisId ? detail.hypotheses.find((hypothesis) => hypothesis.id === hypothesisId) ?? null : null;
    const cweMappings = cweMappingsForToolArgs(args, existing?.cweMappings, {
      bugClass: linkedHypothesis?.bugClass ?? '',
      title,
      descriptionMarkdown: summaryMarkdown,
      impactMarkdown
    });

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
        observationBacked: state === 'verified' || state === 'reproduced',
        claimStatus: state === 'verified' ? 'verifier_backed_finding' : 'model_proposed_finding',
        action: existing ? 'update' : 'create',
        findingId: finding.id,
        hypothesisId: finding.hypothesisId,
        title: finding.title,
        state: finding.state,
        priorityScore: finding.priorityScore,
        cweMappings: cwePayload(finding.cweMappings),
        verifiedByVerifierRunId: finding.verifiedByVerifierRunId
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
          artifactId: outcome.artifactId
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
        promotedFinding: false
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
    return localAssets.flatMap((asset) => {
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
    const candidateUrl = normalizeGitHubRepositoryUrl(candidate.url);
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
    return this.db.saveProgramScope({
      programName: scope.programName,
      organizationName: scope.organizationName,
      descriptionMarkdown: scope.descriptionMarkdown,
      rulesMarkdown: scope.rulesMarkdown,
      networkProfile: scope.networkProfile,
      expiresAt: scope.expiresAt,
      assets
    });
  }

  private toolPolicy(toolName: ToolName): Record<string, unknown> {
    switch (toolName) {
      case 'source':
        return { execution: 'host_safe_source_setup', targetExecution: false, liveNetwork: 'scoped_repository_clone', hostShell: false };
      case 'search':
      case 'code_browser':
        return { execution: 'host_scoped_read_only', targetExecution: false, liveNetwork: false };
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

function numberProp(description: string): Record<string, unknown> {
  return { type: 'number', description };
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
  if (toolName === 'source' || toolName === 'search' || toolName === 'code_browser') return null;
  const destination = args.destination ?? args.url ?? args.host ?? args.target;
  return typeof destination === 'string' && /^https?:\/\//.test(destination) ? destination : null;
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
  const normalizedRight = normalizeGitHubRepositoryUrl(right);
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
    mode: regex ? 'regex_or_terms' : terms.length > 1 ? 'terms' : 'literal'
  };
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

function selectLineRange(lines: string[], symbol: string): { start: number; end: number } {
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

function safeStat(path: string): ReturnType<typeof statSync> | null {
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
