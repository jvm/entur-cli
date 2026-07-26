import { parseArgs } from 'node:util';
import { UsageError } from './errors.js';

// Options every command accepts.
export const globalOptions = {
  json: { type: 'boolean', default: false },
  timeout: { type: 'string', default: '15' },
  'client-name': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
};

export function parse(argv, options) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true });
  } catch (err) {
    throw new UsageError(err.message);
  }
}

export function reqNum(values, name) {
  if (values[name] === undefined) throw new UsageError(`--${name} is required`);
  return num(values, name);
}

export function num(values, name) {
  if (values[name] === undefined) return undefined;
  const n = Number(values[name]);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number, got '${values[name]}'`);
  return n;
}

// Per-request options derived from parsed global flags.
export function httpOpts(values, fetchImpl) {
  const timeoutSec = Number(values.timeout);
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    throw new UsageError(`--timeout must be a positive number of seconds, got '${values.timeout}'`);
  }
  return { timeoutSec, clientName: values['client-name'], fetchImpl };
}

const ID_RE = /^[A-Za-z]+:[A-Za-z]+:[A-Za-z0-9_.-]+$/;
const ENUM_RE = /^[A-Za-z_]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/;

// Validators for values embedded into GraphQL query strings.
export function gqlId(value, what) {
  if (!ID_RE.test(value)) throw new UsageError(`${what} '${value}' is not a valid Entur ID (like NSR:StopPlace:337)`);
  return value;
}

export function gqlEnum(value, what) {
  if (!ENUM_RE.test(value)) throw new UsageError(`${what} '${value}' is not a valid value`);
  return value;
}

export function gqlTime(value) {
  if (!ISO_RE.test(value)) {
    throw new UsageError(`--time must be ISO 8601 (like 2026-07-27T08:00:00+02:00), got '${value}'`);
  }
  return value;
}
