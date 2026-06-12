import { spawnSync as defaultSpawnSync } from "child_process"
import os from "os"

import type { CommandIo } from "../types"
import { getBluenoteStateDir, getDaemonStatePath } from "../daemon/paths"
import { findCommandOnPath } from "../utils/command-discovery"
import { readDaemonStatus } from "../utils/daemon-state"
import { readOwnPackageInfo } from "../utils/package-info"
import { isSupportedNodeVersion, nodeRequirementText } from "../utils/runtime-requirements"
import { write } from "../utils/write"

const OPTIONAL_CLIENTS = ["bluenote-webui", "bluenote-term"] as const

function checkBun(io: CommandIo): { available: boolean; version?: string } {
  const spawnSync = io.spawnSync || defaultSpawnSync
  const result = spawnSync("bun", ["--version"], { encoding: "utf8", env: io.env || process.env })
  if (result.error || result.status !== 0) return { available: false }
  return { available: true, version: String(result.stdout || "").trim() }
}

export async function runDoctor(_args: string[] = [], io: CommandIo = {}): Promise<number> {
  const stdout = io.stdout || process.stdout
  const env = io.env || process.env
  const nodeVersion = io.nodeVersion || process.versions.node
  const platform = io.platform || process.platform
  const supportedNode = isSupportedNodeVersion(nodeVersion)
  const ownPackage = readOwnPackageInfo()

  write(stdout, "BlueNote doctor\n\n")
  write(stdout, "Distribution\n")
  write(stdout, "  command: ok\n")
  write(stdout, `  version: ${ownPackage.version}\n`)
  write(stdout, `  platform: ${platform} (${os.arch()})\n`)
  write(stdout, `  node: ${supportedNode ? "ok" : "unsupported"} (${nodeVersion}; requires ${nodeRequirementText()})\n`)
  write(stdout, `Node status: ${supportedNode ? "ok" : "unsupported"}\n`)

  const daemon = await readDaemonStatus(env)
  write(stdout, "\nDaemon\n")
  write(stdout, `  status: ${daemon.state}\n`)
  write(stdout, `  endpoint: ${daemon.metadata ? daemon.metadata.url : "unavailable"}\n`)
  write(stdout, `  pid: ${daemon.metadata?.pid || "unavailable"}\n`)
  write(stdout, `  token: ${daemon.metadata?.token ? "present" : "missing"}\n`)
  write(stdout, `  health: ${daemon.healthOk ? "ok" : daemon.state === "stopped" ? "not checked" : "failed"}\n`)

  write(stdout, "\nClients\n")
  for (const client of OPTIONAL_CLIENTS) {
    const resolution = findCommandOnPath(client, { path: env.PATH, platform, pathext: env.PATHEXT })
    write(stdout, `  ${client}: ${resolution ? "found" : "missing"}\n`)
    if (resolution) write(stdout, `    path: ${resolution.path}\n`)
    write(stdout, "    version: unavailable\n")
    write(stdout, `    daemon handshake: ${daemon.state === "running" ? "not checked" : "not checked"}\n`)
  }

  const bun = checkBun(io)
  write(stdout, `  Bun for TUI: ${bun.available ? `available${bun.version ? ` (${bun.version})` : ""}` : "not found; install Bun to run bluenote tui"}\n`)

  write(stdout, "\nConfig\n")
  write(stdout, `  config dir: ${getBluenoteStateDir(env)}\n`)
  write(stdout, `  daemon state: ${getDaemonStatePath(env)}\n`)
  write(stdout, `  daemon endpoint: ${daemon.metadata ? daemon.metadata.url : "unavailable"}\n`)

  write(stdout, "\nAI\n")
  write(stdout, "  provider: not configured\n")
  write(stdout, "  secrets: not printed\n")

  return supportedNode ? 0 : 1
}
