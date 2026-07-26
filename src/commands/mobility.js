import { ApiError, UsageError } from '../errors.js';
import { ENDPOINTS, graphql } from '../http.js';
import {
  MOBILITY_FORM_FACTORS,
  exactPositionals,
  globalHelp,
  globalOptions,
  httpOpts,
  int,
  oneOf,
  parse,
  reqNum,
} from '../cli.js';

export const help = `Usage: entur mobility <vehicles|stations> --lat <n> --lon <n> [options]

Shared mobility (city bikes, scooters, cars) near a coordinate (Entur Mobility v2).

Subcommands:
  vehicles   free-floating vehicles
  stations   docking stations with availability

Options:
  --lat <n> --lon <n>    center coordinate (required)
  --range <m>            search radius in meters (default 500, max 2000)
  --form-factor <f>      bicycle,cargo_bicycle,car,moped,scooter,
                         scooter_standing,scooter_seated,other
  --limit <n>            max results (default 20, max 50)
${globalHelp}

Examples:
  entur mobility vehicles --lat 59.911 --lon 10.750 --form-factor scooter --limit 5
  entur mobility stations --lat 59.911 --lon 10.750 --form-factor bicycle --json`;

const options = {
  ...globalOptions,
  lat: { type: 'string' },
  lon: { type: 'string' },
  range: { type: 'string', default: '500' },
  'form-factor': { type: 'string' },
  limit: { type: 'string', default: '20' },
};

const vehiclesQuery = `query Vehicles($lat: Float!, $lon: Float!, $range: Int!, $formFactors: [FormFactor!], $count: Int!) {
  vehicles(lat: $lat, lon: $lon, range: $range, formFactors: $formFactors, count: $count) {
    id lat lon isReserved currentRangeMeters currentFuelPercent
    vehicleType { formFactor propulsionType }
    system { name { translation { language value } } }
  }
}`;

const stationsQuery = `query Stations($lat: Float!, $lon: Float!, $range: Int!, $formFactors: [FormFactor!], $count: Int!) {
  stations(lat: $lat, lon: $lon, range: $range, availableFormFactors: $formFactors, count: $count) {
    id lat lon numVehiclesAvailable
    name { translation { language value } }
    vehicleTypesAvailable { count vehicleType { formFactor } }
    system { name { translation { language value } } }
  }
}`;

function translated(name) {
  const translations = name?.translation;
  if (!Array.isArray(translations)) return '';
  return (translations.find((item) => item?.language === 'nb') ?? translations[0])?.value ?? '';
}

export async function run(argv, opts = {}) {
  const { values, positionals } = parse(argv, options);
  if (values.help) return { lines: [help] };
  exactPositionals(
    positionals,
    1,
    'mobility needs exactly one subcommand: vehicles or stations',
  );
  const [sub] = positionals;
  if (sub !== 'vehicles' && sub !== 'stations') {
    throw new UsageError('mobility needs a subcommand: vehicles or stations', {
      code: 'invalid_argument',
      field: 'subcommand',
      allowedValues: ['vehicles', 'stations'],
    });
  }

  const limit = int(values, 'limit', { min: 1, max: 50 });
  const range = int(values, 'range', { min: 1, max: 2000 });
  const formFactor = oneOf(values['form-factor'], 'form-factor', MOBILITY_FORM_FACTORS, {
    normalize: (value) => value.toLowerCase(),
  });
  const variables = {
    lat: reqNum(values, 'lat', { min: -90, max: 90 }),
    lon: reqNum(values, 'lon', { min: -180, max: 180 }),
    range,
    count: limit,
  };
  if (formFactor) variables.formFactors = [formFactor.toUpperCase()];
  const http = httpOpts(values, opts);

  if (sub === 'vehicles') {
    const res = await graphql(ENDPOINTS.mobility, vehiclesQuery, variables, http);
    if (!Array.isArray(res.vehicles)) throw invalidResponse('vehicles');
    const data = res.vehicles.map((vehicle) => {
      if (!vehicle?.id || !Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) {
        throw invalidResponse('vehicles');
      }
      if (vehicle.currentFuelPercent != null && !Number.isFinite(vehicle.currentFuelPercent)) {
        throw invalidResponse('vehicles');
      }
      return {
        id: vehicle.id,
        formFactor: vehicle.vehicleType?.formFactor ?? '',
        propulsion: vehicle.vehicleType?.propulsionType ?? '',
        lat: vehicle.lat,
        lon: vehicle.lon,
        reserved: vehicle.isReserved ?? false,
        rangeMeters: vehicle.currentRangeMeters ?? null,
        // API reports a 0..1 fraction; expose 0..100 as the field name promises.
        fuelPercent: vehicle.currentFuelPercent != null ? Math.round(vehicle.currentFuelPercent * 100) : null,
        system: translated(vehicle.system?.name),
      };
    });
    const lines = data.length
      ? data.map((vehicle) =>
          [
            vehicle.id,
            vehicle.formFactor.toLowerCase(),
            vehicle.system,
            `${vehicle.lat},${vehicle.lon}`,
            vehicle.fuelPercent != null ? `${vehicle.fuelPercent}%` : '',
            vehicle.reserved ? 'reserved' : '',
          ].filter(Boolean).join('  '),
        )
      : ['no vehicles found in range'];
    return {
      json: values.json,
      data,
      lines,
      meta: { subcommand: sub, count: data.length, limit, rangeMeters: range },
    };
  }

  const res = await graphql(ENDPOINTS.mobility, stationsQuery, variables, http);
  if (!Array.isArray(res.stations)) throw invalidResponse('stations');
  const data = res.stations.map((station) => {
    if (
      !station?.id
      || !Number.isFinite(station.lat)
      || !Number.isFinite(station.lon)
      || !Array.isArray(station.vehicleTypesAvailable ?? [])
    ) throw invalidResponse('stations');
    return {
      id: station.id,
      name: translated(station.name),
      lat: station.lat,
      lon: station.lon,
      available: station.numVehiclesAvailable ?? 0,
      types: (station.vehicleTypesAvailable ?? []).map((type) => ({
        formFactor: type?.vehicleType?.formFactor ?? '',
        count: type?.count ?? 0,
      })),
      system: translated(station.system?.name),
    };
  });
  const lines = data.length
    ? data.map((station) => `${station.id}  ${station.name}  ${station.available} available  ${station.lat},${station.lon}  (${station.system})`)
    : ['no stations found in range'];
  return {
    json: values.json,
    data,
    lines,
    meta: { subcommand: sub, count: data.length, limit, rangeMeters: range },
  };
}

function invalidResponse(resource) {
  return new ApiError(`invalid Mobility ${resource} response`, {
    code: 'invalid_response',
    retryable: true,
    hint: 'Retry once; report the endpoint response if it persists.',
  });
}
