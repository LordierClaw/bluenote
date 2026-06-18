#!/usr/bin/env bash
set -Eeuo pipefail

DRY_RUN=0
PURGE_CONFIG=0
PURGE_CACHE=0
PURGE_DATA=0
CONFIRMATION=""
CREATED_THIS_RUN=()
CONFIG_DIR="${BLUENOTE_CONFIG_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}}/bluenote"
CLIENT_MODE_FILE="$CONFIG_DIR/client-mode.env"

usage() { printf 'Usage: ./scripts/uninstall.sh [--purge-config] [--purge-cache] [--purge-data --confirm "delete my bluenote data"] [--dry-run]\n'; }
fail_usage() { printf 'ERROR: %s\n' "$1" >&2; usage >&2; exit 2; }
require_value() { flag="$1"; value="${2:-}"; [ -n "$value" ] && [ "${value#--}" = "$value" ] || fail_usage "Missing value for $flag"; printf '%s' "$value"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --purge-config) PURGE_CONFIG=1; shift ;;
    --purge-cache) PURGE_CACHE=1; shift ;;
    --purge-data) PURGE_DATA=1; shift ;;
    --confirm=*) CONFIRMATION="${1#*=}"; shift ;;
    --confirm) CONFIRMATION="$(require_value --confirm "${2:-}")"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) fail_usage "Unknown argument: $1" ;;
  esac
done

rollback_current_run() {
  printf 'Attempting best-effort rollback for current-run artifacts.\n'
  for item in "${CREATED_THIS_RUN[@]}"; do
    printf 'rollback artifact: %s\n' "$item"
    [ "$DRY_RUN" -eq 1 ] || rm -rf -- "$item"
  done
}
recovery_command() { printf './scripts/install.sh --dry-run # inspect repair/reinstall plan\n'; }
on_failure() { printf 'Uninstall failed. Recovery command: %s' "$(recovery_command)" >&2; rollback_current_run >&2 || true; }
trap on_failure ERR
trap 'printf "Uninstall interrupted; attempting best-effort rollback. Recovery command: %s" "$(recovery_command)" >&2; rollback_current_run >&2 || true; exit 130' INT TERM

recorded_built_client_dir() {
  if [ -n "${BLUENOTE_BUILT_CLIENT_DIR:-}" ]; then printf '%s' "$BLUENOTE_BUILT_CLIENT_DIR"; return 0; fi
  if [ -f "$CLIENT_MODE_FILE" ]; then
    value="$(grep '^BLUENOTE_BUILT_CLIENT_DIR=' "$CLIENT_MODE_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2-)"
    if [ -n "$value" ]; then printf '%s' "$value"; return 0; fi
  fi
  printf '%s' "$HOME/.local/share/bluenote/clients"
}

preflight() {
  printf 'Preflight checks before mutating state\n'
  printf '  missing required runtime: verify node and npm are available\n'
  command -v node >/dev/null 2>&1 || { printf 'ERROR: missing required runtime node\n' >&2; exit 1; }
  command -v npm >/dev/null 2>&1 || { printf 'ERROR: missing required runtime npm\n' >&2; exit 1; }
  printf '  PATH conflict detection for commands: bluenote, bn, bluenote-webui, bluenote-term\n'
  printf '  old package/unscoped detection: bluenote, bluenote-webui, bluenote-term\n'
  printf '  older scoped package lower version detection via semver/version compare\n'
  printf '  newer installed version than requested detection and downgrade protection\n'
  printf '  mixed install detection: npm CLI with built artifact TUI\n'
  printf '  stale daemon process and daemon metadata detection before uninstall\n'
  printf '  partial previous install detection and repair choices\n'
  printf '  built artifact install directory unknown files detection; fail instead of overwriting unknown/conflicting files\n'
  printf '  npm global prefix writable/permission preflight\n'
  printf '  GitHub Packages auth/registry guidance: @lordierclaw:registry, NODE_AUTH_TOKEN/GH_TOKEN, .npmrc\n'
  printf '  unsupported OS/architecture/platform for built artifact: skip optional clients\n'
  printf '  Windows PowerShell execution policy issues are handled in uninstall.ps1 with ExecutionPolicy/PSSecurityException guidance\n'
}

run_cmd() { printf '+ %s\n' "$*"; [ "$DRY_RUN" -eq 1 ] || "$@"; }

print_plan() {
  printf 'dry-run conflict summary / Planned actions:\n'
  printf '  stop stale daemon / daemon metadata if present before package/artifact removal\n'
  printf '  bluenote daemon stop\n'
  printf '  uninstall packages/artifacts: @lordierclaw/bluenote, @lordierclaw/bluenote-webui, and optionally remove managed @lordierclaw/bluenote-term built terminal artifact\n'
  printf '  npm uninstall -g @lordierclaw/bluenote\n'
  printf '  npm uninstall -g @lordierclaw/bluenote-webui\n'
  printf '  npm uninstall -g @lordierclaw/bluenote-term\n'
  printf '  remove managed built client shim: %s/bluenote-term\n' "$(recorded_built_client_dir)"
  printf '  interactive choices on conflicts: upgrade, repair, skip optional clients, abort\n'
  printf '  --yes/non-interactive contract: fail instead of overwriting unknown/conflicting files\n'
  printf '  preserve user notes/config/data during normal uninstall\n'
  printf '  Never delete user notes/config/data unless --purge-data exact confirmation is supplied\n'
  printf '  purge confirmation phrase: delete my bluenote data\n'
  [ "$PURGE_CONFIG" -eq 1 ] && printf '  purge config after confirmation/scope checks\n'
  [ "$PURGE_CACHE" -eq 1 ] && printf '  purge cache after package removal\n'
  [ "$PURGE_DATA" -eq 1 ] && printf '  purge data after exact confirmation phrase\n'
  printf '  on failure: best-effort rollback current-run artifacts and print Recovery command\n'
}

perform_uninstall() {
  run_cmd bluenote daemon stop || true
  run_cmd npm uninstall -g @lordierclaw/bluenote
  run_cmd npm uninstall -g @lordierclaw/bluenote-webui || true
  run_cmd npm uninstall -g @lordierclaw/bluenote-term || true
  run_cmd rm -f "$(recorded_built_client_dir)/bluenote-term"
  run_cmd rm -f "$CLIENT_MODE_FILE"
  if [ "$PURGE_CACHE" -eq 1 ]; then run_cmd rm -rf "${BLUENOTE_CACHE_HOME:-$HOME/.cache}/bluenote"; fi
  if [ "$PURGE_CONFIG" -eq 1 ]; then run_cmd rm -rf "${BLUENOTE_CONFIG_HOME:-$HOME/.config}/bluenote"; fi
  if [ "$PURGE_DATA" -eq 1 ]; then run_cmd rm -rf "${BLUENOTE_DATA_HOME:-$HOME/.local/share}/bluenote"; fi
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
if [ "$DRY_RUN" -eq 1 ]; then printf 'Dry-run complete; no state mutated.\n'; exit 0; fi
perform_uninstall
printf 'BlueNote uninstall complete. User notes/config/data preserved unless purge flags were confirmed.\n'
