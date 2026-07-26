import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delayStr, dur, hhmm, hhmmOffset } from '../src/format.js';

test('hhmm keeps schedule wall time while hhmmOffset preserves the source zone', () => {
  assert.equal(hhmm('2026-07-26T23:08:15+02:00'), '23:08');
  assert.equal(hhmmOffset('2026-07-26T21:08:15Z'), '21:08Z');
  assert.equal(hhmmOffset('2026-07-26T23:08:15+02:00'), '23:08+02:00');
  assert.equal(hhmmOffset('2026-01-26T22:08:15+01:00'), '22:08+01:00');
  assert.equal(hhmmOffset('not-a-time'), '');
});

test('duration and delay formatting retain existing units', () => {
  assert.equal(dur(9180), '2h33m');
  assert.equal(dur(null), '');
  assert.equal(delayStr('2026-07-26T12:00:00+02:00', '2026-07-26T12:02:00+02:00'), '+2m');
});
