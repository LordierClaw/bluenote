import { spawn as defaultSpawn } from "child_process"

import type { CommandIo } from "../types"
import { parseClientModeArgs, resolveClientCommand } from "../utils/command-discovery"
import { readDaemonStatus } from "../utils/daemon-state"
import { buildWindowsShimInvocation, isWindowsShellShim } from "../utils/windows-shim"
import { write } from "../utils/write"

function daemonNotRunning(io: CommandIo): number {
  write(io.stderr || process.stderr, "BlueNote daemon is not running.\nRun: bluenote daemon start\n")
  return 1
}

function missingClient(io: CommandIo, command: string, mode: string): number {
  if (mode === "built") {
    write(io.stderr || process.stderr, `Built client ${command} was not found in BLUENOTE_BUILT_CLIENT_DIR. Install the BlueNote built client artifact, set BLUENOTE_BUILT_CLIENT_DIR to its directory, or retry with --client-mode path for PATH discovery.\n`)
    return 1
  }
  write(io.stderr || process.stderr, `Optional client ${command} was not found on PATH. Install it with npm install -g ${command} and retry.\n`)
  return 1
}

export async function runWeb(args: string[] = [], io: CommandIo = {}): Promise<number> {
  const env = io.env || process.env
  const daemon = await readDaemonStatus(env)
  if (daemon.state !== "running" || !daemon.metadata) return daemonNotRunning(io)
  const metadata = daemon.metadata
  const parsed = parseClientModeArgs(args, env)
  if (!parsed.ok) {
    write(io.stderr || process.stderr, parsed.message)
    return 1
  }

  const resolution = resolveClientCommand("bluenote-webui", { env, clientMode: parsed.mode, platform: io.platform || process.platform, pathext: env.PATHEXT })
  if (!resolution) return missingClient(io, "bluenote-webui", parsed.mode)

  const spawn = io.spawn || defaultSpawn
  return await new Promise<number>((resolve) => {
    let child
    try {
      const invocation = isWindowsShellShim(resolution.path, io.platform || process.platform)
        ? buildWindowsShimInvocation(resolution.path, parsed.args, env)
        : { command: resolution.path, args: parsed.args }
      child = spawn(invocation.command, invocation.args, {
        stdio: ["inherit", "inherit", "inherit"],
        env: {
          ...env,
          BLUENOTE_DAEMON_URL: metadata.url,
          BLUENOTE_DAEMON_TOKEN: metadata.token,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      write(io.stderr || process.stderr, `Unable to launch bluenote-webui: ${message}\n`)
      resolve(1)
      return
    }

    child.on("error", (error) => {
      write(io.stderr || process.stderr, `Unable to launch bluenote-webui: ${error.message}\n`)
      resolve(1)
    })
    child.on("exit", (code) => {
      resolve(code === null ? 1 : code)
    })
  })
}
