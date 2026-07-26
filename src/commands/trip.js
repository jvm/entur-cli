import { UsageError } from '../errors.js';
import { ENDPOINTS, graphql } from '../http.js';
import { globalOptions, gqlEnum, gqlId, gqlTime, httpOpts, num, parse } from '../cli.js';
import { dur, hhmm } from '../format.js';
import { resolvePlace } from '../resolve.js';

export const help = `Usage: entur trip <from> <to> [options]

Plan a door-to-door journey (Entur Journey Planner v3).
<from>/<to> are NSR IDs or free text (quote multi-word names); free text is
resolved via the geocoder and the chosen places are reported on stderr.

Options:
  --time <iso>      depart at this time (ISO 8601; default now)
  --arrive-by       treat --time as latest arrival instead of departure
  --modes <a,b>     only these transport modes, e.g. bus,rail,metro
  --limit <n>       max trip alternatives (default 3)
  --json            JSON output
  -h, --help        this help

Example:
  entur trip "Oslo S" "Bergen stasjon" --time 2026-07-27T08:00:00+02:00`;

const options = {
  ...globalOptions,
  time: { type: 'string' },
  'arrive-by': { type: 'boolean', default: false },
  modes: { type: 'string' },
  limit: { type: 'string', default: '3' },
};

function placeArg(place) {
  if (/^NSR:/.test(place.id ?? '')) return `{ place: "${gqlId(place.id, 'place')}" }`;
  if (place.lat === undefined || place.lon === undefined) {
    throw new UsageError(`cannot use '${place.name}' as a trip endpoint (no NSR ID or coordinates)`);
  }
  return `{ coordinates: { latitude: ${place.lat}, longitude: ${place.lon} } }`;
}

export async function run(argv, opts = {}) {
  const { values, positionals } = parse(argv, options);
  if (values.help) return { lines: [help] };
  if (positionals.length !== 2) {
    throw new UsageError('trip needs exactly <from> and <to>; quote multi-word names, e.g.: entur trip "Oslo S" "Bergen stasjon"');
  }
  const http = httpOpts(values, opts.fetchImpl);
  http.stderr = opts.stderr;

  const [from, to] = [await resolvePlace(positionals[0], http), await resolvePlace(positionals[1], http)];
  const args = [
    `from: ${placeArg(from)}`,
    `to: ${placeArg(to)}`,
    `numTripPatterns: ${num(values, 'limit')}`,
  ];
  if (values.time) args.push(`dateTime: "${gqlTime(values.time)}"`);
  if (values['arrive-by']) args.push('arriveBy: true');
  if (values.modes) {
    const modes = values.modes.split(',').map((m) => `{ transportMode: ${gqlEnum(m.trim(), 'mode')} }`);
    args.push(`modes: { transportModes: [${modes.join(', ')}] }`);
  }
  const query = `{
    trip(${args.join(', ')}) {
      tripPatterns {
        duration expectedStartTime expectedEndTime
        legs {
          mode distance duration
          fromPlace { name }
          toPlace { name }
          line { publicCode name }
          expectedStartTime expectedEndTime
        }
      }
    }
  }`;

  const res = await graphql(ENDPOINTS.journeyPlanner, query, undefined, http);
  const data = {
    from: { id: from.id, name: from.name },
    to: { id: to.id, name: to.name },
    tripPatterns: (res.trip?.tripPatterns ?? []).map((p) => ({
      start: p.expectedStartTime,
      end: p.expectedEndTime,
      duration: p.duration,
      legs: (p.legs ?? []).map((l) => ({
        mode: l.mode,
        line: l.line?.publicCode ?? null,
        from: l.fromPlace?.name ?? '',
        to: l.toPlace?.name ?? '',
        start: l.expectedStartTime,
        end: l.expectedEndTime,
        distance: l.distance,
        duration: l.duration,
      })),
    })),
  };
  const lines = [];
  data.tripPatterns.forEach((p, i) => {
    lines.push(`${i + 1}) ${hhmm(p.start)} -> ${hhmm(p.end)}  (${dur(p.duration)})`);
    for (const l of p.legs) {
      const via = l.line ? `${l.mode} ${l.line}` : l.mode;
      lines.push(`   ${hhmm(l.start)}-${hhmm(l.end)}  ${via}: ${l.from} -> ${l.to}`);
    }
  });
  if (!lines.length) lines.push(`no trips found from ${from.name} to ${to.name}`);
  return { json: values.json, data, lines };
}
