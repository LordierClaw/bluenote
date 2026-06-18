#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<'USAGE'
Usage: ./scripts/dev-install-local.sh [--web] [--tui] [--all] [--skip-check] [--dry-run]

Fast local developer linking for sibling BlueNote checkouts.
Default links the distribution CLI and WebUI. TUI is linked only with --tui or --all.
USAGE
}

include_web=1
include_tui=0
skip_check=0
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web) include_web=1 ;;
    --tui) include_tui=1 ;;
    --all) include_web=1; include_tui=1 ;;
    --skip-check) skip_check=1 ;;
    --dry-run) dry_run=1 ;;
    -h|--help) show_help; exit 0 ;;
    *) echo "Unknown option: $1" >&2; show_help >&2; exit 2 ;;
  esac
  shift
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bluenote_dir="$(cd -- "$script_dir/.." && pwd)"
workspace_dir="$(cd -- "$bluenote_dir/.." && pwd)"
webui_dir="$workspace_dir/bluenote-webui"
term_pkg_dir="$workspace_dir/bluenote-term/packages/term"

say() { printf '%s\n' "$*"; }

run() {
  if [[ "$dry_run" -eq 1 ]]; then
    printf '+ %q' "$1"
    shift
    for arg in "$@"; do printf ' %q' "$arg"; done
    printf '\n'
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
    echo "Missing sibling checkout: $dir" >&2
    exit 1
  fi
}

say "BlueNote local developer install/link"
say "bluenote: $bluenote_dir"
say "webui:    $webui_dir"
if [[ "$include_tui" -eq 1 ]]; then say "term:     $term_pkg_dir"; fi

require_command node
require_command npm
if [[ "$include_tui" -eq 1 ]]; then require_command bun; fi

require_dir "$bluenote_dir"
if [[ "$include_web" -eq 1 ]]; then require_dir "$webui_dir"; fi
if [[ "$include_tui" -eq 1 ]]; then require_dir "$term_pkg_dir"; fi

if [[ "$skip_check" -eq 0 ]]; then
  run_in "$bluenote_dir" npm run check
  if [[ "$include_web" -eq 1 ]]; then run_in "$webui_dir" npm run check; fi
  if [[ "$include_tui" -eq 1 ]]; then run_in "$workspace_dir/bluenote-term" bun run check; fi
else
  say "Skipping repo checks (--skip-check)."
fi

run_in "$bluenote_dir" npm link
if [[ "$include_web" -eq 1 ]]; then run_in "$webui_dir" npm link; fi
if [[ "$include_tui" -eq 1 ]]; then run_in "$term_pkg_dir" bun link; fi

if command -v bluenote >/dev/null 2>&1 || [[ "$dry_run" -eq 1 ]]; then
  run bluenote doctor
else
  say "bluenote is not on PATH yet; add npm/Bun global bins to PATH and run: bluenote doctor"
fi
