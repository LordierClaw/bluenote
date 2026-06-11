import { write } from "../utils/write"
import type { CommandIo } from "../types"

export const HELP_TEXT = `BlueNote distribution CLI

Usage: bluenote <command> [options]
       bn <command> [options]

Commands:
  tui [...args]             Launch the terminal interface via bluenote-term
  web [...args]             Launch the local WebUI via bluenote-webui
  daemon start|status|stop  Reserved local daemon scaffold
  doctor                    Check runtime and package availability
  version                   Print package versions

Options:
  -h, --help                Show this help message
`

export function runHelp(_args: string[] = [], io: CommandIo = {}): number {
  write(io.stdout || process.stdout, HELP_TEXT)
  return 0
}
