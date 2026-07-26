import { ApiError, UsageError } from '../errors.js';
import { ENDPOINTS, request } from '../http.js';
import {
  GEOCODER_LAYERS,
  csvOf,
  globalHelp,
  globalOptions,
  httpOpts,
  int,
  num,
  parse,
  reqNum,
} from '../cli.js';
import { placeName } from '../resolve.js';

export const help = `Usage: entur geocode <search|reverse> [options]

Find Norwegian stops, addresses, and points of interest (Entur Geocoder v3).

Subcommands:
  search <query...>   text search / autocomplete
  reverse             places near a coordinate

Options:
  --lat <n> --lon <n>   search focus point; reverse required center
  --radius <km>         search focus radius; reverse search radius (default 1)
  --limit <n>           max results (default 10, max 100)
  --layers <a,b>        layers: address,street,stopPlace,groupOfStopPlaces,poi,place
${globalHelp}

Examples:
  entur geocode search "Oslo S" --layers stopPlace --limit 3
  entur geocode reverse --lat 59.911 --lon 10.750 --radius 0.5 --layers stopPlace`;

const options = {
  ...globalOptions,
  lat: { type: 'string' },
  lon: { type: 'string' },
  radius: { type: 'string' },
  limit: { type: 'string', default: '10' },
  layers: { type: 'string' },
};

export async function run(argv, opts = {}) {
  const { values, positionals } = parse(argv, options);
  if (values.help) return { lines: [help] };
  const [sub, ...rest] = positionals;
  const limit = int(values, 'limit', { min: 1, max: 100 });
  const layers = csvOf(values.layers, 'layers', GEOCODER_LAYERS);

  let url;
  if (sub === 'search') {
    const q = rest.join(' ').trim();
    if (!q) {
      throw new UsageError('search needs a query, e.g.: entur geocode search "Oslo S"', {
        code: 'missing_argument',
        field: 'query',
      });
    }
    if (q.length > 500 || /[\u0000-\u001f\u007f]/.test(q)) {
      throw new UsageError('search query must be at most 500 characters without control characters', {
        code: 'invalid_argument',
        field: 'query',
      });
    }
    const params = new URLSearchParams({ q, limit: String(limit) });
    const hasFocus = values.lat !== undefined || values.lon !== undefined;
    if (hasFocus) {
      params.set('lat', String(reqNum(values, 'lat', { min: -90, max: 90 })));
      params.set('lon', String(reqNum(values, 'lon', { min: -180, max: 180 })));
    }
    if (values.radius !== undefined) {
      if (!hasFocus) {
        throw new UsageError('--radius on search requires both --lat and --lon', {
          code: 'missing_argument',
          field: 'radius',
          hint: 'Pass --lat and --lon with --radius, or omit --radius.',
        });
      }
      params.set('radius', String(num(values, 'radius', { min: 0 })));
    }
    if (layers) params.set('layers', layers.join(','));
    url = `${ENDPOINTS.geocoder}/autocomplete?${params}`;
  } else if (sub === 'reverse') {
    if (rest.length) {
      throw new UsageError('reverse does not accept positional arguments', {
        code: 'unexpected_argument',
        field: 'arguments',
      });
    }
    const params = new URLSearchParams({
      lat: String(reqNum(values, 'lat', { min: -90, max: 90 })),
      lon: String(reqNum(values, 'lon', { min: -180, max: 180 })),
      radius: String(num(values, 'radius', { min: 0 }) ?? 1),
      limit: String(limit),
    });
    if (layers) params.set('layers', layers.join(','));
    url = `${ENDPOINTS.geocoder}/reverse?${params}`;
  } else {
    throw new UsageError('geocode needs a subcommand: search or reverse', {
      code: 'invalid_argument',
      field: 'subcommand',
      allowedValues: ['search', 'reverse'],
    });
  }

  const geo = await request(url, httpOpts(values, opts));
  if (!Array.isArray(geo.features)) throw invalidResponse();
  const data = geo.features.map((feature) => {
    const properties = feature?.properties;
    const coordinates = feature?.geometry?.coordinates;
    const lat = coordinates?.[1];
    const lon = coordinates?.[0];
    if (
      !properties
      || !Array.isArray(coordinates)
      || !Number.isFinite(lat)
      || !Number.isFinite(lon)
    ) throw invalidResponse();
    return {
      id: properties.id ?? null,
      label: placeName(properties),
      layer: properties.layer ?? '',
      lat,
      lon,
    };
  });
  const lines = data.length
    ? data.map((place) => `${place.id ?? '-'}  ${place.label} [${place.layer}]`)
    : ['no results'];
  return {
    json: values.json,
    data,
    lines,
    meta: { subcommand: sub, count: data.length, limit },
  };
}

function invalidResponse() {
  return new ApiError('invalid Geocoder response', {
    code: 'invalid_response',
    retryable: true,
    hint: 'Retry once; report the endpoint response if it persists.',
  });
}
