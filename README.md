# entur-cli

CLI for [Entur's open APIs](https://developer.entur.no/): Norwegian public transport and shared mobility. It has no runtime dependencies, requires Node.js 20+, and has deterministic paths for terminals, scripts, and AI agents.

## Install

```sh
npm install
npm link        # exposes `entur`
```

## Commands

```sh
entur geocode search "Oslo S" --layers stopPlace --limit 3
entur geocode reverse --lat 59.911 --lon 10.750 --radius 0.5
entur departures "Oslo" --limit 5 --modes rail
entur trip "Oslo S" "Bergen stasjon" --limit 1
entur vehicles --codespace ATB --mode bus --limit 5
entur mobility vehicles --lat 59.911 --lon 10.750 --form-factor scooter
entur mobility stations --lat 59.911 --lon 10.750 --form-factor bicycle
```

Stops accept StopPlace IDs such as `NSR:StopPlace:59872` or free text. Departure free text is restricted to StopPlace results; trip endpoints may also be addresses or other routable places. Resolved places are reported on stderr. Run `entur <command> --help` for accepted values and limits.

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
npm test                  # deterministic tests; no Entur network calls
ENTUR_SMOKE=1 npm test    # opt-in live schema checks
node bin/entur.js --help
```
