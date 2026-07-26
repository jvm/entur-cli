import process from 'node:process';
import { ApiError } from './errors.js';

export const ENDPOINTS = {
  journeyPlanner: 'https://api.entur.io/journey-planner/v3/graphql',
  geocoder: 'https://api.entur.io/geocoder/v3',
  vehicles: 'https://api.entur.io/realtime/v2/vehicles/graphql',
  mobility: 'https://api.entur.io/mobility/v2/graphql',
};

export function clientName(explicit) {
  return explicit ?? process.env.ENTUR_CLIENT_NAME ?? 'jvm-entur-cli';
}

// Single HTTP path for every Entur call: headers, timeout, error mapping.
export async function request(url, opts = {}) {
  const { method = 'GET', body, timeoutSec = 15, fetchImpl = fetch } = opts;
  const headers = { 'ET-Client-Name': clientName(opts.clientName), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutSec * 1000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new ApiError(`request timed out after ${timeoutSec}s: ${url}`, { url });
    }
    throw new ApiError(`network error for ${url}: ${err.message}`, { url });
  }
  if (res.status === 429) {
    const expiry = res.headers.get('Rate-Limit-Expiry-Time');
    throw new ApiError(
      `rate limited (HTTP 429) by ${url}${expiry ? `; do not retry before ${expiry}` : ''}`,
      { status: 429, url },
    );
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      // body unavailable; status alone is enough
    }
    throw new ApiError(`HTTP ${res.status} from ${url}${detail ? `: ${detail}` : ''}`, {
      status: res.status,
      url,
    });
  }
  return res.json();
}

export async function graphql(url, query, variables, opts = {}) {
  const payload = await request(url, { ...opts, method: 'POST', body: { query, variables } });
  if (payload.errors?.length) {
    throw new ApiError(
      `GraphQL error from ${url}: ${payload.errors.map((e) => e.message).join('; ')}`,
      { url },
    );
  }
  return payload.data;
}
