import process from 'node:process';
import { enturId } from './cli.js';
import { ApiError, UsageError } from './errors.js';
import { ENDPOINTS, request } from './http.js';
import { inlineSafe } from './output.js';

// Free text -> one geocoder hit; Entur IDs pass through verbatim after type validation.
export async function resolvePlace(text, opts = {}) {
  const {
    layers,
    idTypes,
    what = 'place',
    stderr = process.stderr,
    ...http
  } = opts;

  if (looksLikeEnturId(text)) {
    const id = enturId(text, what, { types: idTypes });
    return { id, name: id };
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 500 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new UsageError(`${what} must be non-empty text of at most 500 characters`, {
      code: 'invalid_argument',
      field: what,
    });
  }

  const params = new URLSearchParams({ q: text, limit: '1' });
  if (layers?.length) params.set('layers', layers.join(','));
  const url = `${ENDPOINTS.geocoder}/autocomplete?${params}`;
  const geo = await request(url, http);
  const feature = geo.features?.[0];
  if (!feature) {
    throw new UsageError(`no ${what} found matching '${text}'`, {
      code: 'not_found',
      field: what,
      hint: `Try: entur geocode search "${inlineSafe(text)}" --layers ${layers?.join(',') ?? 'stopPlace'}`,
    });
  }

  const properties = feature.properties;
  const coordinates = feature.geometry?.coordinates;
  const id = properties?.id;
  const name = placeName(properties);
  const [lon, lat] = Array.isArray(coordinates) ? coordinates : [];
  if (
    typeof id !== 'string'
    || !name
    || !Number.isFinite(lat)
    || lat < -90
    || lat > 90
    || !Number.isFinite(lon)
    || lon < -180
    || lon > 180
    || (idTypes && !idTypes.includes(id.split(':')[1]))
  ) {
    throw invalidResult(what);
  }
  try {
    enturId(id, what, { types: idTypes });
  } catch {
    throw invalidResult(what);
  }

  stderr.write(`resolved '${inlineSafe(text)}' -> ${inlineSafe(id)} (${inlineSafe(name)})\n`);
  return { id, name, lat, lon };
}

export function placeName(properties) {
  return properties?.names?.display ?? properties?.names?.default ?? '';
}

function invalidResult(what) {
  return new ApiError(`invalid geocoder result for ${what}`, {
    code: 'invalid_response',
    retryable: true,
    hint: 'Retry once; report the geocoder response if it persists.',
  });
}

function looksLikeEnturId(value) {
  return typeof value === 'string' && /^[^:\s]+:[^:\s]+:/.test(value);
}
