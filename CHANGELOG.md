# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project aims to follow [Semantic Versioning](https://semver.org/). Breaking changes include
incompatible changes to command names, required arguments, the JSON output contract
(`schemaVersion`, `data`, `meta`), the structured error envelope, stable exit codes, or safety
behavior.

## [0.2.0] - 2026-07-28

Initial public release.

### Added

- Geocoder v3 commands: `geocode search`, `geocode reverse`, and `geocode place` (autocomplete,
  reverse lookup, and up to 100 exact place IDs per request).
- `departures` (StopPlace departure boards) and `trip` (door-to-door journey patterns) via the
  Journey Planner GraphQL API.
- `vehicles` (real-time vehicle positions) and `mobility vehicles` / `mobility stations` (shared
  mobility) via the Vehicle Positions and Mobility APIs.
- Deterministic machine-readable output (`--json`) with a stable schema-v1 contract
  (`schemaVersion`, `data`, `meta`) and a structured error envelope on stderr.
- Stable exit codes: `0` success, `1` API/network/timeout/cancellation, `2` usage/validation.
- Per-request `ET-Client-Name` identification (derived, `ENTUR_CLIENT_NAME`, or `--client-name`)
  with `429` rate-limit handling and bounded, cancellable timeouts.
- CI security and quality checks: betterleaks, CodeQL, Semgrep (SARIF), `npm audit --omit=dev`,
  ShellCheck, actionlint + zizmor, OpenSSF Scorecard, and Dependabot with a 7-day cooldown.
