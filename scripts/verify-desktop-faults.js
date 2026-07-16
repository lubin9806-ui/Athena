const assert = require('assert');
const net = require('net');
const http = require('http');
const { LLMClient } = require('../dist/core/ai/Client.js');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function main() {
  const reservation = net.createServer();
  const closedPort = await listen(reservation);
  await close(reservation);
  const offline = new LLMClient({ ollama: { baseUrl: `http://127.0.0.1:${closedPort}` }, fallback: { timeoutMs: 250 } });
  assert.strictEqual(await offline.checkConnection(), false, 'no Ollama must fail closed without throwing');

  const conflictServer = http.createServer((_request, response) => {
    response.writeHead(409, { 'Content-Type': 'text/plain' });
    response.end('not Ollama');
  });
  const conflictPort = await listen(conflictServer);
  const conflict = new LLMClient({ ollama: { baseUrl: `http://127.0.0.1:${conflictPort}` }, fallback: { timeoutMs: 500 } });
  assert.strictEqual(await conflict.checkConnection(), false, 'a non-Ollama port occupant must not be treated as connected');
  await close(conflictServer);

  const slowServer = http.createServer(() => {
    // Intentionally never respond; the client deadline must end the request.
  });
  const slowPort = await listen(slowServer);
  const slow = new LLMClient({ ollama: { baseUrl: `http://127.0.0.1:${slowPort}` }, fallback: { timeoutMs: 250 } });
  const started = Date.now();
  assert.strictEqual(await slow.checkConnection(), false, 'weak/stalled network must fail closed');
  assert(Date.now() - started < 2000, 'weak-network deadline must be bounded');
  await close(slowServer);

  console.log('ATHENA_DESKTOP_FAULTS_OK noOllama=degraded portConflict=rejected weakNetwork=bounded');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
