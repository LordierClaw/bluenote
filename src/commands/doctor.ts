import { spawnSync as defaultSpawnSync } from "child_process"
import os from "os"

import type { CommandIo } from "../types"
import { resolvePackageJson } from "../utils/package-info"
import { isSupportedNodeVersion, nodeRequirementText } from "../utils/runtime-requirements"
import { write } from "../utils/write"

const CLIENT_PACKAGES = ["@lordierclaw/bluenote-core", "bluenote-term", "bluenote-webui"]

function checkBun(io: CommandIo): { available: boolean; version?: string } {
  const spawnSync = io.spawnSync || defaultSpawnSync
  const result = spawnSync("bun", ["--version"], { encoding: "utf8" })
  if (result.error || result.status !== 0) return { available: false }
  return { available: true, version: String(result.stdout || "").trim() }
}

export function runDoctor(_args: string[] = [], io: CommandIo = {}): number {
  const stdout = io.stdout || process.stdout
  const nodeVersion = io.nodeVersion || process.versions.node
  const platform = io.platform || process.platform
  const supportedNode = isSupportedNodeVersion(nodeVersion)
  let ok = supportedNode

  write(stdout, "BlueNote doctor\n")
  write(stdout, `Platform: ${platform} (${os.arch()})\n`)
  write(stdout, `Node version: ${nodeVersion}\n`)
  write(stdout, `Node requirement: ${nodeRequirementText()}\n`)
  write(stdout, `Node status: ${supportedNode ? "ok" : "unsupported"}\n`)

  for (const packageName of CLIENT_PACKAGES) {
    const resolution = resolvePackageJson(packageName)
    if (!resolution.resolved) ok = false
    write(stdout, `Package ${packageName}: ${resolution.resolved ? `ok${resolution.version ? ` (${resolution.version})` : ""}` : "missing"}\n`)
  }

  const bun = checkBun(io)
  write(stdout, `Bun for TUI: ${bun.available ? `available${bun.version ? ` (${bun.version})` : ""}` : "not found; install Bun to run bluenote tui"}\n`)

  return ok ? 0 : 1
}
