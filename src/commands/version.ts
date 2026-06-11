import type { CommandIo } from "../types"
import { readOwnPackageInfo, resolvePackageJson } from "../utils/package-info"
import { write } from "../utils/write"

const CLIENT_PACKAGES = ["@lordierclaw/bluenote-core", "bluenote-term", "bluenote-webui"]

export function runVersion(_args: string[] = [], io: CommandIo = {}): number {
  const own = readOwnPackageInfo()
  const lines = [`${own.name} ${own.version}`]

  for (const packageName of CLIENT_PACKAGES) {
    const resolution = resolvePackageJson(packageName)
    lines.push(`${packageName} ${resolution.version || (resolution.resolved ? "version unavailable" : "not installed")}`)
  }

  write(io.stdout || process.stdout, `${lines.join("\n")}\n`)
  return 0
}
