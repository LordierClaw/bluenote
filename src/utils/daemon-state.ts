import fs from "fs"
import http from "http"

import type { DaemonMetadata } from "../daemon/server"
import { getDaemonStatePath } from "../daemon/paths"

export type DaemonConnection = {
  url: string
  token: string
  pid?: number
}

export type DaemonStatus = {
  state: "running" | "stopped" | "stale" | "unreachable"
  metadata?: DaemonMetadata
  healthOk?: boolean
}

export function readDaemonMetadata(env: NodeJS.ProcessEnv = process.env): DaemonMetadata | undefined {
  const statePath = getDaemonStatePath(env)
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as Partial<DaemonMetadata>
    if (typeof parsed.url !== "string" || typeof parsed.token !== "string") return undefined
    return {
      pid: typeof parsed.pid === "number" ? parsed.pid : 0,
      url: parsed.url,
      token: parsed.token,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      version: typeof parsed.version === "string" ? parsed.version : "",
    }
  } catch {
    return undefined
  }
}

export function removeDaemonMetadata(env: NodeJS.ProcessEnv = process.env): void {
  fs.rmSync(getDaemonStatePath(env), { force: true })
}

export function getDaemonConnection(env: NodeJS.ProcessEnv = process.env): DaemonConnection | undefined {
  const metadata = readDaemonMetadata(env)
  if (!metadata) return undefined
  return { url: metadata.url, token: metadata.token, pid: metadata.pid || undefined }
}

export function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function requestJson(url: string, options: { method?: string; token?: string; timeoutMs?: number } = {}): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const request = http.request(url, {
      method: options.method || "GET",
      timeout: options.timeoutMs || 1000,
      headers: options.token ? { authorization: `Bearer ${options.token}` } : undefined,
    }, (response) => {
      let body = ""
      response.setEncoding("utf8")
      response.on("data", (chunk) => {
        body += chunk
      })
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode || 0}`))
          return
        }
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on("timeout", () => {
      request.destroy(new Error("request timed out"))
    })
    request.on("error", reject)
    request.end()
  })
}

export async function readDaemonStatus(env: NodeJS.ProcessEnv = process.env): Promise<DaemonStatus> {
  const metadata = readDaemonMetadata(env)
  if (!metadata) return { state: "stopped" }

  try {
    const health = await requestJson(`${metadata.url}/health`, { timeoutMs: 750 }) as { ok?: boolean }
    if (health && health.ok === true) return { state: "running", metadata, healthOk: true }
    return { state: "unreachable", metadata, healthOk: false }
  } catch {
    return { state: isProcessAlive(metadata.pid) ? "unreachable" : "stale", metadata, healthOk: false }
  }
}
