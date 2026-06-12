import { spawn as defaultSpawn } from "child_process"
import path from "path"

import type { CommandIo } from "../types"
import { getDaemonStatePath } from "../daemon/paths"
import { createDaemonToken } from "../daemon/token"
import { startDaemonServer } from "../daemon/server"
import { readOwnPackageInfo } from "../utils/package-info"
import { readDaemonStatus, removeDaemonMetadata, requestJson } from "../utils/daemon-state"
import { write } from "../utils/write"

const HELP_TEXT = `BlueNote daemon

Usage: bluenote daemon <start|status|stop>

Commands:
  start   Start the local BlueNote daemon
  status  Show daemon status and health
  stop    Stop the local BlueNote daemon
`

function binPath(): string {
  return path.resolve(__dirname, "..", "bin.js")
}

function parseServeArgs(args: string[], env: NodeJS.ProcessEnv = process.env): { statePath?: string; token?: string; version?: string } {
  const parsed: { statePath?: string; token?: string; version?: string } = { token: env.BLUENOTE_DAEMON_SERVE_TOKEN }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === "--state" && args[index + 1]) parsed.statePath = args[++index]
    else if (value === "--version" && args[index + 1]) parsed.version = args[++index]
  }
  return parsed
}

async function waitForRunning(env: NodeJS.ProcessEnv, deadlineMs: number): Promise<Awaited<ReturnType<typeof readDaemonStatus>>> {
  const deadline = Date.now() + deadlineMs
  let latest = await readDaemonStatus(env)
  while (Date.now() < deadline) {
    latest = await readDaemonStatus(env)
    if (latest.state === "running") return latest
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return latest
}

async function startDaemon(io: CommandIo): Promise<number> {
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr
  const env = io.env || process.env
  const existing = await readDaemonStatus(env)
  if (existing.state === "running" && existing.metadata) {
    write(stdout, `BlueNote daemon already running\nstatus: running\nendpoint: ${existing.metadata.url}\npid: ${existing.metadata.pid}\n`)
    return 0
  }
  if (existing.state === "stale") removeDaemonMetadata(env)

  const statePath = getDaemonStatePath(env)
  const token = createDaemonToken()
  const version = readOwnPackageInfo().version
  const spawn = io.spawn || defaultSpawn
  let child
  try {
    child = spawn(process.execPath, [binPath(), "daemon", "serve", "--state", statePath, "--version", version], {
      detached: true,
      stdio: "ignore",
      env: { ...env, BLUENOTE_DAEMON_SERVE_TOKEN: token },
    })
    child.unref()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    write(stderr, `Unable to start BlueNote daemon: ${message}\n`)
    return 1
  }

  const status = await waitForRunning(env, 5000)
  if (status.state !== "running" || !status.metadata) {
    if (child?.pid) {
      try {
        process.kill(child.pid, "SIGTERM")
      } catch {
        // best effort cleanup for failed starts
      }
    }
    write(stderr, "Unable to start BlueNote daemon: health check did not become ready.\n")
    return 1
  }

  write(stdout, `BlueNote daemon started\nstatus: running\nendpoint: ${status.metadata.url}\npid: ${status.metadata.pid}\n`)
  return 0
}

async function statusDaemon(io: CommandIo): Promise<number> {
  const stdout = io.stdout || process.stdout
  const status = await readDaemonStatus(io.env || process.env)
  write(stdout, `status: ${status.state}\n`)
  write(stdout, `endpoint: ${status.metadata ? status.metadata.url : "unavailable"}\n`)
  write(stdout, `pid: ${status.metadata?.pid || "unavailable"}\n`)
  write(stdout, `token: ${status.metadata?.token ? "present" : "missing"}\n`)
  write(stdout, `health: ${status.healthOk ? "ok" : status.state === "stopped" ? "not checked" : "failed"}\n`)
  return 0
}

async function stopDaemon(io: CommandIo): Promise<number> {
  const stdout = io.stdout || process.stdout
  const env = io.env || process.env
  const status = await readDaemonStatus(env)
  if (!status.metadata) {
    write(stdout, "BlueNote daemon is not running.\nstatus: stopped\n")
    return 0
  }

  if (status.state === "running") {
    try {
      await requestJson(`${status.metadata.url}/shutdown`, { method: "POST", token: status.metadata.token, timeoutMs: 1500 })
    } catch {
      try {
        process.kill(status.metadata.pid, "SIGTERM")
      } catch {
        // best effort
      }
    }
  } else {
    try {
      process.kill(status.metadata.pid, "SIGTERM")
    } catch {
      // best effort
    }
  }

  removeDaemonMetadata(env)
  write(stdout, "BlueNote daemon stopped\nstatus: stopped\n")
  return 0
}

export async function runDaemon(args: string[] = [], io: CommandIo = {}): Promise<number> {
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr
  const command = args[0]

  if (!command || command === "--help" || command === "-h" || command === "help") {
    write(stdout, HELP_TEXT)
    return 0
  }

  if (command === "serve") {
    const parsed = parseServeArgs(args.slice(1), io.env || process.env)
    if (!parsed.statePath || !parsed.token || !parsed.version) {
      write(stderr, "Missing daemon serve arguments.\n")
      return 1
    }
    await startDaemonServer({ statePath: parsed.statePath, token: parsed.token, version: parsed.version })
    return 0
  }

  if (command === "start") return await startDaemon(io)
  if (command === "status") return await statusDaemon(io)
  if (command === "stop") return await stopDaemon(io)

  write(stderr, `Unknown daemon command: ${command}\nRun "bluenote daemon --help" for usage.\n`)
  return 1
}
