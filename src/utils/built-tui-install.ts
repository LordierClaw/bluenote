import { spawnSync as defaultSpawnSync } from "child_process"
import fs from "fs"
import https from "https"
import os from "os"
import path from "path"

import { getClientModeConfigPath, readPersistedClientMode } from "./command-discovery"

export type LegacyPortableCleanupResult = {
  removed: boolean
  skippedReason?: string
  removedPath?: string
}

const TERM_RELEASE_REPO = "LordierClaw/bluenote-term"

type SyncSpawn = typeof import("child_process").spawnSync

type BuiltTuiAsset = {
  archiveExtension: ".zip" | ".tar.gz"
  executableName: "bluenote-term.exe" | "bluenote-term"
  executableDestinationName: "bluenote-term.exe" | "bluenote-term"
  platformId: "windows-x64" | "linux-x64"
}

function detectBuiltTuiAsset(platform: NodeJS.Platform, arch: string): BuiltTuiAsset | undefined {
  if (platform === "win32" && arch === "x64") {
    return {
      platformId: "windows-x64",
      archiveExtension: ".zip",
      executableName: "bluenote-term.exe",
      executableDestinationName: "bluenote-term.exe",
    }
  }
  if (platform === "linux" && arch === "x64") {
    return {
      platformId: "linux-x64",
      archiveExtension: ".tar.gz",
      executableName: "bluenote-term",
      executableDestinationName: "bluenote-term",
    }
  }
  return undefined
}

function defaultBuiltClientDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const persisted = readPersistedClientMode(env)
  if (env.BLUENOTE_BUILT_CLIENT_DIR) return env.BLUENOTE_BUILT_CLIENT_DIR
  if (persisted.builtClientDir) return persisted.builtClientDir
  if (platform === "win32") return path.join(os.homedir(), "AppData", "Local", "BlueNote", "clients")
  return path.join(os.homedir(), ".local", "share", "bluenote", "clients")
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
}

function runSpawnSync(spawnSync: SyncSpawn, command: string, args: string[], options: Parameters<SyncSpawn>[2] = {}): void {
  const result = spawnSync(command, args, { encoding: "utf8", ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : ""
    throw new Error(stderr || `Command failed: ${command} ${args.join(" ")}`)
  }
}

function download(url: string, destinationPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const visit = (target: string, redirectsRemaining: number) => {
      const request = https.get(target, {
        headers: {
          "User-Agent": "BlueNote-CLI",
          Accept: "application/vnd.github+json",
        },
      }, (response) => {
        const location = response.headers.location
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
          response.resume()
          if (redirectsRemaining <= 0) {
            reject(new Error(`Too many redirects while downloading ${target}`))
            return
          }
          visit(location, redirectsRemaining - 1)
          return
        }
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`Download failed for ${target}: HTTP ${response.statusCode ?? "unknown"}`))
          return
        }
        const output = fs.createWriteStream(destinationPath)
        response.pipe(output)
        output.on("finish", () => output.close(() => resolve()))
        output.on("error", reject)
      })
      request.on("error", reject)
    }
    visit(url, 5)
  })
}

async function fetchJson(url: string): Promise<unknown> {
  const tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bluenote-release-json-")), "response.json")
  await download(url, tempPath)
  try {
    return JSON.parse(fs.readFileSync(tempPath, "utf8"))
  } finally {
    fs.rmSync(path.dirname(tempPath), { recursive: true, force: true })
  }
}

async function resolveReleaseArchivePath(env: NodeJS.ProcessEnv, asset: BuiltTuiAsset): Promise<{ archivePath: string; cleanupDir?: string }> {
  if (env.BLUENOTE_TERM_RELEASE_ARCHIVE_PATH) {
    return { archivePath: env.BLUENOTE_TERM_RELEASE_ARCHIVE_PATH }
  }

  const releaseJsonUrl = env.BLUENOTE_TERM_RELEASE_JSON_URL || `https://api.github.com/repos/${TERM_RELEASE_REPO}/releases/latest`
  const release = await fetchJson(releaseJsonUrl) as {
    assets?: Array<{ name?: string; browser_download_url?: string }>
    tag_name?: string
  }
  const expectedSuffix = `${asset.platformId}${asset.archiveExtension}`
  const matchedAsset = release.assets?.find((entry) => typeof entry.name === "string" && entry.name.endsWith(expectedSuffix))
  if (!matchedAsset?.browser_download_url) {
    throw new Error(`Latest ${TERM_RELEASE_REPO} release ${release.tag_name || "<unknown>"} does not include a ${expectedSuffix} asset.`)
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bluenote-term-release-"))
  const archivePath = path.join(tempDir, matchedAsset.name || `bluenote-${expectedSuffix}`)
  await download(matchedAsset.browser_download_url, archivePath)
  return { archivePath, cleanupDir: tempDir }
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function extractArchivePackageDir(archivePath: string, extractRoot: string, asset: BuiltTuiAsset, spawnSync: SyncSpawn): string {
  const extractedPackageDir = path.join(extractRoot, "bluenote")
  if (asset.archiveExtension === ".zip") {
    runSpawnSync(spawnSync, "powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${psSingleQuote(archivePath)} -DestinationPath ${psSingleQuote(extractRoot)} -Force`,
    ])
  } else {
    runSpawnSync(spawnSync, "tar", ["-xzf", archivePath, "-C", extractRoot])
  }
  const extractedExecutable = path.join(extractedPackageDir, asset.executableName)
  if (!fs.existsSync(extractedExecutable)) {
    throw new Error(`Built TUI archive did not contain ${path.join("bluenote", asset.executableName)}.`)
  }
  return extractedPackageDir
}

function copyExtractedPackageContents(packageDir: string, destinationDir: string, asset: BuiltTuiAsset, platform: NodeJS.Platform): string {
  const entries = fs.readdirSync(packageDir, { withFileTypes: true })
  let executablePath = ""
  for (const entry of entries) {
    const sourcePath = path.join(packageDir, entry.name)
    const targetName = entry.name === asset.executableName ? asset.executableDestinationName : entry.name
    const targetPath = path.join(destinationDir, targetName)
    if (entry.isDirectory()) {
      fs.cpSync(sourcePath, targetPath, { recursive: true })
      continue
    }
    fs.copyFileSync(sourcePath, targetPath)
    if (platform !== "win32" && targetName === asset.executableDestinationName) {
      fs.chmodSync(targetPath, 0o755)
    }
    if (targetName === asset.executableDestinationName) executablePath = targetPath
  }
  if (!executablePath) {
    throw new Error(`Built TUI archive did not produce ${asset.executableDestinationName}.`)
  }
  return executablePath
}

function readTrimmedSpawnOutput(spawnSync: SyncSpawn, command: string, args: string[], env: NodeJS.ProcessEnv): string | undefined {
  const result = spawnSync(command, args, { encoding: "utf8", env })
  if (result.error || result.status !== 0) return undefined
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : ""
  return stdout || undefined
}

function isLegacyPortableExecutableName(candidatePath: string, platform: NodeJS.Platform): boolean {
  const basename = path.basename(candidatePath)
  if (platform === "win32") return basename.toLowerCase() === "bn.exe"
  return basename === "bn"
}

function directoryLooksLikeLegacyPortableArtifact(directoryPath: string): boolean {
  const sqlWasmPath = path.join(directoryPath, "sql-wasm.wasm")
  const readmePath = path.join(directoryPath, "README.txt")
  if (!fs.existsSync(sqlWasmPath) || !fs.existsSync(readmePath)) return false
  try {
    const readme = fs.readFileSync(readmePath, "utf8")
    return /bluenote/i.test(readme) && /portable|legacy\s+bn|standalone/i.test(readme)
  } catch {
    return false
  }
}

function isWritableDirectory(directoryPath: string): boolean {
  try {
    fs.accessSync(directoryPath, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function isWithinDirectory(candidatePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(candidatePath))
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
}

function npmGlobalBinDirectories(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, spawnSync: SyncSpawn): string[] {
  const prefixes = [
    readTrimmedSpawnOutput(spawnSync, "npm", ["prefix", "-g"], env),
    readTrimmedSpawnOutput(spawnSync, "npm", ["config", "get", "prefix"], env),
  ].filter((value): value is string => Boolean(value))
  const directories = new Set<string>()
  for (const prefix of prefixes) {
    directories.add(path.resolve(prefix))
    if (platform === "win32") {
      directories.add(path.resolve(prefix))
      directories.add(path.resolve(prefix, "node_modules", ".bin"))
    } else {
      directories.add(path.resolve(prefix, "bin"))
    }
  }
  return [...directories]
}

export function tryRemoveStaleLegacyPortableClient(options: {
  candidatePath: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  spawnSync?: SyncSpawn
  currentExecutablePath?: string
}): LegacyPortableCleanupResult {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const spawnSync = options.spawnSync || defaultSpawnSync
  const candidatePath = path.resolve(options.candidatePath)
  const candidateDir = path.dirname(candidatePath)

  if (!isLegacyPortableExecutableName(candidatePath, platform)) return { removed: false }
  if (!directoryLooksLikeLegacyPortableArtifact(candidateDir)) return { removed: false, skippedReason: "portable artifact markers were inconclusive" }
  if (!isWritableDirectory(candidateDir)) return { removed: false, skippedReason: "candidate directory is not user-writable" }

  if (options.currentExecutablePath) {
    try {
      if (fs.realpathSync(options.currentExecutablePath) === fs.realpathSync(candidatePath)) {
        return { removed: false, skippedReason: "candidate matches the current distribution binary" }
      }
    } catch {
      if (path.resolve(options.currentExecutablePath) === candidatePath) {
        return { removed: false, skippedReason: "candidate matches the current distribution binary" }
      }
    }
  }

  const npmBinDirs = npmGlobalBinDirectories(env, platform, spawnSync)
  if (npmBinDirs.some((directoryPath) => isWithinDirectory(candidatePath, directoryPath))) {
    return { removed: false, skippedReason: "candidate is inside an npm global bin/shim directory" }
  }

  try {
    fs.rmSync(candidatePath, { force: true })
    return { removed: true, removedPath: candidatePath }
  } catch (error) {
    return { removed: false, skippedReason: error instanceof Error ? error.message : String(error) }
  }
}

export async function installManagedBuiltTuiClient(options: {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: string
  spawnSync?: SyncSpawn
} = {}): Promise<{ executablePath: string; builtClientDir: string }> {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const arch = options.arch || process.arch
  const spawnSync = options.spawnSync || defaultSpawnSync
  const asset = detectBuiltTuiAsset(platform, arch)
  if (!asset) {
    throw new Error(`Automatic built TUI installation is not supported on ${platform}/${arch}.`)
  }

  const builtClientDir = defaultBuiltClientDir(env, platform)
  const configPath = getClientModeConfigPath(env)
  ensureDirectory(builtClientDir)
  ensureDirectory(path.dirname(configPath))

  let executablePath: string
  if (env.BLUENOTE_TERM_ARTIFACT_PATH) {
    executablePath = path.join(builtClientDir, asset.executableDestinationName)
    fs.copyFileSync(env.BLUENOTE_TERM_ARTIFACT_PATH, executablePath)
  } else {
    const { archivePath, cleanupDir } = await resolveReleaseArchivePath(env, asset)
    const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bluenote-term-extract-"))
    let extractedPackageDir: string | undefined
    try {
      extractedPackageDir = extractArchivePackageDir(archivePath, extractRoot, asset, spawnSync)
      executablePath = copyExtractedPackageContents(extractedPackageDir, builtClientDir, asset, platform)
    } finally {
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true })
      fs.rmSync(extractRoot, { recursive: true, force: true })
    }
  }

  if (platform !== "win32") fs.chmodSync(executablePath, 0o755)
  fs.writeFileSync(configPath, `BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=${builtClientDir}\n`, "utf8")
  return { executablePath, builtClientDir }
}
