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
