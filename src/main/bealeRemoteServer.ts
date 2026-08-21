import { createServer, type Server, type Socket } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import type {
  BealeRemoteHostSummary,
  BealeRemoteMemorySummary,
  BealeRemoteResponse,
  BealeRemoteWorkspaceSummary,
  HoneycrispMemorySummary,
  WorkspaceRegistryState
} from '@shared/types';

export const BEALE_REMOTE_PORT = 59_728;
const MAX_REQUEST_BYTES = 16 * 1024;
const RETRY_INTERVAL_MS = 5_000;

type BealeRemoteRequest =
  | { version: 1; action: 'list_workspaces' }
  | { version: 1; action: 'get_workspace_memory'; registryWorkspaceId: string };

type WorkspaceMemoryResolver = (registryWorkspaceId: string) => Promise<HoneycrispMemorySummary>;

export class BealeRemoteServer {
  private server: Server | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  public constructor(
    private readonly getRegistry: () => WorkspaceRegistryState,
    private readonly getWorkspaceMemory: WorkspaceMemoryResolver
  ) {}

  public start(): void {
    this.stopped = false;
    this.tryStart();
  }

  public stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const server = this.server;
    this.server = null;
    server?.close();
  }

  private tryStart(): void {
    if (this.stopped || this.server) return;
    const address = tailscaleIpv4Address();
    if (!address) {
      this.scheduleRetry();
      return;
    }

    const server = createServer((socket) => this.handleConnection(socket, address));
    server.on('error', () => {
      if (this.server === server) this.server = null;
      if (server.listening) server.close();
      this.scheduleRetry();
    });
    server.listen(BEALE_REMOTE_PORT, address);
    this.server = server;
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.tryStart();
    }, RETRY_INTERVAL_MS);
    this.retryTimer.unref();
  }

  private handleConnection(socket: Socket, address: string): void {
    if (!isTailscaleIpv4Address(normalizeRemoteAddress(socket.remoteAddress))) {
      socket.destroy();
      return;
    }
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.setTimeout(10_000, () => socket.destroy());
    let requestText = '';
    let responded = false;
    const respond = (response: BealeRemoteResponse) => {
      if (responded) return;
      responded = true;
      socket.removeAllListeners('data');
      socket.end(encodeResponse(response));
    };
    socket.on('data', (chunk: string) => {
      requestText += chunk;
      if (Buffer.byteLength(requestText) > MAX_REQUEST_BYTES) {
        respond({ ok: false, version: 1, error: 'Remote request is too large.' });
        return;
      }
      const newline = requestText.indexOf('\n');
      if (newline < 0) return;
      socket.removeAllListeners('data');
      void handleBealeRemoteRequest(requestText.slice(0, newline), this.getRegistry(), {
        name: hostname(),
        address,
        port: BEALE_REMOTE_PORT
      }, this.getWorkspaceMemory)
        .then(respond)
        .catch(() => respond({ ok: false, version: 1, error: 'Beale could not load the requested workspace data.' }));
    });
    socket.on('error', () => undefined);
  }
}

export async function handleBealeRemoteRequest(
  requestText: string,
  registry: WorkspaceRegistryState,
  host: BealeRemoteHostSummary,
  getWorkspaceMemory: WorkspaceMemoryResolver = async () => {
    throw new Error('Workspace memory is unavailable.');
  }
): Promise<BealeRemoteResponse> {
  let request: unknown;
  try {
    request = JSON.parse(requestText);
  } catch {
    return { ok: false, version: 1, error: 'Remote request must be valid JSON.' };
  }
  if (!isRemoteRequest(request)) {
    return { ok: false, version: 1, error: 'Unsupported Beale remote request.' };
  }
  if (request.action === 'get_workspace_memory') {
    const workspace = registry.workspaces.find((candidate) => candidate.id === request.registryWorkspaceId);
    if (!workspace) return { ok: false, version: 1, error: 'The requested workspace is not registered.' };
    const memory = await getWorkspaceMemory(workspace.id);
    return {
      ok: true,
      version: 1,
      action: 'get_workspace_memory',
      workspace: remoteWorkspaceSummary(workspace),
      memory: remoteMemorySummary(memory)
    };
  }
  return {
    ok: true,
    version: 1,
    action: 'list_workspaces',
    host,
    workspaces: registry.workspaces.map(remoteWorkspaceSummary)
  };
}

export function isTailscaleIpv4Address(address: string | undefined): boolean {
  if (!address) return false;
  const octets = address.split('.').map(Number);
  return octets.length === 4
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && octets[0] === 100
    && octets[1]! >= 64
    && octets[1]! <= 127;
}

function tailscaleIpv4Address(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal && isTailscaleIpv4Address(address.address)) {
        return address.address;
      }
    }
  }
  return null;
}

function normalizeRemoteAddress(address: string | undefined): string | undefined {
  return address?.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

function isRemoteRequest(value: unknown): value is BealeRemoteRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (request.version !== 1) return false;
  if (request.action === 'list_workspaces') {
    return Object.keys(request).every((key) => key === 'version' || key === 'action');
  }
  if (request.action === 'get_workspace_memory') {
    return typeof request.registryWorkspaceId === 'string'
      && request.registryWorkspaceId.trim().length > 0
      && request.registryWorkspaceId.length <= 256
      && Object.keys(request).every((key) => key === 'version' || key === 'action' || key === 'registryWorkspaceId');
  }
  return false;
}

function remoteWorkspaceSummary(workspace: WorkspaceRegistryState['workspaces'][number]): BealeRemoteWorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.workspaceName,
    researchProfileId: workspace.researchProfileId,
    researchKitId: workspace.researchKitId,
    runCount: workspace.runCount,
    lastRunAt: workspace.lastRunAt,
    updatedAt: workspace.updatedAt
  };
}

export function remoteMemorySummary(memory: HoneycrispMemorySummary): BealeRemoteMemorySummary {
  return {
    status: memory.status,
    nodeCount: memory.nodeCount,
    latestNodeUpdatedAt: memory.latestNodeUpdatedAt,
    nodeTypeCounts: memory.nodeTypeCounts,
    nodes: memory.nodes.map((node) => ({
      id: node.id,
      subjectName: node.subjectName,
      type: node.type,
      title: node.title,
      summary: node.summary,
      body: node.body,
      status: node.status,
      confidence: node.confidence,
      tags: node.tags,
      sessionCount: node.sessionIds.length,
      evidence: node.evidenceRefs.map((evidence) => ({
        kind: evidence.kind,
        summary: evidence.summary,
        createdAt: evidence.createdAt
      })),
      createdAt: node.createdAt,
      updatedAt: node.updatedAt
    })),
    lastError: memory.lastError
  };
}

function encodeResponse(response: BealeRemoteResponse): string {
  return `${JSON.stringify(response)}\n`;
}
