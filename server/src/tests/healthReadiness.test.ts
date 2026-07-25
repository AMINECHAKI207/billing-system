import assert from 'assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../app';
import { setDatabaseConnected } from '@config/database';

type HealthBody = {
  status: string;
  database?: string;
};

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    setDatabaseConnected(false);

    const health = await getJson(baseUrl, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(Boolean(health.headers.get('x-request-id')), true);

    const notReady = await getJson(baseUrl, '/ready');
    assert.equal(notReady.status, 503);
    assert.equal(notReady.body.status, 'degraded');
    assert.equal(notReady.body.database, 'disconnected');

    setDatabaseConnected(true);

    const ready = await getJson(baseUrl, '/ready');
    assert.equal(ready.status, 200);
    assert.equal(ready.body.status, 'ok');
    assert.equal(ready.body.database, 'connected');

    console.log('health readiness tests passed');
  } finally {
    setDatabaseConnected(false);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function getJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = (await response.json()) as HealthBody;

  return {
    status: response.status,
    headers: response.headers,
    body,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
