import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsageError } from '../src/errors.js';
import * as geocode from '../src/commands/geocode.js';
import * as departures from '../src/commands/departures.js';
import * as trip from '../src/commands/trip.js';
import * as vehicles from '../src/commands/vehicles.js';
import * as mobility from '../src/commands/mobility.js';
import { fakeFetch, jsonRes, quietStderr } from './helpers.js';

const geocodeHit = {
  features: [
    {
      geometry: { coordinates: [10.7522, 59.9109] },
      properties: { id: 'NSR:StopPlace:337', names: { default: 'Oslo S', display: 'Oslo S, Oslo' }, layer: 'stopPlace' },
    },
  ],
};

test('geocode search builds autocompleteV3 URL and shapes results', async () => {
  const fetchImpl = fakeFetch(jsonRes(geocodeHit));
  const res = await geocode.run(['search', 'oslo', 's', '--limit', '3'], { fetchImpl });
  assert.match(fetchImpl.calls[0].url, /autocomplete\?q=oslo\+s&limit=3/);
  assert.deepEqual(res.data, [
    { id: 'NSR:StopPlace:337', label: 'Oslo S, Oslo', layer: 'stopPlace', lat: 59.9109, lon: 10.7522 },
  ]);
  assert.match(res.lines[0], /NSR:StopPlace:337 {2}Oslo S, Oslo \[stopPlace\]/);
});

test('geocode reverse requires --lat and --lon', async () => {
  await assert.rejects(
    geocode.run(['reverse', '--lon', '10.75'], { fetchImpl: fakeFetch() }),
    (err) => err instanceof UsageError && err.message === '--lat is required',
  );
});

test('geocode rejects unknown subcommand and unknown flags', async () => {
  await assert.rejects(geocode.run(['frobnicate'], {}), UsageError);
  await assert.rejects(geocode.run(['search', 'oslo', '--bogus'], {}), UsageError);
});

const departuresFixture = {
  data: {
    stopPlace: {
      id: 'NSR:StopPlace:337',
      name: 'Oslo S',
      estimatedCalls: [
        {
          aimedDepartureTime: '2026-07-26T12:00:00+02:00',
          expectedDepartureTime: '2026-07-26T12:02:00+02:00',
          realtime: true,
          cancellation: false,
          quay: { publicCode: '3' },
          destinationDisplay: { frontText: 'Skien' },
          serviceJourney: { line: { publicCode: 'RE11', transportMode: 'rail' } },
        },
      ],
    },
  },
};

test('departures resolves stop, queries estimatedCalls, formats delay', async () => {
  const fetchImpl = fakeFetch(jsonRes(geocodeHit), jsonRes(departuresFixture));
  const res = await departures.run(['oslo', 's', '--limit', '5', '--modes', 'rail'], {
    fetchImpl,
    stderr: quietStderr,
  });
  const query = JSON.parse(fetchImpl.calls[1].init.body).query;
  assert.match(query, /stopPlace\(id: "NSR:StopPlace:337"\)/);
  assert.match(query, /numberOfDepartures: 5/);
  assert.match(query, /whiteListedModes: \[rail\]/);
  assert.equal(res.data.departures[0].line, 'RE11');
  assert.equal(res.lines[0], '12:02  +2m  RE11  -> Skien  quay 3  (rail)');
});

test('departures with unknown stop id is a usage error', async () => {
  const fetchImpl = fakeFetch(jsonRes({ data: { stopPlace: null } }));
  await assert.rejects(
    departures.run(['NSR:StopPlace:999999'], { fetchImpl, stderr: quietStderr }),
    (err) => err instanceof UsageError && /no stop place found/.test(err.message),
  );
});

const tripFixture = {
  data: {
    trip: {
      tripPatterns: [
        {
          duration: 9180,
          expectedStartTime: '2026-07-27T08:02:00+02:00',
          expectedEndTime: '2026-07-27T10:35:00+02:00',
          legs: [
            {
              mode: 'rail',
              distance: 120000,
              duration: 9180,
              fromPlace: { name: 'Oslo S' },
              toPlace: { name: 'Bergen stasjon' },
              line: { publicCode: 'F4', name: 'Bergensbanen' },
              expectedStartTime: '2026-07-27T08:02:00+02:00',
              expectedEndTime: '2026-07-27T10:35:00+02:00',
            },
          ],
        },
      ],
    },
  },
};

test('trip plans between two NSR ids with time and modes', async () => {
  const fetchImpl = fakeFetch(jsonRes(tripFixture));
  const res = await trip.run(
    ['NSR:StopPlace:337', 'NSR:StopPlace:548', '--time', '2026-07-27T08:00:00+02:00', '--modes', 'rail'],
    { fetchImpl, stderr: quietStderr },
  );
  const query = JSON.parse(fetchImpl.calls[0].init.body).query;
  assert.match(query, /from: \{ place: "NSR:StopPlace:337" \}/);
  assert.match(query, /dateTime: "2026-07-27T08:00:00\+02:00"/);
  assert.match(query, /modes: \{ transportModes: \[\{ transportMode: rail \}\] \}/);
  assert.equal(res.data.tripPatterns[0].legs[0].line, 'F4');
  assert.equal(res.lines[0], '1) 08:02 -> 10:35  (2h33m)');
  assert.equal(res.lines[1], '   08:02-10:35  rail F4: Oslo S -> Bergen stasjon');
});

test('trip requires exactly two endpoints and a valid --time', async () => {
  await assert.rejects(trip.run(['Oslo'], {}), /exactly <from> and <to>/);
  await assert.rejects(
    trip.run(['NSR:StopPlace:1', 'NSR:StopPlace:2', '--time', 'tomorrow'], {}),
    /--time must be ISO 8601/,
  );
});

const vehiclesFixture = {
  data: {
    vehicles: [
      {
        vehicleId: 'RUT:Vehicle:1',
        lastUpdated: '2026-07-26T12:00:30+02:00',
        mode: 'BUS',
        line: { lineRef: 'RUT:Line:31', publicCode: '31' },
        location: { latitude: 59.91, longitude: 10.75 },
        bearing: 90,
        speed: 10,
        delay: 60,
        occupancyStatus: 'MANY_SEATS_AVAILABLE',
      },
      {
        vehicleId: 'RUT:Vehicle:2',
        lastUpdated: '2026-07-26T12:00:31+02:00',
        mode: 'BUS',
        line: { lineRef: 'RUT:Line:31', publicCode: '31' },
        location: { latitude: 59.92, longitude: 10.76 },
        bearing: 91,
        speed: 11,
        delay: 0,
        occupancyStatus: null,
      },
    ],
  },
};

test('vehicles requires a filter, applies --limit client-side', async () => {
  await assert.rejects(vehicles.run([], {}), /at least one filter/);
  const fetchImpl = fakeFetch(jsonRes(vehiclesFixture));
  const res = await vehicles.run(['--codespace', 'RUT', '--limit', '1'], { fetchImpl });
  const query = JSON.parse(fetchImpl.calls[0].init.body).query;
  assert.match(query, /vehicles\(codespaceId: "RUT"\)/);
  assert.equal(res.data.length, 1);
  assert.match(res.lines.at(-1), /1 more; raise --limit/);
});

test('vehicles validates --bbox shape', async () => {
  await assert.rejects(vehicles.run(['--bbox', '1,2,3'], {}), /--bbox must be/);
});

const mobilityVehiclesFixture = {
  data: {
    vehicles: [
      {
        id: 'YVO:Vehicle:abc',
        lat: 59.911,
        lon: 10.751,
        isReserved: false,
        currentRangeMeters: 12000,
        currentFuelPercent: 0.8,
        vehicleType: { formFactor: 'SCOOTER', propulsionType: 'ELECTRIC' },
        system: { name: { translation: [{ language: 'nb', value: 'Voi Oslo' }] } },
      },
    ],
  },
};

test('mobility vehicles queries by coordinate with form factor', async () => {
  const fetchImpl = fakeFetch(jsonRes(mobilityVehiclesFixture));
  const res = await mobility.run(
    ['vehicles', '--lat', '59.911', '--lon', '10.750', '--form-factor', 'scooter'],
    { fetchImpl },
  );
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.deepEqual(body.variables, {
    lat: 59.911,
    lon: 10.75,
    range: 500,
    count: 20,
    formFactors: ['SCOOTER'],
  });
  assert.equal(res.data[0].system, 'Voi Oslo');
  assert.equal(res.data[0].fuelPercent, 80);
  assert.match(res.lines[0], /scooter {2}Voi Oslo/);
  assert.match(res.lines[0], /80%/);
});

test('mobility requires subcommand and coordinates', async () => {
  await assert.rejects(mobility.run(['nearby'], {}), /vehicles or stations/);
  await assert.rejects(mobility.run(['vehicles', '--lat', '59.9'], {}), /--lon is required/);
});

test('every command returns its help text with --help and makes no requests', async () => {
  for (const mod of [geocode, departures, trip, vehicles, mobility]) {
    const res = await mod.run(['--help'], { fetchImpl: fakeFetch() });
    assert.match(res.lines[0], /^Usage: entur /);
    assert.match(res.lines[0], /Example/);
  }
});
