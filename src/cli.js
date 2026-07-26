import { parseArgs } from 'node:util';
import { UsageError } from './errors.js';
import { clientName } from './http.js';
import { inlineSafe } from './output.js';

export const globalOptions = {
  json: { type: 'boolean', default: false },
  timeout: { type: 'string', default: '15' },
  'client-name': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
};

export const globalHelp = `  --json                 schema-v1 JSON result; structured errors on stderr
  --timeout <sec>        per-request timeout (default 15, max 300)
  --client-name <name>   ET-Client-Name; also ENTUR_CLIENT_NAME
  -h, --help             this help`;

export const JOURNEY_MODES = Object.freeze([
  'air',
  'bus',
  'cableway',
  'water',
  'funicular',
  'lift',
  'rail',
  'metro',
  'taxi',
  'tram',
  'trolleybus',
  'monorail',
  'coach',
  'unknown',
]);

export const VEHICLE_MODES = Object.freeze([
  'air',
  'bus',
  'coach',
  'ferry',
  'metro',
  'rail',
  'taxi',
  'tram',
]);

export const MOBILITY_FORM_FACTORS = Object.freeze([
  'bicycle',
  'cargo_bicycle',
  'car',
  'moped',
  'scooter',
  'scooter_standing',
  'scooter_seated',
  'other',
]);

export const GEOCODER_LAYERS = Object.freeze([
  'address',
  'street',
  'stopPlace',
  'groupOfStopPlaces',
  'poi',
  'place',
]);

const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;

export function parse(argv, options) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err.message, {
      code: 'invalid_argument',
      field: 'arguments',
    });
  }
}

export function reqNum(values, name, constraints = {}) {
  if (values[name] === undefined) throw missingOption(name);
  return num(values, name, constraints);
}

export function num(
  values,
  name,
  {
    integer = false,
    min,
    max,
  } = {},
) {
  if (values[name] === undefined) return undefined;
  const raw = String(values[name]).trim();
  const n = DECIMAL_RE.test(raw) ? Number(raw) : Number.NaN;
  const validInteger = !integer || (Number.isSafeInteger(n) && Number.isInteger(n));
  if (
    !Number.isFinite(n)
    || !validInteger
    || (min !== undefined && n < min)
    || (max !== undefined && n > max)
  ) {
    const type = integer ? 'an integer' : 'a number';
    const range = rangeText(min, max);
    throw new UsageError(`--${name} must be ${type}${range}, got '${inlineSafe(values[name])}'`, {
      code: 'invalid_argument',
      field: name,
      hint: validRangeHint(name, min, max),
    });
  }
  return n;
}

export function reqInt(values, name, constraints = {}) {
  return reqNum(values, name, { ...constraints, integer: true });
}

export function int(values, name, constraints = {}) {
  return num(values, name, { ...constraints, integer: true });
}

export function oneOf(value, name, allowed, { normalize = (item) => item } = {}) {
  if (value === undefined) return undefined;
  const normalized = normalize(String(value).trim());
  if (!allowed.includes(normalized)) {
    throw new UsageError(`--${name} must be one of: ${allowed.join(', ')}; got '${inlineSafe(value)}'`, {
      code: 'invalid_argument',
      field: name,
      allowedValues: [...allowed],
      hint: `Pass --${name} with one of the allowed values.`,
    });
  }
  return normalized;
}

export function csvOf(value, name, allowed, options = {}) {
  if (value === undefined) return undefined;
  const parts = String(value).split(',').map((item) => item.trim());
  if (!parts.length || parts.some((item) => !item)) {
    throw new UsageError(`--${name} must be a comma-separated list without empty values`, {
      code: 'invalid_argument',
      field: name,
      allowedValues: [...allowed],
    });
  }
  return [...new Set(parts.map((item) => oneOf(item, name, allowed, options)))];
}

export function token(value, name, { normalize = (item) => item } = {}) {
  if (value === undefined) return undefined;
  const normalized = normalize(String(value).trim());
  if (!normalized || normalized.length > 64 || !TOKEN_RE.test(normalized)) {
    throw new UsageError(`--${name} must contain only letters, numbers, underscores, or hyphens`, {
      code: 'invalid_argument',
      field: name,
    });
  }
  return normalized;
}

export function enturId(value, what, { types } = {}) {
  if (typeof value !== 'string' || value.length > 500 || /[\s\u0000-\u001f\u007f]/.test(value)) {
    throw invalidId(value, what, types);
  }
  const [codespace, type, ...idParts] = value.split(':');
  if (!codespace || !type || !idParts.length || idParts.some((part) => !part)) {
    throw invalidId(value, what, types);
  }
  if (types && !types.includes(type)) throw invalidId(value, what, types);
  return value;
}

export function gqlString(value, what) {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new UsageError(`${what} must be a non-empty string without control characters`, {
      code: 'invalid_argument',
      field: what,
    });
  }
  return JSON.stringify(value);
}

export function gqlTime(value) {
  const match = ISO_RE.exec(value);
  if (!match || !validDateTime(match)) {
    throw new UsageError(`--time must be ISO 8601 with a real date and explicit offset (like 2026-07-27T08:00:00+02:00), got '${inlineSafe(value)}'`, {
      code: 'invalid_argument',
      field: 'time',
      hint: 'Include Z or an explicit offset such as +02:00.',
    });
  }
  return value;
}

export function noPositionals(positionals, command) {
  if (!positionals.length) return;
  throw new UsageError(`${command} does not accept positional arguments; got '${positionals.map(inlineSafe).join(' ')}'`, {
    code: 'unexpected_argument',
    field: 'arguments',
    hint: `Run 'entur ${command} --help' for usage.`,
  });
}

export function exactPositionals(positionals, count, message) {
  if (positionals.length === count) return;
  throw new UsageError(message, {
    code: positionals.length < count ? 'missing_argument' : 'unexpected_argument',
    field: 'arguments',
  });
}

export function httpOpts(values, { fetchImpl, signal } = {}) {
  const timeoutSec = num(values, 'timeout', { min: 0.001, max: 300 });
  return {
    timeoutSec,
    clientName: clientName(values['client-name']),
    fetchImpl,
    signal,
  };
}

function missingOption(name) {
  return new UsageError(`--${name} is required`, {
    code: 'missing_argument',
    field: name,
    hint: `Pass --${name} with a value.`,
  });
}

function rangeText(min, max) {
  if (min !== undefined && max !== undefined) return ` from ${min} to ${max}`;
  if (min !== undefined) return ` greater than or equal to ${min}`;
  if (max !== undefined) return ` less than or equal to ${max}`;
  return '';
}

function validRangeHint(name, min, max) {
  if (min !== undefined && max !== undefined) return `Pass --${name} with a value from ${min} to ${max}.`;
  if (min !== undefined) return `Pass --${name} with a value of at least ${min}.`;
  if (max !== undefined) return `Pass --${name} with a value no greater than ${max}.`;
  return `Pass --${name} with a valid numeric value.`;
}

function invalidId(value, what, types) {
  const exampleType = types?.[0] ?? 'StopPlace';
  return new UsageError(`${what} '${inlineSafe(value)}' is not a valid Entur ID (like NSR:${exampleType}:337)`, {
    code: 'invalid_argument',
    field: what,
    hint: types ? `${what} must have type ${types.join(' or ')}.` : 'Use an ID returned by Entur.',
  });
}

function validDateTime(match) {
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', , zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return false;

  if (zone !== 'Z') {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return true;
}
