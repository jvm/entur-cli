# Security Policy

## Reporting A Vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting:

https://github.com/jvm/entur-cli/security/advisories/new

Include the affected command or component, reproduction steps, impact, and any suggested mitigation. Do not include real Entur credentials, OAuth client secrets, access tokens, `ET-Client-Name` values, authorization headers, or account data.

You should receive an acknowledgment within seven days. A fix and disclosure timeline will depend on severity and reproducibility.

## Supported Versions

Security fixes are provided for the latest released version.

## Entur credentials and identity

- Open Entur APIs require an `ET-Client-Name` but no token. This CLI derives a per-user default (`<os-username>-entur-cli`); override with `ENTUR_CLIENT_NAME` or `--client-name`. Never fabricate unique client names to obtain extra quota — that is quota evasion and breaks Entur's attribution.
- Partner APIs require an Entur partnership and OAuth 2.0 Client Credentials. Keep client secrets in environment variables or OS-backed credential storage, never in tracked files, logs, fixtures, or command output.
- Treat HTTP `429` according to Entur's rate-limit headers; wait until `Rate-Limit-Expiry-Time` rather than retrying in a tight loop.

## Security checks

GitHub Actions runs these checks on every pull request and push to `main`:

- betterleaks secret scanning (SARIF uploaded to code scanning);
- GitHub CodeQL static analysis (`security-extended,security-and-quality`);
- `npm audit --omit=dev` for production dependency advisories;
- ShellCheck for shell scripts;
- actionlint + zizmor auditing for GitHub Actions workflows.

Additionally, OpenSSF Scorecard analyzes supply-chain posture on `main`, and Dependabot opens weekly update PRs for npm and GitHub Actions.

Run the local equivalents before pushing:

```sh
npm run security:local
```
