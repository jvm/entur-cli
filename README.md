# entur-cli

CLI for [Entur's open APIs](https://developer.entur.no/): Norwegian public transport and shared mobility. It has no runtime dependencies, requires Node.js 20+, and has deterministic paths for terminals, scripts, and AI agents.

## Install

```sh
npm install -g entur-cli
entur --version
```

Or run it once without installing:

```sh
npx entur-cli geocode search "Oslo S"
```

For local development, see [Contributing](https://github.com/jvm/entur-cli/blob/main/CONTRIBUTING.md).

## Commands

```sh
entur geocode search "Oslo S" --layers stopPlace --limit 3
entur geocode search --stop-place-types airport --limit 20 --json
entur geocode reverse --lat 59.911 --lon 10.750 --radius 0.5
entur geocode place NSR:StopPlace:59872 --json
entur departures "Oslo" --limit 5 --modes rail
entur trip "Oslo S" "Bergen stasjon" --limit 1
entur vehicles --codespace ATB --mode bus --limit 5
entur mobility vehicles --lat 59.911 --lon 10.750 --form-factor scooter_standing
entur mobility stations --lat 59.911 --lon 10.750 --form-factor bicycle
```

Stops accept StopPlace IDs such as `NSR:StopPlace:59872` or free text. Departure free text is restricted to StopPlace results; trip endpoints may also be addresses or other routable places. Resolved places are reported on stderr. Run `entur <command> --help` for accepted values and limits.

### Geocoder v3 coverage

`entur geocode` covers all three current read endpoints:

- `search [query...]` → `/v3/autocomplete`; omit the query to list places using a filter.
- `reverse --lat <n> --lon <n>` → `/v3/reverse`; omitting `--radius` sends no radius limit.
- `place <id...>` → `/v3/place`; accepts up to 100 exact IDs, as separate or comma-separated arguments.

Search supports the focus options `--lat`, `--lon`, `--radius`, and `--weight`, plus the hard `--bbox minLon,minLat,maxLon,maxLat` filter. Search and reverse support `--layers`, `--stop-place-types`, `--sources`, `--countries`, `--counties`, `--localities`, `--fare-zones`, `--fare-zone-authorities`, and `--multimodal`. Reverse also supports `--distance-sort true|false`. All three endpoints support `--lang` and `--correlation-id`.

Geocoder JSON records retain the stable convenience fields `id`, `label`, `layer`, `lat`, and `lon` and add the complete v3 feature data: GeoJSON type/geometry/bbox, names, source, address, reverse distance, fare zones, categories, descriptions, stop-place role/types, and transport modes. `meta.geocoder` carries the FeatureCollection type, API metadata, and collection bbox. `meta.mayHaveMore` is true when a search/reverse response reaches `--limit`; Geocoder has no cursor, so raise the limit up to 100 or narrow the filters.

Times passed through `--time` must be real ISO 8601 date-times with `Z` or an explicit offset. Entur IDs are kept as opaque strings and are never parsed as numeric-only values.

## Automation contract

Every data command supports `--json`. A successful result is one schema-v1 JSON document on stdout:

```json
{
  "schemaVersion": 1,
  "data": [],
  "meta": {
    "command": "vehicles",
    "count": 0,
    "totalCount": 0,
    "limit": 20,
    "hasMore": false,
    "truncated": false
  }
}
```

- `data` has the command-specific result; empty success uses the same object/array shape with no ambiguous blank output.
- `meta.command`, `meta.count`, and `meta.limit` describe the result where applicable. Grouped commands also include `meta.subcommand`.
- Vehicle Positions has no server-side result limit. The CLI receives the matched snapshot, returns at most `--limit` records, and exposes `totalCount`, `hasMore`, and `truncated` instead of silently dropping records.
- Result data alone goes to stdout. Place-resolution notices and other diagnostics go to stderr.
- Machine mode never prompts. The CLI is non-interactive in all modes.

Machine errors are one JSON document on stderr and leave stdout empty:

```json
{
  "schemaVersion": 1,
  "error": {
    "code": "invalid_argument",
    "message": "--limit must be an integer from 1 to 100, got '-1'",
    "field": "limit",
    "retryable": false,
    "hint": "Pass --limit with a value from 1 to 100."
  }
}
```

Optional error fields include `allowedValues`, `status`, and `retryAfter`. Exit codes remain small and stable:

- `0`: success
- `1`: Entur API, network, cancellation, timeout, or malformed-response failure
- `2`: command usage or input validation failure

Each HTTP request has a 15-second timeout by default; `--timeout` accepts up to 300 seconds. Commands that resolve free text make multiple requests, so this is a per-request rather than whole-command deadline.

### Field units

- Coordinates are decimal latitude/longitude degrees.
- Journey `duration` and vehicle `delay` values are seconds; trip-leg `distance` is meters.
- Geocoder reverse `distance` is kilometres; GeoJSON bboxes are `minLon,minLat,maxLon,maxLat`.
- Date-time fields retain their ISO 8601 offsets. Human vehicle-update times retain `Z` or the supplied numeric offset.
- Mobility `rangeMeters` is meters and `fuelPercent` is normalized to `0..100`.
- Entur identifiers are strings and may contain non-numeric components.

### Version and compatibility

```sh
entur --version
entur --version --json
```

`--version --json` reports the CLI version, current schema version, and `supportedSchemaVersions`. Schema v1 may gain optional fields; field removals, renames, type changes, or semantic changes require a new schema version and CLI release. This release does not support requesting an older schema, so automation should preflight `supportedSchemaVersions` before upgrading.

## Configuration

Entur's open APIs need no key, only identification through `ET-Client-Name`. Precedence is:

1. `--client-name`
2. `ENTUR_CLIENT_NAME`
3. `<your-os-username>-entur-cli`

The value must use lowercase `company-application` form with no spaces. The derived default means your OS username is sent to Entur; set an override if you prefer not to disclose it. Use one stable name for your application, contact Entur for high-volume use, and never generate names to evade per-client quotas.

## Development

```sh
npm install              # install dependencies (wires lefthook hooks)
npm test                 # deterministic tests; no Entur network calls
npm run smoke            # ENTUR_SMOKE=1 — opt-in live schema checks
npm run validate         # npm test && npm audit
npm run verify-pack      # npm pack --dry-run — inspect published contents
npm run security:local   # audit + betterleaks + shellcheck + actionlint
node bin/entur.js --help
```

## Security

GitHub Actions runs security and quality gates on every pull request and push to `main`: betterleaks secret scanning, Semgrep SAST (SARIF), GitHub CodeQL SAST, `npm audit --omit=dev`, ShellCheck, and actionlint + zizmor workflow auditing. OpenSSF Scorecard reports supply-chain posture on `main`, Dependabot opens weekly update PRs, and releases on `v*` tags publish to npm with provenance. See [`SECURITY.md`](https://github.com/jvm/entur-cli/blob/main/SECURITY.md) for the vulnerability reporting policy and [`AGENTS.md`](https://github.com/jvm/entur-cli/blob/main/AGENTS.md) for the full workflow inventory.

All workflows pin actions by SHA, request the minimum permissions needed, and disable credential persistence at checkout. Run the local equivalents before pushing with `npm run security:local`; lefthook additionally runs betterleaks on pre-commit and `npm run validate` on pre-push.
