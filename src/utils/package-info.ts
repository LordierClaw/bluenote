import path from "path"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const requireFunc = require

export interface PackageInfo {
  name: string
  version: string
  path?: string
}

export interface PackageResolution {
  name: string
  resolved: boolean
  path?: string
  version?: string
  error?: string
}

export function readOwnPackageInfo(): PackageInfo {
  const packageJson = requireFunc("../../package.json") as { name: string; version: string }
  return { name: packageJson.name, version: packageJson.version }
}

export function resolvePackageJson(packageName: string): PackageResolution {
  try {
    const packageJsonPath = requireFunc.resolve(`${packageName}/package.json`)
    const packageJson = requireFunc(packageJsonPath) as { version?: string }
    return { name: packageName, resolved: true, path: packageJsonPath, version: packageJson.version }
  } catch (packageJsonError) {
    try {
      const resolvedPath = requireFunc.resolve(packageName)
      return { name: packageName, resolved: true, path: resolvedPath }
    } catch (resolveError) {
      const error = resolveError instanceof Error ? resolveError.message : String(resolveError)
      return { name: packageName, resolved: false, error }
    }
  }
}

export function findPackageBin(packageName: string, binName: string): string | null {
  const resolution = resolvePackageJson(packageName)
  if (!resolution.resolved || !resolution.path) return null
  try {
    const packageJsonPath = resolution.path.endsWith("package.json")
      ? resolution.path
      : requireFunc.resolve(`${packageName}/package.json`)
    const packageJson = requireFunc(packageJsonPath) as { bin?: string | Record<string, string> }
    const binValue = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binName]
    return binValue ? path.resolve(path.dirname(packageJsonPath), binValue) : null
  } catch {
    return null
  }
}
