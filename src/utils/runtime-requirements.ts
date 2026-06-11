export interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

export function parseVersion(version: string): ParsedVersion | null {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function isSupportedNodeVersion(version: string): boolean {
  const parsed = parseVersion(version)
  if (!parsed) return false
  if (parsed.major === 16) {
    return parsed.minor > 14 || (parsed.minor === 14 && parsed.patch >= 0)
  }
  if (parsed.major === 17) return false
  return parsed.major >= 18
}

export function nodeRequirementText(): string {
  return ">=16.14 <17 || >=18"
}
