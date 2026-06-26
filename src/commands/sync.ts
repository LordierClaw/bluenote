import http from "node:http"
import path from "node:path"
import fs from "node:fs"
import { spawnSync } from "node:child_process"

import type { CommandIo } from "../types"
import { write } from "../utils/write"
import type {
  DownloadNoteBodyResponse,
  PullChangesRequest,
  PullChangesResponse,
  PushRequest,
  PushResponse,
  SyncStatusView,
  SyncTransport,
} from "@lordierclaw/bluenote-core"

type CoreModule = typeof import("@lordierclaw/bluenote-core")

interface SyncClientConfig {
  serverUrl: string
  workspaceId: string
  replicaId: string
}

function rootOptions(io: CommandIo): { override?: string; env: NodeJS.ProcessEnv } {
  const env = io.env || process.env
  return { env, ...(env.BLUENOTE_ROOT ? { override: env.BLUENOTE_ROOT } : {}) }
}

function formatCliError(core: CoreModule, error: InstanceType<typeof core.AppError>): { exitCode: number; stderr: string } {
  const lines = [error.message]
  if (error.hint) lines.push(`Hint: ${error.hint.replace(/\bbn\b/g, "bluenote")}`)
  return {
    exitCode: core.isValidationOrDataError(error) ? 2 : 1,
    stderr: `${lines.join("\n")}\n`,
  }
}

async function loadCore(): Promise<CoreModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<CoreModule>
  return dynamicImport("@lordierclaw/bluenote-core")
}

function usage(): string {
  return [
    "Usage:",
    "  bluenote sync status",
    "  bluenote sync link --server <url> [--workspace-id <id>] [--replica-id <id>]",
    "  bluenote sync now",
    "  bluenote sync unlink",
    "  bluenote sync server start [--host <host>] [--port <port>]",
    "",
    "Examples:",
    "  bluenote sync server start --host 0.0.0.0 --port 8765",
    "  bluenote sync link --server http://server.example:8765 --replica-id laptop",
    "  bluenote sync now",
  ].join("\n") + "\n"
}

function consumeOption(core: CoreModule, args: string[], index: number, name: string): string {
  const value = args[index + 1]
  if (value === undefined || value.startsWith("--")) {
    throw new core.UsageError(`Missing value for ${name}.`, { hint: usage().trimEnd() })
  }
  return value
}

function parseOptions(core: CoreModule, args: string[]): { subcommand?: string; options: Record<string, string | boolean> } {
  const [subcommand, ...rest] = args
  const options: Record<string, string | boolean> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === "--server" || arg === "--workspace-id" || arg === "--replica-id" || arg === "--host" || arg === "--port") {
      options[arg.slice(2)] = consumeOption(core, rest, index, arg)
      index += 1
      continue
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true
      continue
    }
    throw new core.UsageError(`Unknown sync option: ${arg}.`, { hint: usage().trimEnd() })
  }
  return { subcommand, options }
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "")
}

function configPath(rootPath: string): string {
  return path.join(rootPath, ".data", "sync", "client.json")
}

function writeClientConfig(rootPath: string, config: SyncClientConfig): void {
  const filePath = configPath(rootPath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

function readClientConfig(core: CoreModule, rootPath: string): SyncClientConfig {
  const filePath = configPath(rootPath)
  if (!fs.existsSync(filePath)) {
    throw new core.UsageError("Sync is not linked to a server URL.", {
      hint: "Run bluenote sync link --server <url> first.",
    })
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as SyncClientConfig
}

function removeClientConfig(rootPath: string): void {
  fs.rmSync(configPath(rootPath), { force: true })
}

function readServerWorkspaceId(core: CoreModule, serverUrl: string): string | undefined {
  const status = requestJsonSync(core, serverUrl, "GET", "/sync/v1/status") as Record<string, unknown>
  return typeof status.workspaceId === "string" ? status.workspaceId : undefined
}

function createReplicaId(): string {
  return `replica-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function joinBaseUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${endpoint}`
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ""
}

function requestJsonSync(core: CoreModule, baseUrl: string, method: "GET" | "POST", endpoint: string, body?: unknown): unknown {
  const script = `
const http = require('http');
const https = require('https');
const url = process.argv[1];
const method = process.argv[2];
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => raw += chunk);
process.stdin.on('end', () => {
  const parsed = new URL(url);
  const lib = parsed.protocol === 'https:' ? https : http;
  const req = lib.request(parsed, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} }, res => {
    let response = '';
    res.setEncoding('utf8');
    res.on('data', chunk => response += chunk);
    res.on('end', () => {
      if ((res.statusCode || 500) < 200 || (res.statusCode || 500) >= 300) {
        process.stderr.write(response || ('HTTP ' + res.statusCode));
        process.exit(2);
      }
      process.stdout.write(response);
    });
  });
  req.on('error', error => { process.stderr.write(error.message); process.exit(1); });
  req.setTimeout(30000, () => req.destroy(new Error('sync HTTP request timed out')));
  if (method === 'POST') req.write(raw || '{}');
  req.end();
});`
  const url = joinBaseUrl(baseUrl, endpoint)
  const result = spawnSync(process.execPath, ["-e", script, url, method], {
    input: body === undefined ? "" : JSON.stringify(body),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new core.UsageError(`Sync HTTP ${method} ${endpoint} failed.`, {
      hint: result.stderr || "Check the sync server URL and connectivity.",
    })
  }
  return JSON.parse(result.stdout || "{}")
}

function createSyncHttpTransportSync(core: CoreModule, baseUrl: string): SyncTransport {
  return {
    pull(request: PullChangesRequest): PullChangesResponse {
      return requestJsonSync(core, baseUrl, "POST", "/sync/v1/changes/pull", request) as PullChangesResponse
    },
    push(request: PushRequest & { noteBodies?: Record<string, string> }): PushResponse {
      return requestJsonSync(core, baseUrl, "POST", "/sync/v1/changes/push", request) as PushResponse
    },
    downloadNoteBody(noteId: string, request?: { workspaceId?: string; sequence?: number; serverRevision?: number }): DownloadNoteBodyResponse {
      return requestJsonSync(core, baseUrl, "GET", `/sync/v1/bodies/${encodeURIComponent(noteId)}${query({ workspaceId: request?.workspaceId, sequence: request?.sequence, serverRevision: request?.serverRevision })}`) as DownloadNoteBodyResponse
    },
  }
}

function formatStatus(status: SyncStatusView, config?: SyncClientConfig): string {
  const lines = [
    `State: ${status.state}`,
    `Mode: ${status.mode}`,
    `Activity: ${status.activity}`,
    `Pending: ${status.pendingCount}`,
    `Running: ${status.runningCount}`,
    `Failed: ${status.failedCount}`,
  ]
  if (status.workspaceId) lines.push(`Workspace: ${status.workspaceId}`)
  if (config) {
    lines.push(`Server: ${config.serverUrl}`)
    lines.push(`Replica: ${config.replicaId}`)
  }
  if (status.lastError) lines.push(`Last error: ${status.lastError}`)
  return `${lines.join("\n")}\n`
}

async function startSyncServer(core: CoreModule, args: string[], io: CommandIo): Promise<number> {
  const parsed = parseOptions(core, ["server", ...args])
  const host = String(parsed.options.host ?? "127.0.0.1")
  const portText = String(parsed.options.port ?? "8765")
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new core.UsageError("Invalid sync server port.", { hint: "Use --port with a number from 0 to 65535." })
  }
  const rootPath = core.ensureManagedRoot(core.resolveBlueNoteRoot(rootOptions(io)))
  core.initRoot({ override: rootPath })
  const manifest = core.readStateManifest(rootPath)
  if (!manifest.workspaceId) throw new core.UsageError("Server root is missing a workspace ID.", { hint: "Run bluenote init first." })
  const service = core.createSyncServerService({ rootPath, workspaceId: manifest.workspaceId })
  const handlers = core.createSyncHttpHandlers({
    ...service,
    status: () => ({ ok: true, workspaceId: manifest.workspaceId, rootPath }),
  })
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on("end", () => {
      Promise.resolve()
        .then(async () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          const body = raw ? JSON.parse(raw) : undefined
          const handled = await handlers.handle({ method: request.method || "GET", path: request.url || "/", headers: request.headers, body })
          response.writeHead(handled.status, handled.headers)
          response.end(JSON.stringify(handled.body))
        })
        .catch((error) => {
          response.writeHead(500, { "content-type": "application/json" })
          response.end(JSON.stringify({ error: { code: "internal_error", message: error instanceof Error ? error.message : "Unexpected sync server error" } }))
        })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => resolve())
  })
  const address = server.address()
  const actualPort = typeof address === "object" && address ? address.port : port
  write(io.stdout || process.stdout, `BlueNote sync server listening: http://${host}:${actualPort}\nWorkspace: ${manifest.workspaceId}\nRoot: ${rootPath}\n`)
  await new Promise<void>((resolve) => {
    const stop = () => server.close(() => resolve())
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  })
  return 0
}

export async function runSyncCommand(args: string[], io: CommandIo = {}): Promise<number> {
  const core = await loadCore()
  try {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      write(io.stdout || process.stdout, usage())
      return 0
    }
    if (args[0] === "server" && args[1] === "start") {
      return await startSyncServer(core, args.slice(2), io)
    }

    const parsed = parseOptions(core, args)
    const rootPath = core.ensureManagedRoot(core.resolveBlueNoteRoot(rootOptions(io)))
    if (parsed.subcommand === "status") {
      let config: SyncClientConfig | undefined
      try { config = readClientConfig(core, rootPath) } catch { config = undefined }
      write(io.stdout || process.stdout, formatStatus(core.getCoreSyncStatus({ override: rootPath }), config))
      return 0
    }
    if (parsed.subcommand === "link") {
      const serverUrl = parsed.options.server
      if (typeof serverUrl !== "string") {
        throw new core.UsageError("Missing sync server URL.", { hint: "Run bluenote sync link --server <url>." })
      }
      const manifest = core.readStateManifest(rootPath)
      const normalizedServerUrl = normalizeServerUrl(serverUrl)
      const workspaceId = typeof parsed.options["workspace-id"] === "string" ? parsed.options["workspace-id"] : readServerWorkspaceId(core, normalizedServerUrl) ?? manifest.workspaceId
      if (!workspaceId) throw new core.UsageError("Cannot link sync without a workspace ID.", { hint: "Run bluenote init first." })
      const replicaId = typeof parsed.options["replica-id"] === "string" ? parsed.options["replica-id"] : createReplicaId()
      const summary = core.linkCoreSync({ override: rootPath, mode: "seed-empty-server-from-local", serverUrl: normalizedServerUrl, workspaceId })
      writeClientConfig(rootPath, { serverUrl: normalizedServerUrl, workspaceId, replicaId })
      write(io.stdout || process.stdout, `Linked sync client\nWorkspace: ${summary.workspaceId}\nServer: ${normalizedServerUrl}\nReplica: ${replicaId}\nMarked dirty records: ${summary.dirtyRecordsMarked}\n`)
      return 0
    }
    if (parsed.subcommand === "now") {
      const config = readClientConfig(core, rootPath)
      const summary = core.syncCoreNow({ override: rootPath, replicaId: config.replicaId, transport: createSyncHttpTransportSync(core, config.serverUrl) })
      write(io.stdout || process.stdout, `Sync ${summary.status}\nPushed: ${summary.pushed}\nPulled: ${summary.pulled}\n`)
      return summary.status === "synced" || summary.status === "not-linked" ? 0 : 1
    }
    if (parsed.subcommand === "unlink") {
      const summary = core.unlinkCoreSync({ override: rootPath })
      removeClientConfig(rootPath)
      write(io.stdout || process.stdout, `Unlinked sync\nMode: ${summary.mode}\nLocal notes kept: ${summary.keptLocalNotes ? "yes" : "no"}\n`)
      return 0
    }
    if (parsed.subcommand === "repair") {
      const summary = core.repairCoreSync({ override: rootPath, dryRun: true })
      write(io.stdout || process.stdout, `Repair dry run: ${summary.dryRun ? "yes" : "no"}\nIssues: ${summary.issues.length}\n`)
      return 0
    }
    throw new core.UsageError(`Unknown sync command: ${parsed.subcommand ?? ""}.`, { hint: usage().trimEnd() })
  } catch (error) {
    if (error instanceof core.AppError) {
      const formatted = formatCliError(core, error)
      write(io.stderr || process.stderr, formatted.stderr)
      return formatted.exitCode
    }
    throw error
  }
}
