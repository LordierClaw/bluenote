import type { CommandIo } from "../types"
import { write } from "../utils/write"

const HELP_TEXT = `BlueNote daemon scaffold

Usage: bluenote daemon <start|status|stop>

The local single-runtime daemon is future work. This command surface is reserved
for a later cross-repo daemon/runtime/sync design; no daemon or sync service is
started, queried, or stopped by this scaffold.
`

function scaffoldMessage(action: string): string {
  return `bluenote daemon ${action} is not implemented yet. The local single-runtime daemon requires a future cross-repo design; no daemon or sync service was ${action === "status" ? "queried" : action === "start" ? "started" : "stopped"}.\n`
}

export function runDaemon(args: string[] = [], io: CommandIo = {}): number {
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr
  const command = args[0]

  if (!command || command === "--help" || command === "-h" || command === "help") {
    write(stdout, HELP_TEXT)
    return 0
  }

  if (command === "start" || command === "status" || command === "stop") {
    write(stdout, scaffoldMessage(command))
    return 0
  }

  write(stderr, `Unknown daemon command: ${command}\nRun "bluenote daemon --help" for usage.\n`)
  return 1
}
