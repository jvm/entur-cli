import { ApiError, UsageError } from '../errors.js';
import { ENDPOINTS, graphql } from '../http.js';
import {
  JOURNEY_MODES,
  csvOf,
  exactPositionals,
  globalHelp,
  globalOptions,
  gqlString,
  gqlTime,
  httpOpts,
  int,
  parse,
} from '../cli.js';
import { dur, hhmm } from '../format.js';
import { resolvePlace } from '../resolve.js';

export const help = `Usage: entur trip <from> <to> [options]

Plan a door-to-door journey (Entur Journey Planner v3).
<from>/<to> are Entur IDs or free text; quote multi-word names. Free text is
resolved via the geocoder and the chosen places are reported on stderr.

Options:
  --time <iso>      depart at an offset-aware ISO 8601 time (default now)
  --arrive-by       treat --time as latest arrival instead of departure
  --modes <a,b>     transit modes: air,bus,cableway,water,funicular,lift,rail,
                    metro,taxi,tram,trolleybus,monorail,coach,unknown
  --limit <n>       max trip alternatives (default 3, max 50)
${globalHelp}

Examples:
  entur trip "Oslo S" "Bergen stasjon" --limit 1
  entur trip NSR:StopPlace:59872 NSR:StopPlace:59983 --modes rail --limit 1 --json`;

const options = {
  ...globalOptions,
  time: { type: 'string' },
  'arrive-by': { type: 'boolean', default: false },
  modes: { type: 'string' },
  limit: { type: 'string', default: '3' },
};

function placeArg(place) {
  if (/^NSR:/.test(place.id ?? '')) return `{ place: ${gqlString(place.id, 'place')} }`;
  if (
    !Number.isFinite(place.lat)
    || place.lat < -90
    || place.lat > 90
    || !Number.isFinite(place.lon)
    || place.lon < -180
    || place.lon > 180
  ) {
    throw new UsageError(`cannot use '${place.name}' as a trip endpoint (no routable ID or coordinates)`, {
      code: 'invalid_argument',
      field: 'place',
      hint: 'Use free text, an NSR ID, or a place returned by geocode search.',
    });
  }
  return `{ coordinates: { latitude: ${place.lat}, longitude: ${place.lon} } }`;
}

export async function run(argv, opts = {}) {
  const { values, positionals } = parse(argv, options);
  if (values.help) return { lines: [help] };
  exactPositionals(
    positionals,
    2,
    'trip needs exactly <from> and <to>; quote multi-word names, e.g.: entur trip "Oslo S" "Bergen stasjon"',
  );

  // Validate every local option before spending geocoder/API quota.
  const limit = int(values, 'limit', { min: 1, max: 50 });
  const time = values.time === undefined ? undefined : gqlTime(values.time);
  const modes = csvOf(values.modes, 'modes', JOURNEY_MODES);
  const http = httpOpts(values, opts);

  const from = await resolvePlace(positionals[0], { ...http, stderr: opts.stderr, what: 'from' });
  const to = await resolvePlace(positionals[1], { ...http, stderr: opts.stderr, what: 'to' });
  const args = [
    `from: ${placeArg(from)}`,
    `to: ${placeArg(to)}`,
    `numTripPatterns: ${limit}`,
  ];
  if (time) args.push(`dateTime: ${gqlString(time, 'time')}`);
  if (values['arrive-by']) args.push('arriveBy: true');
  if (modes) {
    args.push(`modes: { transportModes: [${modes.map((mode) => `{ transportMode: ${mode} }`).join(', ')}] }`);
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
  if (!Array.isArray(res.trip?.tripPatterns)) throw invalidResponse();
  const data = {
    from: { id: from.id, name: from.name },
    to: { id: to.id, name: to.name },
    tripPatterns: res.trip.tripPatterns.map((pattern) => {
      if (!Array.isArray(pattern?.legs)) throw invalidResponse();
      return {
        start: pattern.expectedStartTime ?? null,
        end: pattern.expectedEndTime ?? null,
        duration: pattern.duration ?? null,
        legs: pattern.legs.map((leg) => ({
          mode: leg?.mode ?? '',
          line: leg?.line?.publicCode ?? null,
          from: leg?.fromPlace?.name ?? '',
          to: leg?.toPlace?.name ?? '',
          start: leg?.expectedStartTime ?? null,
          end: leg?.expectedEndTime ?? null,
          distance: leg?.distance ?? null,
          duration: leg?.duration ?? null,
        })),
      };
    }),
  };
  const lines = [];
  data.tripPatterns.forEach((pattern, index) => {
    lines.push(`${index + 1}) ${hhmm(pattern.start)} -> ${hhmm(pattern.end)}  (${dur(pattern.duration)})`);
    for (const leg of pattern.legs) {
      const via = leg.line ? `${leg.mode} ${leg.line}` : leg.mode;
      lines.push(`   ${hhmm(leg.start)}-${hhmm(leg.end)}  ${via}: ${leg.from} -> ${leg.to}`);
    }
  });
  if (!lines.length) lines.push(`no trips found from ${from.name} to ${to.name}`);
  return {
    json: values.json,
    data,
    lines,
    meta: { count: data.tripPatterns.length, limit },
  };
}

function invalidResponse() {
  return new ApiError('invalid Journey Planner trip response', {
    code: 'invalid_response',
    retryable: true,
    hint: 'Retry once; report the endpoint response if it persists.',
  });
}
