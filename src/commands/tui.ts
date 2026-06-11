import { spawn as defaultSpawn } from "child_process"

import type { CommandIo } from "../types"
import { findCommandOnPath } from "../utils/command-discovery"
import { getDaemonConnection } from "../utils/daemon-state"
import { write } from "../utils/write"

function daemonNotRunning(io: CommandIo): number {
  write(io.stderr || process.stderr, "BlueNote daemon is not running.\nRun: bluenote daemon start\n")
  return 1
}

function missingClient(io: CommandIo, command: string): number {
  write(io.stderr || process.stderr, `Optional client ${command} was not found on PATH. Install it with npm install -g ${command} and retry.\n`)
  return 1
}

export async function runTui(args: string[] = [], io: CommandIo = {}): Promise<number> {
  const env = io.env || process.env
  const daemon = getDaemonConnection(env)
  if (!daemon) return daemonNotRunning(io)

  const resolution = findCommandOnPath("bluenote-term", { path: env.PATH, platform: io.platform || process.platform, pathext: env.PATHEXT })
  if (!resolution) return missingClient(io, "bluenote-term")

  const spawn = io.spawn || defaultSpawn
  return await new Promise<number>((resolve) => {
    let child
    try {
      child = spawn(resolution.path, args, {
        stdio: ["inherit", "inherit", "inherit"],
        env: {
          ...env,
          BLUENOTE_DAEMON_URL: daemon.url,
          BLUENOTE_DAEMON_TOKEN: daemon.token,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      write(io.stderr || process.stderr, `Unable to launch bluenote-term: ${message}\n`)
      resolve(1)
      return
    }

    child.on("error", (error) => {
      write(io.stderr || process.stderr, `Unable to launch bluenote-term: ${error.message}\n`)
      resolve(1)
    })
    child.on("exit", (code) => {
      resolve(code === null ? 1 : code)
    })
  })
}
