#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const logPath = process.argv[2];
const failActions = new Set((process.argv[3] ?? '').split(',').map((item) => item.trim()).filter(Boolean));
if (logPath) {
  appendFileSync(logPath, `${JSON.stringify({ input, env: process.env })}\n`);
}

const baseCapabilities = {
  protocolVersion: 1,
  provider: 'vmctl',
  configured: true,
  available: true,
  label: 'Fixture local VM controller',
  reason: null,
  targetExecution: true,
  supportedNetworkProfiles: ['offline', 'scoped'],
  supports: {
    snapshots: true,
    clone: true,
    import: true,
    export: true,
    shell: true,
    python: true,
    debugger: false
  }
};

const now = new Date().toISOString();

const handlers = {
  list_capabilities() {
    return baseCapabilities;
  },
  create_context() {
    return { providerContextId: `fixture-${input.payload.vmContextId}`, state: 'clean' };
  },
  restore_snapshot() {
    return { restored: true, snapshotRef: input.payload.snapshotRef };
  },
  clone_context() {
    return { cloned: true, snapshotRef: input.payload.snapshotRef };
  },
  import_workspace_material() {
    return { imported: true, guestPath: input.payload.import.guestPath, mode: input.payload.import.mode };
  },
  execute() {
    return {
      status: 'success',
      exitCode: 0,
      signal: null,
      startedAt: now,
      endedAt: now,
      durationMs: 7,
      stdoutSummary: 'fixture guest stdout',
      stderrSummary: '',
      structured: {
        fixture: true,
        operationKind: input.payload.operation.operationKind,
        envKeys: Object.keys(input.payload.operation.env ?? {}).sort()
      },
      candidateArtifacts: [
        {
          guestPath: '/tmp/beale-output.txt',
          kind: 'log',
          mimeType: 'text/plain',
          sensitivity: 'internal',
          modelVisible: true,
          summary: 'fixture candidate artifact'
        }
      ],
      contaminated: true,
      error: null
    };
  },
  export_artifact() {
    return {
      guestPath: input.payload.export.guestPath,
      kind: input.payload.export.kind,
      mimeType: input.payload.export.mimeType,
      sensitivity: input.payload.export.sensitivity,
      modelVisible: input.payload.export.modelVisible,
      contentBase64: Buffer.from('fixture exported artifact\n', 'utf8').toString('base64')
    };
  },
  revert() {
    return { reverted: true, snapshotRef: input.payload.snapshotRef };
  },
  preserve() {
    return { preserved: true, reason: input.payload.reason };
  },
  destroy() {
    return { destroyed: true };
  }
};

const handler = handlers[input.action];
if (!handler) {
  console.log(JSON.stringify({ ok: false, error: `unsupported action: ${input.action}` }));
  process.exit(0);
}
if (failActions.has(input.action)) {
  console.log(JSON.stringify({ ok: false, error: `fixture forced ${input.action} failure` }));
  process.exit(0);
}

console.log(JSON.stringify({ ok: true, result: handler() }));
