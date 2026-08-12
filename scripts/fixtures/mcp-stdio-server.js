const readline = require('node:readline');

const tools = [
  {
    name: 'read_fixture',
    title: 'Read fixture',
    description: 'Read deterministic fixture data.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'write_fixture',
    title: 'Write fixture',
    description: 'Mutate deterministic fixture data.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'exit_fixture',
    title: 'Exit fixture',
    description: 'Return once and then close the fixture server.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'initialize') {
    respond(request.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'athena-mcp-fixture', version: '1.0.0' },
      instructions: 'Fixture instructions must remain server-scoped.',
    });
    return;
  }
  if (request.method === 'ping') return respond(request.id, {});
  if (request.method === 'tools/list') return respond(request.id, { tools });
  if (request.method === 'tools/call') {
    const name = request.params?.name;
    if (name === 'read_fixture') {
      return respond(request.id, {
        content: [{ type: 'text', text: `fixture:${request.params?.arguments?.query || ''}` }],
        structuredContent: { source: 'fixture', ok: true },
      });
    }
    if (name === 'write_fixture') {
      return respond(request.id, { content: [{ type: 'text', text: 'written' }] });
    }
    if (name === 'exit_fixture') {
      respond(request.id, { content: [{ type: 'text', text: 'closing' }] });
      return setTimeout(() => process.exit(0), 20);
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown tool' } })}\n`);
  }
});

process.on('SIGTERM', () => process.exit(0));
