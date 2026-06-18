import fs from "fs"
import path from "path"

export type CommandDiscoveryOptions = {
  path?: string
  pathext?: string
  platform?: NodeJS.Platform
}

export type CommandResolution = {
  command: string
  path: string
}

export type ClientRuntimeMode = "auto" | "path" | "built"

export type ClientCommandResolution = CommandResolution & {
  mode: "path" | "built"
}

export type ClientCommandDiscoveryOptions = CommandDiscoveryOptions & {
  env?: NodeJS.ProcessEnv
  clientMode?: string
  builtClientDir?: string
}

export type ParsedClientModeArgs =
  | { ok: true; mode: ClientRuntimeMode; args: string[] }
  | { ok: false; message: string }

function isClientRuntimeMode(value: string | undefined): value is ClientRuntimeMode {
  return value === "path" || value === "built" || value === "auto"
}

function isExecutableFile(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    if (platform === "win32") return true
    return (stat.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function windowsCandidates(command: string, pathext: string): string[] {
  if (path.extname(command)) return [command]
  const extensions = pathext
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean)
  return [command, ...extensions.map((extension) => `${command}${extension}`)]
}

export function findCommandOnPath(command: string, options: CommandDiscoveryOptions = {}): CommandResolution | undefined {
  const searchPath = options.path !== undefined ? options.path : process.env.PATH || ""
  const platform = options.platform || process.platform
  const pathext = options.pathext !== undefined ? options.pathext : process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD"
  const pathEntries = searchPath.split(path.delimiter).filter(Boolean)
  const candidates = platform === "win32" ? windowsCandidates(command, pathext) : [command]

  for (const directory of pathEntries) {
    for (const candidate of candidates) {
      const candidatePath = path.resolve(directory, candidate)
      if (isExecutableFile(candidatePath, platform)) return { command, path: candidatePath }
    }
  }

  return undefined
}

export function normalizeClientRuntimeMode(value: string | undefined): ClientRuntimeMode {
  if (isClientRuntimeMode(value)) return value
  return "auto"
}

function invalidModeMessage(source: string, value: string): string {
  return `Invalid ${source} "${value}". Expected auto, path, or built.\n`
}

export function parseClientModeArgs(args: string[], env: NodeJS.ProcessEnv = process.env): ParsedClientModeArgs {
  const remaining: string[] = []
  let mode: ClientRuntimeMode = "auto"

  if (env.BLUENOTE_CLIENT_MODE !== undefined) {
    if (!isClientRuntimeMode(env.BLUENOTE_CLIENT_MODE)) return { ok: false, message: invalidModeMessage("BLUENOTE_CLIENT_MODE", env.BLUENOTE_CLIENT_MODE) }
    mode = env.BLUENOTE_CLIENT_MODE
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--client-mode") {
      const value = args[index + 1]
      if (!value || value.startsWith("--")) return { ok: false, message: "Missing value for --client-mode. Expected auto, path, or built.\n" }
      if (!isClientRuntimeMode(value)) return { ok: false, message: invalidModeMessage("--client-mode", value) }
      mode = value
      index += 1
      continue
    }
    if (arg.startsWith("--client-mode=")) {
      const value = arg.slice("--client-mode=".length)
      if (!isClientRuntimeMode(value)) return { ok: false, message: invalidModeMessage("--client-mode", value) }
      mode = value
      continue
    }
    remaining.push(arg)
  }

  return { ok: true, mode, args: remaining }
}

export function clientExecutableCandidates(command: string, platform: NodeJS.Platform, pathext?: string): string[] {
  if (platform === "win32") return windowsCandidates(command, pathext || ".EXE;.CMD;.BAT;.COM")
  return [command]
}

function findBuiltClient(command: string, options: ClientCommandDiscoveryOptions = {}): CommandResolution | undefined {
  const env = options.env || process.env
  const builtClientDir = options.builtClientDir || env.BLUENOTE_BUILT_CLIENT_DIR
  if (!builtClientDir) return undefined
  const platform = options.platform || process.platform
  const candidates = clientExecutableCandidates(command, platform, options.pathext || env.PATHEXT)
  for (const candidate of candidates) {
    const candidatePath = path.resolve(builtClientDir, candidate)
    if (isExecutableFile(candidatePath, platform)) return { command, path: candidatePath }
  }
  return undefined
}

export function resolveClientCommand(command: string, options: ClientCommandDiscoveryOptions = {}): ClientCommandResolution | undefined {
  const env = options.env || process.env
  const mode = normalizeClientRuntimeMode(options.clientMode || env.BLUENOTE_CLIENT_MODE)
  const platform = options.platform || process.platform
  const pathext = options.pathext !== undefined ? options.pathext : env.PATHEXT

  if (mode !== "path") {
    const built = findBuiltClient(command, { ...options, env, platform, pathext })
    if (built) return { ...built, mode: "built" }
    if (mode === "built") return undefined
  }

  const onPath = findCommandOnPath(command, { path: options.path !== undefined ? options.path : env.PATH, platform, pathext })
  if (onPath) return { ...onPath, mode: "path" }

  return undefined
}
