import { ApiError, UsageError } from '../errors.js';
import { ENDPOINTS, graphql } from '../http.js';
import {
  JOURNEY_MODES,
  csvOf,
  globalHelp,
  globalOptions,
  gqlString,
  gqlTime,
  httpOpts,
  int,
  parse,
} from '../cli.js';
import { delayStr, hhmm } from '../format.js';
import { resolvePlace } from '../resolve.js';

export const help = `Usage: entur departures <stop> [options]

Departure board for a stop place (Entur Journey Planner v3).
<stop> is a StopPlace ID (NSR:StopPlace:337) or free text resolved to a stop
(the chosen stop is reported on stderr).

Options:
  --limit <n>       max departures (default 10, max 50)
  --time <iso>      departures from an offset-aware ISO 8601 time instead of now
  --modes <a,b>     modes: air,bus,cableway,water,funicular,lift,rail,metro,
                    taxi,tram,trolleybus,monorail,coach,unknown
${globalHelp}

Examples:
  entur departures "Oslo S" --limit 5 --modes rail
  entur departures NSR:StopPlace:59872 --limit 5 --json`;

const options = {
  ...globalOptions,
  limit: { type: 'string', default: '10' },
  time: { type: 'string' },
  modes: { type: 'string' },
};

export async function run(argv, opts = {}) {
  const { values, positionals } = parse(argv, options);
  if (values.help) return { lines: [help] };
  const stopText = positionals.join(' ').trim();
  if (!stopText) {
    throw new UsageError('a stop is required, e.g.: entur departures "Oslo S"', {
      code: 'missing_argument',
      field: 'stop',
    });
  }

  // Validate every local option before spending geocoder/API quota.
  const limit = int(values, 'limit', { min: 1, max: 50 });
  const time = values.time === undefined ? undefined : gqlTime(values.time);
  const modes = csvOf(values.modes, 'modes', JOURNEY_MODES);
  const http = httpOpts(values, opts);
  const stop = await resolvePlace(stopText, {
    ...http,
    stderr: opts.stderr,
    layers: ['stopPlace'],
    idTypes: ['StopPlace'],
    what: 'stop',
  });

  const args = [`numberOfDepartures: ${limit}`];
  if (time) args.push(`startTime: ${gqlString(time, 'time')}`);
  if (modes) args.push(`whiteListedModes: [${modes.join(', ')}]`);
  const query = `{
    stopPlace(id: ${gqlString(stop.id, 'stop')}) {
      id name
      estimatedCalls(${args.join(', ')}) {
        aimedDepartureTime expectedDepartureTime realtime cancellation
        quay { publicCode }
        destinationDisplay { frontText }
        serviceJourney { line { publicCode transportMode } }
      }
    }
  }`;

  const res = await graphql(ENDPOINTS.journeyPlanner, query, undefined, http);
  const place = res.stopPlace;
  if (!place) {
    throw new UsageError(`no stop place found for '${stop.id}'`, {
      code: 'not_found',
      field: 'stop',
      hint: `Find a StopPlace ID with: entur geocode search "${stopText}" --layers stopPlace`,
    });
  }
  if (!place.id || typeof place.name !== 'string' || !Array.isArray(place.estimatedCalls)) {
    throw invalidResponse();
  }

  const data = {
    stop: { id: place.id, name: place.name },
    departures: place.estimatedCalls.map((call) => {
      if (!call || typeof call !== 'object') throw invalidResponse();
      return {
        time: call.expectedDepartureTime ?? null,
        aimedTime: call.aimedDepartureTime ?? null,
        realtime: call.realtime ?? false,
        cancelled: call.cancellation ?? false,
        line: call.serviceJourney?.line?.publicCode ?? '',
        mode: call.serviceJourney?.line?.transportMode ?? '',
        destination: call.destinationDisplay?.frontText ?? '',
        quay: call.quay?.publicCode ?? '',
      };
    }),
  };
  const lines = data.departures.length
    ? data.departures.map((departure) => {
        const delay = delayStr(departure.aimedTime, departure.time);
        return [
          hhmm(departure.time),
          delay,
          departure.cancelled ? 'CANCELLED' : '',
          departure.line,
          `-> ${departure.destination}`,
          departure.quay ? `quay ${departure.quay}` : '',
          departure.mode ? `(${departure.mode})` : '',
        ].filter(Boolean).join('  ');
      })
    : [`no departures found for ${place.name}`];
  return {
    json: values.json,
    data,
    lines,
    meta: { count: data.departures.length, limit },
  };
}

function invalidResponse() {
  return new ApiError('invalid Journey Planner departure response', {
    code: 'invalid_response',
    retryable: true,
    hint: 'Retry once; report the endpoint response if it persists.',
  });
}
