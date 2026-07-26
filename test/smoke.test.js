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

test('geocoder search and reverse return NSR/place features', { skip }, async () => {
  const search = await geocode.run(['search', 'Oslo S', '--limit', '1'], quiet);
  assert.match(search.data[0].id, /^NSR:/);
  assert.ok(search.data[0].label.includes('Oslo'));
  const reverse = await geocode.run(['reverse', '--lat', '59.911', '--lon', '10.750'], quiet);
  assert.ok(reverse.data.length > 0);
});

test('journey planner serves a departure board with estimatedCalls fields', { skip }, async () => {
  const res = await departures.run(['NSR:StopPlace:59872', '--limit', '2'], quiet);
  assert.equal(res.data.stop.name, 'Oslo S');
  assert.ok(res.data.departures.length > 0);
  assert.ok(res.data.departures[0].time);
});

test('journey planner plans a trip with legs', { skip }, async () => {
  const res = await trip.run(['NSR:StopPlace:59872', 'NSR:StopPlace:59983', '--limit', '1'], quiet);
  assert.ok(res.data.tripPatterns.length > 0);
  assert.ok(res.data.tripPatterns[0].legs.length > 0);
});

test('vehicle positions accepts mode and bbox filters', { skip }, async () => {
  const res = await vehicles.run(['--mode', 'bus', '--bbox', '58,4,72,32', '--limit', '1'], quiet);
  assert.ok(Array.isArray(res.data));
});

test('mobility serves vehicles and stations near a coordinate', { skip }, async () => {
  const veh = await mobility.run(['vehicles', '--lat', '59.911', '--lon', '10.750'], quiet);
  const sta = await mobility.run(['stations', '--lat', '59.911', '--lon', '10.750'], quiet);
  assert.ok(Array.isArray(veh.data));
  assert.ok(Array.isArray(sta.data));
});
