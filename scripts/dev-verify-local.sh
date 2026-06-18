#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<'USAGE'
Usage: ./scripts/dev-verify-local.sh [--web] [--tui] [--all] [--keep-temp] [--dry-run]

Release-like local verification without publishing. The script packs local package
artifacts, installs them into a temporary npm prefix, and runs BlueNote commands
with isolated config/data/cache paths so real global npm packages and user notes
are not touched.
USAGE
}

include_web=0
include_tui=0
keep_temp=0
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web) include_web=1 ;;
    --tui) include_tui=1 ;;
    --all) include_web=1; include_tui=1 ;;
    --keep-temp) keep_temp=1 ;;
    --dry-run) dry_run=1 ;;
    -h|--help) show_help; exit 0 ;;
    *) echo "Unknown option: $1" >&2; show_help >&2; exit 2 ;;
  esac
  shift
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bluenote_dir="$(cd -- "$script_dir/.." && pwd)"
workspace_dir="$(cd -- "$bluenote_dir/.." && pwd)"
core_dir="$workspace_dir/bluenote-core"
webui_dir="$workspace_dir/bluenote-webui"
term_pkg_dir="$workspace_dir/bluenote-term/packages/term"

if [[ "$dry_run" -eq 1 ]]; then
  temp_root="${TMPDIR:-/tmp}/bluenote-verify-local.dry-run"
else
  temp_root="$(mktemp -d "${TMPDIR:-/tmp}/bluenote-verify-local.XXXXXX")"
fi
pack_dir="$temp_root/packs"
npm_prefix="$temp_root/npm-prefix"
npm_cache="$temp_root/npm-cache"
npm_config_file="$temp_root/npmrc"
config_home="$temp_root/config"
data_home="$temp_root/data"
cache_home="$temp_root/cache"
daemon_started=0

say() { printf '%s\n' "$*"; }

print_cmd() {
  printf '+ '
  local first=1
  for arg in "$@"; do
    if [[ "$first" -eq 0 ]]; then printf ' '; fi
    printf '%q' "$arg"
    first=0
  done
  printf '\n'
}

run() {
  if [[ "$dry_run" -eq 1 ]]; then
    print_cmd "$@"
  else
    "$@"
  fi
}

run_in() {
  local dir="$1"
  shift
  if [[ "$dry_run" -eq 1 ]]; then
    printf '+ cd %q &&' "$dir"
    for arg in "$@"; do printf ' %q' "$arg"; done
    printf '\n'
  else
    (cd "$dir" && "$@")
  fi
}

run_env() {
  if [[ "$dry_run" -eq 1 ]]; then
    printf '+ NPM_CONFIG_PREFIX=%q NPM_CONFIG_CACHE=%q NPM_CONFIG_USERCONFIG=%q BLUENOTE_CONFIG_HOME=%q BLUENOTE_DATA_HOME=%q BLUENOTE_CACHE_HOME=%q PATH=%q' \
      "$npm_prefix" "$npm_cache" "$npm_config_file" "$config_home" "$data_home" "$cache_home" "$npm_prefix/bin:$npm_prefix:$PATH"
    for arg in "$@"; do printf ' %q' "$arg"; done
    printf '\n'
  else
    NPM_CONFIG_PREFIX="$npm_prefix" \
    NPM_CONFIG_CACHE="$npm_cache" \
    NPM_CONFIG_USERCONFIG="$npm_config_file" \
    BLUENOTE_CONFIG_HOME="$config_home" \
    BLUENOTE_DATA_HOME="$data_home" \
    BLUENOTE_CACHE_HOME="$cache_home" \
    PATH="$npm_prefix/bin:$npm_prefix:$PATH" \
      "$@"
  fi
}

cleanup() {
  local exit_code=$?
  if [[ "$dry_run" -eq 1 ]]; then
    if [[ "$keep_temp" -eq 1 ]]; then
      say "+ keeping temp paths under $temp_root (--keep-temp)"
    else
      say "+ cleanup temp paths: rm -rf $temp_root"
    fi
    return "$exit_code"
  fi

  if [[ "$daemon_started" -eq 1 ]]; then
    run_env bluenote daemon stop >/dev/null 2>&1 || true
    daemon_started=0
  fi

  if [[ "$keep_temp" -eq 1 ]]; then
    say "Keeping temp paths under $temp_root (--keep-temp)."
  else
    rm -rf "$temp_root"
  fi
  return "$exit_code"
}
trap cleanup EXIT

require_command() {
  local command_name="$1"
  if [[ "$dry_run" -eq 1 ]]; then
    say "+ command -v $command_name"
    return 0
  fi
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

require_dir() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    echo "Missing checkout/package directory: $dir" >&2
    exit 1
  fi
}

pack_package() {
  local package_dir="$1"
  local tarball_name
  tarball_name="$(cd "$package_dir" && npm pack --pack-destination "$pack_dir" | tail -n 1)"
  printf '%s/%s\n' "$pack_dir" "$tarball_name"
}

pack_package_ignore_scripts() {
  local package_dir="$1"
  local tarball_name
  tarball_name="$(cd "$package_dir" && npm pack --ignore-scripts --pack-destination "$pack_dir" | tail -n 1)"
  printf '%s/%s\n' "$pack_dir" "$tarball_name"
}

stage_package_with_local_core() {
  local package_dir="$1"
  local label="$2"
  local core_tarball="$3"
  local stage_dir="$temp_root/stage/$label"
  rm -rf "$stage_dir"
  mkdir -p "$stage_dir"
  node - "$package_dir" "$stage_dir" "$core_tarball" <<'NODE'
const fs = require('fs');
const path = require('path');
const [sourceDir, stageDir, coreTarball] = process.argv.slice(2);
const pkgPath = path.join(sourceDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
for (const entry of pkg.files || []) {
  const from = path.join(sourceDir, entry);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(stageDir, entry), { recursive: true });
}
for (const entry of ['README.md', 'LICENSE']) {
  const from = path.join(sourceDir, entry);
  if (fs.existsSync(from) && !fs.existsSync(path.join(stageDir, entry))) fs.copyFileSync(from, path.join(stageDir, entry));
}
if (pkg.dependencies && pkg.dependencies['@lordierclaw/bluenote-core']) {
  pkg.dependencies['@lordierclaw/bluenote-core'] = `file:${coreTarball}`;
}
if (pkg.devDependencies) delete pkg.devDependencies;
if (pkg.scripts) {
  delete pkg.scripts.prepare;
  delete pkg.scripts.prepack;
  delete pkg.scripts.prepublishOnly;
}
fs.writeFileSync(path.join(stageDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
NODE
  pack_package_ignore_scripts "$stage_dir"
}

pack_package_dry_run() {
  local package_dir="$1"
  local label="$2"
  run_in "$package_dir" npm pack --pack-destination "$pack_dir"
  printf '%s/%s-local.tgz\n' "$pack_dir" "$label"
}

say "BlueNote local packed-artifact verification"
say "bluenote: $bluenote_dir"
say "core:     $core_dir"
if [[ "$include_web" -eq 1 ]]; then say "webui:    $webui_dir"; fi
if [[ "$include_tui" -eq 1 ]]; then say "term:     $term_pkg_dir"; fi
say "temp:     $temp_root"
say "npm prefix: $npm_prefix"
say "state:    $config_home | $data_home | $cache_home"

require_command node
require_command npm
require_dir "$core_dir"
require_dir "$bluenote_dir"
if [[ "$include_web" -eq 1 ]]; then require_dir "$webui_dir"; fi
if [[ "$include_tui" -eq 1 ]]; then require_dir "$term_pkg_dir"; fi

run mkdir -p "$pack_dir" "$npm_prefix" "$npm_cache" "$config_home" "$data_home" "$cache_home"
if [[ "$dry_run" -eq 0 ]]; then
  printf 'cache=%s\n' "$npm_cache" >"$npm_config_file"
fi

# Build before packing so package tarballs contain fresh runtime artifacts.
run_in "$core_dir" npm run build
run_in "$bluenote_dir" npm run build
if [[ "$include_web" -eq 1 ]]; then run_in "$webui_dir" npm run build; fi

if [[ "$dry_run" -eq 1 ]]; then
  pack_package_dry_run "$core_dir" "lordierclaw-bluenote-core"
  core_tarball="$pack_dir/lordierclaw-bluenote-core-local.tgz"
  say "+ stage package manifests with @lordierclaw/bluenote-core=file:$core_tarball"
  pack_package_dry_run "$bluenote_dir" "lordierclaw-bluenote"
  bluenote_tarball="$pack_dir/lordierclaw-bluenote-local.tgz"
  webui_tarball=""
  term_tarball=""
  if [[ "$include_web" -eq 1 ]]; then
    pack_package_dry_run "$webui_dir" "lordierclaw-bluenote-webui"
    webui_tarball="$pack_dir/lordierclaw-bluenote-webui-local.tgz"
  fi
  if [[ "$include_tui" -eq 1 ]]; then
    pack_package_dry_run "$term_pkg_dir" "lordierclaw-bluenote-term"
    term_tarball="$pack_dir/lordierclaw-bluenote-term-local.tgz"
  fi
else
  core_tarball="$(pack_package_ignore_scripts "$core_dir")"
  bluenote_tarball="$(stage_package_with_local_core "$bluenote_dir" "bluenote" "$core_tarball")"
  webui_tarball=""
  term_tarball=""
  if [[ "$include_web" -eq 1 ]]; then webui_tarball="$(stage_package_with_local_core "$webui_dir" "bluenote-webui" "$core_tarball")"; fi
  if [[ "$include_tui" -eq 1 ]]; then term_tarball="$(stage_package_with_local_core "$term_pkg_dir" "bluenote-term" "$core_tarball")"; fi
fi

run_env npm install -g "$bluenote_tarball"
if [[ "$include_web" -eq 1 ]]; then run_env npm install -g "$webui_tarball"; fi
if [[ "$include_tui" -eq 1 ]]; then run_env npm install -g "$term_tarball"; fi

run_env bluenote --help
run_env bluenote version
run_env bluenote doctor
run_env bluenote daemon start
daemon_started=1
run_env bluenote daemon status
run_env bluenote doctor
run_env bluenote daemon stop
daemon_started=0
run_env bluenote daemon status

say "BlueNote local packed-artifact verification complete."
