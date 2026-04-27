import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CreatedRunContext, WorkspaceDatabase } from './database';
import { ExecutorManager, normalizeNetworkProfile } from './executorManager';
import type { FunctionCallOutputItem } from './openaiAdapter';
import { redactJsonForModel } from './redaction';
import type { GuestExecuteRequest, GuestExecuteResult } from './executorTypes';
import type { ScopeAsset, TraceEventType, TraceSource } from '@shared/types';

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

interface GuestToolExecution {
  result: GuestExecuteResult;
  artifactId: string | null;
  importedHostPath: string | null;
}

const TOOL_NAMES = ['search', 'code_browser', 'python', 'debugger', 'artifact', 'verifier'] as const;
type ToolName = (typeof TOOL_NAMES)[number];

const LOCAL_ASSET_KINDS: ReadonlySet<ScopeAsset['kind']> = new Set(['path', 'repo', 'binary', 'documentation', 'other']);
const SKIPPED_DIRS = new Set(['.beale', '.git', 'node_modules', 'dist', 'out', 'coverage', '.cache']);
const MAX_SEARCH_FILES = 300;
const MAX_SEARCH_MATCHES = 25;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_BROWSER_LINES = 180;
const MAX_EXCERPT_CHARS = 16_000;
const MAX_MODEL_ARTIFACT_BYTES = 256 * 1024;

export function bealeToolDefinitions(): OpenAiToolDefinition[] {
  return [
    tool('search', 'Search scoped workspace metadata, source text, binary-derived strings, notes, and artifact summaries. Does not access live networks.', {
      query: stringProp('Search query'),
      target: stringProp('Optional scoped target, path, artifact id, or component hint')
    }),
    tool('code_browser', 'Read bounded chunks from scoped source, text artifacts, or binary-derived strings.', {
      path: stringProp('Scoped file path or artifact id'),
      symbol: stringProp('Optional symbol or text anchor')
    }),
    tool('python', 'Run a small Python analysis operation inside the disposable guest VM. No host execution.', {
      task: stringProp('Analysis task'),
      script: stringProp('Python script to run in the guest VM'),
      artifact_path: stringProp('Optional guest path to export as an artifact after execution')
    }),
    tool('debugger', 'Run a wrapper-first debugger observation inside the disposable guest VM.', {
      operation: stringProp('Debugger operation, such as crash_summary or gdb_probe'),
      target: stringProp('Target executable path inside the guest'),
      input_path: stringProp('Optional guest input path for crash reproduction')
    }),
    tool('artifact', 'Preserve generated research output or evidence metadata in the content-addressed artifact store.', {
      name: stringProp('Artifact name'),
      content: stringProp('Artifact content or bounded summary'),
      kind: stringProp('Artifact kind')
    }),
    tool('verifier', 'Record a verifier contract and structured pass, fail, or inconclusive evidence state.', {
      hypothesis: stringProp('Hypothesis or finding identifier'),
      expectation: stringProp('Expected observation'),
      artifact_id: stringProp('Optional artifact id that backs the expectation'),
      trace_event_id: stringProp('Optional trace event id that backs the expectation')
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

    const destination = extractDestination(args);
    if (destination && !this.destinationAllowed(destination)) {
      return this.recordPolicyBlock(context, call, args, destination);
    }

    const toolCallId = this.db.createToolCall({
      runId: context.run.id,
      attemptId: context.attempt.id,
      toolName: call.name,
      toolVersion: 'structured-tools-v1',
      input: {
        openaiCallId: call.callId,
        responseItemId: call.responseItemId ?? null,
        arguments: args,
        policy: this.toolPolicy(call.name)
      },
      status: 'completed',
      resultSummary: `Structured ${call.name} call accepted by Beale tool router.`,
      result: { toolName: call.name, normalizedInTrace: true },
      vmContextId: context.vmContext.id
    });

    this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'tool_call',
      source: 'model',
      summary: `OpenAI requested Beale tool: ${call.name}.`,
      payload: {
        openaiCallId: call.callId,
        responseItemId: call.responseItemId ?? null,
        arguments: args,
        policy: this.toolPolicy(call.name)
      },
      toolCallId,
      vmContextId: context.vmContext.id
    });

    let result: ToolResult;
    try {
      result = this.dispatch(context, call, args);
    } catch (error) {
      result = {
        status: 'error',
        summary: `${call.name} failed: ${errorMessage(error)}`,
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
    return { ...result, traceEventId: event.id };
  }

  private dispatch(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    switch (call.name) {
      case 'search':
        return this.search(context, args);
      case 'code_browser':
        return this.codeBrowser(context, call, args);
      case 'python':
        return this.python(context, call, args);
      case 'debugger':
        return this.debugger(context, call, args);
      case 'artifact':
        return this.artifact(args);
      case 'verifier':
        return this.verifier(context, args);
      default:
        return this.recordError(context, call, args, `Unknown Beale tool requested: ${call.name}`);
    }
  }

  private search(context: CreatedRunContext, args: Record<string, unknown>): ToolResult {
    const query = stringValue(args.query, '').trim();
    const targetHint = stringValue(args.target, '').trim();
    if (!query) {
      return {
        status: 'error',
        summary: 'Search requires a non-empty query.',
        payload: { observationBacked: false, error: 'missing_query' }
      };
    }

    const files = this.collectScopedFiles(targetHint);
    const queryLower = query.toLowerCase();
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
        if (!line.toLowerCase().includes(queryLower)) continue;
        matches.push({
          kind: 'file',
          path: file.path,
          assetId: file.assetId,
          assetKind: file.assetKind,
          line: loaded.binaryDerived ? null : index + 1,
          range: loaded.binaryDerived ? 'binary_strings' : `${index + 1}`,
          binaryDerived: loaded.binaryDerived,
          snippet: trimSnippet(line)
        });
        if (matches.length >= MAX_SEARCH_MATCHES) break;
      }
    }

    matches.push(...this.searchRunArtifactsAndTrace(context, queryLower, MAX_SEARCH_MATCHES - matches.length));

    return {
      status: 'success',
      summary: `Search returned ${matches.length} scoped match${matches.length === 1 ? '' : 'es'}.`,
      payload: {
        observationBacked: true,
        simulated: false,
        query,
        targetHint,
        filesConsidered: files.length,
        skippedFiles,
        matches
      }
    };
  }

  private codeBrowser(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
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
      return this.recordLocalPolicyBlock(context, call, args, 'Path is outside the active program scope.', {
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

  private python(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    const script = stringValue(args.script, '').trim();
    if (!script) {
      return {
        status: 'error',
        summary: 'Python requires a non-empty guest script.',
        payload: { observationBacked: false, error: 'missing_script' }
      };
    }
    const unavailable = this.executorUnavailable();
    if (unavailable) {
      return this.recordLocalPolicyBlock(context, call, args, unavailable, {
        reason: 'vm_executor_unavailable',
        hostExecution: false
      });
    }

    const artifactPath = stringValue(args.artifact_path, '').trim();
    const execution = this.executeInDisposableGuest(context, {
      operationKind: 'python',
      command: ['python3', '-c', script],
      cwd: '/workspace',
      env: {
        BEALE_TARGET_PATH: '/workspace/target'
      },
      timeoutMs: 30_000,
      networkProfile: normalizeNetworkProfile(context.run.networkProfile),
      expectedOutput: artifactPath ? 'artifact' : 'summary'
    }, artifactPath || null);

    return {
      status: execution.result.status === 'success' ? 'success' : 'error',
      summary: `Guest python operation finished with ${execution.result.status}.`,
      artifactId: execution.artifactId ?? undefined,
      payload: {
        observationBacked: true,
        simulated: false,
        hostExecution: false,
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
        networkProfile: normalizeNetworkProfile(context.run.networkProfile)
      }
    };
  }

  private debugger(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>): ToolResult {
    const unavailable = this.executorUnavailable();
    if (unavailable) {
      return this.recordLocalPolicyBlock(context, call, args, unavailable, {
        reason: 'vm_executor_unavailable',
        hostExecution: false
      });
    }
    const operation = stringValue(args.operation, 'gdb_probe');
    const target = stringValue(args.target, '/workspace/target');
    const inputPath = stringValue(args.input_path, '').trim();
    const shellCommand = [
      'set -eu',
      'operation="${BEALE_DEBUG_OPERATION:-gdb_probe}"',
      'target="${BEALE_DEBUG_TARGET:-/workspace/target}"',
      'input_path="${BEALE_DEBUG_INPUT_PATH:-}"',
      'if command -v gdb >/dev/null 2>&1; then',
      '  if [ "$operation" = "crash_summary" ] || [ "$operation" = "run" ]; then',
      '    if [ -n "$input_path" ]; then',
      '      gdb --batch -ex run -ex bt -ex "info registers" --args "$target" "$input_path" 2>&1 | sed -n "1,160p"',
      '    else',
      '      gdb --batch -ex run -ex bt -ex "info registers" --args "$target" 2>&1 | sed -n "1,160p"',
      '    fi',
      '  else',
      '    gdb --batch -ex "file $target" -ex "info files" 2>&1 | sed -n "1,80p"',
      '  fi',
      'else',
      '  echo "gdb unavailable in guest image"',
      'fi'
    ].join('\n');

    const execution = this.executeInDisposableGuest(context, {
      operationKind: 'shell',
      command: ['sh', '-lc', shellCommand],
      cwd: '/workspace',
      env: {
        BEALE_DEBUG_OPERATION: operation,
        BEALE_DEBUG_TARGET: target,
        BEALE_DEBUG_INPUT_PATH: inputPath
      },
      timeoutMs: 30_000,
      networkProfile: normalizeNetworkProfile(context.run.networkProfile),
      expectedOutput: 'summary'
    }, null);

    return {
      status: execution.result.status === 'success' ? 'success' : 'error',
      summary: `Debugger wrapper operation finished with ${execution.result.status}.`,
      payload: {
        observationBacked: true,
        simulated: false,
        hostExecution: false,
        wrapper: 'gdb_batch_probe',
        operation,
        target,
        inputPath,
        status: execution.result.status,
        exitCode: execution.result.exitCode,
        stdoutSummary: execution.result.stdoutSummary,
        stderrSummary: execution.result.stderrSummary,
        structured: execution.result.structured,
        importedHostPath: execution.importedHostPath,
        networkProfile: normalizeNetworkProfile(context.run.networkProfile)
      }
    };
  }

  private artifact(args: Record<string, unknown>): ToolResult {
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

  private verifier(context: CreatedRunContext, args: Record<string, unknown>): ToolResult {
    const artifactId = stringValue(args.artifact_id, '').trim();
    const traceEventId = stringValue(args.trace_event_id, '').trim();
    const detail = this.db.getRunDetail(context.run.id);
    const referencedArtifact = artifactId ? detail.artifacts.find((artifact) => artifact.id === artifactId) ?? null : null;
    const referencedTrace = traceEventId ? detail.traceEvents.find((event) => event.id === traceEventId) ?? null : null;
    const hasEvidenceReference = Boolean(referencedArtifact || referencedTrace);
    const status = 'inconclusive';
    const blockedIssue = hasEvidenceReference ? 'requires_reproduction_contract_execution' : 'missing_trace_or_artifact_reference';

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
        traceEventId: referencedTrace?.id ?? null
      },
      passCriteria: {
        requiresObservedBehavior: true,
        requiresTraceOrArtifactReference: true
      }
    });
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

  private executeInDisposableGuest(context: CreatedRunContext, request: GuestExecuteRequest, artifactPath: string | null): GuestToolExecution {
    if (!this.executor) {
      throw new Error('VM executor is not available to the OpenAI tool router.');
    }

    const status = this.executor.getStatus();
    if (!status.available) {
      throw new Error(status.reason ?? 'VM executor is not available.');
    }

    const importSpec = this.firstScopedImport();
    let contextCreated = false;
    try {
      this.executor.createContext(context, 'beale-default-toolchain', 'clean');
      contextCreated = true;
      if (status.supports.clone) {
        this.executor.cloneContext(context, 'clean');
      }
      if (importSpec && status.supports.import) {
        this.executor.importWorkspaceMaterial(context, {
          hostPath: importSpec.hostPath,
          guestPath: '/workspace/target',
          mode: 'read_only'
        });
      }
      const result = this.executor.executeGuestOperation(context, request);
      const artifactId =
        artifactPath && status.supports.export
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
        importedHostPath: importSpec?.hostPath ?? null
      };
    } finally {
      if (contextCreated) {
        this.executor.destroyContext(context);
      }
    }
  }

  private collectScopedFiles(targetHint: string): ScopedFile[] {
    const files: ScopedFile[] = [];
    for (const asset of this.db.getActiveScope().assets) {
      if (!isScopedLocalAsset(asset)) continue;
      const root = resolve(asset.value);
      if (!existsSync(root)) continue;
      this.addScopedFiles(root, asset, files);
      if (files.length >= MAX_SEARCH_FILES) break;
    }
    if (!targetHint) return files;
    const normalizedHint = targetHint.toLowerCase();
    return files.filter((file) => file.path.toLowerCase().includes(normalizedHint) || basename(file.path).toLowerCase().includes(normalizedHint));
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

  private searchRunArtifactsAndTrace(context: CreatedRunContext, queryLower: string, remaining: number): Array<Record<string, unknown>> {
    if (remaining <= 0) return [];
    const detail = this.db.getRunDetail(context.run.id);
    const matches: Array<Record<string, unknown>> = [];
    for (const artifact of detail.artifacts) {
      const haystack = `${artifact.id} ${artifact.kind} ${artifact.sha256} ${JSON.stringify(artifact.metadata)}`.toLowerCase();
      if (!haystack.includes(queryLower)) continue;
      matches.push({
        kind: 'artifact',
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        sha256: artifact.sha256,
        snippet: trimSnippet(`${artifact.kind} ${artifact.id} ${artifact.sha256}`)
      });
      if (matches.length >= remaining) return matches;
    }
    for (const event of detail.traceEvents) {
      const haystack = `${event.summary} ${event.type} ${event.source} ${JSON.stringify(event.payload)}`.toLowerCase();
      if (!haystack.includes(queryLower)) continue;
      matches.push({
        kind: 'trace_event',
        traceEventId: event.id,
        sequence: event.sequence,
        eventType: event.type,
        source: event.source,
        snippet: trimSnippet(event.summary)
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

  private toolPolicy(toolName: ToolName): Record<string, unknown> {
    switch (toolName) {
      case 'search':
      case 'code_browser':
        return { execution: 'host_scoped_read_only', targetExecution: false, liveNetwork: false };
      case 'python':
      case 'debugger':
        return { execution: 'disposable_guest_vm', hostExecution: false, hostDatabaseMounted: false, openAiCredentialsMounted: false };
      case 'artifact':
        return { execution: 'host_artifact_store', contentAddressed: true, modelGeneratedContentIsNotObservation: true };
      case 'verifier':
        return { execution: 'host_verifier_records', promotionRequiresTraceOrArtifactEvidence: true };
    }
  }

  private executorUnavailable(): string | null {
    if (!this.executor) return 'VM executor is not available to the OpenAI tool router.';
    const status = this.executor.getStatus();
    return status.available ? null : (status.reason ?? 'VM executor is not available.');
  }

  private recordPolicyBlock(context: CreatedRunContext, call: OpenAiFunctionCall, args: Record<string, unknown>, destination: string): ToolResult {
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
      reason: `Blocked out-of-scope tool destination: ${destination}`
    });
    const event = this.db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'approval_event',
      source: 'policy',
      summary: `Policy blocked OpenAI tool call: ${call.name}.`,
      payload: {
        decision: 'blocked',
        destination,
        arguments: args
      },
      approvalId: approval.id,
      vmContextId: context.vmContext.id
    });
    return {
      status: 'policy_blocked',
      summary: `Policy blocked ${call.name} for out-of-scope destination.`,
      traceEventId: event.id,
      payload: {
        observationBacked: false,
        blocked: true,
        destination,
        approvalId: approval.id
      }
    };
  }

  private recordLocalPolicyBlock(
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
      summary: `Policy blocked ${call.name}: ${reason}`,
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

function extractDestination(args: Record<string, unknown>): string | null {
  const destination = args.destination ?? args.url ?? args.host ?? args.target;
  return typeof destination === 'string' && /^https?:\/\//.test(destination) ? destination : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
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
  for (const byte of buffer) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
      continue;
    }
    if (current.length >= 4) parts.push(current);
    current = '';
    if (parts.join('\n').length > MAX_EXCERPT_CHARS) break;
  }
  if (current.length >= 4) parts.push(current);
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
