#!/usr/bin/env bash
# Local developer security helpers used by `npm run security:scripts` and
# `npm run security:workflows`. Each subcommand skips gracefully ONLY when its
# tool is missing or there is nothing to check; genuine findings still
# produce a non-zero exit code (no `|| true` masking).
set -euo pipefail

run_scripts() {
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "shellcheck not installed; skipping" >&2
    return 0
  fi
  mapfile -t files < <(find . -type f -name '*.sh' \
    -not -path './node_modules/*' \
    -not -path './.git/*' \
    -not -path './dist/*')
  if [ "${#files[@]}" -eq 0 ]; then
    echo "no shell scripts found; skipping" >&2
    return 0
  fi
  shellcheck "${files[@]}"
}

run_workflows() {
  if ! command -v actionlint >/dev/null 2>&1; then
    echo "actionlint not installed; skipping" >&2
    return 0
  fi
  if ! compgen -G ".github/workflows/*.yml" >/dev/null 2>&1; then
    echo "no GitHub Actions workflows found; skipping" >&2
    return 0
  fi
  actionlint .github/workflows/*.yml
}

case "${1:-}" in
  scripts) run_scripts ;;
  workflows) run_workflows ;;
  *)
    echo "usage: $0 {scripts|workflows}" >&2
    exit 2
    ;;
esac
