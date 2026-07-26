# entur-cli

CLI for [Entur's open APIs](https://developer.entur.no/): Norwegian public transport and shared mobility. Zero runtime dependencies (Node 20+), designed to be driven by both humans and AI agents.

## Install

```sh
npm install
npm link        # exposes `entur`
```

## Commands

```sh
entur geocode search "Oslo S" --limit 3            # find stops, addresses, places
entur geocode reverse --lat 59.911 --lon 10.750    # places near a coordinate
entur departures "Oslo S" --limit 5 --modes rail   # departure board
entur trip "Oslo S" "Bergen stasjon" --time 2026-07-27T08:00:00+02:00
entur vehicles --codespace ATB --mode bus --limit 5   # real-time vehicle positions
entur mobility vehicles --lat 59.911 --lon 10.750 --form-factor scooter
entur mobility stations --lat 59.911 --lon 10.750
```

Stops accept NSR IDs (`NSR:StopPlace:59872`) or free text; free text is resolved via the geocoder and the chosen stop is reported on stderr. Run `entur <command> --help` for all options.

## Agent-friendly by design

- Never interactive: every input is a flag or argument.
- `--json` on every command prints stable machine-readable JSON on stdout; diagnostics go to stderr.
- Exit codes: `0` success, `1` API/network error, `2` usage error (with a specific message).
- Bounded output (`--limit` defaults) and bounded time (`--timeout <sec>`, default 15).
- Errors are actionable, e.g. rate limiting reports Entur's `Rate-Limit-Expiry-Time` and says not to retry before it.

## Configuration

Entur's open APIs need no key, only client identification. Set the `ET-Client-Name` header via `ENTUR_CLIENT_NAME` or `--client-name` (format `company-application`; defaults to `jvm-entur-cli` — set your own).

## Development

```sh
npm test               # unit tests, no network
node bin/entur.js ...  # run directly
```
