import type { CommandIo } from "./types"
import { runAiCommand } from "./commands/ai"
import { runDaemon } from "./commands/daemon"
import { runDoctor } from "./commands/doctor"
import { runHelp } from "./commands/help"
import { isNoteCommand, runNoteCommand } from "./commands/notes"
import { runSyncCommand } from "./commands/sync"
import { runTui } from "./commands/tui"
import { runVersion } from "./commands/version"
import { runWeb } from "./commands/web"
import { write } from "./utils/write"

export const COMMANDS = ["init", "new", "list", "show", "search", "edit", "archive", "delete", "rebuild", "ai", "sync", "tui", "term", "web", "daemon", "doctor", "version"] as const

export async function run(args: string[] = [], io: CommandIo = {}): Promise<number> {
  const [command, ...commandArgs] = args

  if (!command || command === "--help" || command === "-h" || command === "help") {
    return runHelp(commandArgs, io)
  }

  if (command === "version" || command === "--version") return runVersion(commandArgs, io)
  if (isNoteCommand(command)) return runNoteCommand(command, commandArgs, io)
  if (command === "ai") return runAiCommand(commandArgs, io)
  if (command === "sync") return runSyncCommand(commandArgs, io)
  if (command === "doctor") return runDoctor(commandArgs, io)
  if (command === "daemon") return runDaemon(commandArgs, io)
  if (command === "tui" || command === "term") return runTui(commandArgs, io)
  if (command === "web") return runWeb(commandArgs, io)

  write(io.stderr || process.stderr, `Unknown command: ${command}\nRun "bluenote --help" for usage.\n`)
  return 1
}

export async function main(args: string[] = process.argv.slice(2), io?: CommandIo): Promise<number> {
  const exitCode = await run(args, io)
  process.exitCode = exitCode
  return exitCode
}
