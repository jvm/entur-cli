import process from 'node:process';
import { UsageError } from './errors.js';
import { ENDPOINTS, request } from './http.js';

// Free text -> place via one geocoder autocomplete hit; NSR-style IDs pass through verbatim.
// The chosen place is reported on stderr so callers can verify the resolution.
export async function resolvePlace(text, opts = {}) {
  if (/^[A-Za-z]+:[A-Za-z]+:/.test(text)) return { id: text, name: text };
  const url = `${ENDPOINTS.geocoder}/autocomplete?${new URLSearchParams({ q: text, limit: '1' })}`;
  const geo = await request(url, opts);
  const feature = geo.features?.[0];
  if (!feature) {
    throw new UsageError(`no place found matching '${text}'; try: entur geocode search "${text}"`);
  }
  const [lon, lat] = feature.geometry?.coordinates ?? [];
  const { id } = feature.properties;
  const name = placeName(feature.properties);
  (opts.stderr ?? process.stderr).write(`resolved '${text}' -> ${id} (${name})\n`);
  return { id, name, lat, lon };
}

export function placeName(properties) {
  return properties?.names?.display ?? properties?.names?.default ?? '';
}
