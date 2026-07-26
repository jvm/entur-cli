// Live schema checks against the real Entur APIs. Opt in: ENTUR_SMOKE=1 npm test
// These exist because fixture-based unit tests cannot catch upstream schema drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as geocode from '../src/commands/geocode.js';
import * as departures from '../src/commands/departures.js';
import * as trip from '../src/commands/trip.js';
import * as vehicles from '../src/commands/vehicles.js';
import * as mobility from '../src/commands/mobility.js';

const skip = process.env.ENTUR_SMOKE ? false : 'set ENTUR_SMOKE=1 to run live smoke tests';
const quiet = { stderr: { write() {} } };

test('all Geocoder v3 endpoints and filter-only search return complete features', { skip }, async () => {
  const search = await geocode.run([
    'search', 'Oslo S',
    '--lat', '59.91', '--lon', '10.75', '--radius', '25', '--weight', '0.75',
    '--bbox', '10.5,59.8,10.9,60.0', '--limit', '1', '--lang', 'no',
    '--layers', 'stopPlace', '--stop-place-types', 'railStation', '--sources', 'nsr',
    '--countries', 'no', '--counties', 'KVE:TopographicPlace:03',
    '--localities', 'KVE:TopographicPlace:0301', '--fare-zones', 'RUT:FareZone:4',
    '--fare-zone-authorities', 'RUT:Authority:RUT', '--multimodal', 'all',
    '--correlation-id', 'smoke-geocoder',
  ], quiet);
  assert.match(search.data[0].id, /^NSR:/);
  assert.ok(search.data[0].label.includes('Oslo'));
  assert.equal(search.data[0].type, 'Feature');
  assert.equal(search.data[0].source, 'nsr');
  assert.ok(search.data[0].names.display);
  assert.equal(search.meta.geocoder.type, 'FeatureCollection');
  assert.equal(search.meta.geocoder.metadata.resultCount, 1);

  const filtered = await geocode.run(['search', '--stop-place-types', 'airport', '--limit', '1'], quiet);
  assert.ok(filtered.data[0].stopPlaceTypes.includes('airport'));

  const reverse = await geocode.run([
    'reverse', '--lat', '59.911', '--lon', '10.750', '--layers', 'stopPlace', '--limit', '1',
  ], quiet);
  assert.equal(typeof reverse.data[0].distance, 'number');

  const place = await geocode.run(['place', 'NSR:StopPlace:59872', '--lang', 'en'], quiet);
  assert.equal(place.data[0].id, 'NSR:StopPlace:59872');
  assert.equal(place.meta.requestedCount, 1);
});

test('journey planner resolves free text to a StopPlace departure board', { skip }, async () => {
  const res = await departures.run(['Oslo', '--limit', '2'], quiet);
  assert.equal(res.data.stop.id, 'NSR:StopPlace:59872');
  assert.equal(res.data.stop.name, 'Oslo S');
  assert.ok(res.data.departures.length > 0);
  assert.ok(res.data.departures[0].time);
});

test('journey planner plans a trip with legs', { skip }, async () => {
  const searchTime = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const res = await trip.run([
    'NSR:StopPlace:59872', 'NSR:StopPlace:59983', '--time', searchTime, '--limit', '1',
  ], quiet);
  assert.ok(res.data.tripPatterns.length > 0);
  assert.ok(res.data.tripPatterns[0].legs.length > 0);
});

test('vehicle positions accepts mode and bbox filters', { skip }, async () => {
  const res = await vehicles.run(['--mode', 'bus', '--bbox', '58,4,72,32', '--limit', '1'], quiet);
  assert.ok(Array.isArray(res.data));
});

test('mobility serves vehicles and stations near a coordinate', { skip }, async () => {
  const veh = await mobility.run(['vehicles', '--lat', '59.911', '--lon', '10.750'], quiet);
  const sta = await mobility.run(['stations', '--lat', '59.911', '--lon', '10.750', '--form-factor', 'bicycle'], quiet);
  assert.ok(Array.isArray(veh.data));
  assert.ok(Array.isArray(sta.data));
});
