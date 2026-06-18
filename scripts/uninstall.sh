#!/usr/bin/env bash
set -Eeuo pipefail

# BlueNote user uninstaller contract scaffold (Task 10).
# Normal uninstall must never overwrite/delete user notes/config/data. --purge-data is
# the only destructive user-data path and requires exact typed confirmation.

DRY_RUN=0
PURGE_DATA=0
CONFIRMATION=""
CREATED_THIS_RUN=()

usage() {
  printf 'Usage: ./scripts/uninstall.sh [--dry-run] [--purge-data --confirm="delete my bluenote data"]\n'
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
    --purge-data) PURGE_DATA=1; shift ;;
    --confirm=*) CONFIRMATION="${1#*=}"; shift ;;
    --confirm) CONFIRMATION="$(require_value --confirm "${2:-}")"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) fail_usage "Unknown argument: $1" ;;
  esac
done

rollback_current_run() {
  # best-effort rollback for files/artifacts created in current run only.
  for item in "${CREATED_THIS_RUN[@]}"; do
    printf 'rollback artifact: %s\n' "$item"
    [ "$DRY_RUN" -eq 1 ] || rm -rf -- "$item"
  done
}

recovery_command() {
  printf './scripts/install.sh --dry-run # inspect repair/reinstall plan\n'
}

on_failure() {
  printf 'Uninstall failed. Recovery command: %s' "$(recovery_command)" >&2
  rollback_current_run >&2 || true
}
trap on_failure ERR
trap 'printf "Uninstall interrupted; attempting best-effort rollback. Recovery command: %s" "$(recovery_command)" >&2; rollback_current_run >&2 || true; exit 130' INT TERM

preflight() {
  printf 'Preflight checks before mutating state\n'
  printf '  missing required runtime: verify node and npm are available\n'
  command -v node >/dev/null 2>&1 || { printf 'ERROR: missing required runtime node\n' >&2; exit 1; }
  command -v npm >/dev/null 2>&1 || { printf 'ERROR: missing required runtime npm\n' >&2; exit 1; }
  printf '  PATH conflict detection for commands: bluenote, bn, bluenote-webui, bluenote-term\n'
  printf '  old package/unscoped detection and older scoped package lower version semver/version compare\n'
  printf '  newer installed version than requested detection and downgrade protection\n'
  printf '  mixed install detection: npm CLI with built artifact TUI\n'
  printf '  stop stale daemon process and inspect daemon metadata before uninstall\n'
  printf '  partial previous install detection and repair/uninstall-reinstall choices\n'
  printf '  built artifact install directory unknown files detection; fail instead of overwriting unknown/conflicting files\n'
  printf '  npm global prefix writable/permission preflight\n'
  printf '  GitHub Packages auth/registry guidance: @lordierclaw:registry, NODE_AUTH_TOKEN/GH_TOKEN, .npmrc\n'
  printf '  unsupported OS/architecture/platform for built artifact: skip optional clients\n'
  printf '  Windows PowerShell execution policy issues are handled in uninstall.ps1 with ExecutionPolicy/PSSecurityException guidance\n'
}

print_plan() {
  printf 'dry-run conflict summary / Planned actions:\n'
  printf '  stop stale daemon / daemon metadata if present before package/artifact removal\n'
  printf '  uninstall packages/artifacts: @lordierclaw/bluenote, @lordierclaw/bluenote-webui, @lordierclaw/bluenote-term when managed\n'
  printf '  interactive choices on conflicts: upgrade, repair, uninstall-reinstall, skip optional clients, abort\n'
  printf '  --yes/non-interactive contract: fail instead of overwriting unknown/conflicting files\n'
  printf '  preserve user notes/config/data during normal uninstall\n'
  printf '  Never delete user notes/config/data unless --purge-data exact confirmation is supplied\n'
  printf '  purge confirmation phrase: delete my bluenote data\n'
  printf '  on failure: best-effort rollback current-run artifacts and print Recovery command\n'
}

preflight
if [ "$PURGE_DATA" -eq 1 ]; then
  if [ "$CONFIRMATION" != "delete my bluenote data" ]; then
    printf 'ERROR: --purge-data requires exact confirmation: delete my bluenote data\n' >&2
    exit 1
  fi
  printf 'Purge-data confirmed by exact typed phrase: delete my bluenote data\n'
fi
print_plan

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'Dry-run complete; no state mutated.\n'
  exit 0
fi

printf 'Task 10 contract scaffold complete. Real uninstall mutation is intentionally deferred to Task 11. Re-run with --dry-run for planned actions.\n' >&2
false
