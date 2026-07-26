import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/entur.js', import.meta.url));

function cli(...args) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
}

test('no args prints root help with examples, exit 0', () => {
  const { status, stdout } = cli();
  assert.equal(status, 0);
  assert.match(stdout, /Usage: entur <command>/);
  assert.match(stdout, /entur geocode search "Oslo S"/);
});

test('unknown command exits 2 with help on stderr', () => {
  const { status, stderr } = cli('teleport');
  assert.equal(status, 2);
  assert.match(stderr, /unknown command 'teleport'/);
});

test('usage error exits 2 with a specific message', () => {
  const { status, stderr } = cli('geocode', 'reverse', '--lon', '10.75');
  assert.equal(status, 2);
  assert.match(stderr, /--lat is required/);
  assert.match(stderr, /entur geocode --help/);
});

test('command help exits 0 and shows an example', () => {
  const { status, stdout } = cli('trip', '--help');
  assert.equal(status, 0);
  assert.match(stdout, /entur trip "Oslo S" "Bergen stasjon"/);
});
