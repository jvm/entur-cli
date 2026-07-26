import os from 'node:os';
import process from 'node:process';
import { ApiError, UsageError } from './errors.js';

export const ENDPOINTS = {
  journeyPlanner: 'https://api.entur.io/journey-planner/v3/graphql',
  geocoder: 'https://api.entur.io/geocoder/v3',
  vehicles: 'https://api.entur.io/realtime/v2/vehicles/graphql',
  mobility: 'https://api.entur.io/mobility/v2/graphql',
};

const CLIENT_NAME_RE = /^[a-z0-9_]+(?:-[a-z0-9_]+)+$/;
const MAX_CLIENT_NAME_LENGTH = 128;
const MAX_TIMEOUT_SECONDS = 300;

// Default identifies the local user per Entur's honor-system quota model
// (per-name buckets); the -entur-cli suffix keeps traffic attributable to
// this tool. Never auto-generate unique names — that's quota evasion.
export function clientName(explicit) {
  const user = os.userInfo().username.toLowerCase().replace(/[^a-z0-9_]+/g, '') || 'local';
  const value = explicit ?? process.env.ENTUR_CLIENT_NAME ?? `${user}-entur-cli`;
  if (
    typeof value !== 'string'
    || value.length > MAX_CLIENT_NAME_LENGTH
    || !CLIENT_NAME_RE.test(value)
  ) {
    throw new UsageError('ET-Client-Name must use lowercase company-application format with no spaces', {
      code: 'invalid_client_name',
      field: 'clientName',
      hint: 'Set ENTUR_CLIENT_NAME or --client-name to a value like company-application.',
    });
  }
  return value;
}

// Single HTTP path for every Entur call: headers, timeout, cancellation, and errors.
export async function request(url, opts = {}) {
  const {
    method = 'GET',
    body,
    timeoutSec = 15,
    fetchImpl = fetch,
    signal: externalSignal,
  } = opts;
  validateTimeout(timeoutSec);

  const endpoint = displayUrl(url);
  const abort = requestAbort(timeoutSec, externalSignal);
  const headers = { 'ET-Client-Name': clientName(opts.clientName), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });

    if (res.status === 429) {
      await discardBody(res);
      const expiry = res.headers.get('Rate-Limit-Expiry-Time') ?? undefined;
      throw new ApiError(
        `rate limited (HTTP 429) by ${endpoint}${expiry ? `; do not retry before ${expiry}` : ''}`,
        {
          code: 'rate_limited',
          status: 429,
          url: endpoint,
          retryable: true,
          retryAfter: expiry,
          hint: expiry ? `Retry after ${expiry}.` : 'Retry later; do not retry in a tight loop.',
        },
      );
    }

    if (!res.ok) {
      // Error bodies can reflect private request values; never copy them into diagnostics.
      await discardBody(res);
      const retryable = res.status === 408 || res.status >= 500;
      throw new ApiError(`HTTP ${res.status} from ${endpoint}`, {
        code: 'http_error',
        status: res.status,
        url: endpoint,
        retryable,
        hint: retryable ? 'Retry with backoff.' : 'Check the request values and try again.',
      });
    }

    let payload;
    try {
      payload = await res.json();
    } catch (err) {
      if (abort.timedOut()) throw err;
      throw new ApiError(`invalid JSON response from ${endpoint}`, {
        code: 'invalid_response',
        status: res.status,
        url: endpoint,
        retryable: true,
        hint: 'Retry once; report the endpoint failure if it persists.',
      });
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ApiError(`invalid response shape from ${endpoint}`, {
        code: 'invalid_response',
        status: res.status,
        url: endpoint,
        retryable: true,
        hint: 'Retry once; report the endpoint failure if it persists.',
      });
    }
    return payload;
  } catch (err) {
    if (err instanceof UsageError || err instanceof ApiError) throw err;
    if (
      abort.timedOut()
      || (!externalSignal && (err?.name === 'TimeoutError' || err?.name === 'AbortError'))
    ) {
      throw new ApiError(`request timed out after ${timeoutSec}s: ${endpoint}`, {
        code: 'timeout',
        url: endpoint,
        retryable: true,
        hint: 'Retry once or increase --timeout up to 300 seconds.',
      });
    }
    if (externalSignal?.aborted) {
      throw new ApiError(`request cancelled: ${endpoint}`, {
        code: 'cancelled',
        url: endpoint,
        retryable: false,
      });
    }
    throw new ApiError(`network error contacting ${endpoint}`, {
      code: 'network_error',
      url: endpoint,
      retryable: true,
      hint: 'Check network connectivity, then retry with backoff.',
    });
  } finally {
    abort.cleanup();
  }
}

export async function graphql(url, query, variables, opts = {}) {
  const payload = await request(url, { ...opts, method: 'POST', body: { query, variables } });
  if (payload.errors !== undefined && !Array.isArray(payload.errors)) {
    throw invalidGraphqlResponse(url);
  }
  if (payload.errors?.length) {
    throw new ApiError(
      `GraphQL error from ${displayUrl(url)}: ${payload.errors.map((error) => error?.message ?? 'unknown error').join('; ')}`,
      {
        code: 'graphql_error',
        url: displayUrl(url),
        retryable: false,
        hint: 'Check option values and the current Entur API schema.',
      },
    );
  }
  if (
    !Object.hasOwn(payload, 'data')
    || payload.data === null
    || typeof payload.data !== 'object'
    || Array.isArray(payload.data)
  ) {
    throw invalidGraphqlResponse(url);
  }
  return payload.data;
}

function validateTimeout(timeoutSec) {
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0 || timeoutSec > MAX_TIMEOUT_SECONDS) {
    throw new UsageError(`request timeout must be greater than 0 and at most ${MAX_TIMEOUT_SECONDS} seconds`, {
      code: 'invalid_argument',
      field: 'timeout',
      hint: `Pass --timeout with a value up to ${MAX_TIMEOUT_SECONDS}.`,
    });
  }
}

function requestAbort(timeoutSec, externalSignal) {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    const reason = new Error(`request timed out after ${timeoutSec}s`);
    reason.name = 'TimeoutError';
    controller.abort(reason);
  }, Math.ceil(timeoutSec * 1000));
  timer.unref?.();

  const onExternalAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

async function discardBody(res) {
  try {
    await res.body?.cancel();
  } catch {
    // Status and headers remain sufficient when cancellation is unavailable.
  }
}

function invalidGraphqlResponse(url) {
  return new ApiError(`invalid GraphQL response from ${displayUrl(url)}`, {
    code: 'invalid_response',
    url: displayUrl(url),
    retryable: true,
    hint: 'Retry once; report the endpoint failure if it persists.',
  });
}

function displayUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'Entur endpoint';
  }
}
