import { ApiError, UsageError } from './errors.js';
import { SCHEMA_VERSION } from './version.js';

export function successEnvelope(data, meta = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    data,
    meta,
  };
}

export function errorEnvelope(err) {
  const error = normalizedError(err);
  return {
    schemaVersion: SCHEMA_VERSION,
    error,
  };
}

export function normalizedError(err) {
  if (err instanceof UsageError) {
    return compact({
      code: err.code,
      message: err.message,
      field: err.field,
      allowedValues: err.allowedValues,
      retryable: false,
      hint: err.hint,
    });
  }

  if (err instanceof ApiError) {
    return compact({
      code: err.code,
      message: err.message,
      status: err.status,
      retryable: err.retryable,
      retryAfter: err.retryAfter,
      hint: err.hint,
    });
  }

  return {
    code: 'internal_error',
    message: 'unexpected internal error',
    retryable: false,
    hint: 'Run the command again; report the failure if it persists.',
  };
}

// Keep terminal control bytes from user/API text from becoming active escapes.
// terminalSafe preserves intentional line feeds in already-composed CLI output;
// inlineSafe escapes every control byte in a single untrusted value.
export function terminalSafe(value) {
  return escapeControls(value, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g);
}

export function inlineSafe(value) {
  return escapeControls(value, /[\u0000-\u001f\u007f-\u009f]/g);
}

function escapeControls(value, pattern) {
  return String(value).replace(pattern, (char) =>
    `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
