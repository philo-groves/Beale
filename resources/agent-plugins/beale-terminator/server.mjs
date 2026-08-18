import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const LEASE_TTL_MS = 30_000;
const MAX_LEASES = 100;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const BLOCKED_PROCESS_NAMES = new Set([
  '1password', 'bash', 'beale', 'bitwarden', 'chatgpt', 'cmd', 'codex',
  'conhost', 'control', 'credentialui', 'cscript', 'explorer', 'keepass',
  'keepassxc', 'logonui', 'mmc', 'mshta', 'msmpeng', 'node', 'powershell',
  'pwsh', 'python', 'pythonw', 'regedit', 'rundll32', 'securityhealthservice',
  'securityhealthsystray', 'services', 'sh', 'systemsettings', 'taskmgr',
  'windowsterminal', 'winlogon', 'wscript', 'wsl', 'wt', 'zsh'
]);
const BLOCKED_SURFACE_PATTERN = /(?:\b(?:age verification|authentication|authenticator|beale|bitwarden|captcha|chatgpt|codex|command prompt|credential|debug console|developer console|integrated console|log[ -]?in|one[- ]time (?:code|password)|passcode|passkey|password|permission(?:s| prompt)|sign[ -]?in|terminal|user account control|verification code|windows defender|windows security)\b|1password)/iu;
const BLOCKED_KEY_PATTERN = /(?:\b(?:lwin|meta|rwin|super|win|windows)\b|ctrl\+alt\+(?:del|delete)|ctrl\+shift\+esc|alt\+f4|ctrl\+(?:c|v|x))/iu;

const READ_ANNOTATION = toolAnnotation(['inspect'], 'read', ['computer-use:observe'], 'never');
const WRITE_ANNOTATION = toolAnnotation(['experiment'], 'write', ['computer-use:mutate'], 'always');

const TOOLS = [
  {
    name: 'observe',
    description: 'Observe safe Windows applications or one uniquely identified window through UI Automation. Call without process to list allowed applications, with process only to list its exact window titles, or with process and title to return a bounded accessibility tree.',
    inputSchema: objectSchema({
      process: { type: 'string', minLength: 1, maxLength: 128 },
      title: { type: 'string', minLength: 1, maxLength: 512 },
      maxDepth: { type: 'integer', minimum: 1, maximum: 12, default: 8 }
    }),
    annotations: READ_ANNOTATION
  },
  {
    name: 'find',
    description: 'Find exactly one safe element in a uniquely identified window and issue a short-lived, single-use observation ID required by mutation tools.',
    inputSchema: objectSchema({
      process: stringField(128),
      title: stringField(512),
      selector: stringField(1_024),
      timeoutMs: { type: 'integer', minimum: 100, maximum: 10_000, default: 2_000 },
      depth: { type: 'integer', minimum: 1, maximum: 30, default: 12 }
    }, ['process', 'title', 'selector']),
    annotations: READ_ANNOTATION
  },
  {
    name: 'click',
    description: 'Click one freshly revalidated element. Requires a non-expired observation ID from find and one host approval for this action.',
    inputSchema: mutationSchema({
      button: { type: 'string', enum: ['left', 'double', 'right'], default: 'left' }
    }),
    annotations: WRITE_ANNOTATION
  },
  {
    name: 'type',
    description: 'Type text without the clipboard into one freshly revalidated element. Requires a non-expired observation ID and one host approval.',
    inputSchema: mutationSchema({
      text: { type: 'string', maxLength: 16_384 },
      clear: { type: 'boolean', default: false }
    }, ['text']),
    annotations: WRITE_ANNOTATION
  },
  {
    name: 'key',
    description: 'Press a bounded keyboard shortcut on one freshly revalidated element. Windows-key, clipboard, security, and close-window shortcuts are denied. Requires host approval.',
    inputSchema: mutationSchema({ key: stringField(64) }, ['key']),
    annotations: WRITE_ANNOTATION
  },
  {
    name: 'scroll',
    description: 'Scroll one freshly revalidated element. Requires a non-expired observation ID and one host approval.',
    inputSchema: mutationSchema({
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
      amount: { type: 'integer', minimum: 1, maximum: 20, default: 3 }
    }, ['direction']),
    annotations: WRITE_ANNOTATION
  },
  {
    name: 'wait_for',
    description: 'Wait for exactly one safe element to exist, become visible, enabled, or focused, then return a fresh observation ID.',
    inputSchema: objectSchema({
      process: stringField(128),
      title: stringField(512),
      selector: stringField(1_024),
      condition: { type: 'string', enum: ['exists', 'visible', 'enabled', 'focused'], default: 'visible' },
      timeoutMs: { type: 'integer', minimum: 100, maximum: 30_000, default: 5_000 }
    }, ['process', 'title', 'selector']),
    annotations: READ_ANNOTATION
  },
  {
    name: 'capture',
    description: 'Capture a PNG screenshot of one uniquely identified safe window and return it as MCP image content.',
    inputSchema: objectSchema({ process: stringField(128), title: stringField(512) }, ['process', 'title']),
    annotations: READ_ANNOTATION
  }
];

const leases = new Map();
let desktopInstance;
let terminatorModule;
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  drainMessages();
});
process.stdin.on('error', (error) => console.error(error instanceof Error ? error.message : String(error)));

function drainMessages() {
  while (true) {
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex < 0) return;
    const line = buffer.slice(0, newlineIndex).replace(/\r$/u, '').trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) handleMessage(line);
  }
}

function handleMessage(body) {
  let message;
  try {
    message = JSON.parse(body);
  } catch {
    sendError(null, -32700, 'Invalid JSON-RPC payload.');
    return;
  }
  if (message.method?.startsWith('notifications/')) return;
  Promise.resolve(dispatch(message)).catch((error) => {
    sendError(message.id ?? null, -32603, errorMessage(error));
  });
}

async function dispatch(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'beale-terminator', version: '0.1.0' }
    });
    return;
  }
  if (method === 'ping') {
    sendResult(id, {});
    return;
  }
  if (method === 'tools/list') {
    sendResult(id, { tools: TOOLS });
    return;
  }
  if (method !== 'tools/call') {
    sendError(id ?? null, -32601, `Unsupported method: ${String(method)}`);
    return;
  }

  const name = typeof params?.name === 'string' ? params.name : '';
  const args = isRecord(params?.arguments) ? params.arguments : {};
  if (!TOOLS.some((tool) => tool.name === name)) {
    sendToolError(id, `Unknown Beale computer-use tool: ${name}`);
    return;
  }
  try {
    const result = await callTool(name, args);
    sendResult(id, result);
  } catch (error) {
    sendToolError(id, errorMessage(error));
  }
}

async function callTool(name, args) {
  assertWindows();
  pruneLeases();
  if (name === 'observe') return textResult(await observe(args));
  if (name === 'find') return textResult(await find(args));
  if (name === 'wait_for') return textResult(await waitFor(args));
  if (name === 'capture') return capture(args);
  if (name === 'click') return textResult(await mutate(args, clickElement));
  if (name === 'type') return textResult(await mutate(args, typeIntoElement));
  if (name === 'key') return textResult(await mutate(args, pressElementKey));
  if (name === 'scroll') return textResult(await mutate(args, scrollElement));
  throw new Error(`Unsupported computer-use tool: ${name}`);
}

async function observe(args) {
  const desktop = getDesktop();
  if (args.process === undefined) {
    const applications = desktop.applications().flatMap((application) => {
      try {
        const process = normalizedProcess(application.processName());
        const name = boundedText(application.name(), 512);
        if (isBlockedSurface(process, name, application.role(), application.attributes())) return [];
        return [{ process, name, processId: application.processId() }];
      } catch {
        return [];
      }
    });
    return { applications: applications.slice(0, 100), blockedSurfacesOmitted: true };
  }
  const process = safeProcess(args.process);
  if (args.title === undefined) {
    const windows = (await desktop.windowsForApplication(process)).flatMap((window) => {
      try {
        const title = boundedText(window.name(), 512);
        if (!window.isVisible() || !title || isBlockedSurface(process, title, window.role(), window.attributes())) return [];
        return [{ title, processId: window.processId(), role: boundedText(window.role(), 128) }];
      } catch {
        return [];
      }
    });
    return { process, windows: windows.slice(0, 100), blockedSurfacesOmitted: true };
  }
  const title = requiredString(args.title, 'title', 512);
  await uniqueWindow(process, title);
  const maxDepth = boundedInteger(args.maxDepth, 1, 12, 8);
  const result = await desktop.getWindowTreeResultAsync(process, title, {
    propertyMode: terminator().PropertyLoadingMode.Smart,
    maxDepth,
    formatOutput: true,
    treeOutputFormat: terminator().TreeOutputFormat.CompactYaml,
    includeWindowScreenshot: false,
    includeMonitorScreenshots: false,
    includeBrowserDom: false,
    includeGeminiVision: false,
    includeOmniparser: false,
    includeOcr: false
  });
  return {
    process,
    title,
    processId: result.pid,
    elementCount: result.elementCount,
    tree: boundedText(result.formatted, 30_000),
    note: 'Element indexes are informational only. Use find to obtain a fresh mutation observation ID.'
  };
}

async function find(args) {
  const target = await findUniqueElement(args);
  return issueLease(target);
}

async function waitFor(args) {
  const process = safeProcess(args.process);
  const title = requiredString(args.title, 'title', 512);
  const selector = safeSelector(args.selector);
  await uniqueWindow(process, title);
  const timeoutMs = boundedInteger(args.timeoutMs, 100, 30_000, 5_000);
  const condition = ['exists', 'visible', 'enabled', 'focused'].includes(args.condition) ? args.condition : 'visible';
  const window = await uniqueWindow(process, title);
  await window.locator(selector).waitFor(condition, timeoutMs);
  return issueLease(await findUniqueElement({ process, title, selector, timeoutMs: 500, depth: 12 }));
}

async function capture(args) {
  const process = safeProcess(args.process);
  const title = requiredString(args.title, 'title', 512);
  const window = await uniqueWindow(process, title);
  const screenshot = window.capture();
  const png = Buffer.from(getDesktop().screenshotToPng(screenshot));
  if (!png.length || png.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new Error(`Screenshot size ${png.byteLength} bytes is outside Beale's 10 MiB limit.`);
  }
  return {
    content: [
      { type: 'text', text: JSON.stringify({ process, title, width: screenshot.width, height: screenshot.height }) },
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }
    ]
  };
}

async function mutate(args, operation) {
  const observationId = requiredString(args.observationId, 'observationId', 200);
  const lease = leases.get(observationId);
  leases.delete(observationId);
  if (!lease || lease.expiresAt < Date.now()) {
    throw new Error('Observation ID is missing or expired. Call find again immediately before mutating the UI.');
  }
  assertMutationInputMatchesLease(args, lease);
  const target = await findUniqueElement({
    process: lease.process,
    title: lease.title,
    selector: lease.selector,
    timeoutMs: 1_000,
    depth: lease.depth
  });
  const freshFingerprint = elementFingerprint(target);
  if (JSON.stringify(freshFingerprint) !== JSON.stringify(lease.fingerprint)) {
    throw new Error('The target element changed after observation. Call find again and review the fresh target.');
  }
  const result = await operation(target.element, args);
  leases.clear();
  return {
    success: result?.success !== false,
    process: lease.process,
    title: lease.title,
    selector: lease.selector,
    target: freshFingerprint,
    leasesInvalidated: true,
    note: 'UI state may have changed. Observe or find again before the next mutation.'
  };
}

async function clickElement(element, args) {
  const options = actionOptions();
  if (args.button === 'double') return element.doubleClick(options);
  if (args.button === 'right') {
    element.rightClick(options);
    return { success: true };
  }
  return await element.click(options);
}

function typeIntoElement(element, args) {
  const text = typeof args.text === 'string' && args.text.length <= 16_384
    ? args.text
    : (() => { throw new Error('text must be a string of at most 16,384 characters.'); })();
  assertSafeElement(element);
  return element.typeText(text, {
    clearBeforeTyping: args.clear === true,
    useClipboard: false,
    includeWindowScreenshot: false,
    includeMonitorScreenshots: false,
    tryFocusBefore: true,
    tryClickBefore: false,
    uiDiffBeforeAfter: false
  });
}

function pressElementKey(element, args) {
  const key = requiredString(args.key, 'key', 64);
  const normalizedKey = key.toLocaleLowerCase()
    .replace(/control/gu, 'ctrl')
    .replace(/[\s_-]+/gu, '+')
    .replace(/\++/gu, '+');
  if (BLOCKED_KEY_PATTERN.test(normalizedKey)) throw new Error(`Keyboard shortcut is denied by Beale computer-use policy: ${key}`);
  return element.pressKey(key, actionOptions());
}

function scrollElement(element, args) {
  const direction = ['up', 'down', 'left', 'right'].includes(args.direction) ? args.direction : null;
  if (!direction) throw new Error('direction must be up, down, left, or right.');
  return element.scroll(direction, boundedInteger(args.amount, 1, 20, 3), actionOptions());
}

async function findUniqueElement(args) {
  const process = safeProcess(args.process);
  const title = requiredString(args.title, 'title', 512);
  const selector = safeSelector(args.selector);
  const timeoutMs = boundedInteger(args.timeoutMs, 100, 10_000, 2_000);
  const depth = boundedInteger(args.depth, 1, 30, 12);
  const window = await uniqueWindow(process, title);
  const matches = await window.locator(selector).all(timeoutMs, depth);
  if (matches.length !== 1) {
    throw new Error(`Selector must match exactly one element in the target window; matched ${matches.length}.`);
  }
  const element = matches[0];
  assertSafeElement(element, title);
  return { process, title, selector, depth, window, element };
}

async function uniqueWindow(process, title) {
  const windows = (await getDesktop().windowsForApplication(process)).filter((window) => {
    try {
      return window.isVisible() && !isBlockedSurface(process, window.name(), window.role(), window.attributes());
    } catch {
      return false;
    }
  });
  const normalizedTitle = title.trim().toLocaleLowerCase();
  const matches = windows.filter((window) => (window.name() ?? '').trim().toLocaleLowerCase() === normalizedTitle);
  if (matches.length !== 1) {
    throw new Error(`Window title must identify exactly one safe ${process} window; matched ${matches.length}.`);
  }
  assertSafeElement(matches[0], title);
  return matches[0];
}

function issueLease(target) {
  pruneLeases();
  if (leases.size >= MAX_LEASES) leases.delete(leases.keys().next().value);
  const observationId = `observation_${randomUUID()}`;
  const fingerprint = elementFingerprint(target);
  leases.set(observationId, {
    process: target.process,
    title: target.title,
    selector: target.selector,
    depth: target.depth,
    fingerprint,
    expiresAt: Date.now() + LEASE_TTL_MS
  });
  return {
    observationId,
    expiresInMs: LEASE_TTL_MS,
    process: target.process,
    title: target.title,
    selector: target.selector,
    target: fingerprint,
    note: 'This observation ID is single-use and bound to the exact process, window, selector, and element fingerprint.'
  };
}

function elementFingerprint(target) {
  const attributes = target.element.attributes();
  return {
    processId: target.element.processId(),
    processName: normalizedProcess(target.element.processName()),
    windowName: boundedText(target.window.name(), 512),
    role: boundedText(target.element.role(), 128),
    name: boundedText(target.element.name(), 1_024),
    automationId: boundedText(attributes.properties?.AutomationId ?? attributes.properties?.automationId, 512),
    bounds: normalizedBounds(target.element.bounds())
  };
}

function assertMutationInputMatchesLease(args, lease) {
  if (
    safeProcess(args.process) !== lease.process
    || requiredString(args.title, 'title', 512) !== lease.title
    || safeSelector(args.selector) !== lease.selector
  ) throw new Error('Mutation target does not match the process, window, and selector bound to the observation ID.');
}

function assertSafeElement(element, title = '') {
  const process = normalizedProcess(element.processName());
  if (isBlockedSurface(process, `${title} ${element.name() ?? ''}`, element.role(), element.attributes())) {
    throw new Error('Beale computer-use policy denies access to this application, window, or sensitive control.');
  }
}

function isBlockedSurface(process, text, role, attributes = {}) {
  const normalized = normalizedProcess(process);
  const propertyText = Object.entries(attributes.properties ?? {})
    .slice(0, 100)
    .map(([key, value]) => `${key}=${String(value ?? '')}`)
    .join(' ');
  return BLOCKED_PROCESS_NAMES.has(normalized)
    || BLOCKED_SURFACE_PATTERN.test(`${text ?? ''} ${role ?? ''} ${attributes.name ?? ''} ${attributes.label ?? ''} ${attributes.description ?? ''} ${propertyText}`);
}

function safeProcess(value) {
  const process = normalizedProcess(requiredString(value, 'process', 128));
  if (!/^[a-z0-9_.-]+$/u.test(process)) throw new Error('process contains unsupported characters.');
  if (BLOCKED_PROCESS_NAMES.has(process)) throw new Error(`Beale computer-use policy denies process: ${process}`);
  return process;
}

function safeSelector(value) {
  const selector = requiredString(value, 'selector', 1_024);
  if (/\b(?:browser_script|execute|javascript|powershell|shell)\b/iu.test(selector)) {
    throw new Error('Selector contains a denied execution token.');
  }
  return selector;
}

function actionOptions() {
  return {
    highlightBeforeAction: false,
    includeWindowScreenshot: false,
    includeMonitorScreenshots: false,
    tryFocusBefore: true,
    tryClickBefore: false,
    restoreCursor: true,
    restoreFocus: false,
    uiDiffBeforeAfter: false
  };
}

function getDesktop() {
  if (!desktopInstance) desktopInstance = new (terminator().Desktop)(false, false, 'warn');
  return desktopInstance;
}

function terminator() {
  if (terminatorModule) return terminatorModule;
  const modulePath = process.env.BEALE_TERMINATOR_MODULE_PATH;
  if (!modulePath) throw new Error('The pinned Terminator SDK path was not provided by Beale.');
  terminatorModule = require(modulePath);
  if (typeof terminatorModule?.Desktop !== 'function') throw new Error('The pinned Terminator SDK did not expose Desktop.');
  return terminatorModule;
}

function assertWindows() {
  if (process.platform !== 'win32') throw new Error('Beale Terminator computer use is available only on Windows.');
}

function pruneLeases() {
  const now = Date.now();
  for (const [id, lease] of leases) if (lease.expiresAt < now) leases.delete(id);
}

function normalizedBounds(bounds) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}

function normalizedProcess(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/\.exe$/u, '');
}

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function boundedInteger(value, minimum, maximum, fallback) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function boundedText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function sendToolError(id, message) {
  sendResult(id, { isError: true, content: [{ type: 'text', text: message }] });
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(maxLength) {
  return { type: 'string', minLength: 1, maxLength };
}

function objectSchema(properties, required = []) {
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function mutationSchema(extraProperties, extraRequired = []) {
  return objectSchema({
    observationId: stringField(200),
    process: stringField(128),
    title: stringField(512),
    selector: stringField(1_024),
    ...extraProperties
  }, ['observationId', 'process', 'title', 'selector', ...extraRequired]);
}

function toolAnnotation(actionClasses, sideEffects, requiredPermissions, confirmation) {
  return {
    readOnlyHint: sideEffects === 'read',
    destructiveHint: sideEffects === 'write',
    openWorldHint: true,
    'beale.io/tool': { actionClasses, sideEffects, requiredPermissions, confirmation }
  };
}
