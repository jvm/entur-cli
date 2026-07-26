import { UsageError } from '../errors.js';
import { ENDPOINTS, graphql } from '../http.js';
import { globalOptions, gqlEnum, gqlId, gqlTime, httpOpts, num, parse } from '../cli.js';
import { delayStr, hhmm } from '../format.js';
import { resolvePlace } from '../resolve.js';

export const help = `Usage: entur departures <stop> [options]

Departure board for a stop place (Entur Journey Planner v3).
<stop> is an NSR ID (NSR:StopPlace:337) or free text resolved via the geocoder
(the chosen stop is reported on stderr).

Options:
  --limit <n>       max departures (default 10)
  --time <iso>      departures from this time instead of now (ISO 8601)
  --modes <a,b>     only these transport modes, e.g. bus,rail,tram,metro,water
  --json            JSON output
  -h, --help        this help

Example:
  entur departures "Oslo S" --limit 5 --modes rail`;

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
  if (!stopText) throw new UsageError('a stop is required, e.g.: entur departures "Oslo S"');
  const http = httpOpts(values, opts.fetchImpl);
  http.stderr = opts.stderr;

  const stop = await resolvePlace(stopText, http);
  // Args are embedded (validated) rather than declared as variables so optional
  // filters don't have to exist in the schema when unused.
  const args = [`numberOfDepartures: ${num(values, 'limit')}`];
  if (values.time) args.push(`startTime: "${gqlTime(values.time)}"`);
  if (values.modes) {
    const modes = values.modes.split(',').map((m) => gqlEnum(m.trim(), 'mode'));
    args.push(`whiteListedModes: [${modes.join(', ')}]`);
  }
  const query = `{
    stopPlace(id: "${gqlId(stop.id, 'stop')}") {
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
  if (!place) throw new UsageError(`no stop place found for '${stop.id}'`);

  const data = {
    stop: { id: place.id, name: place.name },
    departures: (place.estimatedCalls ?? []).map((c) => ({
      time: c.expectedDepartureTime,
      aimedTime: c.aimedDepartureTime,
      realtime: c.realtime,
      cancelled: c.cancellation,
      line: c.serviceJourney?.line?.publicCode ?? '',
      mode: c.serviceJourney?.line?.transportMode ?? '',
      destination: c.destinationDisplay?.frontText ?? '',
      quay: c.quay?.publicCode ?? '',
    })),
  };
  const lines = data.departures.length
    ? data.departures.map((d) => {
        const delay = delayStr(d.aimedTime, d.time);
        return [
          hhmm(d.time),
          delay,
          d.cancelled ? 'CANCELLED' : '',
          d.line,
          `-> ${d.destination}`,
          d.quay ? `quay ${d.quay}` : '',
          `(${d.mode})`,
        ].filter(Boolean).join('  ');
      })
    : [`no departures found for ${place.name}`];
  return { json: values.json, data, lines };
}
