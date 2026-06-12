import http from "http"

export type ApiErrorBody = {
  error: {
    code: string
    message: string
    hint?: string
  }
}

export type DaemonRequestContext = {
  request: http.IncomingMessage
  response: http.ServerResponse
  url: URL
}

export type DaemonRouteHandler = (context: DaemonRequestContext) => void | Promise<void>

export type DaemonRouteOptions = {
  auth?: boolean
}

type DaemonRoute = {
  method: string
  path: string
  handler: DaemonRouteHandler
  auth: boolean
}

export class HttpError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly hint?: string

  constructor(statusCode: number, code: string, message: string, hint?: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.hint = hint
  }
}

export function writeJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  })
  response.end(text)
}

export function toApiErrorBody(error: unknown): { statusCode: number; body: ApiErrorBody } {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.hint ? { hint: error.hint } : {}),
        },
      },
    }
  }

  return {
    statusCode: 500,
    body: { error: { code: "internal_error", message: "Unexpected daemon error" } },
  }
}

export function isBearerAuthorized(request: http.IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization || ""
  return authorization === `Bearer ${token}`
}

export function requireBearerAuth(request: http.IncomingMessage, token: string): void {
  if (!isBearerAuthorized(request, token)) {
    throw new HttpError(401, "unauthorized", "Missing or invalid daemon token")
  }
}

export async function readRequestBody(request: http.IncomingMessage, limitBytes = 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    totalBytes += buffer.byteLength
    if (totalBytes > limitBytes) {
      throw new HttpError(400, "request_too_large", "Request body is too large")
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString("utf8")
}

export type DaemonRouter = {
  get(path: string, handler: DaemonRouteHandler, options?: DaemonRouteOptions): void
  post(path: string, handler: DaemonRouteHandler, options?: DaemonRouteOptions): void
  register(method: string, path: string, handler: DaemonRouteHandler, options?: DaemonRouteOptions): void
  handle(request: http.IncomingMessage, response: http.ServerResponse): void
}

export function createDaemonRouter(token: string): DaemonRouter {
  const routes: DaemonRoute[] = []

  function register(method: string, path: string, handler: DaemonRouteHandler, options: DaemonRouteOptions = {}): void {
    routes.push({ method: method.toUpperCase(), path, handler, auth: options.auth !== false })
  }

  function handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const url = new URL(request.url || "/", "http://127.0.0.1")
    const method = request.method || "GET"
    const route = routes.find((candidate) => candidate.method === method && candidate.path === url.pathname)

    Promise.resolve()
      .then(async () => {
        if (!route) {
          throw new HttpError(404, "not_found", "Route not found")
        }
        if (route.auth) {
          requireBearerAuth(request, token)
        }
        await route.handler({ request, response, url })
      })
      .catch((error) => {
        if (response.headersSent || response.writableEnded) {
          response.end()
          return
        }
        const { statusCode, body } = toApiErrorBody(error)
        writeJson(response, statusCode, body)
      })
  }

  return {
    get(path, handler, options) {
      register("GET", path, handler, options)
    },
    post(path, handler, options) {
      register("POST", path, handler, options)
    },
    register,
    handle,
  }
}
