#!/usr/bin/env node
import process from 'node:process';
import { ApiError, UsageError } from '../src/errors.js';

const COMMANDS = {
  geocode: () => import('../src/commands/geocode.js'),
  departures: () => import('../src/commands/departures.js'),
  trip: () => import('../src/commands/trip.js'),
  vehicles: () => import('../src/commands/vehicles.js'),
  mobility: () => import('../src/commands/mobility.js'),
};

const HELP = `entur - CLI for Entur's open APIs: Norwegian public transport and shared mobility

Usage: entur <command> [options]

Commands:
  geocode     find stops, addresses, and places (search, reverse)
  departures  departure board for a stop
  trip        plan a journey between two places
  vehicles    real-time vehicle positions
  mobility    shared bikes/scooters/cars nearby (vehicles, stations)

Examples:
  entur geocode search "Oslo S" --limit 3
  entur departures "Oslo S" --limit 5 --modes rail
  entur trip "Oslo S" "Bergen stasjon" --time 2026-07-27T08:00:00+02:00
  entur vehicles --codespace ATB --mode bus --limit 5
  entur mobility vehicles --lat 59.911 --lon 10.750 --form-factor scooter

Global options (all commands):
  --json                 machine-readable JSON on stdout (schema stable; diagnostics on stderr)
  --timeout <sec>        request timeout in seconds (default 15)
  --client-name <name>   ET-Client-Name header; also via ENTUR_CLIENT_NAME env (default jvm-entur-cli)
  -h, --help             help for a command

Run 'entur <command> --help' for options and an example. Exit codes: 0 ok, 1 API/network error, 2 usage error.`;

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log(HELP);
  process.exit(0);
}
if (!COMMANDS[cmd]) {
  console.error(`Error: unknown command '${cmd}'\n\n${HELP}`);
  process.exit(2);
}

try {
  const mod = await COMMANDS[cmd]();
  const result = await mod.run(rest);
  if (result.json) console.log(JSON.stringify(result.data, null, 2));
  else if (result.lines?.length) console.log(result.lines.join('\n'));
  process.exit(0);
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`Error: ${err.message}\nRun 'entur ${cmd} --help' for usage.`);
    process.exit(2);
  }
  if (err instanceof ApiError) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  console.error(`Error: ${err.stack ?? err.message}`);
  process.exit(1);
}
