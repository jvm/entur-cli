import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEY_MODES,
  csvOf,
  enturId,
  gqlString,
  gqlTime,
  httpOpts,
  int,
  num,
  oneOf,
  reqNum,
} from '../src/cli.js';
import { UsageError } from '../src/errors.js';

test('numeric validators reject non-decimal, fractional, and out-of-range values', () => {
  assert.equal(num({ value: '1.5' }, 'value', { min: 0, max: 2 }), 1.5);
  assert.equal(int({ value: '2' }, 'value', { min: 1, max: 3 }), 2);
  for (const value of ['', '0x10', '1.5', '0', '4', 'Infinity']) {
    assert.throws(() => int({ value }, 'value', { min: 1, max: 3 }), UsageError);
  }
  assert.throws(() => reqNum({}, 'lat'), (err) => err.code === 'missing_argument' && err.field === 'lat');
});

test('enum validators normalize, deduplicate, and expose allowed values', () => {
  assert.equal(oneOf(' BUS ', 'mode', JOURNEY_MODES, { normalize: (value) => value.toLowerCase() }), 'bus');
  assert.deepEqual(csvOf('rail,bus,rail', 'modes', JOURNEY_MODES), ['rail', 'bus']);
  assert.throws(
    () => csvOf('rail,banana', 'modes', JOURNEY_MODES),
    (err) => err instanceof UsageError
      && err.field === 'modes'
      && err.allowedValues.includes('rail'),
  );
});

test('Entur IDs remain opaque while GraphQL strings are safely encoded', () => {
  const id = 'ATB:Line:non_numeric.part-extra:segment';
  assert.equal(enturId(id, 'line'), id);
  assert.equal(gqlString('x") { injected }', 'value'), JSON.stringify('x") { injected }'));
  assert.throws(() => enturId('ATB:Line:', 'line'), UsageError);
  assert.throws(() => enturId('ATB:Line:1\nfield', 'line'), UsageError);
});

test('time validator requires a real date and explicit valid offset', () => {
  assert.equal(gqlTime('2028-02-29T08:30:00+01:00'), '2028-02-29T08:30:00+01:00');
  assert.equal(gqlTime('2026-07-27T08:30Z'), '2026-07-27T08:30Z');
  for (const value of [
    '2026-02-29T08:30:00+01:00',
    '2026-13-01T08:30:00+01:00',
    '2026-07-27T24:00:00+01:00',
    '2026-07-27T08:30:00',
    '2026-07-27T08:30:00+15:00',
  ]) {
    assert.throws(() => gqlTime(value), UsageError);
  }
});

test('httpOpts validates timeout and carries fetch cancellation options', () => {
  const fetchImpl = async () => new Response('{}');
  const controller = new AbortController();
  const opts = httpOpts({ timeout: '0.25', 'client-name': 'company-application' }, {
    fetchImpl,
    signal: controller.signal,
  });
  assert.equal(opts.timeoutSec, 0.25);
  assert.equal(opts.fetchImpl, fetchImpl);
  assert.equal(opts.signal, controller.signal);
  assert.throws(
    () => httpOpts({ timeout: '301', 'client-name': 'company-application' }),
    UsageError,
  );
});
