import { spawn as defaultSpawn } from "child_process"
import path from "path"

import type { CommandIo } from "../types"
import { findPackageBin } from "../utils/package-info"
import { write } from "../utils/write"

function writeRuntimeError(io: CommandIo, detail?: string): number {
  const stderr = io.stderr || process.stderr
  write(stderr, "Unable to run `bluenote tui` in the current runtime.\n")
  if (detail) write(stderr, `${detail}\n`)
  write(stderr, "The terminal UI is provided by bluenote-term and requires Bun/OpenTUI. Install Bun and ensure the public bluenote-term package is installed, then retry.\n")
  return 1
}

export async function runTui(args: string[] = [], io: CommandIo = {}): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return writeRuntimeError(io, "The TUI requires an interactive terminal (TTY).")
  }

  const binPath = findPackageBin("bluenote-term", "bn")
  if (!binPath) return writeRuntimeError(io, "Could not resolve the public bluenote-term bin.")

  const spawn = io.spawn || defaultSpawn
  return await new Promise<number>((resolve) => {
    let child
    try {
      child = spawn("bun", [binPath, "tui", ...args], {
        stdio: ["inherit", "inherit", "inherit"],
        cwd: path.dirname(binPath),
        env: io.env || process.env,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      resolve(writeRuntimeError(io, message))
      return
    }

    child.on("error", (error) => {
      resolve(writeRuntimeError(io, error.message))
    })
    child.on("exit", (code) => {
      resolve(code === null ? 1 : code)
    })
  })
}
