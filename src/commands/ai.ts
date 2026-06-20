import type { CommandIo } from "../types"
import { write } from "../utils/write"

import type {
  AiConfig,
  AiQueueJob,
  AiTextGenerationClient,
  CliResult,
  CodexAuthClientOptions,
  GenerateNoteDescriptionResult,
  OpenAiCompatibleFetch,
} from "@lordierclaw/bluenote-core"

type CoreModule = typeof import("@lordierclaw/bluenote-core")

export interface AiCliRuntimeOptions {
  aiClient?: AiTextGenerationClient
  fetch?: OpenAiCompatibleFetch
  codexAuth?: Omit<CodexAuthClientOptions, "fetch" | "repository">
  writeStdout?: (chunk: string) => void
}

const PLAINTEXT_WARNING = [
  "Warning: API key is stored in plaintext under .data/ai/config.json.",
  "Do not commit or share your BlueNote managed root if it contains secrets.",
].join("\n")

const DEFAULT_AI_LOGGING = {
  usage: true,
  conversations: false,
  results: true,
} as const

export function formatAiHelp(): string {
  return [
    "Opt-in AI description generation for BlueNote notes.",
    "",
    "Usage:",
    "  bluenote ai <command> [options]",
    "  bn ai <command> [options]",
    "",
    "Commands:",
    "  bluenote ai config set [--provider openai-compatible] --base-url <url> --api-key <key> --model <model> [--max-attempts <n>] [--output-language <text>]  Configure OpenAI-compatible AI",
    "  bluenote ai config set --provider codex --model <model> [--max-attempts <n>] [--output-language <text>]  Configure Codex AI model selection",
    "  config show    Show configured provider settings with the API key masked",
    "  codex auth login   Authenticate Codex with device-code OAuth",
    "  codex auth status  Show Codex auth status without secrets",
    "  codex auth logout  Remove stored Codex auth while keeping AI config",
    "  describe       <key|path>  Generate and automatically apply a note description",
    "  queue          Show pending AI description jobs",
    "  process-queue  [--limit <n>]  Process queued description refreshes",
    "",
    "AI is disabled until configured. Core BlueNote commands work offline; AI provider calls require network access.",
  ].join("\n") + "\n"
}

function readFlagValue(args: string[], flagName: string, core: CoreModule): string | undefined {
  const flagIndex = args.indexOf(flagName)
  if (flagIndex === -1) return undefined

  const value = args[flagIndex + 1]
  if (value === undefined || value.startsWith("--")) {
    throw new core.UsageError(`Missing value for ${flagName}.`, {
      hint: `Pass ${flagName} "...".`,
    })
  }
  return value
}

function requireFlag(args: string[], flagName: string, hint: string, core: CoreModule): string {
  const value = readFlagValue(args, flagName, core)
  if (!value) {
    throw new core.UsageError(`Missing required ${flagName} for AI config.`, { hint })
  }
  return value
}

function parseLimit(args: string[], core: CoreModule): number | undefined {
  const raw = readFlagValue(args, "--limit", core)
  if (raw === undefined) return undefined
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1) {
    throw new core.UsageError("Invalid --limit for AI queue processing.", {
      hint: "Run bluenote ai process-queue --limit <positive-integer>.",
    })
  }
  return limit
}

function parsePositiveIntegerFlag(args: string[], flagName: string, core: CoreModule): number | undefined {
  const raw = readFlagValue(args, flagName, core)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new core.UsageError(`Invalid ${flagName} for AI config.`, {
      hint: `Run bluenote ai config set ${flagName} <integer-from-1-to-10>.`,
    })
  }
  return value
}

function readOptionalOutputLanguage(args: string[], core: CoreModule): string | undefined {
  const value = readFlagValue(args, "--output-language", core)
  if (value === undefined) return undefined
  if (value.trim() === "") {
    throw new core.UsageError("Invalid --output-language for AI config.", {
      hint: "Pass a non-empty language preference string.",
    })
  }
  return value
}

function rootOptions(io: CommandIo): { override?: string; env: NodeJS.ProcessEnv } {
  const env = io.env || process.env
  return { env, ...(env.BLUENOTE_ROOT ? { override: env.BLUENOTE_ROOT } : {}) }
}

function getConfiguredRootPath(core: CoreModule, io: CommandIo): string {
  return core.ensureManagedRoot(core.resolveBlueNoteRoot(rootOptions(io)))
}

function createDefaultConfig(input: { baseUrl: string; apiKey: string; model: string; maxAttempts?: number; outputLanguage?: string; existing?: AiConfig | null }): AiConfig {
  const existingOpenAiConfig = input.existing?.provider === "openai-compatible" ? input.existing : null
  return {
    version: 1,
    enabled: existingOpenAiConfig?.enabled ?? true,
    provider: "openai-compatible",
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    logging: existingOpenAiConfig?.logging ?? DEFAULT_AI_LOGGING,
    maxAttempts: input.maxAttempts ?? input.existing?.maxAttempts ?? 3,
    outputLanguage: input.outputLanguage ?? input.existing?.outputLanguage ?? "English",
  }
}

function createCodexConfig(input: { model: string; maxAttempts?: number; outputLanguage?: string; existing?: AiConfig | null }): AiConfig {
  const existingCodexConfig = input.existing?.provider === "codex" ? input.existing : null
  return {
    version: 1,
    enabled: existingCodexConfig?.enabled ?? true,
    provider: "codex",
    model: input.model,
    logging: existingCodexConfig?.logging ?? DEFAULT_AI_LOGGING,
    maxAttempts: input.maxAttempts ?? input.existing?.maxAttempts ?? 3,
    outputLanguage: input.outputLanguage ?? input.existing?.outputLanguage ?? "English",
  }
}

function requireAiConfig(core: CoreModule, rootPath: string): void {
  if (!core.createAiConfigRepository(rootPath).exists()) {
    throw new core.UsageError("AI is not configured.", {
      hint: "Run bluenote ai config set --base-url <url> --api-key <key> --model <model>. For Codex, run bluenote ai config set --provider codex --model <model>.",
    })
  }
}

function requireCodexConfig(core: CoreModule, rootPath: string): AiConfig {
  requireAiConfig(core, rootPath)
  const config = core.createAiConfigRepository(rootPath).read()
  if (config.provider !== "codex") {
    throw new core.UsageError("Codex is not the configured AI provider.", {
      hint: "Run bluenote ai config set --provider codex --model <model> before Codex auth commands.",
    })
  }
  return config
}

function getAiClient(core: CoreModule, config: AiConfig, runtime: AiCliRuntimeOptions, io: CommandIo): AiTextGenerationClient {
  if (runtime.aiClient) return runtime.aiClient
  const providerOptions = runtime.fetch ? { fetch: runtime.fetch } : {}

  if (config.provider === "codex") {
    const rootPath = getConfiguredRootPath(core, io)
    const repository = core.createCodexAuthRepository(rootPath, runtime.codexAuth)
    const authClient = core.createCodexAuthClient({
      ...runtime.codexAuth,
      ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
      repository,
    })
    return core.createAiTextGenerationClient(config, {
      ...providerOptions,
      codexAuth: {
        hasAuth: () => repository.exists(),
        async getAuth() {
          return repository.exists() ? repository.read() : null
        },
        async refreshAuth(auth) {
          const refreshed = await authClient.refreshAuth(auth)
          repository.write(refreshed)
          return refreshed
        },
      },
    })
  }

  return core.createAiTextGenerationClient(config, providerOptions)
}

function formatConfig(core: CoreModule, config: AiConfig): string {
  return [
    "AI config:",
    `  enabled: ${config.enabled}`,
    `  provider: ${config.provider}`,
    `  model: ${config.model}`,
    ...(config.provider === "openai-compatible" ? [
      `  baseUrl: ${config.baseUrl}`,
      `  apiKey: ${core.maskApiKey(config.apiKey)}`,
    ] : []),
    `  logging.usage: ${config.logging.usage}`,
    `  logging.conversations: ${config.logging.conversations}`,
    `  logging.results: ${config.logging.results}`,
    `  maxAttempts: ${config.maxAttempts ?? 3}`,
    `  outputLanguage: ${config.outputLanguage ?? "English"}`,
  ].join("\n") + "\n"
}

function formatPendingJobs(jobs: AiQueueJob[]): string {
  if (jobs.length === 0) return "Pending AI jobs: 0\n"
  return [
    `Pending AI jobs: ${jobs.length}`,
    ...jobs.map((job) => `${job.kind}\t${job.key}\t${job.relativePath}\tattempts=${job.attempts}`),
  ].join("\n") + "\n"
}

function markJobFailed(core: CoreModule, rootPath: string, job: AiQueueJob, error: unknown, secrets: string[] = []): boolean {
  const message = core.sanitizeAiErrorMessage(error, secrets)
  return core.markDescribeNoteJobFailedIfContentHashMatches({
    rootPath,
    key: job.key,
    contentHash: job.contentHash,
    lastError: message,
  })
}

function describeOutput(core: CoreModule, result: GenerateNoteDescriptionResult): CliResult {
  if (result.status === "applied" && result.description) {
    return { exitCode: 0, stdout: `Updated AI description for ${result.key}\nDescription: ${result.description}\n`, stderr: "" }
  }
  if (result.status === "stale") {
    throw new core.UsageError(`AI description result was stale: ${result.error ?? "note changed while AI description was generating"}.`, {
      hint: "The existing note description was left unchanged. Run bluenote ai describe again to refresh it.",
    })
  }
  throw new core.UsageError(result.error ?? "Provider returned an invalid description.", {
    hint: "The existing note description was left unchanged.",
  })
}

function providerFailureError(core: CoreModule, error: unknown, secrets: string[] = []): InstanceType<typeof core.UsageError> {
  return new core.UsageError(`AI provider request failed: ${core.sanitizeAiErrorMessage(error, secrets)}`, {
    hint: "The existing note description was left unchanged.",
  })
}

function isCodexProviderSetupBlocked(core: CoreModule, error: unknown): boolean {
  if (error instanceof core.CodexProviderSetupRequiredError) return true
  if (!(error instanceof core.CodexTextGenerationClientError)) return false
  const message = error.message.toLowerCase()
  return message.includes("codex auth setup is required")
    || message.includes("codex auth refresh failed")
    || message.includes("codex auth is expired")
    || message.includes("run bn ai codex auth login")
    || message.includes("run bluenote ai codex auth login")
}

async function runConfigCommand(core: CoreModule, args: string[], io: CommandIo): Promise<CliResult> {
  const [subcommand, ...subcommandArgs] = args
  const rootPath = getConfiguredRootPath(core, io)
  const repository = core.createAiConfigRepository(rootPath)

  if (subcommand === "set") {
    const existingConfig = repository.exists() ? repository.read() : null
    const provider = readFlagValue(subcommandArgs, "--provider", core) ?? existingConfig?.provider ?? "openai-compatible"
    if (provider !== "openai-compatible" && provider !== "codex") {
      throw new core.UsageError("Invalid AI provider.", {
        hint: "Use --provider openai-compatible or --provider codex.",
      })
    }
    const maxAttempts = parsePositiveIntegerFlag(subcommandArgs, "--max-attempts", core)
    const outputLanguage = readOptionalOutputLanguage(subcommandArgs, core)
    const config = provider === "codex"
      ? createCodexConfig({
        model: readFlagValue(subcommandArgs, "--model", core) ?? (existingConfig?.provider === "codex" ? existingConfig.model : undefined) ?? requireFlag(subcommandArgs, "--model", "Run bluenote ai config set --provider codex --model <model>.", core),
        maxAttempts,
        outputLanguage,
        existing: existingConfig,
      })
      : createDefaultConfig({
        baseUrl: readFlagValue(subcommandArgs, "--base-url", core) ?? (existingConfig?.provider === "openai-compatible" ? existingConfig.baseUrl : undefined) ?? requireFlag(subcommandArgs, "--base-url", "Run bluenote ai config set --base-url <url> --api-key <key> --model <model>.", core),
        apiKey: readFlagValue(subcommandArgs, "--api-key", core) ?? (existingConfig?.provider === "openai-compatible" ? existingConfig.apiKey : undefined) ?? requireFlag(subcommandArgs, "--api-key", "Run bluenote ai config set --base-url <url> --api-key <key> --model <model>.", core),
        model: readFlagValue(subcommandArgs, "--model", core) ?? (existingConfig?.provider === "openai-compatible" ? existingConfig.model : undefined) ?? requireFlag(subcommandArgs, "--model", "Run bluenote ai config set --base-url <url> --api-key <key> --model <model>.", core),
        maxAttempts,
        outputLanguage,
        existing: existingConfig,
      })
    repository.write(config)
    return {
      exitCode: 0,
      stdout: config.provider === "codex" ? "AI Codex config saved. Run bluenote ai codex auth login before Codex generation.\n" : `AI config saved.\n${PLAINTEXT_WARNING}\n`,
      stderr: "",
    }
  }

  if (subcommand === "show") {
    requireAiConfig(core, rootPath)
    return { exitCode: 0, stdout: formatConfig(core, repository.read()), stderr: "" }
  }

  throw new core.UsageError(`Unknown AI config command: ${subcommand ?? ""}`.trim(), {
    hint: "Run bluenote ai config set ... or bluenote ai config show.",
  })
}

function assertNoExtraArgs(core: CoreModule, args: string[], command: string): void {
  if (args.length > 0) {
    throw new core.UsageError(`Unexpected arguments for ${command}.`, { hint: `Run ${command}.` })
  }
}

async function runCodexAuthCommand(core: CoreModule, args: string[], runtime: AiCliRuntimeOptions, io: CommandIo): Promise<CliResult> {
  const [subcommand, ...subcommandArgs] = args
  const rootPath = getConfiguredRootPath(core, io)
  const config = requireCodexConfig(core, rootPath)
  const repository = core.createCodexAuthRepository(rootPath, runtime.codexAuth)

  if (subcommand === "status") {
    assertNoExtraArgs(core, subcommandArgs, "bluenote ai codex auth status")
    return { exitCode: 0, stdout: `${core.formatCodexAuthStatus(repository.getStatus({ provider: config.provider }))}\n`, stderr: "" }
  }

  if (subcommand === "login") {
    assertNoExtraArgs(core, subcommandArgs, "bluenote ai codex auth login")
    const outputLines: string[] = []
    const shouldStream = runtime.writeStdout !== undefined || (runtime.fetch === undefined && runtime.codexAuth === undefined && runtime.aiClient === undefined)
    const writeInteractive = (line: string) => {
      if (shouldStream) {
        ;(runtime.writeStdout ?? ((chunk: string) => write(io.stdout || process.stdout, chunk)))(`${line}\n`)
      } else {
        outputLines.push(line)
      }
    }
    const client = core.createCodexAuthClient({ ...runtime.codexAuth, ...(runtime.fetch ? { fetch: runtime.fetch } : {}), repository })
    try {
      await client.login({
        onDeviceFlow(flow) {
          writeInteractive(`Open ${flow.verificationUrl} and enter code ${flow.userCode}.`)
          writeInteractive("Waiting for Codex authentication to complete...")
        },
      })
    } catch (error) {
      throw new core.UsageError(`Codex auth login failed: ${core.sanitizeCodexAuthErrorMessage(error)}`, {
        hint: "Check network access and retry bluenote ai codex auth login.",
      })
    }
    outputLines.push("Codex auth login complete.")
    return { exitCode: 0, stdout: `${outputLines.join("\n")}\n`, stderr: "" }
  }

  if (subcommand === "logout") {
    assertNoExtraArgs(core, subcommandArgs, "bluenote ai codex auth logout")
    repository.delete()
    return { exitCode: 0, stdout: "Codex auth removed. Codex AI config was kept.\n", stderr: "" }
  }

  throw new core.UsageError("Unknown AI Codex auth command.", {
    hint: "Run bluenote ai codex auth login, bluenote ai codex auth status, or bluenote ai codex auth logout.",
  })
}

async function runAiCliWithCore(core: CoreModule, args: string[], runtime: AiCliRuntimeOptions, io: CommandIo): Promise<CliResult> {
  const [subcommand, ...subcommandArgs] = args

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    return { exitCode: 0, stdout: formatAiHelp(), stderr: "" }
  }
  if (subcommand === "config") return runConfigCommand(core, subcommandArgs, io)
  if (subcommand === "codex") {
    if (subcommandArgs[0] === "auth") return runCodexAuthCommand(core, subcommandArgs.slice(1), runtime, io)
    throw new core.UsageError("Unknown AI Codex command.", {
      hint: "Run bluenote ai codex auth login, bluenote ai codex auth status, or bluenote ai codex auth logout.",
    })
  }
  if (subcommand === "queue") {
    const rootPath = getConfiguredRootPath(core, io)
    return { exitCode: 0, stdout: formatPendingJobs(core.listPendingAiJobs(rootPath)), stderr: "" }
  }
  if (subcommand === "describe") {
    const selector = subcommandArgs[0]
    if (!selector) {
      throw new core.UsageError("Missing required selector for AI describe.", { hint: "Run bluenote ai describe <key|path>." })
    }
    const rootPath = getConfiguredRootPath(core, io)
    requireAiConfig(core, rootPath)
    const config = core.createAiConfigRepository(rootPath).read()
    if (!config.enabled) {
      throw new core.UsageError("AI description generation is disabled.", { hint: "Enable AI in .data/ai/config.json before generating note descriptions." })
    }
    const secrets = config.provider === "openai-compatible" ? [config.apiKey] : []
    try {
      return describeOutput(core, await core.generateNoteDescription({ rootPath, selector, client: getAiClient(core, config, runtime, io) }))
    } catch (error) {
      if (error instanceof core.UsageError) throw error
      throw providerFailureError(core, error, secrets)
    }
  }
  if (subcommand === "process-queue") {
    const rootPath = getConfiguredRootPath(core, io)
    requireAiConfig(core, rootPath)
    const config = core.createAiConfigRepository(rootPath).read()
    const limit = parseLimit(subcommandArgs, core)
    if (!config.enabled) {
      const remaining = core.listPendingAiJobs(rootPath).length
      return { exitCode: remaining > 0 ? 1 : 0, stdout: `Processed AI queue: 0 applied, 0 failed, ${remaining} remaining.\n`, stderr: "" }
    }

    const secrets = config.provider === "openai-compatible" ? [config.apiKey] : []
    const jobs = core.listRetryableAiJobs(rootPath, config.maxAttempts ?? 3)
    const selectedJobs = jobs.slice(0, limit ?? jobs.length)
    let applied = 0
    let failed = 0
    let setupBlocked = false

    for (const job of selectedJobs) {
      try {
        if (core.dropDescribeNoteJobIfNoteMissing(rootPath, job)) continue
        const result = await core.generateNoteDescription({ rootPath, selector: job.key, client: getAiClient(core, config, runtime, io) })
        if (result.status === "applied") applied += 1
        else if (result.status !== "stale" && markJobFailed(core, rootPath, job, result.error ?? "invalid description", secrets)) failed += 1
      } catch (error) {
        if (isCodexProviderSetupBlocked(core, error)) {
          setupBlocked = true
          continue
        }
        if (markJobFailed(core, rootPath, job, error, secrets)) failed += 1
      }
    }

    const remaining = core.listPendingAiJobs(rootPath).length
    return { exitCode: failed > 0 || setupBlocked ? 1 : 0, stdout: `Processed AI queue: ${applied} applied, ${failed} failed, ${remaining} remaining.\n`, stderr: "" }
  }

  throw new core.UsageError(`Unknown AI command: ${subcommand ?? ""}`.trim(), {
    hint: "Run bluenote ai config set, bluenote ai config show, bluenote ai describe, bluenote ai queue, or bluenote ai process-queue.",
  })
}

async function loadCore(): Promise<CoreModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<CoreModule>
  return dynamicImport("@lordierclaw/bluenote-core")
}

function formatCliError(core: CoreModule, error: InstanceType<typeof core.AppError>): { exitCode: number; stderr: string } {
  const lines = [error.message]
  if (error.hint) lines.push(`Hint: ${error.hint.replace(/\bbn\b/g, "bluenote")}`)
  return { exitCode: core.isValidationOrDataError(error) ? 2 : 1, stderr: `${lines.join("\n")}\n` }
}

export async function runAiCommand(args: string[], io: CommandIo = {}, runtime: AiCliRuntimeOptions = {}): Promise<number> {
  const core = await loadCore()
  try {
    const result = await runAiCliWithCore(core, args, runtime, io)
    write(io.stdout || process.stdout, result.stdout)
    write(io.stderr || process.stderr, result.stderr)
    return result.exitCode
  } catch (error) {
    if (error instanceof core.AppError) {
      const formatted = formatCliError(core, error)
      write(io.stderr || process.stderr, formatted.stderr)
      return formatted.exitCode
    }
    throw error
  }
}
