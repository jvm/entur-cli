# Contributing

The full development guide for both humans and coding agents lives in [AGENTS.md](AGENTS.md) —
read it before opening a pull request.

## Development

Requirements:

- Node.js 20 or newer
- npm

Install and verify:

```sh
npm install              # installs dev dependencies and wires lefthook hooks
npm test                 # deterministic tests; no Entur network calls
npm run validate         # npm test && npm audit
npm run security:local   # betterleaks + shellcheck + actionlint + npm audit
node bin/entur.js --help
```

Before pushing, lefthook runs betterleaks on staged files (`pre-commit`) and `npm run validate`
(`pre-push`).

## Pull requests

- Open PRs against `main`. `main` is protected and requires all CI checks to pass; keep your
  branch up to date with `main` before merging.
- Add or update tests for every behavior change. `test/docs.test.js` keeps the README and
  `--help` in sync — update them together.
- Use concise, imperative-mood commit subjects.
- After changing any Entur query or endpoint, run `npm run smoke` (`ENTUR_SMOKE=1`) against the
  live API.
- Do not commit credentials, local configuration, or `node_modules/`.

## Entur API usage

Entur's open APIs need no key, only an `ET-Client-Name`. Use one stable name per application,
contact Entur for high-volume use, and never fabricate names to evade per-client quotas. See the
"Configuration" section of the [README](README.md) and [SECURITY.md](SECURITY.md).

## Reporting vulnerabilities

Do not open a public issue. Use
[private vulnerability reporting](https://github.com/jvm/entur-cli/security/advisories/new) — see
[SECURITY.md](SECURITY.md).
