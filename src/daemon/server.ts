import fs from "fs"
import http from "http"
import type { AddressInfo } from "net"

import { ensureParentDir } from "./paths"

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

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  })
  response.end(text)
}

function isAuthorized(request: http.IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization || ""
  return authorization === `Bearer ${token}`
}

export async function startDaemonServer(options: DaemonServerOptions): Promise<void> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1")

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, name: "bluenote-daemon", version: options.version })
      return
    }

    if (request.method === "GET" && url.pathname === "/capabilities") {
      sendJson(response, 200, {
        ok: true,
        name: "bluenote-daemon",
        version: options.version,
        mode: "local-only",
        clients: {
          web: { daemonEnvironment: true },
          tui: { daemonEnvironment: true },
        },
      })
      return
    }

    if (request.method === "POST" && url.pathname === "/shutdown") {
      if (!isAuthorized(request, options.token)) {
        sendJson(response, 401, { ok: false, error: "unauthorized" })
        return
      }
      sendJson(response, 200, { ok: true })
      server.close(() => {
        try {
          fs.rmSync(options.statePath, { force: true })
        } finally {
          process.exit(0)
        }
      })
      return
    }

    sendJson(response, 404, { ok: false, error: "not found" })
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
  fs.writeFileSync(options.statePath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })

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
