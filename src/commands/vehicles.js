import { ApiError, UsageError } from '../errors.js';
import { ENDPOINTS, graphql } from '../http.js';
import {
  VEHICLE_MODES,
  enturId,
  globalHelp,
  globalOptions,
  gqlString,
  httpOpts,
  int,
  noPositionals,
  num,
  oneOf,
  parse,
  token,
} from '../cli.js';
import { hhmmOffset } from '../format.js';

export const help = `Usage: entur vehicles [options]

Real-time public transport vehicle positions (Entur Vehicle Positions API).
At least one filter is required; unfiltered output would be every vehicle in Norway.

Options:
  --codespace <id>   operator codespace, e.g. ATB, SKY, KOL
  --line <ref>       line ref, e.g. RUT:Line:1
  --mode <mode>      air, bus, coach, ferry, metro, rail, taxi, tram
  --bbox <a,b,c,d>   minLat,minLon,maxLat,maxLon
  --limit <n>        max vehicles returned (default 20, max 100)
${globalHelp}

Examples:
  entur vehicles --codespace ATB --mode bus --limit 5
  entur vehicles --bbox 59.8,10.5,60.0,10.9 --limit 20 --json`;

const options = {
  ...globalOptions,
  codespace: { type: 'string' },
  line: { type: 'string' },
  mode: { type: 'string' },
  bbox: { type: 'string' },
  limit: { type: 'string', default: '20' },
};

export async function run(argv, opts = {}) {
  const { values, positionals } = parse(argv, options);
  if (values.help) return { lines: [help] };
  noPositionals(positionals, 'vehicles');

  const limit = int(values, 'limit', { min: 1, max: 100 });
  const codespace = token(values.codespace, 'codespace', { normalize: (value) => value.toUpperCase() });
  const line = values.line === undefined ? undefined : enturId(values.line, 'line');
  const mode = oneOf(values.mode, 'mode', VEHICLE_MODES, { normalize: (value) => value.toLowerCase() });
  const bbox = values.bbox === undefined ? undefined : parseBbox(values.bbox);

  const args = [];
  if (codespace) args.push(`codespaceId: ${gqlString(codespace, 'codespace')}`);
  if (line) args.push(`lineRef: ${gqlString(line, 'line')}`);
  if (mode) args.push(`mode: ${mode.toUpperCase()}`);
  if (bbox) {
    args.push(`boundingBox: { minLat: ${bbox.minLat}, minLon: ${bbox.minLon}, maxLat: ${bbox.maxLat}, maxLon: ${bbox.maxLon} }`);
  }
  if (!args.length) {
    throw new UsageError('at least one filter is required: --codespace, --line, --mode, or --bbox', {
      code: 'missing_argument',
      field: 'filter',
      hint: "Try: entur vehicles --codespace ATB --limit 5",
    });
  }

  const res = await graphql(ENDPOINTS.vehicles, `{
    vehicles(${args.join(', ')}) {
      vehicleId lastUpdated mode
      line { lineRef publicCode }
      location { latitude longitude }
      bearing speed delay occupancyStatus
    }
  }`, undefined, httpOpts(values, opts));
  if (!Array.isArray(res.vehicles)) throw invalidResponse();

  const all = res.vehicles;
  const data = all.slice(0, limit).map((vehicle) => {
    if (!vehicle || vehicle.vehicleId === undefined) throw invalidResponse();
    return {
      vehicleId: String(vehicle.vehicleId),
      line: vehicle.line?.publicCode ?? vehicle.line?.lineRef ?? '',
      mode: vehicle.mode ?? '',
      lat: vehicle.location?.latitude ?? null,
      lon: vehicle.location?.longitude ?? null,
      bearing: vehicle.bearing ?? null,
      speed: vehicle.speed ?? null,
      delay: vehicle.delay ?? null,
      occupancy: vehicle.occupancyStatus ?? null,
      lastUpdated: vehicle.lastUpdated ?? null,
    };
  });
  const lines = data.length
    ? data.map((vehicle) =>
        [
          vehicle.vehicleId,
          vehicle.line,
          vehicle.mode.toLowerCase(),
          vehicle.lat != null && vehicle.lon != null ? `${vehicle.lat},${vehicle.lon}` : '',
          vehicle.delay != null ? `delay ${vehicle.delay}s` : '',
          vehicle.occupancy ? humanEnum(vehicle.occupancy) : '',
          vehicle.lastUpdated ? `@${hhmmOffset(vehicle.lastUpdated)}` : '',
        ].filter(Boolean).join('  '),
      )
    : ['no vehicles matched'];
  const hasMore = all.length > data.length;
  if (hasMore) lines.push(`(${all.length - data.length} more; raise --limit or narrow filters)`);
  return {
    json: values.json,
    data,
    lines,
    meta: {
      count: data.length,
      totalCount: all.length,
      limit,
      hasMore,
      truncated: hasMore,
    },
  };
}

function parseBbox(value) {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => !part)) {
    throw invalidBbox();
  }
  const minLat = num({ bbox: parts[0] }, 'bbox', { min: -90, max: 90 });
  const minLon = num({ bbox: parts[1] }, 'bbox', { min: -180, max: 180 });
  const maxLat = num({ bbox: parts[2] }, 'bbox', { min: -90, max: 90 });
  const maxLon = num({ bbox: parts[3] }, 'bbox', { min: -180, max: 180 });
  if (minLat >= maxLat || minLon >= maxLon) throw invalidBbox();
  return { minLat, minLon, maxLat, maxLon };
}

function invalidBbox() {
  return new UsageError('--bbox must be ordered minLat,minLon,maxLat,maxLon', {
    code: 'invalid_argument',
    field: 'bbox',
    hint: 'Latitude must be -90..90, longitude -180..180, and each minimum must be below its maximum.',
  });
}

function humanEnum(value) {
  return String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase();
}

function invalidResponse() {
  return new ApiError('invalid Vehicle Positions response', {
    code: 'invalid_response',
    retryable: true,
    hint: 'Retry once; report the endpoint response if it persists.',
  });
}
