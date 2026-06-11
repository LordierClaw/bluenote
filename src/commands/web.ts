import type { CommandIo } from "../types"
import { importPublicPackage } from "../utils/lazy-import"
import { write } from "../utils/write"

type WebApi = {
  runWebCommand?: (args: string[], options?: Record<string, unknown>) => Promise<void | number> | void | number
  runCommand?: (args: string[], options?: Record<string, unknown>) => Promise<void | number> | void | number
}

export async function runWeb(args: string[] = [], io: CommandIo = {}): Promise<number> {
  let moduleNamespace: WebApi
  try {
    moduleNamespace = await importPublicPackage("bluenote-webui", io.clientLoader) as WebApi
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    write(io.stderr || process.stderr, `Unable to load bluenote-webui for \`bluenote web\`: ${message}\nInstall/build the public bluenote-webui package and retry.\n`)
    return 1
  }

  const command = moduleNamespace.runWebCommand || moduleNamespace.runCommand
  if (typeof command !== "function") {
    write(io.stderr || process.stderr, "bluenote-webui does not export runWebCommand or runCommand.\n")
    return 1
  }

  const result = await command(args, { stdout: io.stdout || process.stdout, stderr: io.stderr || process.stderr, env: io.env || process.env })
  return typeof result === "number" ? result : 0
}
