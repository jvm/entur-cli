import { UsageError } from '../errors.js';
import { ENDPOINTS, graphql } from '../http.js';
import { globalOptions, httpOpts, num, parse, reqNum } from '../cli.js';

export const help = `Usage: entur mobility <vehicles|stations> --lat <n> --lon <n> [options]

Shared mobility (city bikes, scooters, cars) near a coordinate (Entur Mobility v2).

Subcommands:
  vehicles   free-floating vehicles
  stations   docking stations with availability

Options:
  --lat <n> --lon <n>    center coordinate (required)
  --range <m>            search radius in meters (default 500)
  --form-factor <f>      vehicles: bicycle, scooter, car, cargo_bicycle, moped
  --limit <n>            max results (default 20)
  --json                 JSON output
  -h, --help             this help

Example:
  entur mobility vehicles --lat 59.911 --lon 10.750 --form-factor scooter --limit 5`;

const options = {
  ...globalOptions,
  lat: { type: 'string' },
  lon: { type: 'string' },
  range: { type: 'string', default: '500' },
  'form-factor': { type: 'string' },
  limit: { type: 'string', default: '20' },
};

// Query shapes match Entur's own MCP service (entur/opentripplanner-mcp).
const vehiclesQuery = `query Vehicles($lat: Float!, $lon: Float!, $range: Int!, $formFactors: [FormFactor!], $count: Int!) {
  vehicles(lat: $lat, lon: $lon, range: $range, formFactors: $formFactors, count: $count) {
    id lat lon isReserved currentRangeMeters currentFuelPercent
    vehicleType { formFactor propulsionType }
    system { name { translation { language value } } }
  }
}`;

const stationsQuery = `query Stations($lat: Float!, $lon: Float!, $range: Int!, $count: Int!) {
  stations(lat: $lat, lon: $lon, range: $range, count: $count) {
    id lat lon numVehiclesAvailable
    name { translation { language value } }
    vehicleTypesAvailable { count vehicleType { formFactor } }
    system { name { translation { language value } } }
  }
}`;

function translated(name) {
  const t = name?.translation ?? [];
  return (t.find((x) => x.language === 'nb') ?? t[0])?.value ?? '';
}

export async function run(argv, opts = {}) {
  const { values, positionals } = parse(argv, options);
  if (values.help) return { lines: [help] };
  const [sub] = positionals;
  if (sub !== 'vehicles' && sub !== 'stations') {
    throw new UsageError(`mobility needs a subcommand: vehicles or stations (got '${sub ?? ''}')`);
  }
  const http = httpOpts(values, opts.fetchImpl);
  const variables = {
    lat: reqNum(values, 'lat'),
    lon: reqNum(values, 'lon'),
    range: num(values, 'range'),
    count: num(values, 'limit'),
  };

  if (sub === 'vehicles') {
    if (values['form-factor']) variables.formFactors = [values['form-factor'].toUpperCase()];
    const res = await graphql(ENDPOINTS.mobility, vehiclesQuery, variables, http);
    const data = (res.vehicles ?? []).map((v) => ({
      id: v.id,
      formFactor: v.vehicleType?.formFactor ?? '',
      propulsion: v.vehicleType?.propulsionType ?? '',
      lat: v.lat,
      lon: v.lon,
      reserved: v.isReserved ?? false,
      rangeMeters: v.currentRangeMeters ?? null,
      // API reports a 0..1 fraction; expose 0..100 as the name says.
      fuelPercent: v.currentFuelPercent != null ? Math.round(v.currentFuelPercent * 100) : null,
      system: translated(v.system?.name),
    }));
    const lines = data.length
      ? data.map((v) =>
          [
            v.id,
            v.formFactor.toLowerCase(),
            v.system,
            `${v.lat},${v.lon}`,
            v.fuelPercent != null ? `${v.fuelPercent}%` : '',
            v.reserved ? 'reserved' : '',
          ].filter(Boolean).join('  '),
        )
      : ['no vehicles found in range'];
    return { json: values.json, data, lines };
  }

  const res = await graphql(ENDPOINTS.mobility, stationsQuery, variables, http);
  const data = (res.stations ?? []).map((s) => ({
    id: s.id,
    name: translated(s.name),
    lat: s.lat,
    lon: s.lon,
    available: s.numVehiclesAvailable ?? 0,
    types: (s.vehicleTypesAvailable ?? []).map((t) => ({
      formFactor: t.vehicleType?.formFactor ?? '',
      count: t.count,
    })),
    system: translated(s.system?.name),
  }));
  const lines = data.length
    ? data.map((s) => `${s.id}  ${s.name}  ${s.available} available  ${s.lat},${s.lon}  (${s.system})`)
    : ['no stations found in range'];
  return { json: values.json, data, lines };
}
