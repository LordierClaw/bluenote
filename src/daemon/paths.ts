import fs from "fs"
import os from "os"
import path from "path"

export function getBluenoteStateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BLUENOTE_DAEMON_STATE) return path.dirname(env.BLUENOTE_DAEMON_STATE)
  if (env.BLUENOTE_CONFIG_HOME) return path.join(env.BLUENOTE_CONFIG_HOME, "bluenote")
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "bluenote")
  return path.join(os.homedir(), ".config", "bluenote")
}

export function getDaemonStatePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BLUENOTE_DAEMON_STATE) return env.BLUENOTE_DAEMON_STATE
  return path.join(getBluenoteStateDir(env), "daemon.json")
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}
