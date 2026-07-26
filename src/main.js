import process from 'node:process';
import { ApiError, UsageError } from './errors.js';
import { errorEnvelope, inlineSafe, successEnvelope, terminalSafe } from './output.js';
import { CLI_VERSION, SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from './version.js';

const DEFAULT_COMMANDS = Object.freeze({
  geocode: () => import('./commands/geocode.js'),
  departures: () => import('./commands/departures.js'),
  trip: () => import('./commands/trip.js'),
  vehicles: () => import('./commands/vehicles.js'),
  mobility: () => import('./commands/mobility.js'),
});

export const HELP = `entur - CLI for Entur's open APIs: Norwegian public transport and shared mobility

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
  entur trip "Oslo S" "Bergen stasjon" --limit 1
  entur vehicles --codespace ATB --mode bus --limit 5
  entur mobility vehicles --lat 59.911 --lon 10.750 --form-factor scooter

Global options (all commands):
  --json                 schema-v1 JSON result on stdout; structured errors on stderr
  --timeout <sec>        per-request timeout in seconds (default 15, max 300)
  --client-name <name>   ET-Client-Name; also ENTUR_CLIENT_NAME (default <username>-entur-cli)
  -h, --help             help for a command
  -V, --version          CLI and machine-schema version

Run 'entur <command> --help' for options and examples. Exit codes: 0 ok, 1 API/network error, 2 usage error.`;

export async function main(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    commands = DEFAULT_COMMANDS,
  } = {},
) {
  const machine = hasFlag(argv, '--json');
  const [cmd, ...rest] = argv;

  try {
    if (hasVersionFlag(argv)) {
      assertOnlyVersionArgs(argv);
      const data = {
        cliVersion: CLI_VERSION,
        currentSchemaVersion: SCHEMA_VERSION,
        supportedSchemaVersions: [...SUPPORTED_SCHEMA_VERSIONS],
      };
      writeResult(stdout, machine ? successEnvelope(data, { command: 'version' }) : `entur ${CLI_VERSION}`);
      return 0;
    }

    if (!cmd || cmd === '--help' || cmd === '-h') {
      if (rest.length) throw unexpectedArguments(rest);
      writeResult(stdout, HELP);
      return 0;
    }

    if (cmd === 'help') {
      if (rest.length > 1) throw unexpectedArguments(rest.slice(1));
      if (!rest.length) {
        writeResult(stdout, HELP);
        return 0;
      }
      const target = rest[0];
      const load = commands[target];
      if (!load) throw unknownCommand(target, commands);
      const mod = await load();
      writeResult(stdout, mod.help);
      return 0;
    }

    const load = commands[cmd];
    if (!load) throw unknownCommand(cmd, commands);

    const mod = await load();
    const result = await mod.run(rest);
    if (result.json) {
      writeResult(stdout, successEnvelope(result.data, { command: cmd, ...(result.meta ?? {}) }));
    } else if (result.lines?.length) {
      writeResult(stdout, terminalSafe(result.lines.join('\n')));
    }
    return 0;
  } catch (err) {
    if (machine) {
      writeResult(stderr, errorEnvelope(err));
    } else {
      writeResult(stderr, humanError(err, cmd));
    }
    return err instanceof UsageError ? 2 : 1;
  }
}

function writeResult(stream, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  stream.write(`${text}\n`);
}

function humanError(err, cmd) {
  if (err instanceof UsageError) {
    const commandHint = cmd && !cmd.startsWith('-') ? `Run 'entur ${cmd} --help' for usage.` : undefined;
    return [`Error: ${terminalSafe(err.message)}`, err.hint, commandHint]
      .filter((item, index, items) => item && items.indexOf(item) === index)
      .join('\n');
  }
  if (err instanceof ApiError) {
    return [`Error: ${terminalSafe(err.message)}`, err.hint ? terminalSafe(err.hint) : ''].filter(Boolean).join('\n');
  }
  return 'Error: unexpected internal error\nRun the command again; report the failure if it persists.';
}

function unknownCommand(command, commands) {
  const allowedValues = Object.keys(commands);
  return new UsageError(`unknown command '${inlineSafe(command)}'`, {
    code: 'unknown_command',
    field: 'command',
    allowedValues,
    hint: `Valid commands: ${allowedValues.join(', ')}. Run 'entur --help' for examples.`,
  });
}

function unexpectedArguments(args) {
  return new UsageError(`unexpected argument${args.length === 1 ? '' : 's'}: ${args.map(inlineSafe).join(', ')}`, {
    code: 'unexpected_argument',
    field: 'arguments',
    hint: "Run 'entur --help' for the valid invocation.",
  });
}

function hasFlag(argv, flag) {
  const separator = argv.indexOf('--');
  const options = separator === -1 ? argv : argv.slice(0, separator);
  return options.includes(flag);
}

function hasVersionFlag(argv) {
  return hasFlag(argv, '--version') || hasFlag(argv, '-V');
}

function assertOnlyVersionArgs(argv) {
  const invalid = argv.filter((arg) => arg !== '--version' && arg !== '-V' && arg !== '--json');
  if (invalid.length) throw unexpectedArguments(invalid);
  const versionCount = argv.filter((arg) => arg === '--version' || arg === '-V').length;
  if (versionCount !== 1) {
    throw new UsageError('specify --version only once', {
      code: 'invalid_argument',
      field: 'version',
      hint: 'Run: entur --version or entur --version --json',
    });
  }
}
