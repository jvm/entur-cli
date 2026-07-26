import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/entur.js', import.meta.url));
const mainUrl = new URL('../src/main.js', import.meta.url).href;

function cli(...args) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
  });
}

test('no args prints root help with examples, exit 0', () => {
  const { status, stdout } = cli();
  assert.equal(status, 0);
  assert.match(stdout, /Usage: entur <command>/);
  assert.match(stdout, /entur geocode search "Oslo S"/);
});

test('unknown command exits 2 with repair guidance on stderr', () => {
  const { status, stderr } = cli('teleport');
  assert.equal(status, 2);
  assert.match(stderr, /unknown command 'teleport'/);
  assert.match(stderr, /Valid commands:/);
});

test('--version has human and machine-readable forms', () => {
  const human = cli('--version');
  assert.equal(human.status, 0);
  assert.match(human.stdout, /^entur 0\.2\.0/);

  const machine = cli('--version', '--json');
  assert.equal(machine.status, 0);
  assert.equal(machine.stderr, '');
  assert.deepEqual(JSON.parse(machine.stdout), {
    schemaVersion: 1,
    data: {
      cliVersion: '0.2.0',
      currentSchemaVersion: 1,
      supportedSchemaVersions: [1],
    },
    meta: { command: 'version' },
  });
});

test('usage error exits 2 with a specific message', () => {
  const { status, stderr } = cli('geocode', 'reverse', '--lon', '10.75');
  assert.equal(status, 2);
  assert.match(stderr, /--lat is required/);
  assert.match(stderr, /entur geocode --help/);
});

test('--json renders structured usage errors on stderr with clean stdout', () => {
  const { status, stdout, stderr } = cli('geocode', 'reverse', '--lon', '10.75', '--json');
  assert.equal(status, 2);
  assert.equal(stdout, '');
  assert.deepEqual(JSON.parse(stderr), {
    schemaVersion: 1,
    error: {
      code: 'missing_argument',
      message: '--lat is required',
      field: 'lat',
      retryable: false,
      hint: 'Pass --lat with a value.',
    },
  });
});

test('command help exits 0 and shows an example', () => {
  const { status, stdout } = cli('trip', '--help');
  assert.equal(status, 0);
  assert.match(stdout, /entur trip "Oslo S" "Bergen stasjon"/);
});

test('machine errors are structured for unknown commands and hide internal stacks', async () => {
  const unknown = cli('teleport', '--json');
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, '');
  const unknownPayload = JSON.parse(unknown.stderr);
  assert.equal(unknownPayload.error.code, 'unknown_command');
  assert.deepEqual(unknownPayload.error.allowedValues, [
    'geocode', 'departures', 'trip', 'vehicles', 'mobility',
  ]);

  const writes = [];
  const commands = {
    broken: async () => ({ run: async () => { throw new Error('private implementation path'); } }),
  };
  const status = await mainForTest(['broken', '--json'], commands, writes);
  assert.equal(status, 1);
  const payload = JSON.parse(writes[0]);
  assert.equal(payload.error.code, 'internal_error');
  assert.doesNotMatch(writes[0], /private implementation path/);
});

test('human result rendering neutralizes terminal control bytes', async () => {
  const writes = [];
  const commands = {
    safe: async () => ({ run: async () => ({ lines: ['name\u001b[31mred'] }) }),
  };
  const status = await mainForTest(['safe'], commands, writes);
  assert.equal(status, 0);
  assert.equal(writes[0], 'name\\x1b[31mred\n');
  assert.doesNotMatch(writes[0], /\u001b/);
});

test('large machine output drains completely before process exit', () => {
  const script = `
    import { main } from ${JSON.stringify(mainUrl)};
    const data = Array.from({ length: 5000 }, (_, id) => ({ id, value: 'x'.repeat(40) }));
    const commands = { fixture: async () => ({ run: async () => ({ json: true, data }) }) };
    process.exitCode = await main(['fixture', '--json'], { commands });
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 2_000_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.length > 65_536);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.data.length, 5000);
  assert.deepEqual(payload.meta, { command: 'fixture' });
});

async function mainForTest(args, commands, writes) {
  const { main } = await import('../src/main.js');
  const stream = { write: (value) => writes.push(value) };
  return main(args, { commands, stdout: stream, stderr: stream });
}
