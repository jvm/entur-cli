import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ApiError, UsageError } from '../src/errors.js';
import { clientName, graphql, request } from '../src/http.js';
import { fakeFetch, jsonRes } from './helpers.js';

test('clientName precedence: explicit > env > derived from local username', () => {
  const saved = process.env.ENTUR_CLIENT_NAME;
  try {
    process.env.ENTUR_CLIENT_NAME = 'acme-app';
    assert.equal(clientName('explicit-app'), 'explicit-app');
    assert.equal(clientName(), 'acme-app');
    delete process.env.ENTUR_CLIENT_NAME;
    assert.match(clientName(), /^[a-z0-9_]+-entur-cli$/);
  } finally {
    if (saved === undefined) delete process.env.ENTUR_CLIENT_NAME;
    else process.env.ENTUR_CLIENT_NAME = saved;
  }
});

test('clientName rejects invalid explicit and environment values', () => {
  const saved = process.env.ENTUR_CLIENT_NAME;
  try {
    assert.throws(() => clientName('Company App'), UsageError);
    process.env.ENTUR_CLIENT_NAME = '';
    assert.throws(() => clientName(), /lowercase company-application/);
  } finally {
    if (saved === undefined) delete process.env.ENTUR_CLIENT_NAME;
    else process.env.ENTUR_CLIENT_NAME = saved;
  }
});

test('request returns parsed JSON and sends ET-Client-Name', async () => {
  const fetchImpl = fakeFetch(jsonRes({ ok: true }));
  const data = await request('https://example.test/x', { fetchImpl, clientName: 'test-app' });
  assert.deepEqual(data, { ok: true });
  assert.equal(fetchImpl.calls[0].init.headers['ET-Client-Name'], 'test-app');
});

test('request maps non-2xx without exposing response or URL secrets', async () => {
  const secret = 'conspicuously-fake-secret';
  const fetchImpl = fakeFetch(jsonRes({ message: secret }, { status: 500 }));
  await assert.rejects(
    request(`https://example.test/x?token=${secret}`, { fetchImpl }),
    (err) => err instanceof ApiError
      && err.status === 500
      && /HTTP 500/.test(err.message)
      && !err.message.includes(secret),
  );
});

test('request does not expose a network implementation error', async () => {
  const secret = 'conspicuously-fake-secret';
  const fetchImpl = async () => { throw new Error(secret); };
  await assert.rejects(
    request('https://example.test/x', { fetchImpl }),
    (err) => err instanceof ApiError
      && err.code === 'network_error'
      && !err.message.includes(secret),
  );
});

test('request surfaces 429 Rate-Limit-Expiry-Time and forbids blind retry', async () => {
  const fetchImpl = fakeFetch(
    jsonRes({}, { status: 429, headers: { 'Rate-Limit-Expiry-Time': '2026-07-26T13:00:00Z' } }),
  );
  await assert.rejects(
    request('https://example.test/x', { fetchImpl }),
    (err) => err.status === 429 && err.message.includes('2026-07-26T13:00:00Z'),
  );
});

test('request maps timeout to retryable ApiError', async () => {
  const fetchImpl = async () => {
    const err = new Error('aborted');
    err.name = 'TimeoutError';
    throw err;
  };
  await assert.rejects(
    request('https://example.test/x', { fetchImpl, timeoutSec: 1 }),
    (err) => err instanceof ApiError && err.code === 'timeout' && err.retryable && /timed out after 1s/.test(err.message),
  );
});

test('request timeout covers a response body that stalls after headers', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"ok":');
    setTimeout(() => res.end('true}'), 250);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/slow?private=query`;
    await assert.rejects(
      request(url, { timeoutSec: 0.02 }),
      (err) => err instanceof ApiError
        && err.code === 'timeout'
        && !err.message.includes('private=query'),
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('request maps malformed successful JSON to invalid_response', async () => {
  const fetchImpl = fakeFetch(new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(
    request('https://example.test/x?private=query', { fetchImpl }),
    (err) => err instanceof ApiError
      && err.code === 'invalid_response'
      && !err.message.includes('private=query'),
  );
});

test('request supports caller cancellation', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  const fetchImpl = async (_url, { signal }) => {
    if (signal.aborted) throw signal.reason;
    throw new Error('expected an aborted signal');
  };
  await assert.rejects(
    request('https://example.test/x', { fetchImpl, signal: controller.signal }),
    (err) => err instanceof ApiError && err.code === 'cancelled' && !err.retryable,
  );
});

test('graphql posts query/variables and raises on errors[]', async () => {
  const fetchImpl = fakeFetch(jsonRes({ data: { a: 1 } }), jsonRes({ errors: [{ message: 'bad field' }] }));
  const data = await graphql('https://example.test/gql', 'query { a }', { v: 1 }, { fetchImpl });
  assert.deepEqual(data, { a: 1 });
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(body.query, 'query { a }');
  assert.deepEqual(body.variables, { v: 1 });
  await assert.rejects(
    graphql('https://example.test/gql', 'query { b }', undefined, { fetchImpl }),
    /bad field/,
  );
});

test('graphql rejects null or missing data payloads as invalid responses', async () => {
  const fetchImpl = fakeFetch(jsonRes(null), jsonRes({}), jsonRes({ errors: {} }));
  await assert.rejects(
    graphql('https://example.test/gql', 'query { a }', undefined, { fetchImpl }),
    (err) => err instanceof ApiError && err.code === 'invalid_response',
  );
  await assert.rejects(
    graphql('https://example.test/gql', 'query { a }', undefined, { fetchImpl }),
    (err) => err instanceof ApiError && err.code === 'invalid_response',
  );
  await assert.rejects(
    graphql('https://example.test/gql', 'query { a }', undefined, { fetchImpl }),
    (err) => err instanceof ApiError && err.code === 'invalid_response',
  );
});
