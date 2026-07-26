import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsageError } from '../src/errors.js';
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

test('free text resolves via geocoder autocomplete top hit', async () => {
  const fetchImpl = fakeFetch(jsonRes(osloS));
  const messages = [];
  const place = await resolvePlace('oslo s', { fetchImpl, stderr: { write: (s) => messages.push(s) } });
  assert.equal(place.id, 'NSR:StopPlace:337');
  assert.equal(place.lat, 59.9109);
  assert.match(fetchImpl.calls[0].url, /autocomplete\?q=oslo\+s&limit=1/);
  assert.match(messages.join(''), /resolved 'oslo s' -> NSR:StopPlace:337/);
});

test('no geocoder match is a usage error suggesting geocode search', async () => {
  const fetchImpl = fakeFetch(jsonRes({ features: [] }));
  await assert.rejects(
    resolvePlace('xyzzy', { fetchImpl, stderr: quietStderr }),
    (err) => err instanceof UsageError && /no place found matching 'xyzzy'/.test(err.message),
  );
});
