import fs from "fs"
import http from "http"
import type { AddressInfo } from "net"

import { ensureParentDir } from "./paths"
import { createDaemonRouter, writeJson } from "./router"

const BLUENOTE_DAEMON_API_VERSION = "1"

export type DaemonMetadata = {
  pid: number
  url: string
  token: string
  startedAt: string
  version: string
}

export type DaemonServerOptions = {
  statePath: string
  token: string
  version: string
}

export async function startDaemonServer(options: DaemonServerOptions): Promise<void> {
  const router = createDaemonRouter(options.token)
  const server = http.createServer((request, response) => router.handle(request, response))

  router.get("/health", ({ response }) => {
    writeJson(response, 200, { ok: true, name: "bluenote-daemon", version: options.version })
  }, { auth: false })

  router.get("/capabilities", ({ response }) => {
    writeJson(response, 200, {
      ok: true,
      name: "bluenote-daemon",
      version: options.version,
      mode: "local-only",
      apiVersion: BLUENOTE_DAEMON_API_VERSION,
      workspaceApi: true,
      notesApi: false,
      aiApi: false,
      clients: {
        web: { daemonEnvironment: true },
        tui: { daemonEnvironment: true },
      },
    })
  })

  router.post("/shutdown", ({ response }) => {
    writeJson(response, 200, { ok: true })
    server.close(() => {
      try {
        fs.rmSync(options.statePath, { force: true })
      } finally {
        process.exit(0)
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })

  const address = server.address() as AddressInfo
  const metadata: DaemonMetadata = {
    pid: process.pid,
    url: `http://127.0.0.1:${address.port}`,
    token: options.token,
    startedAt: new Date().toISOString(),
    version: options.version,
  }
  ensureParentDir(options.statePath)
  fs.rmSync(options.statePath, { force: true })
  fs.writeFileSync(options.statePath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(options.statePath, 0o600)

  const cleanup = () => {
    try {
      fs.rmSync(options.statePath, { force: true })
    } catch {
      // best effort
    }
  }
  process.once("SIGTERM", () => {
    cleanup()
    process.exit(0)
  })
  process.once("SIGINT", () => {
    cleanup()
    process.exit(0)
  })
}
