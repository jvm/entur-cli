import { ApiError } from './errors.js';
import { placeName } from './resolve.js';

const ADDRESS_FIELDS = Object.freeze([
  'county',
  'borough',
  'countyId',
  'locality',
  'boroughId',
  'localityId',
  'postalCode',
  'streetName',
  'countryCode',
  'houseNumber',
]);

// Validate Entur's GeoJSON contract once and expose all documented v3 fields
// while retaining the CLI's flat identity/coordinate convenience fields.
export function normalizeGeocoderResult(value) {
  if (!isObject(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw invalidResponse();
  }
  const metadata = normalizeMetadata(value.metadata);
  if (metadata.resultCount !== value.features.length) throw invalidResponse();
  return {
    type: value.type,
    features: value.features.map(normalizeFeature),
    metadata,
    bbox: value.bbox === undefined ? undefined : responseBbox(value.bbox),
  };
}

function normalizeMetadata(value) {
  if (
    !isObject(value)
    || !isObject(value.query)
    || typeof value.timestamp !== 'string'
    || !value.timestamp
    || !Number.isSafeInteger(value.resultCount)
    || value.resultCount < 0
  ) throw invalidResponse();
  return {
    query: value.query,
    timestamp: value.timestamp,
    resultCount: value.resultCount,
  };
}

function normalizeFeature(feature) {
  if (!isObject(feature) || feature.type !== 'Feature' || !isObject(feature.geometry)) {
    throw invalidResponse();
  }
  const coordinates = feature.geometry.coordinates;
  if (
    feature.geometry.type !== 'Point'
    || !Array.isArray(coordinates)
    || coordinates.length !== 2
    || !Number.isFinite(coordinates[0])
    || coordinates[0] < -180
    || coordinates[0] > 180
    || !Number.isFinite(coordinates[1])
    || coordinates[1] < -90
    || coordinates[1] > 90
  ) throw invalidResponse();

  const properties = feature.properties;
  if (!isObject(properties) || !isObject(properties.names)) throw invalidResponse();
  const names = normalizeNames(properties.names);
  const id = requiredString(properties.id);
  const layer = requiredString(properties.layer);
  const source = requiredString(properties.source);
  const [lon, lat] = coordinates;
  const result = {
    id,
    label: placeName({ names }),
    layer,
    lat,
    lon,
    type: feature.type,
    geometry: { type: feature.geometry.type, coordinates: [lon, lat] },
    names,
    source,
  };

  if (feature.bbox !== undefined) result.bbox = responseBbox(feature.bbox);
  if (properties.address !== undefined) result.address = normalizeAddress(properties.address);
  if (properties.distance !== undefined) {
    if (!Number.isFinite(properties.distance) || properties.distance < 0) throw invalidResponse();
    result.distance = properties.distance;
  }
  if (properties.fareZones !== undefined) result.fareZones = stringArray(properties.fareZones);
  if (properties.categories !== undefined) result.categories = stringArray(properties.categories);
  if (properties.description !== undefined) result.description = normalizeDescription(properties.description);
  if (properties.stopPlaceRole !== undefined) result.stopPlaceRole = requiredString(properties.stopPlaceRole);
  if (properties.stopPlaceTypes !== undefined) result.stopPlaceTypes = stringArray(properties.stopPlaceTypes);
  if (properties.transportModes !== undefined) result.transportModes = normalizeTransportModes(properties.transportModes);
  return result;
}

function normalizeNames(value) {
  const result = {
    default: requiredString(value.default),
    display: requiredString(value.display),
  };
  if (value.label !== undefined) result.label = requiredString(value.label);
  return result;
}

function normalizeAddress(value) {
  if (!isObject(value)) throw invalidResponse();
  const result = {};
  for (const field of ADDRESS_FIELDS) {
    if (value[field] !== undefined) result[field] = requiredString(value[field]);
  }
  return result;
}

function normalizeDescription(value) {
  if (!isObject(value)) throw invalidResponse();
  const result = {};
  for (const [lang, text] of Object.entries(value)) result[lang] = requiredString(text);
  return result;
}

function normalizeTransportModes(value) {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map((item) => {
    if (!isObject(item)) throw invalidResponse();
    const result = { mode: requiredString(item.mode) };
    if (item.subMode !== undefined) result.subMode = requiredString(item.subMode);
    return result;
  });
}

function stringArray(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw invalidResponse();
  return [...value];
}

function responseBbox(value) {
  if (
    !Array.isArray(value)
    || value.length !== 4
    || value.some((item) => !Number.isFinite(item))
    || value[0] < -180
    || value[0] > 180
    || value[2] < -180
    || value[2] > 180
    || value[1] < -90
    || value[1] > 90
    || value[3] < -90
    || value[3] > 90
    || value[0] > value[2]
    || value[1] > value[3]
  ) throw invalidResponse();
  return [...value];
}

function requiredString(value) {
  if (typeof value !== 'string') throw invalidResponse();
  return value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidResponse() {
  return new ApiError('invalid Geocoder response', {
    code: 'invalid_response',
    retryable: true,
    hint: 'Retry once; report the endpoint response if it persists.',
  });
}
