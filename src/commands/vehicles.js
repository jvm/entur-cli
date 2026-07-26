import { UsageError } from '../errors.js';
import { ENDPOINTS, graphql } from '../http.js';
import { globalOptions, gqlEnum, gqlId, httpOpts, num, parse } from '../cli.js';
import { hhmm } from '../format.js';

export const help = `Usage: entur vehicles [options]

Real-time public transport vehicle positions (Entur Vehicle Positions API).
At least one filter is required; unfiltered output would be every vehicle in Norway.

Options:
  --codespace <id>   operator codespace, e.g. ATB, SKY, KOL (not all operators publish positions)
  --line <ref>       line ref, e.g. RUT:Line:1
  --mode <mode>      transport mode: bus, rail, tram, metro, ferry
  --bbox <a,b,c,d>   bounding box minLat,minLon,maxLat,maxLon
  --limit <n>        max vehicles shown (default 20)
  --json             JSON output
  -h, --help         this help

Example:
  entur vehicles --codespace ATB --mode bus --limit 5`;

const options = {
  ...globalOptions,
  codespace: { type: 'string' },
  line: { type: 'string' },
  mode: { type: 'string' },
  bbox: { type: 'string' },
  limit: { type: 'string', default: '20' },
};

export async function run(argv, opts = {}) {
  const { values } = parse(argv, options);
  if (values.help) return { lines: [help] };
  const http = httpOpts(values, opts.fetchImpl);

  const args = [];
  if (values.codespace) args.push(`codespaceId: "${gqlEnum(values.codespace, 'codespace')}"`);
  if (values.line) args.push(`lineRef: "${gqlId(values.line, 'line')}"`);
  if (values.mode) args.push(`mode: ${gqlEnum(values.mode.toUpperCase(), 'mode')}`);
  if (values.bbox) {
    const parts = values.bbox.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new UsageError(`--bbox must be minLat,minLon,maxLat,maxLon, got '${values.bbox}'`);
    }
    const [minLat, minLon, maxLat, maxLon] = parts;
    args.push(`boundingBox: { minLat: ${minLat}, minLon: ${minLon}, maxLat: ${maxLat}, maxLon: ${maxLon} }`);
  }
  if (!args.length) {
    throw new UsageError('at least one filter is required: --codespace, --line, --mode, or --bbox');
  }
  const query = `{
    vehicles(${args.join(', ')}) {
      vehicleId lastUpdated mode
      line { lineRef publicCode }
      location { latitude longitude }
      bearing speed delay occupancyStatus
    }
  }`;

  const res = await graphql(ENDPOINTS.vehicles, query, undefined, http);
  const limit = num(values, 'limit');
  const all = res.vehicles ?? [];
  const data = all.slice(0, limit).map((v) => ({
    vehicleId: v.vehicleId,
    line: v.line?.publicCode ?? v.line?.lineRef ?? '',
    mode: v.mode ?? '',
    lat: v.location?.latitude ?? null,
    lon: v.location?.longitude ?? null,
    bearing: v.bearing ?? null,
    speed: v.speed ?? null,
    delay: v.delay ?? null,
    occupancy: v.occupancyStatus ?? null,
    lastUpdated: v.lastUpdated,
  }));
  const lines = data.length
    ? data.map((v) =>
        [
          v.vehicleId,
          v.line,
          v.mode.toLowerCase(),
          `${v.lat},${v.lon}`,
          v.delay != null ? `delay ${v.delay}s` : '',
          v.occupancy ? v.occupancy.toLowerCase() : '',
          `@${hhmm(v.lastUpdated)}`,
        ].filter(Boolean).join('  '),
      )
    : ['no vehicles matched'];
  if (all.length > limit) lines.push(`(${all.length - limit} more; raise --limit or narrow filters)`);
  return { json: values.json, data, lines };
}
