import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/errors.js';
import { graphql, request } from '../src/http.js';
import { fakeFetch, jsonRes } from './helpers.js';

test('request returns parsed JSON and sends ET-Client-Name', async () => {
  const fetchImpl = fakeFetch(jsonRes({ ok: true }));
  const data = await request('https://example.test/x', { fetchImpl, clientName: 'test-app' });
  assert.deepEqual(data, { ok: true });
  assert.equal(fetchImpl.calls[0].init.headers['ET-Client-Name'], 'test-app');
});

test('request maps non-2xx to ApiError with status', async () => {
  const fetchImpl = fakeFetch(jsonRes({ message: 'nope' }, { status: 500 }));
  await assert.rejects(
    request('https://example.test/x', { fetchImpl }),
    (err) => err instanceof ApiError && err.status === 500 && /HTTP 500/.test(err.message),
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

test('request maps timeout to ApiError', async () => {
  const fetchImpl = async () => {
    const err = new Error('aborted');
    err.name = 'TimeoutError';
    throw err;
  };
  await assert.rejects(
    request('https://example.test/x', { fetchImpl, timeoutSec: 1 }),
    (err) => err instanceof ApiError && /timed out after 1s/.test(err.message),
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
