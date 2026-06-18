#!/usr/bin/env bash
set -Eeuo pipefail

# BlueNote user installer contract scaffold (Task 10).
# This script intentionally implements preflight/conflict/rollback contract and dry-run
# planning only; full interactive install behavior belongs to Task 11.
# Required contract: run preflight before mutating state.

DRY_RUN=0
YES=0
REGISTRY="npm"
TAG="latest"
WITH_WEB=0
WITH_TUI=0
ALL=0
CREATED_THIS_RUN=()
CONFLICTS=()

usage() {
  cat <<'USAGE'
Usage: ./scripts/install.sh [--dry-run] [--yes] [--with-web] [--with-tui] [--all] [--registry npm|github] [--tag <tag>]

Preflight contract only. Dry-run records planned actions before any mutation.
USAGE
}

fail_usage() {
  printf 'ERROR: %s\n' "$1" >&2
  usage >&2
  exit 2
}

require_value() {
  flag="$1"
  value="${2:-}"
  if [ -z "$value" ] || [ "${value#--}" != "$value" ]; then
    fail_usage "Missing value for $flag"
  fi
  printf '%s' "$value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --yes) YES=1; shift ;;
    --with-web) WITH_WEB=1; shift ;;
    --with-tui) WITH_TUI=1; shift ;;
    --all) ALL=1; WITH_WEB=1; WITH_TUI=1; shift ;;
    --registry=*) REGISTRY="${1#*=}"; shift ;;
    --registry) REGISTRY="$(require_value --registry "${2:-}")"; shift 2 ;;
    --tag=*) TAG="${1#*=}"; shift ;;
    --tag) TAG="$(require_value --tag "${2:-}")"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) fail_usage "Unknown argument: $1" ;;
  esac
done

case "$REGISTRY" in
  npm|github) ;;
  *) fail_usage "Invalid --registry '$REGISTRY'; expected npm or github" ;;
esac

recovery_command() {
  printf './scripts/uninstall.sh --dry-run # inspect recovery, then rerun without --dry-run if needed\n'
}

rollback_current_run() {
  # best-effort rollback: delete only files/artifacts created in current run, never user data.
  if [ "${#CREATED_THIS_RUN[@]}" -gt 0 ]; then
    printf 'Attempting best-effort rollback for current-run artifacts:\n'
    for item in "${CREATED_THIS_RUN[@]}"; do
      printf '  rollback artifact: %s\n' "$item"
      [ "$DRY_RUN" -eq 1 ] || rm -rf -- "$item"
    done
  fi
}

on_failure() {
  printf 'Install failed. Recovery command: %s' "$(recovery_command)" >&2
  rollback_current_run >&2 || true
}
trap on_failure ERR
trap 'printf "Install interrupted; attempting best-effort rollback. Recovery command: %s" "$(recovery_command)" >&2; rollback_current_run >&2 || true; exit 130' INT TERM

preflight() {
  printf 'Preflight checks before mutating state\n'
  printf '  missing required runtime: verify node and npm are available\n'
  command -v node >/dev/null 2>&1 || { printf 'ERROR: missing required runtime node\n' >&2; exit 1; }
  command -v npm >/dev/null 2>&1 || { printf 'ERROR: missing required runtime npm\n' >&2; exit 1; }

  printf '  PATH conflict detection for commands: bluenote, bn, bluenote-webui, bluenote-term\n'
  for command_name in bluenote bn bluenote-webui bluenote-term; do
    if command -v "$command_name" >/dev/null 2>&1; then
      command_path="$(command -v "$command_name")"
      printf '    conflict candidate: %s at %s\n' "$command_name" "$command_path"
      CONFLICTS+=("PATH command $command_name at $command_path")
    fi
  done

  printf '  old package/unscoped detection: bluenote, bluenote-webui, bluenote-term\n'
  printf '  older scoped package lower version detection via semver/version compare\n'
  printf '  newer installed version than requested tag (%s) detection; do not downgrade without explicit confirmation\n' "$TAG"
  printf '  mixed install detection: CLI from npm plus TUI from built artifact\n'
  printf '  stale daemon process and daemon metadata detection before upgrade\n'
  printf '  partial previous install detection for missing CLI/client/artifact pieces and repair flow\n'
  printf '  built artifact install directory unknown files detection; fail instead of overwriting unknown/conflicting files\n'
  if [ -n "${BLUENOTE_BUILT_CLIENT_DIR:-}" ] && [ -d "$BLUENOTE_BUILT_CLIENT_DIR" ]; then
    unknown_entries=()
    while IFS= read -r entry; do
      base="$(basename "$entry")"
      case "$base" in
        .bluenote-managed) ;;
        *) unknown_entries+=("$entry") ;;
      esac
    done < <(find "$BLUENOTE_BUILT_CLIENT_DIR" -mindepth 1 -maxdepth 1 -print)
    if [ "${#unknown_entries[@]}" -gt 0 ]; then
      printf '    unknown files in built artifact install directory: %s\n' "${unknown_entries[*]}"
      CONFLICTS+=("unknown files in built artifact install directory $BLUENOTE_BUILT_CLIENT_DIR")
    fi
  fi
  printf '  npm global prefix writable/permission preflight\n'
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [ -n "$npm_prefix" ] && [ ! -w "$npm_prefix" ]; then
    printf 'WARNING: npm global prefix not writable: %s\n' "$npm_prefix"
  fi
  printf '  registry/auth preflight for npm registry unavailable/auth failure\n'
  if [ "$REGISTRY" = "github" ]; then
    printf '  GitHub Packages guidance: configure @lordierclaw:registry=https://npm.pkg.github.com and set NODE_AUTH_TOKEN or GH_TOKEN in .npmrc/token setup\n'
  else
    printf '  npmjs registry selected; on auth/network failure retry or choose --registry github with GitHub Packages token setup\n'
  fi
  printf '  unsupported OS/architecture/platform for built TUI artifacts: skip optional clients when safe\n'
  printf '  Windows PowerShell execution policy issues are handled in install.ps1 with ExecutionPolicy/PSSecurityException guidance\n'

  if [ "$YES" -eq 1 ] && [ "${#CONFLICTS[@]}" -gt 0 ]; then
    printf 'ERROR: non-interactive conflict failure; --yes will not overwrite unknown/conflicting files.\n' >&2
    for conflict in "${CONFLICTS[@]}"; do
      printf '  conflict: %s\n' "$conflict" >&2
    done
    exit 1
  fi
}

print_plan() {
  printf 'dry-run conflict summary / Planned actions:\n'
  if [ "$YES" -eq 1 ]; then
    printf '  --yes non-interactive safe defaults: upgrade/repair same package identity only; skip optional unsupported clients; fail instead of overwriting unknown/conflicting files\n'
  else
    printf '  interactive choices on conflicts: upgrade, repair, uninstall-reinstall, skip optional clients, abort\n'
  fi
  printf '  install package: @lordierclaw/bluenote@%s\n' "$TAG"
  [ "$WITH_WEB" -eq 1 ] && printf '  optional package: @lordierclaw/bluenote-webui@%s\n' "$TAG"
  [ "$WITH_TUI" -eq 1 ] && printf '  optional built artifact: @lordierclaw/bluenote-term built TUI for supported OS/architecture\n'
  printf '  preserve user notes/config/data; Never delete user notes/config/data during install\n'
  printf '  on failure: best-effort rollback current-run artifacts and print Recovery command\n'
}

preflight
print_plan

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'Dry-run complete; no state mutated.\n'
  exit 0
fi

printf 'Task 10 contract scaffold complete. Real install mutation is intentionally deferred to Task 11. Re-run with --dry-run for planned actions.\n' >&2
false
