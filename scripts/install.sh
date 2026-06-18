#!/usr/bin/env bash
set -Eeuo pipefail

DRY_RUN=0
YES=0
FORCE_INTERACTIVE=0
REGISTRY="npm"
TAG="latest"
WITH_WEB=0
WITH_TUI=0
CLIENT_MODE="auto"
SIMULATE_FAILURE=0
CREATED_THIS_RUN=()
CONFLICTS=()

usage() {
  cat <<'USAGE'
Usage: ./scripts/install.sh [--interactive] [--yes] [--with-web] [--with-tui] [--all] [--tag <tag>] [--registry npm|github] [--client-mode path|built|auto] [--dry-run]

Interactive by default. Safe default selection installs only @lordierclaw/bluenote from npmjs and runs bluenote doctor after installation.
USAGE
}

fail_usage() { printf 'ERROR: %s\n' "$1" >&2; usage >&2; exit 2; }
require_value() { flag="$1"; value="${2:-}"; [ -n "$value" ] && [ "${value#--}" = "$value" ] || fail_usage "Missing value for $flag"; printf '%s' "$value"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --interactive) FORCE_INTERACTIVE=1; shift ;;
    --yes) YES=1; shift ;;
    --with-web) WITH_WEB=1; shift ;;
    --with-tui) WITH_TUI=1; CLIENT_MODE="built"; shift ;;
    --all) WITH_WEB=1; WITH_TUI=1; CLIENT_MODE="built"; shift ;;
    --registry=*) REGISTRY="${1#*=}"; shift ;;
    --registry) REGISTRY="$(require_value --registry "${2:-}")"; shift 2 ;;
    --tag=*) TAG="${1#*=}"; shift ;;
    --tag) TAG="$(require_value --tag "${2:-}")"; shift 2 ;;
    --client-mode=*) CLIENT_MODE="${1#*=}"; shift ;;
    --client-mode) CLIENT_MODE="$(require_value --client-mode "${2:-}")"; shift 2 ;;
    --simulate-failure-for-tests) SIMULATE_FAILURE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail_usage "Unknown argument: $1" ;;
  esac
done

case "$REGISTRY" in npm|github) ;; *) fail_usage "Invalid --registry '$REGISTRY'; expected npm or github" ;; esac
case "$CLIENT_MODE" in auto|path|built) ;; *) fail_usage "Invalid --client-mode '$CLIENT_MODE'; expected auto, path, or built" ;; esac
[ "$YES" -eq 1 ] && [ "$FORCE_INTERACTIVE" -eq 1 ] && fail_usage "Use only one of --interactive or --yes"

is_interactive() { [ "$YES" -eq 0 ]; }
recovery_command() { printf './scripts/uninstall.sh --dry-run # inspect recovery, then rerun without --dry-run if needed\n'; }
rollback_current_run() {
  printf 'Attempting best-effort rollback for current-run artifacts.\n'
  for item in "${CREATED_THIS_RUN[@]}"; do
    printf '  rollback artifact: %s\n' "$item"
    [ "$DRY_RUN" -eq 1 ] || rm -rf -- "$item"
  done
}
on_failure() { printf 'Install failed. Recovery command: %s' "$(recovery_command)" >&2; rollback_current_run >&2 || true; }
trap on_failure ERR
trap 'printf "Install interrupted; attempting best-effort rollback. Recovery command: %s" "$(recovery_command)" >&2; rollback_current_run >&2 || true; exit 130' INT TERM

supported_built_tui_platform() {
  case "$(uname -s 2>/dev/null || printf unknown)-$(uname -m 2>/dev/null || printf unknown)" in
    Linux-x86_64|Linux-aarch64|Darwin-x86_64|Darwin-arm64) return 0 ;;
    *) return 1 ;;
  esac
}

preflight() {
  printf 'Preflight checks before mutating state\n'
  printf '  missing required runtime: verify node and npm are available\n'
  command -v node >/dev/null 2>&1 || { printf 'ERROR: missing required runtime node\n' >&2; exit 1; }
  command -v npm >/dev/null 2>&1 || { printf 'ERROR: missing required runtime npm\n' >&2; exit 1; }

  printf '  PATH conflict detection for commands: bluenote, bn, bluenote-webui, bluenote-term\n'
  for command_name in bluenote bn bluenote-webui bluenote-term; do
    if command -v "$command_name" >/dev/null 2>&1; then
      command_path="$(command -v "$command_name")"
      printf '    Conflict found: %s at %s\n' "$command_name" "$command_path"
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
      case "$base" in .bluenote-managed|client-mode.env|bluenote-term|bluenote-term.exe) ;; *) unknown_entries+=("$entry") ;; esac
    done < <(find "$BLUENOTE_BUILT_CLIENT_DIR" -mindepth 1 -maxdepth 1 -print)
    if [ "${#unknown_entries[@]}" -gt 0 ]; then
      printf '    unknown files in built artifact install directory: %s\n' "${unknown_entries[*]}"
      CONFLICTS+=("unknown files in built artifact install directory $BLUENOTE_BUILT_CLIENT_DIR")
    fi
  fi
  printf '  npm global prefix writable/permission preflight\n'
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [ -n "$npm_prefix" ] && [ ! -w "$npm_prefix" ]; then printf 'WARNING: npm global prefix not writable: %s\n' "$npm_prefix"; fi
  printf '  registry/auth preflight for npm registry unavailable/auth failure\n'
  if [ "$REGISTRY" = "github" ]; then
    printf '  GitHub Packages guidance: configure @lordierclaw:registry=https://npm.pkg.github.com and set NODE_AUTH_TOKEN or GH_TOKEN in .npmrc/token setup\n'
  else
    printf '  npmjs registry selected; on auth/network failure retry or choose --registry github with GitHub Packages token setup\n'
  fi
  printf '  unsupported OS/architecture/platform for built TUI artifacts: skip optional clients when safe\n'
  printf '  Windows PowerShell execution policy issues are handled in install.ps1 with ExecutionPolicy/PSSecurityException guidance\n'

  if [ "${#CONFLICTS[@]}" -gt 0 ]; then
    if [ "$YES" -eq 1 ]; then
      printf 'ERROR: non-interactive conflict failure; --yes will not overwrite unknown/conflicting files.\n' >&2
      for conflict in "${CONFLICTS[@]}"; do printf '  conflict: %s\n' "$conflict" >&2; done
      exit 1
    fi
    printf 'Conflict found; safe choices: upgrade, repair, skip, abort. Interactive mode will never overwrite unknown conflicts by default.\n'
    if [ "$DRY_RUN" -eq 0 ]; then
      if [ ! -t 0 ]; then
        printf 'ERROR: conflicts require interactive choice; aborting in non-interactive input.\n' >&2
        exit 1
      fi
      printf 'Choose how to handle detected conflicts: [a]bort, [u]pgrade, [r]epair, [s]kip optional clients: '
      read -r conflict_choice || conflict_choice="a"
      case "$conflict_choice" in
        u|U|upgrade) printf 'Continuing with upgrade after explicit interactive choice.\n' ;;
        r|R|repair) printf 'Continuing with repair after explicit interactive choice.\n' ;;
        s|S|skip) WITH_WEB=0; WITH_TUI=0; printf 'Skipping optional clients after explicit interactive choice.\n' ;;
        *) printf 'Aborting install due to detected conflicts.\n' >&2; exit 1 ;;
      esac
    fi
  fi
}

print_choices() {
  if is_interactive; then printf 'Install mode: interactive\n'; else printf 'Install mode: non-interactive\n'; fi
  printf 'Default selected clients: @lordierclaw/bluenote only\n'
  printf 'Client choices:\n'
  printf '  [x] @lordierclaw/bluenote (distribution CLI)\n'
  if [ "$WITH_WEB" -eq 1 ]; then printf '  [x] @lordierclaw/bluenote-webui (WebUI)\n'; else printf '  [ ] @lordierclaw/bluenote-webui (WebUI)\n'; fi
  if [ "$WITH_TUI" -eq 1 ]; then printf '  [x] @lordierclaw/bluenote-term built terminal artifact (TUI)\n'; else printf '  [ ] @lordierclaw/bluenote-term built terminal artifact (TUI)\n'; fi
  printf '  [ ] all clients (CLI + WebUI + built TUI)\n'
  printf 'Registry choices: npmjs (default), GitHub Packages\n'
}

interactive_prompt() {
  if ! is_interactive || [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  if [ ! -t 0 ]; then
    printf 'ERROR: default install is interactive; use --yes for non-interactive automation.\n' >&2
    exit 1
  fi
  printf '\nBlueNote installer (safe defaults shown in brackets). Press Enter to keep defaults.\n'
  printf 'Install mode: [1] CLI only, [2] CLI + WebUI, [3] CLI + built TUI, [4] all clients: '
  read -r mode_choice || mode_choice=""
  case "$mode_choice" in
    ""|1) ;;
    2) WITH_WEB=1 ;;
    3) WITH_TUI=1; CLIENT_MODE="built" ;;
    4) WITH_WEB=1; WITH_TUI=1; CLIENT_MODE="built" ;;
    *) printf 'Unknown choice; keeping safe default CLI only.\n' ;;
  esac
  printf 'Registry: [1] npmjs, [2] GitHub Packages: '
  read -r registry_choice || registry_choice=""
  case "$registry_choice" in
    ""|1) REGISTRY="npm" ;;
    2) REGISTRY="github" ;;
    *) printf 'Unknown registry choice; keeping npmjs.\n' ;;
  esac
}

ensure_supported_built_tui() {
  if [ "$WITH_TUI" -eq 1 ] && ! supported_built_tui_platform; then
    printf 'ERROR: unsupported OS/architecture/platform for built terminal artifact; no Bun-source fallback will be used.\n' >&2
    exit 1
  fi
}

print_plan() {
  print_choices
  printf 'dry-run conflict summary / Planned actions:\n'
  if [ "$YES" -eq 1 ]; then printf '  --yes non-interactive safe defaults: CLI only; fail instead of overwriting unknown/conflicting files\n'; else printf '  interactive choices on conflicts: upgrade, repair, skip optional clients, abort\n'; fi
  if [ "$REGISTRY" = "github" ]; then
    printf '  configure npm: @lordierclaw:registry=https://npm.pkg.github.com (requires NODE_AUTH_TOKEN or GH_TOKEN)\n'
  else
    printf '  registry: npmjs default; leave GitHub Packages scope registry unchanged\n'
  fi
  printf '  install package: @lordierclaw/bluenote@%s\n' "$TAG"
  [ "$WITH_WEB" -eq 1 ] && printf '  optional package: @lordierclaw/bluenote-webui@%s\n' "$TAG"
  [ "$WITH_TUI" -eq 1 ] && printf '  optional built terminal artifact: copy BLUENOTE_TERM_ARTIFACT_PATH into managed client dir (does not require Bun at runtime; will not use Bun source install)\n'
  if [ "$WITH_TUI" -eq 1 ] || [ "$CLIENT_MODE" = "built" ]; then
    printf '  write client-mode record: BLUENOTE_CLIENT_MODE=built and BLUENOTE_BUILT_CLIENT_DIR=%s for built-binary mode\n' "${BLUENOTE_BUILT_CLIENT_DIR:-$HOME/.local/share/bluenote/clients}"
    printf '  managed built client shim: %s/bluenote-term\n' "${BLUENOTE_BUILT_CLIENT_DIR:-$HOME/.local/share/bluenote/clients}"
  fi
  printf '  preserve user notes/config/data; Never delete user notes/config/data during install\n'
  printf '  run after install: bluenote doctor\n'
  printf '  on failure: best-effort rollback current-run artifacts and print Recovery command\n'
}

run_cmd() { printf '+ %s\n' "$*"; [ "$DRY_RUN" -eq 1 ] || "$@"; }

write_client_mode_record() {
  dir="${BLUENOTE_BUILT_CLIENT_DIR:-$HOME/.local/share/bluenote/clients}"
  config_dir="${BLUENOTE_CONFIG_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}}/bluenote"
  run_cmd mkdir -p "$dir" "$config_dir"
  CREATED_THIS_RUN+=("$dir/bluenote-term")
  CREATED_THIS_RUN+=("$config_dir/client-mode.env")
  if [ "$DRY_RUN" -eq 0 ]; then
    if [ "$WITH_TUI" -eq 1 ]; then
      if [ -z "${BLUENOTE_TERM_ARTIFACT_PATH:-}" ] || [ ! -f "$BLUENOTE_TERM_ARTIFACT_PATH" ]; then
        printf 'ERROR: --with-tui requires BLUENOTE_TERM_ARTIFACT_PATH pointing to a Bun-free built terminal executable; no Bun-source fallback will be used.\n' >&2
        exit 1
      fi
      cp "$BLUENOTE_TERM_ARTIFACT_PATH" "$dir/bluenote-term"
    else
      touch "$dir/bluenote-term"
    fi
    chmod 755 "$dir/bluenote-term"
    { printf 'BLUENOTE_CLIENT_MODE=built\n'; printf 'BLUENOTE_BUILT_CLIENT_DIR=%s\n' "$dir"; } > "$config_dir/client-mode.env"
  fi
  printf 'managed built client shim: %s/bluenote-term\n' "$dir"
  printf 'client-mode record: %s/client-mode.env\n' "$config_dir"
}

install_packages() {
  if [ "$REGISTRY" = "github" ]; then run_cmd npm config set @lordierclaw:registry https://npm.pkg.github.com; fi
  run_cmd npm install -g "@lordierclaw/bluenote@$TAG"
  [ "$WITH_WEB" -eq 1 ] && run_cmd npm install -g "@lordierclaw/bluenote-webui@$TAG"
  if [ "$WITH_TUI" -eq 1 ] || [ "$CLIENT_MODE" = "built" ]; then write_client_mode_record; fi
  run_cmd bluenote doctor
}

preflight
interactive_prompt
ensure_supported_built_tui
print_plan
if [ "$SIMULATE_FAILURE" -eq 1 ]; then false; fi
if [ "$DRY_RUN" -eq 1 ]; then printf 'Dry-run complete; no state mutated.\n'; exit 0; fi
install_packages
printf 'BlueNote install complete.\n'
