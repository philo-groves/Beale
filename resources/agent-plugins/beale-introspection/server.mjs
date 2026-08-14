const TOOLS = [
  {
    name: 'list_workspaces',
    description: 'List Beale workspaces known to this Beale app instance.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'create_workspace',
    description: 'Create and open a Beale workspace at a local filesystem path.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string', description: 'Absolute or host-resolvable workspace directory path.' }
      },
      required: ['workspacePath'],
      additionalProperties: false
    }
  },
  {
    name: 'list_sessions',
    description: 'List recent Beale research sessions, optionally filtered by workspace or status.',
    inputSchema: {
      type: 'object',
      properties: {
        registryWorkspaceId: { type: 'string' },
        workspacePath: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'launch_session',
    description: 'Launch a Beale research session in the current or selected workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        registryWorkspaceId: { type: 'string' },
        workspacePath: { type: 'string' },
        startRunInput: { type: 'object', description: 'Complete Beale StartRunInput. Overrides simplified fields.' },
        promptMarkdown: { type: 'string' },
        provider: { type: 'string' },
        runEngine: { type: 'string', enum: ['honeycrisp', 'fixture'] },
        shellSafetyMode: { type: 'string', enum: ['manual_approval', 'auto_review', 'danger'] },
        goalEnabled: { type: 'boolean' },
        goalObjective: { type: 'string' },
        workflowId: { type: 'string' },
        mode: { type: 'string' },
        attemptStrategy: { type: 'string' },
        model: { type: 'string' },
        reasoningEffort: { type: 'string' },
        sandboxProfile: { type: 'string' },
        targetAssetId: { type: 'string' },
        targetPath: { type: 'string' },
        maxMinutes: { type: 'number' },
        maxAttempts: { type: 'number' },
        maxCostUsd: { type: 'number' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'stop_session',
    description: 'Stop a Beale research session in the current or selected workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        registryWorkspaceId: { type: 'string' },
        workspacePath: { type: 'string' },
        runId: { type: 'string' },
        note: { type: 'string' }
      },
      required: ['runId'],
      additionalProperties: false
    }
  }
];

let buffer = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  drainMessages();
});

process.stdin.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
});

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
  } catch (error) {
    sendError(null, -32700, 'Invalid JSON-RPC payload.');
    return;
  }
  if (message.method?.startsWith('notifications/')) return;
  Promise.resolve(dispatch(message)).catch((error) => {
    sendError(message.id ?? null, -32603, error instanceof Error ? error.message : String(error));
  });
}

async function dispatch(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'beale-introspection', version: '0.1.0' }
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
  if (method === 'tools/call') {
    const name = typeof params?.name === 'string' ? params.name : '';
    const args = params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
      ? params.arguments
      : {};
    if (!TOOLS.some((tool) => tool.name === name)) {
      sendResult(id, {
        isError: true,
        content: [{ type: 'text', text: `Unknown Beale introspection tool: ${name}` }]
      });
      return;
    }
    try {
      const result = await callBeale(name, args);
      sendResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      });
    } catch (error) {
      sendResult(id, {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
      });
    }
    return;
  }
  sendError(id ?? null, -32601, `Unsupported method: ${String(method)}`);
}

async function callBeale(tool, args) {
  const baseUrl = process.env.BEALE_INTROSPECTION_URL;
  const token = process.env.BEALE_INTROSPECTION_TOKEN;
  if (!baseUrl || !token) throw new Error('Beale introspection endpoint is not available.');
  const response = await fetch(`${baseUrl}/tool`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ tool, args })
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Beale introspection request failed: ${response.status}`);
  }
  return payload.result;
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
