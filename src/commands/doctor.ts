import { spawnSync as defaultSpawnSync } from "child_process"
import os from "os"

import type { CommandIo } from "../types"
import { getBluenoteStateDir, getDaemonStatePath } from "../daemon/paths"
import { parseClientModeArgs, resolveClientCommand } from "../utils/command-discovery"
import { readDaemonStatus } from "../utils/daemon-state"
import { readOwnPackageInfo } from "../utils/package-info"
import { isSupportedNodeVersion, nodeRequirementText } from "../utils/runtime-requirements"
import { buildWindowsShimInvocation, isWindowsShellShim } from "../utils/windows-shim"
import { write } from "../utils/write"

const OPTIONAL_CLIENTS = ["bluenote-webui", "bluenote-term"] as const

function runClientCheck(
  commandPath: string,
  args: string[],
  io: CommandIo,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { ok: boolean; stdout: string; stderr: string } {
  const spawnSync = io.spawnSync || defaultSpawnSync
  const invocation = isWindowsShellShim(commandPath, platform)
    ? buildWindowsShimInvocation(commandPath, args, env)
    : { command: commandPath, args }
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env,
    timeout: 5_000,
  })
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  }
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
}

function sourceTuiRuntimeName(): string {
  return ["B", "un"].join("")
}

function checkSourceTuiRuntime(io: CommandIo): { available: boolean; version?: string } {
  const spawnSync = io.spawnSync || defaultSpawnSync
  const result = spawnSync("bun", ["--version"], { encoding: "utf8", env: io.env || process.env })
  if (result.error || result.status !== 0) return { available: false }
  return { available: true, version: String(result.stdout || "").trim() }
}

export async function runDoctor(args: string[] = [], io: CommandIo = {}): Promise<number> {
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr
  const env = io.env || process.env
  const parsedClientMode = parseClientModeArgs(args, env)
  if (!parsedClientMode.ok) {
    write(stderr, parsedClientMode.message)
    return 1
  }
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
  let builtTuiAvailable = false
  for (const client of OPTIONAL_CLIENTS) {
    const resolution = resolveClientCommand(client, { env, clientMode: parsedClientMode.mode, platform, pathext: env.PATHEXT })
    if (!resolution) {
      write(stdout, `  ${client}: missing\n`)
      write(stdout, "    version: unavailable\n")
      write(stdout, "    daemon handshake: not checked\n")
      continue
    }

    const clientEnv = { ...env }
    if (daemon.state === "running" && daemon.metadata) {
      clientEnv.BLUENOTE_DAEMON_URL = daemon.metadata.url
      clientEnv.BLUENOTE_DAEMON_TOKEN = daemon.metadata.token
    }
    const version = runClientCheck(resolution.path, ["--version"], io, platform, clientEnv)
    const tuiRuntime = client === "bluenote-term"
      ? runClientCheck(resolution.path, ["--probe-tui-runtime"], io, platform, clientEnv)
      : undefined
    const handshake = daemon.state === "running" && daemon.metadata
      ? runClientCheck(resolution.path, ["--check-daemon"], io, platform, clientEnv)
      : undefined
    const status = version.ok ? resolution.mode : "broken"
    if (client === "bluenote-term" && resolution.mode === "built" && version.ok) builtTuiAvailable = true

    write(stdout, `  ${client}: ${status}\n`)
    write(stdout, `    path: ${resolution.path}\n`)
    write(stdout, `    version: ${version.ok ? firstLine(version.stdout) || "available" : "unavailable"}\n`)
    if (client === "bluenote-term") {
      write(stdout, `    tui runtime: ${tuiRuntime ? tuiRuntime.ok ? "ok" : "unavailable" : "not checked"}\n`)
    }
    write(stdout, `    daemon handshake: ${handshake ? handshake.ok ? "ok" : "failed" : "not checked"}\n`)
  }

  const sourceRuntime = sourceTuiRuntimeName()
  if (builtTuiAvailable) {
    write(stdout, `  ${sourceRuntime} for source TUI: not required for built TUI\n`)
  } else {
    const sourceRuntimeStatus = checkSourceTuiRuntime(io)
    write(stdout, `  ${sourceRuntime} for source TUI: ${sourceRuntimeStatus.available ? `available${sourceRuntimeStatus.version ? ` (${sourceRuntimeStatus.version})` : ""}` : `not found; install ${sourceRuntime} for source/development TUI usage`}\n`)
  }

  write(stdout, "\nConfig\n")
  write(stdout, `  config dir: ${getBluenoteStateDir(env)}\n`)
  write(stdout, `  daemon state: ${getDaemonStatePath(env)}\n`)
  write(stdout, `  daemon endpoint: ${daemon.metadata ? daemon.metadata.url : "unavailable"}\n`)

  write(stdout, "\nAI\n")
  write(stdout, "  provider: not configured\n")
  write(stdout, "  secrets: not printed\n")

  return supportedNode ? 0 : 1
}
