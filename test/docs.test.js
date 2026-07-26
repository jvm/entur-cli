import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HELP } from '../src/main.js';
import { CLI_VERSION, SCHEMA_VERSION } from '../src/version.js';
import * as departures from '../src/commands/departures.js';
import * as geocode from '../src/commands/geocode.js';
import * as mobility from '../src/commands/mobility.js';
import * as trip from '../src/commands/trip.js';
import * as vehicles from '../src/commands/vehicles.js';

const root = new URL('..', import.meta.url);

test('package, CLI, and documented machine-contract versions agree', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const readme = await readFile(new URL('README.md', root), 'utf8');
  assert.equal(CLI_VERSION, packageJson.version);
  assert.equal(SCHEMA_VERSION, 1);
  assert.match(readme, /"schemaVersion": 1/);
  assert.match(readme, /supportedSchemaVersions/);
  assert.match(HELP, /--version/);
});

test('help and README document current API surfaces', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const docs = [HELP, readme, geocode.help, departures.help, trip.help, vehicles.help, mobility.help].join('\n');
  assert.doesNotMatch(docs, /--layers venue/);
  assert.doesNotMatch(docs, /--form-factor scooter(?:\s|$)/);
  assert.match(docs, /--form-factor scooter_standing/);
  assert.doesNotMatch(geocode.help, /reverse search radius \(default 1\)/);
  assert.match(HELP, /search, reverse, place/);
  for (const value of [
    'search',
    'reverse',
    'place',
    '--weight',
    '--bbox',
    '--lang',
    '--stop-place-types',
    '--sources',
    '--countries',
    '--counties',
    '--localities',
    '--fare-zones',
    '--fare-zone-authorities',
    '--multimodal',
    '--distance-sort',
    '--correlation-id',
  ]) {
    assert.ok(geocode.help.includes(value), `geocode help is missing ${value}`);
    assert.ok(readme.includes(value), `README is missing ${value}`);
  }
  assert.match(readme, /complete v3 feature data/);
  for (const leaf of [geocode.help, departures.help, trip.help, vehicles.help, mobility.help]) {
    assert.match(leaf, /--json/);
    assert.match(leaf, /--timeout/);
    assert.match(leaf, /--client-name/);
  }
});
