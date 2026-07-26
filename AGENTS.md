# AGENTS.md

## Project

`entur-cli` is an ESM Node.js CLI for accessing Entur public-transport APIs. Intentionally minimal: no command framework, runtime dependencies, build step, or CI. Layout:

- `bin/entur.js` — command routing, root help, error-to-exit-code mapping (0 ok, 1 API/network, 2 usage)
- `src/http.js` — the single HTTP path: `ET-Client-Name`, timeouts, 429/error mapping, endpoints, `graphql()` helper
- `src/cli.js` — `parseArgs` wrappers, numeric/ID/enum/time validators for values embedded in GraphQL queries
- `src/resolve.js` — free text → place via geocoder autocomplete; Entur IDs pass through verbatim
- `src/commands/*.js` — one module per command; `src/errors.js`, `src/format.js` — shared error types and time/duration formatting

Command contract: each command module exports `help` (usage string ending in one runnable example) and `run(argv, { fetchImpl, stderr }) → { json, data, lines }`. `bin/entur.js` prints `data` as JSON when `--json`, otherwise `lines`; commands never print to stdout themselves. Throw `UsageError` (exit 2) or `ApiError` (exit 1). Tests inject `fetchImpl`; keep the `data` schema stable.

Requirements:

- Node.js 20 or newer, as declared in `package.json`
- npm; do not introduce another package manager
- ESM (`"type": "module"`); use `import`/`export`, not CommonJS

## Commands

```sh
npm install             # install dependencies
npm test                # run all tests with Node's test runner
node bin/entur.js        # run CLI directly during development
npm link                # optional: expose local `entur` executable
```

There is currently no build, lint, format, coverage, release, or deploy command. Do not document or rely on one unless its tooling is added to `package.json`.

## Source of Truth for Entur APIs

Entur documentation changes independently of this repository. Before implementing or changing an API command:

1. Start at <https://developer.entur.no/llms.txt> to locate current documentation.
2. Read endpoint-specific documentation linked from that index; confirm URL, method, parameters, response schema, authentication, environment, deprecations, and rate-limit behavior.
3. Prefer current API versions. Do not add new use of deprecated APIs such as Geocoder v1/v2 when v3 supports the use case.
4. Record API assumptions in tests. Never infer endpoint contracts from command names or stale examples.
5. The docs have drifted from the live API before: they implied geocoder paths `autocompleteV3`/`reverseV3` with a `size` parameter, but the live v3 endpoints are `/v3/autocomplete`, `/v3/reverse`, `/v3/place` with `limit`, and feature properties carry `names.display`/`names.default`, not `label`. Verify new endpoint contracts against the live API (`ENTUR_SMOKE=1 npm test`).
6. Not every operator publishes to every API — e.g. RUT (Ruter) is absent from Vehicle Positions; query `{ codespaces { codespaceId } }` for the current list before assuming a filter is broken.

Core documentation:

- Catalogue: <https://developer.entur.no/apis/open>
- Getting started and client identification: <https://developer.entur.no/docs/getting-started>
- Partner API authentication: <https://developer.entur.no/docs/authentication>

## Entur Request Rules

- Send `ET-Client-Name` on every Entur request, including open APIs. Value must identify company and application, be lowercase, and contain no spaces (for example, `company-application`). Never silently use a fabricated production identity.
- Rate-limit quota is tracked per `ET-Client-Name`. The default identity is derived per user as `<os-username>-entur-cli` (`clientName()` in `src/http.js`; precedence `--client-name` > `ENTUR_CLIENT_NAME` > derived). Never auto-generate unique names to obtain extra quota — that is quota evasion and breaks Entur's attribution.
- Open APIs require client identification but no OAuth token. Partner APIs require both client identification and an Entur partnership with OAuth 2.0 Client Credentials.
- Keep API base URL, authentication URL, and credentials environment-specific. Never exchange credentials from one environment against another.
- Cache partner access tokens until reported expiry; do not request a token for every API call.
- Treat HTTP `429` according to endpoint headers and policy. For Journey Planner quota exhaustion, wait until `Rate-Limit-Expiry-Time`; do not blindly retry. Use conservative backoff only for retryable failures such as spike-arrest violations.
- Preserve Entur identifiers such as `NSR:StopPlace:337` verbatim. Do not parse IDs by assuming numeric-only values.
- Use time-zone-aware date handling and retain offsets from API responses. Do not assume local machine time zone.

## Implementation Conventions

- Keep `bin/entur.js` thin: argument parsing and process exit behavior belong at CLI boundary; reusable API and formatting logic belongs under `src/` when introduced.
- Use Node 20 built-ins, including native `fetch`, before adding dependencies. Add a package only when it removes meaningful complexity; verify its current API and commit resulting `package-lock.json`.
- Centralize HTTP behavior rather than duplicating headers, error mapping, authentication, and retry logic across commands.
- Default human-readable output goes to stdout. Diagnostics go to stderr. Return nonzero exit status for invalid input, network failures, and API failures.
- Offer deterministic machine-readable output when adding data-producing commands; keep its schema stable and write only data to stdout in that mode.
- Validate user input before network calls. Error messages must identify invalid option or failed operation without printing tokens, client secrets, authorization headers, or full credential-bearing URLs.
- Support cancellation with `AbortSignal` and bounded request timeouts; a CLI must not hang indefinitely.

## Tests

Use built-in `node:test` and `node:assert/strict`. Name tests `*.test.js` and place them under `test/`, mirroring source areas where practical.

- Add tests for every behavior change.
- Test CLI behavior through spawned processes when exit codes, stdout, or stderr matter.
- Unit tests must not call live Entur services. Inject or mock `fetch` and use fixtures for REST/GraphQL responses, errors, rate-limit headers, and malformed payloads.
- Cover success, invalid input, non-2xx responses, timeout/cancellation, and secret redaction for request code.
- Live smoke tests live in `test/smoke.test.js` and are skipped unless `ENTUR_SMOKE=1` is set. They verify schema assumptions (paths, parameters, field names) against the real APIs — run them after changing any query or endpoint: `ENTUR_SMOKE=1 npm test`.
- `npm test` runs `test/*.test.js`; shared fixtures/helpers in `test/` must not use the `.test.js` suffix.

Before finishing a change, run:

```sh
npm test
node bin/entur.js --help   # once help behavior exists
```

Also run focused tests during development:

```sh
node --test test/path/to/file.test.js
node --test --test-name-pattern='pattern'
```

## Secrets and Configuration

- Keep credentials in environment variables or OS-backed credential storage, never tracked files or command output. `.env` is ignored but must not be treated as secure storage.
- Tests and examples use conspicuously fake credentials.
- Sanitize snapshots, fixtures, debug logs, and thrown errors before committing.
- Do not persist OAuth tokens unless required; if persistence is added, use restrictive permissions and document storage and removal behavior.

## Change Discipline

- Keep changes scoped and avoid speculative abstractions while CLI surface is unsettled.
- Update `README.md` and `--help` together when commands, options, environment variables, defaults, or output formats change.
- Keep `package.json` `bin.entur` valid and preserve executable shebang in `bin/entur.js`.
- Run `npm test` before committing. Use imperative commit subjects.
