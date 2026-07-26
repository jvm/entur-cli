import { UsageError } from '../errors.js';
import { ENDPOINTS, request } from '../http.js';
import { globalOptions, httpOpts, num, parse, reqNum } from '../cli.js';
import { placeName } from '../resolve.js';

export const help = `Usage: entur geocode <search|reverse> [options]

Find Norwegian stops, addresses, and points of interest (Entur Geocoder v3).

Subcommands:
  search <query...>   text search / autocomplete
  reverse             places near a coordinate

Options:
  --lat <n> --lon <n>   search: focus point boosting nearby results; reverse: required center
  --radius <km>         reverse only: search radius in km (default 1)
  --limit <n>           max results (default 10)
  --layers <a,b>        search only: restrict layers, e.g. venue,address
  --json                JSON output
  -h, --help            this help

Examples:
  entur geocode search "Oslo S" --limit 3
  entur geocode reverse --lat 59.911 --lon 10.750 --radius 0.5`;

const options = {
  ...globalOptions,
  lat: { type: 'string' },
  lon: { type: 'string' },
  radius: { type: 'string', default: '1' },
  limit: { type: 'string', default: '10' },
  layers: { type: 'string' },
};

export async function run(argv, opts = {}) {
  const { values, positionals } = parse(argv, options);
  if (values.help) return { lines: [help] };
  const [sub, ...rest] = positionals;
  const http = httpOpts(values, opts.fetchImpl);

  let url;
  if (sub === 'search') {
    const q = rest.join(' ').trim();
    if (!q) throw new UsageError('search needs a query, e.g.: entur geocode search "Oslo S"');
    const params = new URLSearchParams({ q, limit: String(num(values, 'limit')) });
    if (values.lat !== undefined || values.lon !== undefined) {
      params.set('lat', String(reqNum(values, 'lat')));
      params.set('lon', String(reqNum(values, 'lon')));
    }
    if (values.layers) params.set('layers', values.layers);
    url = `${ENDPOINTS.geocoder}/autocomplete?${params}`;
  } else if (sub === 'reverse') {
    const params = new URLSearchParams({
      lat: String(reqNum(values, 'lat')),
      lon: String(reqNum(values, 'lon')),
      radius: String(num(values, 'radius')),
      limit: String(num(values, 'limit')),
    });
    url = `${ENDPOINTS.geocoder}/reverse?${params}`;
  } else {
    throw new UsageError(`geocode needs a subcommand: search or reverse (got '${sub ?? ''}')`);
  }

  const geo = await request(url, http);
  const data = (geo.features ?? []).map((f) => ({
    id: f.properties?.id ?? null,
    label: placeName(f.properties),
    layer: f.properties?.layer ?? '',
    lat: f.geometry?.coordinates?.[1] ?? null,
    lon: f.geometry?.coordinates?.[0] ?? null,
  }));
  const lines = data.length
    ? data.map((p) => `${p.id ?? '-'}  ${p.label} [${p.layer}]`)
    : ['no results'];
  return { json: values.json, data, lines };
}
