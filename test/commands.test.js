import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, UsageError } from '../src/errors.js';
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
      properties: {
        id: 'NSR:StopPlace:337',
        names: { default: 'Oslo S', display: 'Oslo S, Oslo' },
        layer: 'stopPlace',
      },
    },
  ],
};

test('geocode search builds the v3 URL and shapes results with metadata', async () => {
  const fetchImpl = fakeFetch(jsonRes(geocodeHit));
  const res = await geocode.run(['search', 'oslo', 's', '--limit', '3'], { fetchImpl });
  assert.match(fetchImpl.calls[0].url, /autocomplete\?q=oslo\+s&limit=3/);
  assert.deepEqual(res.meta, { subcommand: 'search', count: 1, limit: 3 });
  assert.deepEqual(res.data, [
    { id: 'NSR:StopPlace:337', label: 'Oslo S, Oslo', layer: 'stopPlace', lat: 59.9109, lon: 10.7522 },
  ]);
  assert.match(res.lines[0], /NSR:StopPlace:337 {2}Oslo S, Oslo \[stopPlace\]/);
});

test('geocode reverse requires --lat and --lon', async () => {
  const fetchImpl = fakeFetch();
  await assert.rejects(
    geocode.run(['reverse', '--lon', '10.75'], { fetchImpl }),
    (err) => err instanceof UsageError && err.message === '--lat is required',
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('geocode rejects unknown input and reverse positionals before fetch', async () => {
  const fetchImpl = fakeFetch();
  await assert.rejects(geocode.run(['frobnicate'], { fetchImpl }), UsageError);
  await assert.rejects(geocode.run(['search', 'oslo', '--bogus'], { fetchImpl }), UsageError);
  await assert.rejects(
    geocode.run(['reverse', 'extra', '--lat', '59.9', '--lon', '10.7'], { fetchImpl }),
    (err) => err instanceof UsageError && err.code === 'unexpected_argument',
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('geocode applies current v3 layers and focus radius', async () => {
  const fetchImpl = fakeFetch(jsonRes({ features: [] }), jsonRes({ features: [] }));
  await geocode.run([
    'search', 'Oslo', '--lat', '59.9', '--lon', '10.7', '--radius', '25', '--layers', 'stopPlace,address',
  ], { fetchImpl });
  assert.match(fetchImpl.calls[0].url, /lat=59\.9&lon=10\.7&radius=25&layers=stopPlace%2Caddress/);

  await geocode.run([
    'reverse', '--lat', '59.9', '--lon', '10.7', '--layers', 'stopPlace',
  ], { fetchImpl });
  assert.match(fetchImpl.calls[1].url, /radius=1&limit=10&layers=stopPlace/);
});

test('geocode rejects invalid domains before fetch', async () => {
  const fetchImpl = fakeFetch();
  for (const args of [
    ['search', 'Oslo', '--limit=0'],
    ['search', 'Oslo', '--limit=1.5'],
    ['search', 'Oslo', '--limit=101'],
    ['search', 'Oslo', '--lat', '91', '--lon', '10'],
    ['search', 'Oslo', '--radius', '1'],
    ['search', 'Oslo', '--layers', 'venue'],
  ]) await assert.rejects(geocode.run(args, { fetchImpl }), UsageError);
  assert.equal(fetchImpl.calls.length, 0);
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

test('departures resolves only StopPlaces, queries estimatedCalls, and formats delay', async () => {
  const fetchImpl = fakeFetch(jsonRes(geocodeHit), jsonRes(departuresFixture));
  const res = await departures.run(['oslo', 's', '--limit', '5', '--modes', 'rail'], {
    fetchImpl,
    stderr: quietStderr,
  });
  assert.match(fetchImpl.calls[0].url, /layers=stopPlace/);
  const query = JSON.parse(fetchImpl.calls[1].init.body).query;
  assert.match(query, /stopPlace\(id: "NSR:StopPlace:337"\)/);
  assert.match(query, /numberOfDepartures: 5/);
  assert.match(query, /whiteListedModes: \[rail\]/);
  assert.equal(res.data.departures[0].line, 'RE11');
  assert.equal(res.lines[0], '12:02  +2m  RE11  -> Skien  quay 3  (rail)');
  assert.deepEqual(res.meta, { count: 1, limit: 5 });
});

test('departures with unknown StopPlace id is a usage error', async () => {
  const fetchImpl = fakeFetch(jsonRes({ data: { stopPlace: null } }));
  await assert.rejects(
    departures.run(['NSR:StopPlace:999999'], { fetchImpl, stderr: quietStderr }),
    (err) => err instanceof UsageError && err.code === 'not_found',
  );
});

test('departures validates options and explicit ID type before resolution', async () => {
  const fetchImpl = fakeFetch();
  for (const args of [
    ['Oslo', '--limit=-1'],
    ['Oslo', '--limit=1.5'],
    ['Oslo', '--modes', 'banana'],
    ['Oslo', '--time', '2026-02-29T08:00:00+01:00'],
    ['Oslo', '--time', '2026-07-27T08:00:00'],
    ['NSR:GroupOfStopPlaces:1'],
  ]) await assert.rejects(departures.run(args, { fetchImpl, stderr: quietStderr }), UsageError);
  assert.equal(fetchImpl.calls.length, 0);
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

test('trip plans between two NSR ids with validated time and modes', async () => {
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
  assert.deepEqual(res.meta, { count: 1, limit: 3 });
  assert.equal(res.lines[0], '1) 08:02 -> 10:35  (2h33m)');
  assert.equal(res.lines[1], '   08:02-10:35  rail F4: Oslo S -> Bergen stasjon');
});

test('trip resolves from and to deterministically in argument order', async () => {
  const bergenHit = {
    features: [{
      geometry: { coordinates: [5.334, 60.389] },
      properties: {
        id: 'NSR:StopPlace:59983',
        names: { display: 'Bergen stasjon, Bergen' },
        layer: 'stopPlace',
      },
    }],
  };
  const fetchImpl = fakeFetch(
    jsonRes(geocodeHit),
    jsonRes(bergenHit),
    jsonRes({ data: { trip: { tripPatterns: [] } } }),
  );
  const messages = [];
  await trip.run(['Oslo S', 'Bergen stasjon', '--limit', '1'], {
    fetchImpl,
    stderr: { write: (message) => messages.push(message) },
  });
  assert.match(fetchImpl.calls[0].url, /q=Oslo\+S/);
  assert.match(fetchImpl.calls[1].url, /q=Bergen\+stasjon/);
  assert.match(messages[0], /Oslo S/);
  assert.match(messages[1], /Bergen stasjon/);
});

test('trip validates arity and options before geocoding', async () => {
  const fetchImpl = fakeFetch();
  await assert.rejects(trip.run(['Oslo'], { fetchImpl }), /exactly <from> and <to>/);
  for (const args of [
    ['Oslo', 'Bergen', '--time', 'tomorrow'],
    ['Oslo', 'Bergen', '--time', '2026-07-27T08:00:00'],
    ['Oslo', 'Bergen', '--modes', 'banana'],
    ['Oslo', 'Bergen', '--limit=0'],
    ['Oslo', 'Bergen', '--limit=1.5'],
  ]) await assert.rejects(trip.run(args, { fetchImpl, stderr: quietStderr }), UsageError);
  assert.equal(fetchImpl.calls.length, 0);
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

test('vehicles reports client-side truncation in human and machine metadata', async () => {
  await assert.rejects(vehicles.run([], {}), /at least one filter/);
  const fetchImpl = fakeFetch(jsonRes(vehiclesFixture));
  const res = await vehicles.run(['--codespace', 'rut', '--limit', '1'], { fetchImpl });
  const query = JSON.parse(fetchImpl.calls[0].init.body).query;
  assert.match(query, /vehicles\(codespaceId: "RUT"\)/);
  assert.equal(res.data.length, 1);
  assert.deepEqual(res.meta, {
    count: 1,
    totalCount: 2,
    limit: 1,
    hasMore: true,
    truncated: true,
  });
  assert.match(res.lines.at(-1), /1 more; raise --limit/);
  assert.match(res.lines[0], /many seats available/);
  assert.match(res.lines[0], /@12:00\+02:00/);
});

test('vehicles rejects positionals and invalid domains before fetch', async () => {
  const fetchImpl = fakeFetch();
  for (const args of [
    ['extra', '--mode', 'bus'],
    ['--mode', 'bus', '--limit=-1'],
    ['--mode', 'bus', '--limit=1.5'],
    ['--mode', 'bus', '--limit=101'],
    ['--mode', 'water'],
    ['--bbox', '1,2,3'],
    ['--bbox', '3,2,1,4'],
    ['--bbox', '1,181,3,182'],
  ]) await assert.rejects(vehicles.run(args, { fetchImpl }), UsageError);
  assert.equal(fetchImpl.calls.length, 0);
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
  assert.deepEqual(res.meta, { subcommand: 'vehicles', count: 1, limit: 20, rangeMeters: 500 });
  assert.match(res.lines[0], /scooter {2}Voi Oslo/);
  assert.match(res.lines[0], /80%/);
});

test('mobility stations applies --form-factor to availableFormFactors', async () => {
  const fixture = {
    data: {
      stations: [{
        id: 'YOS:Station:1',
        name: { translation: [{ language: 'nb', value: 'Stasjonen' }] },
        lat: 59.91,
        lon: 10.75,
        numVehiclesAvailable: 2,
        vehicleTypesAvailable: [{ count: 2, vehicleType: { formFactor: 'BICYCLE' } }],
        system: { name: { translation: [{ language: 'nb', value: 'Oslo Bysykkel' }] } },
      }],
    },
  };
  const fetchImpl = fakeFetch(jsonRes(fixture));
  const res = await mobility.run([
    'stations', '--lat', '59.91', '--lon', '10.75', '--form-factor', 'bicycle', '--limit', '1',
  ], { fetchImpl });
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.deepEqual(body.variables.formFactors, ['BICYCLE']);
  assert.match(body.query, /availableFormFactors: \$formFactors/);
  assert.equal(res.data[0].available, 2);
  assert.deepEqual(res.meta, { subcommand: 'stations', count: 1, limit: 1, rangeMeters: 500 });
});

test('mobility rejects extra args and invalid domains before fetch', async () => {
  const fetchImpl = fakeFetch();
  for (const args of [
    ['nearby'],
    ['vehicles', 'extra', '--lat', '59.9', '--lon', '10.7'],
    ['vehicles', '--lat', '59.9'],
    ['vehicles', '--lat', '91', '--lon', '10.7'],
    ['vehicles', '--lat', '59.9', '--lon', '181'],
    ['vehicles', '--lat', '59.9', '--lon', '10.7', '--range=0'],
    ['vehicles', '--lat', '59.9', '--lon', '10.7', '--range=2001'],
    ['vehicles', '--lat', '59.9', '--lon', '10.7', '--limit=1.5'],
    ['vehicles', '--lat', '59.9', '--lon', '10.7', '--form-factor', 'banana'],
  ]) await assert.rejects(mobility.run(args, { fetchImpl }), UsageError);
  assert.equal(fetchImpl.calls.length, 0);
});

test('commands map malformed endpoint payloads to ApiError', async () => {
  await assert.rejects(
    geocode.run(['search', 'Oslo'], { fetchImpl: fakeFetch(jsonRes({})) }),
    (err) => err instanceof ApiError && err.code === 'invalid_response',
  );
  await assert.rejects(
    departures.run(['NSR:StopPlace:1'], {
      fetchImpl: fakeFetch(jsonRes({ data: { stopPlace: { id: 'NSR:StopPlace:1', name: 'x', estimatedCalls: {} } } })),
    }),
    (err) => err instanceof ApiError && err.code === 'invalid_response',
  );
  await assert.rejects(
    trip.run(['NSR:StopPlace:1', 'NSR:StopPlace:2'], {
      fetchImpl: fakeFetch(jsonRes({ data: { trip: { tripPatterns: {} } } })),
    }),
    (err) => err instanceof ApiError && err.code === 'invalid_response',
  );
  await assert.rejects(
    vehicles.run(['--mode', 'bus'], { fetchImpl: fakeFetch(jsonRes({ data: { vehicles: {} } })) }),
    (err) => err instanceof ApiError && err.code === 'invalid_response',
  );
  await assert.rejects(
    mobility.run(['vehicles', '--lat', '59.9', '--lon', '10.7'], {
      fetchImpl: fakeFetch(jsonRes({ data: { vehicles: {} } })),
    }),
    (err) => err instanceof ApiError && err.code === 'invalid_response',
  );
});

test('every command returns focused help without requests', async () => {
  for (const mod of [geocode, departures, trip, vehicles, mobility]) {
    const res = await mod.run(['--help'], { fetchImpl: fakeFetch() });
    assert.match(res.lines[0], /^Usage: entur /);
    assert.match(res.lines[0], /Example/);
    assert.match(res.lines[0], /--json/);
    assert.match(res.lines[0], /--timeout/);
    assert.match(res.lines[0], /--client-name/);
  }
});

test('all leaf-help examples parse and execute against fixtures', async () => {
  const emptyTrip = { data: { trip: { tripPatterns: [] } } };
  const emptyStop = { data: { stopPlace: { id: 'NSR:StopPlace:59872', name: 'Oslo S', estimatedCalls: [] } } };
  const cases = [
    {
      mod: geocode,
      example: 'entur geocode search "Oslo S" --layers stopPlace --limit 3',
      args: ['search', 'Oslo S', '--layers', 'stopPlace', '--limit', '3'],
      responses: [jsonRes({ features: [] })],
    },
    {
      mod: geocode,
      example: 'entur geocode reverse --lat 59.911 --lon 10.750 --radius 0.5 --layers stopPlace',
      args: ['reverse', '--lat', '59.911', '--lon', '10.750', '--radius', '0.5', '--layers', 'stopPlace'],
      responses: [jsonRes({ features: [] })],
    },
    {
      mod: departures,
      example: 'entur departures "Oslo S" --limit 5 --modes rail',
      args: ['Oslo S', '--limit', '5', '--modes', 'rail'],
      responses: [jsonRes(geocodeHit), jsonRes(emptyStop)],
    },
    {
      mod: departures,
      example: 'entur departures NSR:StopPlace:59872 --limit 5 --json',
      args: ['NSR:StopPlace:59872', '--limit', '5', '--json'],
      responses: [jsonRes(emptyStop)],
    },
    {
      mod: trip,
      example: 'entur trip "Oslo S" "Bergen stasjon" --limit 1',
      args: ['Oslo S', 'Bergen stasjon', '--limit', '1'],
      responses: [jsonRes(geocodeHit), jsonRes(geocodeHit), jsonRes(emptyTrip)],
    },
    {
      mod: trip,
      example: 'entur trip NSR:StopPlace:59872 NSR:StopPlace:59983 --modes rail --limit 1 --json',
      args: ['NSR:StopPlace:59872', 'NSR:StopPlace:59983', '--modes', 'rail', '--limit', '1', '--json'],
      responses: [jsonRes(emptyTrip)],
    },
    {
      mod: vehicles,
      example: 'entur vehicles --codespace ATB --mode bus --limit 5',
      args: ['--codespace', 'ATB', '--mode', 'bus', '--limit', '5'],
      responses: [jsonRes({ data: { vehicles: [] } })],
    },
    {
      mod: vehicles,
      example: 'entur vehicles --bbox 59.8,10.5,60.0,10.9 --limit 20 --json',
      args: ['--bbox', '59.8,10.5,60.0,10.9', '--limit', '20', '--json'],
      responses: [jsonRes({ data: { vehicles: [] } })],
    },
    {
      mod: mobility,
      example: 'entur mobility vehicles --lat 59.911 --lon 10.750 --form-factor scooter --limit 5',
      args: ['vehicles', '--lat', '59.911', '--lon', '10.750', '--form-factor', 'scooter', '--limit', '5'],
      responses: [jsonRes({ data: { vehicles: [] } })],
    },
    {
      mod: mobility,
      example: 'entur mobility stations --lat 59.911 --lon 10.750 --form-factor bicycle --json',
      args: ['stations', '--lat', '59.911', '--lon', '10.750', '--form-factor', 'bicycle', '--json'],
      responses: [jsonRes({ data: { stations: [] } })],
    },
  ];

  for (const item of cases) {
    assert.ok(item.mod.help.includes(item.example), `missing help example: ${item.example}`);
    await item.mod.run(item.args, { fetchImpl: fakeFetch(...item.responses), stderr: quietStderr });
  }
});
