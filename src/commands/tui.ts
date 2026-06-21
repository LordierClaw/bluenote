import { spawn as defaultSpawn, spawnSync as defaultSpawnSync } from "child_process"

import type { CommandIo } from "../types"
import { installManagedBuiltTuiClient, tryRemoveStaleLegacyPortableClient } from "../utils/built-tui-install"
import { findCommandOnPath, parseClientModeArgs, resolveClientCommand } from "../utils/command-discovery"
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

function probeTuiRuntime(commandPath: string, env: NodeJS.ProcessEnv, io: CommandIo): { ok: boolean; message?: string } {
  const spawnSync = io.spawnSync || defaultSpawnSync
  const invocation = isWindowsShellShim(commandPath, io.platform || process.platform)
    ? buildWindowsShimInvocation(commandPath, ["--probe-tui-runtime"], env)
    : { command: commandPath, args: ["--probe-tui-runtime"] }
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env,
  })
  if (result.error) return { ok: false, message: result.error.message }
  if (result.status === 0) return { ok: true }
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : ""
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : ""
  return { ok: false, message: stderr || stdout || `exit ${result.status ?? 1}` }
}

async function installBuiltTui(io: CommandIo, env: NodeJS.ProcessEnv): Promise<{ command: string; path: string; mode: "built" }> {
  write(io.stderr || process.stderr, "Downloading the latest built BlueNote terminal artifact...\n")
  const installed = await installManagedBuiltTuiClient({ env, platform: io.platform || process.platform, spawnSync: io.spawnSync || defaultSpawnSync })
  return { command: "bluenote-term", path: installed.executablePath, mode: "built" }
}

function maybeCleanStaleLegacyPortableCandidate(commandPath: string, io: CommandIo, env: NodeJS.ProcessEnv): void {
  const cleanup = tryRemoveStaleLegacyPortableClient({
    candidatePath: commandPath,
    env,
    platform: io.platform || process.platform,
    spawnSync: io.spawnSync || defaultSpawnSync,
    currentExecutablePath: process.argv[1],
  })
  if (cleanup.removed && cleanup.removedPath) {
    write(io.stderr || process.stderr, `Removed stale legacy BlueNote portable binary: ${cleanup.removedPath}\n`)
    return
  }
  if (cleanup.skippedReason) {
    write(io.stderr || process.stderr, `Found stale-looking PATH client but skipped automatic cleanup: ${cleanup.skippedReason}\n`)
  }
}

export async function runTui(args: string[] = [], io: CommandIo = {}): Promise<number> {
  const env = io.env || process.env
  const daemon = await readDaemonStatus(env)
  if (daemon.state !== "running" || !daemon.metadata) return daemonNotRunning(io)
  const metadata = daemon.metadata
  const parsed = parseClientModeArgs(args, env)
  if (!parsed.ok) {
    write(io.stderr || process.stderr, parsed.message)
    return 1
  }

  let activeResolution = resolveClientCommand("bluenote-term", { env, clientMode: parsed.mode, platform: io.platform || process.platform, pathext: env.PATHEXT })
  if (!activeResolution) {
    if (parsed.mode === "auto") {
      const legacyPortableCandidate = findCommandOnPath("bn", { path: env.PATH, platform: io.platform || process.platform, pathext: env.PATHEXT })
      if (legacyPortableCandidate) {
        const probe = probeTuiRuntime(legacyPortableCandidate.path, {
          ...env,
          BLUENOTE_DAEMON_URL: metadata.url,
          BLUENOTE_DAEMON_TOKEN: metadata.token,
        }, io)
        if (!probe.ok) maybeCleanStaleLegacyPortableCandidate(legacyPortableCandidate.path, io, env)
      }
      try {
        activeResolution = await installBuiltTui(io, env)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        write(io.stderr || process.stderr, `Unable to install the built BlueNote terminal artifact automatically: ${message}\n`)
        return 1
      }
    } else {
      return missingClient(io, "bluenote-term", parsed.mode)
    }
  }

  if (activeResolution.mode === "path" && parsed.mode === "auto") {
    const probe = probeTuiRuntime(activeResolution.path, {
      ...env,
      BLUENOTE_DAEMON_URL: metadata.url,
      BLUENOTE_DAEMON_TOKEN: metadata.token,
    }, io)
    if (!probe.ok) {
      write(io.stderr || process.stderr, "Installed npm bluenote-term cannot launch the full TUI here.\n")
      maybeCleanStaleLegacyPortableCandidate(activeResolution.path, io, env)
      try {
        activeResolution = await installBuiltTui(io, env)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        write(io.stderr || process.stderr, `Unable to install the built BlueNote terminal artifact automatically: ${message}\n`)
        if (probe.message) write(io.stderr || process.stderr, `npm bluenote-term probe failed: ${probe.message}\n`)
        return 1
      }
    }
  }

  const spawn = io.spawn || defaultSpawn
  return await new Promise<number>((resolve) => {
    let child
    try {
      const invocation = isWindowsShellShim(activeResolution.path, io.platform || process.platform)
        ? buildWindowsShimInvocation(activeResolution.path, parsed.args, env)
        : { command: activeResolution.path, args: parsed.args }
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
