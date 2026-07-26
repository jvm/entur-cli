import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, UsageError } from '../src/errors.js';
import { resolvePlace } from '../src/resolve.js';
import { fakeFetch, jsonRes, quietStderr } from './helpers.js';

const osloS = {
  features: [
    {
      geometry: { coordinates: [10.7522, 59.9109] },
      properties: { id: 'NSR:StopPlace:337', names: { default: 'Oslo S', display: 'Oslo S, Oslo' }, layer: 'stopPlace' },
    },
  ],
};

test('Entur IDs pass through verbatim without a network call', async () => {
  const fetchImpl = fakeFetch();
  const place = await resolvePlace('NSR:StopPlace:337', { fetchImpl });
  assert.deepEqual(place, { id: 'NSR:StopPlace:337', name: 'NSR:StopPlace:337' });
  assert.equal(fetchImpl.calls.length, 0);
});

test('free text resolves via a layer-filtered geocoder top hit', async () => {
  const fetchImpl = fakeFetch(jsonRes(osloS));
  const messages = [];
  const place = await resolvePlace('oslo s', {
    fetchImpl,
    stderr: { write: (message) => messages.push(message) },
    layers: ['stopPlace'],
    idTypes: ['StopPlace'],
    what: 'stop',
  });
  assert.equal(place.id, 'NSR:StopPlace:337');
  assert.equal(place.lat, 59.9109);
  assert.match(fetchImpl.calls[0].url, /autocomplete\?q=oslo\+s&limit=1&layers=stopPlace/);
  assert.match(messages.join(''), /resolved 'oslo s' -> NSR:StopPlace:337/);
});

test('explicit IDs must match a command-specific type without a request', async () => {
  const fetchImpl = fakeFetch();
  await assert.rejects(
    resolvePlace('NSR:GroupOfStopPlaces:1', {
      fetchImpl,
      idTypes: ['StopPlace'],
      what: 'stop',
    }),
    (err) => err instanceof UsageError && err.field === 'stop',
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('no geocoder match is a usage error suggesting geocode search', async () => {
  const fetchImpl = fakeFetch(jsonRes({ features: [] }));
  await assert.rejects(
    resolvePlace('xyzzy', { fetchImpl, stderr: quietStderr }),
    (err) => err instanceof UsageError
      && err.code === 'not_found'
      && /no place found matching 'xyzzy'/.test(err.message),
  );
});

test('malformed geocoder features become retryable API errors', async () => {
  const fetchImpl = fakeFetch(
    jsonRes({ features: [{ properties: {}, geometry: {} }] }),
    jsonRes({
      features: [{
        properties: { id: 'not-an-entur-id', names: { display: 'Oslo' } },
        geometry: { coordinates: [10.75, 59.91] },
      }],
    }),
  );
  for (const query of ['oslo', 'bergen']) {
    await assert.rejects(
      resolvePlace(query, { fetchImpl, stderr: quietStderr }),
      (err) => err instanceof ApiError && err.code === 'invalid_response' && err.retryable,
    );
  }
});

test('free-text control characters are rejected before fetch', async () => {
  const fetchImpl = fakeFetch();
  await assert.rejects(resolvePlace('oslo\u001b[31m', { fetchImpl }), UsageError);
  assert.equal(fetchImpl.calls.length, 0);
});
