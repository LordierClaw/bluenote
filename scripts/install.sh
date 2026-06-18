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
BUILT_CLIENT_DIR="${BLUENOTE_BUILT_CLIENT_DIR:-$HOME/.local/share/bluenote/clients}"
NEW_PATHS=()
BACKUP_PATHS=()
BACKUP_TARGETS=()
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_JSON_PATH="$SCRIPT_DIR/../package.json"
INSTALLED_PACKAGES=()
REGISTRY_CONFIG_TOUCHED=0
SCOPE_REGISTRY_KEY="@lordierclaw:registry"
PREVIOUS_SCOPE_REGISTRY=""
SCOPE_REGISTRY_WAS_SET=0

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
  if [ "$DRY_RUN" -eq 0 ]; then
    for (( idx=${#INSTALLED_PACKAGES[@]}-1 ; idx>=0 ; idx-=1 )); do
      printf '  rollback package: %s\n' "${INSTALLED_PACKAGES[$idx]}"
      npm uninstall -g "${INSTALLED_PACKAGES[$idx]}" >/dev/null 2>&1 || true
    done
    if [ "$REGISTRY_CONFIG_TOUCHED" -eq 1 ]; then
      if [ "$SCOPE_REGISTRY_WAS_SET" -eq 1 ]; then
        printf '  restore npm config: %s=%s\n' "$SCOPE_REGISTRY_KEY" "$PREVIOUS_SCOPE_REGISTRY"
        npm config set "$SCOPE_REGISTRY_KEY" "$PREVIOUS_SCOPE_REGISTRY" >/dev/null 2>&1 || true
      else
        printf '  remove npm config: %s\n' "$SCOPE_REGISTRY_KEY"
        npm config delete "$SCOPE_REGISTRY_KEY" >/dev/null 2>&1 || true
      fi
    fi
  fi
  for i in "${!BACKUP_TARGETS[@]}"; do
    printf '  restore artifact: %s\n' "${BACKUP_TARGETS[$i]}"
    [ "$DRY_RUN" -eq 1 ] || cp -p -- "${BACKUP_PATHS[$i]}" "${BACKUP_TARGETS[$i]}"
  done
  for item in "${NEW_PATHS[@]}"; do
    printf '  rollback artifact: %s\n' "$item"
    [ "$DRY_RUN" -eq 1 ] || rm -rf -- "$item"
  done
  for backup in "${BACKUP_PATHS[@]}"; do
    [ "$DRY_RUN" -eq 1 ] || rm -f -- "$backup"
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

config_dir() { printf '%s/bluenote' "${BLUENOTE_CONFIG_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}}"; }
recorded_client_mode_path() { printf '%s/client-mode.env' "$(config_dir)"; }
recorded_built_client_dir() {
  record_path="$(recorded_client_mode_path)"
  if [ -f "$record_path" ]; then
    while IFS= read -r line; do
      case "$line" in
        BLUENOTE_BUILT_CLIENT_DIR=*) printf '%s' "${line#BLUENOTE_BUILT_CLIENT_DIR=}"; return 0 ;;
      esac
    done < "$record_path"
  fi
  return 1
}
requested_release_version() {
  if [[ "$TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
    printf '%s' "$TAG"
  else
    node -p "require(process.argv[1]).version" "$PACKAGE_JSON_PATH" 2>/dev/null || printf ''
  fi
}
npm_list_json() {
  npm_output="$(npm list -g --depth=0 --json 2>/dev/null || true)"
  if [ -n "$npm_output" ]; then
    printf '%s' "$npm_output"
  else
    printf '{}'
  fi
}
npm_list_version() {
  package_name="$1"
  package_json="$2"
  PACKAGE_NAME="$package_name" PACKAGE_JSON="$package_json" node -e "const data=JSON.parse(process.env.PACKAGE_JSON||'{}'); const deps=data.dependencies||{}; const dep=deps[process.env.PACKAGE_NAME]; process.stdout.write(dep&&dep.version?String(dep.version):'');"
}
compare_semver() {
  left="$1"
  right="$2"
  node -e "function parse(v){const m=String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/); if(!m) return null; return [Number(m[1]),Number(m[2]),Number(m[3])];} const a=parse(process.argv[1]); const b=parse(process.argv[2]); if(!a||!b){process.stdout.write('nan'); process.exit(0);} for(let i=0;i<3;i+=1){ if(a[i]<b[i]){process.stdout.write('-1'); process.exit(0);} if(a[i]>b[i]){process.stdout.write('1'); process.exit(0);} } process.stdout.write('0');" "$left" "$right"
}
has_github_packages_auth() {
  if [ -n "${NODE_AUTH_TOKEN:-}" ] || [ -n "${GH_TOKEN:-}" ]; then return 0; fi
  token="$(npm config get //npm.pkg.github.com/:_authToken 2>/dev/null || true)"
  [ -n "$token" ] && [ "$token" != "undefined" ] && [ "$token" != "null" ]
}
test_writable_dir() {
  dir_path="$1"
  [ -d "$dir_path" ] || return 1
  probe="$dir_path/.bluenote-write-test-$$-$RANDOM"
  if : > "$probe" 2>/dev/null; then
    rm -f -- "$probe" 2>/dev/null || true
    return 0
  fi
  return 1
}
test_writable_dir_or_parent() {
  target_path="$1"
  probe_dir="$target_path"
  while [ ! -d "$probe_dir" ]; do
    parent_dir="$(dirname -- "$probe_dir")"
    [ "$parent_dir" != "$probe_dir" ] || break
    probe_dir="$parent_dir"
  done
  test_writable_dir "$probe_dir"
}
npm_registry_reachable() {
  target_registry="$1"
  if [ -n "${BLUENOTE_TEST_NPM_PING_STATUS:-}" ]; then
    [ "$BLUENOTE_TEST_NPM_PING_STATUS" = "0" ]
    return
  fi
  if [ -n "$target_registry" ]; then
    npm ping --registry "$target_registry" >/dev/null 2>&1
  else
    npm ping >/dev/null 2>&1
  fi
}
check_existing_packages() {
  package_json="$1"
  requested_version="$2"
  old_names=(bluenote)
  scoped_names=(@lordierclaw/bluenote)
  if [ "$WITH_WEB" -eq 1 ]; then
    old_names+=(bluenote-webui)
    scoped_names+=(@lordierclaw/bluenote-webui)
  fi
  if [ "$WITH_TUI" -eq 1 ]; then
    old_names+=(bluenote-term)
    scoped_names+=(@lordierclaw/bluenote-term)
  fi
  for old_name in "${old_names[@]}"; do
    installed_version="$(npm_list_version "$old_name" "$package_json")"
    if [ -n "$installed_version" ]; then
      printf '    old/unscoped package installed: %s@%s\n' "$old_name" "$installed_version"
      CONFLICTS+=("old package $old_name@$installed_version")
    fi
  done
  for scoped_name in "${scoped_names[@]}"; do
    installed_version="$(npm_list_version "$scoped_name" "$package_json")"
    if [ -n "$installed_version" ] && [ -n "$requested_version" ]; then
      semver_cmp="$(compare_semver "$installed_version" "$requested_version")"
      case "$semver_cmp" in
        -1)
          printf '    older scoped package installed: %s@%s < requested %s\n' "$scoped_name" "$installed_version" "$requested_version"
          CONFLICTS+=("older scoped package $scoped_name@$installed_version < $requested_version")
          ;;
        1)
          printf '    newer installed version than requested: %s@%s > requested %s\n' "$scoped_name" "$installed_version" "$requested_version"
          CONFLICTS+=("newer installed version $scoped_name@$installed_version > $requested_version")
          ;;
      esac
    fi
  done
}
check_partial_install_state() {
  record_path="$(recorded_client_mode_path)"
  recorded_dir="$(recorded_built_client_dir || true)"
  built_dir_for_check="$BUILT_CLIENT_DIR"
  if [ -n "$recorded_dir" ]; then built_dir_for_check="$recorded_dir"; fi
  built_exec="$built_dir_for_check/bluenote-term"
  if [ -e "$record_path" ] && [ ! -e "$built_exec" ]; then
    printf '    partial previous install detected: client-mode record exists without built client executable\n'
    CONFLICTS+=("partial previous install missing built client executable for recorded mode")
  fi
  if [ -e "$built_exec" ] && [ ! -e "$record_path" ]; then
    printf '    partial previous install detected: built client executable exists without client-mode record\n'
    CONFLICTS+=("partial previous install missing client-mode record for built client executable")
  fi
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
  requested_version="$(requested_release_version)"
  installed_packages_json="$(npm_list_json)"
  check_existing_packages "$installed_packages_json" "$requested_version"
  printf '  mixed install detection: CLI from npm plus TUI from built artifact\n'
  printf '  stale daemon process and daemon metadata detection before upgrade\n'
  printf '  partial previous install detection for missing CLI/client/artifact pieces and repair flow\n'
  check_partial_install_state
  printf '  built artifact install directory unknown files detection; fail instead of overwriting unknown/conflicting files\n'
  if [ "$WITH_TUI" -eq 1 ] && [ -d "$BUILT_CLIENT_DIR" ]; then
    unknown_entries=()
    while IFS= read -r entry; do
      base="$(basename "$entry")"
      case "$base" in .bluenote-managed|client-mode.env|bluenote-term|bluenote-term.exe) ;; *) unknown_entries+=("$entry") ;; esac
    done < <(find "$BUILT_CLIENT_DIR" -mindepth 1 -maxdepth 1 -print)
    if [ "${#unknown_entries[@]}" -gt 0 ]; then
      printf '    unknown files in built artifact install directory: %s\n' "${unknown_entries[*]}"
      CONFLICTS+=("unknown files in built artifact install directory $BUILT_CLIENT_DIR")
    fi
  fi
  printf '  npm global prefix writable/permission preflight\n'
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [ -z "$npm_prefix" ] || [ ! -d "$npm_prefix" ] || ! test_writable_dir "$npm_prefix"; then
    printf '    npm global prefix not writable or missing: %s\n' "${npm_prefix:-<empty>}"
    CONFLICTS+=("npm global prefix not writable ${npm_prefix:-<empty>}")
  fi
  if [ "$WITH_TUI" -eq 1 ]; then
    printf '  built artifact and config destination writable/permission preflight\n'
    if ! test_writable_dir_or_parent "$BUILT_CLIENT_DIR"; then
      printf '    built client directory not writable: %s\n' "$BUILT_CLIENT_DIR"
      CONFLICTS+=("built client directory not writable $BUILT_CLIENT_DIR")
    fi
    if ! test_writable_dir_or_parent "$(config_dir)"; then
      printf '    client-mode config directory not writable: %s\n' "$(config_dir)"
      CONFLICTS+=("client-mode config directory not writable $(config_dir)")
    fi
  fi
  printf '  registry/auth preflight for npm registry unavailable/auth failure\n'
  if [ "$REGISTRY" = "github" ]; then
    printf '  GitHub Packages guidance: configure @lordierclaw:registry=https://npm.pkg.github.com and set NODE_AUTH_TOKEN or GH_TOKEN in .npmrc/token setup\n'
    if ! has_github_packages_auth; then
      printf '    GitHub Packages auth missing: set NODE_AUTH_TOKEN or GH_TOKEN (or npm.pkg.github.com token in npm config) before install\n'
      CONFLICTS+=("GitHub Packages auth missing")
    fi
    if ! npm_registry_reachable "https://npm.pkg.github.com"; then
      printf '    GitHub Packages registry unreachable or auth failed before install\n'
      CONFLICTS+=("GitHub Packages registry unreachable or auth failed")
    fi
  else
    printf '  npmjs registry selected; on auth/network failure retry or choose --registry github with GitHub Packages token setup\n'
    if ! npm_registry_reachable "https://registry.npmjs.org"; then
      printf '    npmjs registry unreachable before install\n'
      CONFLICTS+=("npmjs registry unreachable")
    fi
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
        s|S|skip) WITH_WEB=0; WITH_TUI=0; CLIENT_MODE="auto"; printf 'Skipping optional clients after explicit interactive choice.\n' ;;
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
    printf 'ERROR: unsupported OS/architecture/platform; cannot install built terminal artifact for an explicit --with-tui request.\n' >&2
    exit 1
  fi
}

validate_built_client_mode() {
  if [ "$CLIENT_MODE" = "built" ] && [ "$WITH_TUI" -ne 1 ]; then
    printf 'ERROR: --client-mode built requires --with-tui so the installer can place a real built terminal artifact.\n' >&2
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
  if [ "$WITH_TUI" -eq 1 ]; then
    printf '  write client-mode record: BLUENOTE_CLIENT_MODE=built and BLUENOTE_BUILT_CLIENT_DIR=%s for built-binary mode\n' "$BUILT_CLIENT_DIR"
    printf '  managed built client executable: %s/bluenote-term\n' "$BUILT_CLIENT_DIR"
  fi
  printf '  preserve user notes/config/data; Never delete user notes/config/data during install\n'
  printf '  run after install: bluenote doctor\n'
  printf '  on failure: best-effort rollback current-run artifacts and print Recovery command\n'
}

run_cmd() { printf '+ %s\n' "$*"; [ "$DRY_RUN" -eq 1 ] || "$@"; }

track_replaced_file() {
  target="$1"
  if [ -e "$target" ]; then
    backup="$(mktemp "${TMPDIR:-/tmp}/bluenote-install-backup.XXXXXX")"
    cp -p -- "$target" "$backup"
    BACKUP_PATHS+=("$backup")
    BACKUP_TARGETS+=("$target")
  else
    NEW_PATHS+=("$target")
  fi
}

write_client_mode_record() {
  dir="$BUILT_CLIENT_DIR"
  config_dir="${BLUENOTE_CONFIG_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}}/bluenote"
  run_cmd mkdir -p "$dir" "$config_dir"
  if [ "$DRY_RUN" -eq 0 ]; then
    if [ -z "${BLUENOTE_TERM_ARTIFACT_PATH:-}" ] || [ ! -f "$BLUENOTE_TERM_ARTIFACT_PATH" ]; then
      printf 'ERROR: --with-tui requires BLUENOTE_TERM_ARTIFACT_PATH pointing to a Bun-free built terminal executable; no Bun-source fallback will be used.\n' >&2
      exit 1
    fi
    track_replaced_file "$dir/bluenote-term"
    track_replaced_file "$config_dir/client-mode.env"
    cp "$BLUENOTE_TERM_ARTIFACT_PATH" "$dir/bluenote-term"
    chmod 755 "$dir/bluenote-term"
    { printf 'BLUENOTE_CLIENT_MODE=built\n'; printf 'BLUENOTE_BUILT_CLIENT_DIR=%s\n' "$dir"; } > "$config_dir/client-mode.env"
  fi
  printf 'managed built client executable: %s/bluenote-term\n' "$dir"
  printf 'client-mode record: %s/client-mode.env\n' "$config_dir"
}

install_packages() {
  if [ "$REGISTRY" = "github" ]; then
    if [ "$DRY_RUN" -eq 0 ]; then
      previous_scope_registry="$(npm config get "$SCOPE_REGISTRY_KEY" 2>/dev/null || true)"
      if [ -n "$previous_scope_registry" ] && [ "$previous_scope_registry" != "undefined" ] && [ "$previous_scope_registry" != "null" ]; then
        PREVIOUS_SCOPE_REGISTRY="$previous_scope_registry"
        SCOPE_REGISTRY_WAS_SET=1
      fi
      REGISTRY_CONFIG_TOUCHED=1
    fi
    run_cmd npm config set "$SCOPE_REGISTRY_KEY" https://npm.pkg.github.com
  fi
  run_cmd npm install -g "@lordierclaw/bluenote@$TAG"
  [ "$DRY_RUN" -eq 1 ] || INSTALLED_PACKAGES+=("@lordierclaw/bluenote")
  if [ "$WITH_WEB" -eq 1 ]; then
    run_cmd npm install -g "@lordierclaw/bluenote-webui@$TAG"
    [ "$DRY_RUN" -eq 1 ] || INSTALLED_PACKAGES+=("@lordierclaw/bluenote-webui")
  fi
  if [ "$WITH_TUI" -eq 1 ]; then write_client_mode_record; fi
  run_cmd bluenote doctor
}

if [ "$DRY_RUN" -eq 0 ] && [ "$YES" -eq 0 ] && [ ! -t 0 ]; then
  printf 'ERROR: default install is interactive; use --yes for non-interactive automation.\n' >&2
  exit 1
fi
if [ "$DRY_RUN" -eq 0 ] && [ "$YES" -eq 0 ] && [ -t 0 ]; then
  interactive_prompt
fi
preflight
ensure_supported_built_tui
validate_built_client_mode
print_plan
if [ "$SIMULATE_FAILURE" -eq 1 ]; then false; fi
if [ "$DRY_RUN" -eq 1 ]; then printf 'Dry-run complete; no state mutated.\n'; exit 0; fi
install_packages
printf 'BlueNote install complete.\n'
