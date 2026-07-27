## Summary

Describe the change and its user-visible effect.

## Security

Describe credential, network, filesystem, parsing, or mutation-safety implications.

## Verification

- [ ] `npm test`
- [ ] `npm run audit`
- [ ] After any query or endpoint change: `npm run smoke` (or `ENTUR_SMOKE=1 npm test`) against the live API
- [ ] No OAuth client secrets, tokens, auth headers, or fabricated `ET-Client-Name` values committed
- [ ] Entur identifiers (`NSR:StopPlace:…`) preserved verbatim
- [ ] Machine-readable output schema (`schemaVersion`) preserved, or breaking changes clearly called out
