import { write } from "../utils/write"
import type { CommandIo } from "../types"

export const HELP_TEXT = `BlueNote distribution CLI

Usage: bluenote <command> [options]
       bn <command> [options]

Note commands:
  init                      Initialize a BlueNote root
  new [options] [body]      Create a note or draft
                            Options: --title, -t, --path
  list [--drafts|--all]     List notes (normal notes by default)
  show [--drafts|--all] <key|path>
                            Show a note's metadata and body
  search [--drafts|--all] <query>
                            Search note titles and bodies
  edit [--drafts|--all] <key|path>
                            Edit a note with $EDITOR
  archive [--drafts|--all] <key|path>
                            Move a note to the archive
  delete [--drafts|--all] <key|path> --force
                            Delete a note permanently
  rebuild                   Rebuild note indexes
  ai <command>              Configure AI and manage AI description jobs
  sync <command>            Link to a sync server and sync notes
                            Includes sync now and sync watch

Client and distribution commands:
  tui [...args]             Launch the terminal interface via bluenote-term
  term [...args]            Alias for tui
  web [...args]             Launch the local WebUI via bluenote-webui
  sync server start         Serve the current root as a remote sync core
  daemon start|status|stop  Manage the local BlueNote daemon
  doctor                    Check runtime, daemon, and optional clients
  version                   Print package versions

Examples:
  bluenote init
  bluenote new "Capture a note"
  bluenote list
  bluenote show <key|path>
  bluenote sync link --server http://remote:8765
  bluenote sync now
  bluenote sync watch --interval 30
  bluenote tui

Options:
  -h, --help                Show this help message
`

export function runHelp(_args: string[] = [], io: CommandIo = {}): number {
  write(io.stdout || process.stdout, HELP_TEXT)
  return 0
}
