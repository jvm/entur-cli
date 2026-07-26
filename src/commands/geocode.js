import { UsageError } from '../errors.js';
import { normalizeGeocoderResult } from '../geocoder.js';
import { ENDPOINTS, request } from '../http.js';
import {
  GEOCODER_LAYERS,
  GEOCODER_MULTIMODAL,
  GEOCODER_SOURCES,
  GEOCODER_STOP_PLACE_TYPES,
  csvOf,
  enturId,
  globalHelp,
  globalOptions,
  httpOpts,
  int,
  num,
  oneOf,
  parse,
  reqNum,
} from '../cli.js';
import { inlineSafe } from '../output.js';

export const help = `Usage: entur geocode <search|reverse|place> [arguments] [options]

Find Norwegian stops, addresses, and points of interest (Entur Geocoder v3).

Subcommands:
  search [query...]   autocomplete; query may be omitted when a filter is supplied
  reverse             places near --lat/--lon
  place <id...>       look up one or more exact place IDs (max 100)

Search options:
  --lat <n> --lon <n>       focus point (must be supplied together)
  --radius <km>             focus radius; requires --lat and --lon (API default 50)
  --weight <0..1>           focus strength; requires --lat and --lon (API default 0.5)
  --bbox <a,b,c,d>          hard filter: minLon,minLat,maxLon,maxLat

Reverse options:
  --lat <n> --lon <n>       required center
  --radius <km>             radius; omitted means no radius limit
  --distance-sort <bool>    true for distance order, false for relevance (default true)

Search and reverse filters:
  --layers <a,b>            address,street,stopPlace,groupOfStopPlaces,poi,place
  --stop-place-types <a,b>  onstreetBus,onstreetTram,airport,railStation,metroStation,
                            busStation,coachStation,tramStation,harbourPort,ferryPort,
                            ferryStop,liftStation,vehicleRailInterchange,other
  --sources <a,b>           openstreetmap,kartverket-matrikkelenadresse,
                            kartverket-stedsnavn,nsr,custom-poi
  --countries <a,b>         ISO 3166-1 alpha-2 codes, e.g. no,se
  --counties <id,...>       county IDs
  --localities <id,...>     locality IDs
  --fare-zones <id,...>     FareZone IDs, e.g. RUT:FareZone:4
  --fare-zone-authorities <id,...>  authority IDs, e.g. RUT:Authority:RUT
  --multimodal <mode>       parent, child, or all (default parent)

Common options:
  --limit <n>               max search/reverse results (default 10, max 100)
  --lang <code>             result-name language (API default no)
  --correlation-id <id>     X-Correlation-Id request trace value
${globalHelp}

Examples:
  entur geocode search "Oslo S" --layers stopPlace --limit 3
  entur geocode search --stop-place-types airport --limit 20 --json
  entur geocode reverse --lat 59.911 --lon 10.750 --radius 0.5 --layers stopPlace
  entur geocode place NSR:StopPlace:59872 KVE:PlaceName:434810 --json`;

const options = {
  ...globalOptions,
  lat: { type: 'string' },
  lon: { type: 'string' },
  radius: { type: 'string' },
  weight: { type: 'string' },
  bbox: { type: 'string' },
  limit: { type: 'string' },
  lang: { type: 'string' },
  layers: { type: 'string' },
  'stop-place-types': { type: 'string' },
  sources: { type: 'string' },
  countries: { type: 'string' },
  counties: { type: 'string' },
  localities: { type: 'string' },
  'fare-zones': { type: 'string' },
  'fare-zone-authorities': { type: 'string' },
  multimodal: { type: 'string' },
  'distance-sort': { type: 'string' },
  'correlation-id': { type: 'string' },
};

const DOMAIN_OPTIONS = Object.freeze([
  'lat',
  'lon',
  'radius',
  'weight',
  'bbox',
  'limit',
  'lang',
  'layers',
  'stop-place-types',
  'sources',
  'countries',
  'counties',
  'localities',
  'fare-zones',
  'fare-zone-authorities',
  'multimodal',
  'distance-sort',
  'correlation-id',
]);

const SEARCH_OPTIONS = new Set(DOMAIN_OPTIONS.filter((name) => name !== 'distance-sort'));
const REVERSE_OPTIONS = new Set(DOMAIN_OPTIONS.filter((name) => !['weight', 'bbox'].includes(name)));
const PLACE_OPTIONS = new Set(['lang', 'correlation-id']);

export async function run(argv, opts = {}) {
  const { values, positionals } = parse(argv, options);
  const [sub, ...rest] = positionals;
  if (values.help) return { lines: [help] };

  let requestInfo;
  if (sub === 'search') {
    rejectUnsupportedOptions(values, SEARCH_OPTIONS, sub);
    requestInfo = searchRequest(rest, values);
  } else if (sub === 'reverse') {
    rejectUnsupportedOptions(values, REVERSE_OPTIONS, sub);
    requestInfo = reverseRequest(rest, values);
  } else if (sub === 'place') {
    rejectUnsupportedOptions(values, PLACE_OPTIONS, sub);
    requestInfo = placeRequest(rest, values);
  } else {
    throw new UsageError('geocode needs a subcommand: search, reverse, or place', {
      code: 'invalid_argument',
      field: 'subcommand',
      allowedValues: ['search', 'reverse', 'place'],
      hint: "Run 'entur geocode --help' for examples.",
    });
  }

  const raw = await request(requestInfo.url, httpOpts(values, opts));
  const result = normalizeGeocoderResult(raw);
  const data = result.features;
  const mayHaveMore = requestInfo.limit !== undefined && data.length === requestInfo.limit;
  const lines = data.length
    ? data.map(formatPlace)
    : ['no results'];
  if (mayHaveMore) {
    lines.push(requestInfo.limit < 100
      ? `(result limit reached; raise --limit up to 100 or narrow filters)`
      : '(result limit reached; narrow filters to find additional matches)');
  }

  const meta = {
    subcommand: sub,
    count: data.length,
  };
  if (requestInfo.limit !== undefined) {
    meta.limit = requestInfo.limit;
    meta.mayHaveMore = mayHaveMore;
  }
  if (requestInfo.requestedCount !== undefined) meta.requestedCount = requestInfo.requestedCount;
  meta.geocoder = {
    type: result.type,
    metadata: result.metadata,
  };
  if (result.bbox !== undefined) meta.geocoder.bbox = result.bbox;

  return {
    json: values.json,
    data,
    lines,
    meta,
  };
}

function searchRequest(words, values) {
  const query = words.join(' ').trim() || undefined;
  if (query !== undefined && (query.length > 500 || /[\u0000-\u001f\u007f]/.test(query))) {
    throw new UsageError('search query must be at most 500 characters without control characters', {
      code: 'invalid_argument',
      field: 'query',
    });
  }

  const focusSupplied = ['lat', 'lon', 'radius', 'weight'].some((name) => values[name] !== undefined);
  let lat;
  let lon;
  if (focusSupplied) {
    lat = reqNum(values, 'lat', { min: -90, max: 90 });
    lon = reqNum(values, 'lon', { min: -180, max: 180 });
  }
  const radius = num(values, 'radius', { min: 0 });
  const weight = num(values, 'weight', { min: 0, max: 1 });
  const bbox = values.bbox === undefined ? undefined : parseBbox(values.bbox);
  const limit = int(values, 'limit', { min: 1, max: 100 }) ?? 10;
  const lang = language(values.lang);
  const filters = filterValues(values);

  if (query === undefined && bbox === undefined && !hasFilter(filters)) {
    throw new UsageError('search needs a query or at least one place filter', {
      code: 'missing_argument',
      field: 'query',
      hint: 'Pass a query, or list matches with a filter such as --stop-place-types airport.',
    });
  }

  const params = new URLSearchParams();
  if (query !== undefined) params.set('q', query);
  if (focusSupplied) {
    params.set('lat', String(lat));
    params.set('lon', String(lon));
  }
  if (radius !== undefined) params.set('radius', String(radius));
  if (weight !== undefined) params.set('weight', String(weight));
  if (bbox !== undefined) params.set('bbox', bbox);
  params.set('limit', String(limit));
  if (lang !== undefined) params.set('lang', lang);
  appendFilters(params, filters);
  return { url: `${ENDPOINTS.geocoder}/autocomplete?${params}`, limit };
}

function reverseRequest(positionals, values) {
  if (positionals.length) {
    throw new UsageError('reverse does not accept positional arguments', {
      code: 'unexpected_argument',
      field: 'arguments',
      hint: 'Pass the center with --lat and --lon.',
    });
  }

  const lat = reqNum(values, 'lat', { min: -90, max: 90 });
  const lon = reqNum(values, 'lon', { min: -180, max: 180 });
  const radius = num(values, 'radius', { min: 0 });
  const distanceSort = booleanValue(values['distance-sort'], 'distance-sort');
  const limit = int(values, 'limit', { min: 1, max: 100 }) ?? 10;
  const lang = language(values.lang);
  const filters = filterValues(values);

  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (radius !== undefined) params.set('radius', String(radius));
  if (distanceSort !== undefined) params.set('distanceSort', String(distanceSort));
  params.set('limit', String(limit));
  if (lang !== undefined) params.set('lang', lang);
  appendFilters(params, filters);
  return { url: `${ENDPOINTS.geocoder}/reverse?${params}`, limit };
}

function placeRequest(positionals, values) {
  const ids = placeIds(positionals);
  const params = new URLSearchParams({ ids: ids.join(',') });
  const lang = language(values.lang);
  if (lang !== undefined) params.set('lang', lang);
  return {
    url: `${ENDPOINTS.geocoder}/place?${params}`,
    requestedCount: ids.length,
  };
}

function filterValues(values) {
  const layers = csvOf(values.layers, 'layers', GEOCODER_LAYERS);
  const stopPlaceTypes = csvOf(
    values['stop-place-types'],
    'stop-place-types',
    GEOCODER_STOP_PLACE_TYPES,
  );
  if (layers && stopPlaceTypes && !layers.includes('stopPlace')) {
    throw new UsageError('--stop-place-types requires --layers to include stopPlace when both are supplied', {
      code: 'invalid_argument',
      field: 'stop-place-types',
      hint: 'Add stopPlace to --layers, or omit --layers to return only matching stop places.',
    });
  }

  return {
    layers,
    stopPlaceTypes,
    sources: csvOf(values.sources, 'sources', GEOCODER_SOURCES, {
      normalize: (value) => value.toLowerCase(),
    }),
    countries: csvValues(values.countries, 'countries', countryCode),
    counties: csvValues(values.counties, 'counties', (value) => enturId(value, 'counties')),
    localities: csvValues(values.localities, 'localities', (value) => enturId(value, 'localities')),
    fareZones: csvValues(
      values['fare-zones'],
      'fare-zones',
      (value) => enturId(value, 'fare-zones', { types: ['FareZone'] }),
    ),
    fareZoneAuthorities: csvValues(
      values['fare-zone-authorities'],
      'fare-zone-authorities',
      (value) => enturId(value, 'fare-zone-authorities'),
    ),
    multimodal: oneOf(values.multimodal, 'multimodal', GEOCODER_MULTIMODAL, {
      normalize: (value) => value.toLowerCase(),
    }),
  };
}

function appendFilters(params, filters) {
  for (const [name, value] of Object.entries(filters)) {
    if (Array.isArray(value)) params.set(name, value.join(','));
    else if (value !== undefined) params.set(name, value);
  }
}

function hasFilter(filters) {
  return Object.values(filters).some((value) => value !== undefined);
}

function placeIds(positionals) {
  if (!positionals.length) {
    throw new UsageError('place needs at least one ID', {
      code: 'missing_argument',
      field: 'ids',
      hint: 'Try: entur geocode place NSR:StopPlace:59872',
    });
  }

  const rawIds = [];
  for (const positional of positionals) {
    const parts = positional.split(',').map((value) => value.trim());
    if (parts.some((value) => !value)) {
      throw new UsageError('place IDs must not contain empty comma-separated values', {
        code: 'invalid_argument',
        field: 'ids',
      });
    }
    rawIds.push(...parts);
  }
  const ids = [...new Set(rawIds.map((value) => enturId(value, 'id')))];
  if (ids.length > 100) {
    throw new UsageError(`place accepts at most 100 IDs, got ${ids.length}`, {
      code: 'invalid_argument',
      field: 'ids',
      hint: 'Split the IDs across requests of at most 100 each.',
    });
  }
  return ids;
}

function language(value) {
  if (value === undefined) return undefined;
  const normalized = String(value).trim();
  if (
    !normalized
    || normalized.length > 64
    || /[\s\u007f]/.test(normalized)
  ) {
    throw new UsageError(`--lang must be a non-empty language code of at most 64 characters, got '${inlineSafe(value)}'`, {
      code: 'invalid_argument',
      field: 'lang',
      hint: 'Pass a language code accepted by Geocoder v3, such as no or en.',
    });
  }
  return normalized;
}

function countryCode(value) {
  const normalized = value.toLowerCase();
  if (!/^[a-z]{2}$/.test(normalized)) {
    throw new UsageError(`--countries values must be ISO 3166-1 alpha-2 codes, got '${inlineSafe(value)}'`, {
      code: 'invalid_argument',
      field: 'countries',
      hint: 'Pass lowercase or uppercase two-letter codes such as no,se.',
    });
  }
  return normalized;
}

function csvValues(value, name, normalize) {
  if (value === undefined) return undefined;
  const parts = String(value).split(',').map((item) => item.trim());
  if (!parts.length || parts.some((item) => !item)) {
    throw new UsageError(`--${name} must be a comma-separated list without empty values`, {
      code: 'invalid_argument',
      field: name,
    });
  }
  return [...new Set(parts.map(normalize))];
}

function booleanValue(value, name) {
  const normalized = oneOf(value, name, ['true', 'false'], {
    normalize: (item) => item.toLowerCase(),
  });
  return normalized === undefined ? undefined : normalized === 'true';
}

function parseBbox(value) {
  const parts = String(value).split(',').map((part) => part.trim());
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (parts.length !== 4 || parts.some((part) => !decimal.test(part))) throw invalidBbox();

  const minLon = num({ bbox: parts[0] }, 'bbox', { min: -180, max: 180 });
  const minLat = num({ bbox: parts[1] }, 'bbox', { min: -90, max: 90 });
  const maxLon = num({ bbox: parts[2] }, 'bbox', { min: -180, max: 180 });
  const maxLat = num({ bbox: parts[3] }, 'bbox', { min: -90, max: 90 });
  if (minLon >= maxLon || minLat >= maxLat) throw invalidBbox();
  return [minLon, minLat, maxLon, maxLat].join(',');
}

function invalidBbox() {
  return new UsageError('--bbox must be ordered minLon,minLat,maxLon,maxLat', {
    code: 'invalid_argument',
    field: 'bbox',
    hint: 'Longitude must be -180..180, latitude -90..90, and each minimum must be below its maximum.',
  });
}

function rejectUnsupportedOptions(values, allowed, subcommand) {
  const unsupported = DOMAIN_OPTIONS.find((name) => values[name] !== undefined && !allowed.has(name));
  if (unsupported === undefined) return;
  throw new UsageError(`--${unsupported} is not supported by geocode ${subcommand}`, {
    code: 'invalid_argument',
    field: unsupported,
    hint: "Run 'entur geocode --help' for endpoint-specific options.",
  });
}

function formatPlace(place) {
  return [
    place.id,
    `${place.label} [${place.layer}]`,
    place.distance === undefined ? undefined : `${place.distance} km`,
  ].filter(Boolean).join('  ');
}
