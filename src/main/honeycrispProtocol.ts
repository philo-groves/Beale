export const HONEYCRISP_PROTOCOL_NAME = 'honeycrisp' as const;
export const HONEYCRISP_PROTOCOL_VERSION = 1 as const;
export const HONEYCRISP_CONTRACT_VERSION = 4 as const;
export const HONEYCRISP_PROTOCOL_WEBSOCKET_PATH = '/v1/session' as const;
export const HONEYCRISP_PROTOCOL_BOOTSTRAP_PREFIX = 'HONEYCRISP_TRANSPORT ' as const;
export const HONEYCRISP_PROTOCOL_WEBSOCKET_CAPABILITIES = [
  'session.events',
  'session.controls'
] as const;
export const HONEYCRISP_PROTOCOL_MAX_REQUEST_ID_LENGTH = 200 as const;
export const HONEYCRISP_REQUIRED_CAPABILITIES = [
  'knowledge.findings',
  'knowledge.finding_staleness',
  'knowledge.campaign_graph',
  'knowledge.evidence_gates',
  'session.append_only',
  'session.controls',
  'session.bounded_reads',
  'session.targeted_details'
] as const;

export interface HoneycrispProtocolErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
}

export interface HoneycrispProtocolDescriptor {
  protocol: typeof HONEYCRISP_PROTOCOL_NAME;
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  operations: string[];
  contractVersion: typeof HONEYCRISP_CONTRACT_VERSION;
  runtime: {
    name: typeof HONEYCRISP_PROTOCOL_NAME;
    version: string;
    buildId: string;
    nodeVersion: string;
  };
  schemas: {
    protocol: 1;
    session: 1;
    memorySummary: 3;
    finding: 1;
    campaignGraph: 1;
  };
  capabilities: string[];
  transports: {
    cli: {
      framing: 'single-json-envelope';
      errors: 'envelope-and-nonzero-exit';
      correlation: 'request-id';
    };
    websocket: {
      path: typeof HONEYCRISP_PROTOCOL_WEBSOCKET_PATH;
      authentication: 'bearer';
      framing: 'json-message';
      errors: 'protocol-error-message';
      correlation: 'request-id';
      capabilities: typeof HONEYCRISP_PROTOCOL_WEBSOCKET_CAPABILITIES;
    };
  };
}

export interface HoneycrispProtocolSuccess<T> {
  protocol: typeof HONEYCRISP_PROTOCOL_NAME;
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  operation: string;
  requestId?: string;
  ok: true;
  result: T;
}

export interface HoneycrispProtocolFailure {
  protocol: typeof HONEYCRISP_PROTOCOL_NAME;
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  operation: string;
  requestId?: string;
  ok: false;
  error: HoneycrispProtocolErrorDetail;
}

export type HoneycrispProtocolEnvelope<T> = HoneycrispProtocolSuccess<T> | HoneycrispProtocolFailure;

export interface HoneycrispTransportBootstrap {
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  transport: 'websocket';
  url: string;
  sessionId: string;
}

export interface HoneycrispClientHello {
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  type: 'client.hello';
  sessionId: string;
  client: { name: string; version: string };
}

export interface HoneycrispSessionControl {
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  type: 'session.control';
  sessionId: string;
  requestId: string;
  control: Record<string, unknown> & { requestId: string };
}

export interface HoneycrispServerHello {
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  type: 'server.hello';
  sessionId: string;
  server: { name: typeof HONEYCRISP_PROTOCOL_NAME; version: string; buildId: string };
  contractVersion: typeof HONEYCRISP_CONTRACT_VERSION;
  schemas: HoneycrispProtocolDescriptor['schemas'];
  capabilities: typeof HONEYCRISP_PROTOCOL_WEBSOCKET_CAPABILITIES;
}

export interface HoneycrispSessionEventMessage {
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  type: 'session.event';
  sessionId: string;
  event: Record<string, unknown>;
}

export interface HoneycrispWebSocketProtocolError {
  protocolVersion: typeof HONEYCRISP_PROTOCOL_VERSION;
  type: 'protocol.error';
  sessionId: string;
  requestId?: string;
  error: HoneycrispProtocolErrorDetail;
  message: string;
}

export type HoneycrispServerMessage =
  | HoneycrispServerHello
  | HoneycrispSessionEventMessage
  | HoneycrispWebSocketProtocolError;

export function decodeHoneycrispProtocolEnvelope<T>(json: string): HoneycrispProtocolEnvelope<T> {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value) || value.protocol !== HONEYCRISP_PROTOCOL_NAME
    || value.protocolVersion !== HONEYCRISP_PROTOCOL_VERSION
    || !nonEmptyString(value.operation) || typeof value.ok !== 'boolean') {
    throw new Error('Invalid or unsupported Honeycrisp protocol envelope.');
  }
  validateOptionalRequestId(value.requestId);
  if (value.ok === true) {
    if (!('result' in value)) throw new Error('Honeycrisp protocol success is missing result.');
    return value as unknown as HoneycrispProtocolSuccess<T>;
  }
  if (!isErrorDetail(value.error)) throw new Error('Honeycrisp protocol failure is missing a valid error.');
  return value as unknown as HoneycrispProtocolFailure;
}

export function decodeHoneycrispProtocolDescriptor(value: unknown): HoneycrispProtocolDescriptor {
  const capabilities = isRecord(value) && Array.isArray(value.capabilities) ? value.capabilities : null;
  if (!isRecord(value)
    || value.protocol !== HONEYCRISP_PROTOCOL_NAME
    || value.protocolVersion !== HONEYCRISP_PROTOCOL_VERSION
    || value.contractVersion !== HONEYCRISP_CONTRACT_VERSION
    || !Array.isArray(value.operations) || !value.operations.every(nonEmptyString)
    || !isRecord(value.runtime) || value.runtime.name !== HONEYCRISP_PROTOCOL_NAME
    || !nonEmptyString(value.runtime.version) || !nonEmptyString(value.runtime.buildId) || !nonEmptyString(value.runtime.nodeVersion)
    || !validSchemaDescriptor(value.schemas)
    || !capabilities || !capabilities.every(nonEmptyString)
    || !HONEYCRISP_REQUIRED_CAPABILITIES.every((capability) => capabilities.includes(capability))
    || !isRecord(value.transports)) {
    throw new Error('Honeycrisp runtime is incompatible with Beale contract v4. Rebuild or update the configured Honeycrisp CLI.');
  }
  return value as unknown as HoneycrispProtocolDescriptor;
}

export function parseHoneycrispTransportBootstrap(
  line: string,
  expectedSessionId: string
): HoneycrispTransportBootstrap | null {
  if (!line.startsWith(HONEYCRISP_PROTOCOL_BOOTSTRAP_PREFIX)) return null;
  try {
    const value = JSON.parse(line.slice(HONEYCRISP_PROTOCOL_BOOTSTRAP_PREFIX.length)) as unknown;
    if (!isRecord(value) || value.protocolVersion !== HONEYCRISP_PROTOCOL_VERSION
      || value.transport !== 'websocket' || value.sessionId !== expectedSessionId
      || !nonEmptyString(value.url)) return null;
    const url = new URL(value.url);
    if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1'
      || url.pathname !== HONEYCRISP_PROTOCOL_WEBSOCKET_PATH || url.username || url.password) return null;
    return {
      protocolVersion: HONEYCRISP_PROTOCOL_VERSION,
      transport: 'websocket',
      url: url.toString(),
      sessionId: value.sessionId
    };
  } catch {
    return null;
  }
}

export function honeycrispClientHello(sessionId: string, clientVersion: string): HoneycrispClientHello {
  return {
    protocolVersion: HONEYCRISP_PROTOCOL_VERSION,
    type: 'client.hello',
    sessionId,
    client: { name: 'beale', version: clientVersion }
  };
}

export function honeycrispSessionControl(
  sessionId: string,
  control: Record<string, unknown> & { requestId: string }
): HoneycrispSessionControl {
  return {
    protocolVersion: HONEYCRISP_PROTOCOL_VERSION,
    type: 'session.control',
    sessionId,
    requestId: control.requestId,
    control
  };
}

export function decodeHoneycrispServerMessage(value: unknown): HoneycrispServerMessage {
  validateMessageBase(value);
  if (value.type === 'server.hello') {
    if (!isRecord(value.server) || value.server.name !== HONEYCRISP_PROTOCOL_NAME
      || !nonEmptyString(value.server.version) || !nonEmptyString(value.server.buildId)
      || value.contractVersion !== HONEYCRISP_CONTRACT_VERSION
      || !validSchemaDescriptor(value.schemas) || !sameCapabilities(value.capabilities)) {
      throw new Error('The server.hello message has invalid server metadata or capabilities.');
    }
    return value as unknown as HoneycrispServerHello;
  }
  if (value.type === 'session.event') {
    if (!isRecord(value.event)) throw new Error('The session.event message requires an event.');
    return value as unknown as HoneycrispSessionEventMessage;
  }
  if (value.type === 'protocol.error') {
    validateOptionalRequestId(value.requestId);
    const legacyMessage = nonEmptyString(value.message) ? value.message : undefined;
    const error = isErrorDetail(value.error)
      ? value.error
      : legacyMessage ? { code: 'protocol_error', message: legacyMessage, retryable: false } : undefined;
    if (!error) throw new Error('The protocol.error message requires a valid error.');
    return {
      protocolVersion: HONEYCRISP_PROTOCOL_VERSION,
      type: 'protocol.error',
      sessionId: value.sessionId,
      ...(nonEmptyString(value.requestId) ? { requestId: value.requestId } : {}),
      error,
      message: legacyMessage ?? error.message
    };
  }
  throw new Error('Unsupported Honeycrisp server message type.');
}

function validSchemaDescriptor(value: unknown): value is HoneycrispProtocolDescriptor['schemas'] {
  return isRecord(value) && value.protocol === 1 && value.session === 1
    && value.memorySummary === 3 && value.finding === 1 && value.campaignGraph === 1;
}

function validateMessageBase(value: unknown): asserts value is Record<string, unknown> & { sessionId: string; type: string } {
  if (!isRecord(value) || value.protocolVersion !== HONEYCRISP_PROTOCOL_VERSION
    || !nonEmptyString(value.sessionId) || !nonEmptyString(value.type)) {
    throw new Error('Invalid Honeycrisp WebSocket message.');
  }
}

function validateOptionalRequestId(value: unknown): void {
  if (value !== undefined && !validRequestId(value)) {
    throw new Error(`Honeycrisp protocol requestId must be non-empty and at most ${HONEYCRISP_PROTOCOL_MAX_REQUEST_ID_LENGTH} characters.`);
  }
}

function isErrorDetail(value: unknown): value is HoneycrispProtocolErrorDetail {
  return isRecord(value) && nonEmptyString(value.code)
    && typeof value.message === 'string' && typeof value.retryable === 'boolean';
}

function sameCapabilities(value: unknown): value is typeof HONEYCRISP_PROTOCOL_WEBSOCKET_CAPABILITIES {
  return Array.isArray(value) && value.length === HONEYCRISP_PROTOCOL_WEBSOCKET_CAPABILITIES.length
    && HONEYCRISP_PROTOCOL_WEBSOCKET_CAPABILITIES.every((capability, index) => value[index] === capability);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function validRequestId(value: unknown): value is string {
  return nonEmptyString(value) && value.length <= HONEYCRISP_PROTOCOL_MAX_REQUEST_ID_LENGTH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
