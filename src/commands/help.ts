import { write } from "../utils/write"
import type { CommandIo } from "../types"

export const HELP_TEXT = `BlueNote distribution CLI

Usage: bluenote <command> [options]
       bn <command> [options]

Commands:
  tui [...args]             Launch the terminal interface via bluenote-term
  term [...args]            Alias for tui
  web [...args]             Launch the local WebUI via bluenote-webui
  daemon start|status|stop  Manage the local BlueNote daemon
  doctor                    Check runtime, daemon, and optional clients
  version                   Print package versions

Options:
  -h, --help                Show this help message
`

export function runHelp(_args: string[] = [], io: CommandIo = {}): number {
  write(io.stdout || process.stdout, HELP_TEXT)
  return 0
}
