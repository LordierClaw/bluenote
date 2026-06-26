import path from "node:path"
import { spawnSync } from "node:child_process"

import type { CommandIo } from "../types"
import { write } from "../utils/write"
import type {
  NoteVisibility,
  RebuildIndexesOptions,
  SearchNoteMatch,
} from "@lordierclaw/bluenote-core"

export const NOTE_COMMANDS = ["init", "new", "list", "show", "search", "edit", "archive", "delete", "rebuild"] as const
export type NoteCommand = typeof NOTE_COMMANDS[number]

type CoreModule = typeof import("@lordierclaw/bluenote-core")

export function isNoteCommand(command: string): command is NoteCommand {
  return (NOTE_COMMANDS as readonly string[]).includes(command)
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

function parseVisibilityArgs(core: CoreModule, args: string[]): { args: string[]; visibility: NoteVisibility } {
  let visibility: NoteVisibility = "normal"
  let index = 0

  for (; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === "--drafts") {
      if (visibility === "all") {
        throw new core.UsageError("Choose either --drafts or --all, not both.", {
          hint: "Use --drafts for normal + draft notes, or --all to include archived notes.",
        })
      }
      visibility = "drafts"
      continue
    }

    if (arg === "--all") {
      if (visibility === "drafts") {
        throw new core.UsageError("Choose either --drafts or --all, not both.", {
          hint: "Use --drafts for normal + draft notes, or --all to include archived notes.",
        })
      }
      visibility = "all"
      continue
    }

    break
  }

  return { args: args.slice(index), visibility }
}

function parseSelectorArgs(core: CoreModule, command: string, args: string[], options: { requireForce?: boolean } = {}): { selector: string; force: boolean; visibility: NoteVisibility } {
  const selectors: string[] = []
  let force = false
  let visibility: NoteVisibility = "normal"

  for (const arg of args) {
    if (arg === "--drafts") {
      if (visibility === "all") {
        throw new core.UsageError("Choose either --drafts or --all, not both.", {
          hint: "Use --drafts for normal + draft notes, or --all to include archived notes.",
        })
      }
      visibility = "drafts"
      continue
    }

    if (arg === "--all") {
      if (visibility === "drafts") {
        throw new core.UsageError("Choose either --drafts or --all, not both.", {
          hint: "Use --drafts for normal + draft notes, or --all to include archived notes.",
        })
      }
      visibility = "all"
      continue
    }

    if (arg === "--force") {
      if (!options.requireForce) {
        throw new core.UsageError(`${command} does not accept --force.`, {
          hint: `Run bluenote ${command} <key|path>.`,
        })
      }
      force = true
      continue
    }

    if (arg.startsWith("--")) {
      throw new core.UsageError(`Unknown option for ${command}: ${arg}.`, {
        hint: `Run bluenote ${command} <key|path>${options.requireForce ? " --force" : ""}.`,
      })
    }

    selectors.push(arg)
  }

  if (selectors.length === 0) {
    throw new core.UsageError(`Missing required selector for ${command}.`, {
      hint: `Run bluenote ${command} <key|path>${options.requireForce ? " --force" : ""}.`,
    })
  }

  if (selectors.length > 1) {
    throw new core.UsageError(`Too many selectors for ${command}.`, {
      hint: `Run bluenote ${command} <key|path>${options.requireForce ? " --force" : ""}.`,
    })
  }

  return { selector: selectors[0], force, visibility }
}

interface ParsedNewArgs {
  title?: string
  path?: string
  useClipboard: boolean
  body?: string
}

function parseNewArgs(core: CoreModule, args: string[]): ParsedNewArgs {
  const positional: string[] = []
  let title: string | undefined
  let destinationPath: string | undefined
  let useClipboard = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === "--title" || arg === "-t") {
      const value = args[index + 1]
      if (value === undefined || value.startsWith("-")) {
        throw new core.UsageError(`Missing value for ${arg}.`, { hint: 'Pass --title "..." or -t "...".' })
      }
      title = value
      index += 1
      continue
    }

    if (arg === "--path") {
      const value = args[index + 1]
      if (value === undefined || value.startsWith("--")) {
        throw new core.UsageError("Missing value for --path.", { hint: "Pass --path note/<folder>." })
      }
      destinationPath = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")
      index += 1
      continue
    }

    if (arg === "--clipboard") {
      useClipboard = true
      continue
    }

    if (arg.startsWith("--")) {
      throw new core.UsageError(`Unknown option for new note: ${arg}.`, {
        hint: "Run bluenote new --help for available new-note options.",
      })
    }

    positional.push(arg)
  }

  if (positional.length > 1) {
    throw new core.UsageError("Too many positional body arguments for new note.", {
      hint: 'Quote the note body as one argument, e.g. bluenote new "Body text".',
    })
  }

  return { title, path: destinationPath, useClipboard, body: positional[0] }
}

function readNewNoteBody(core: CoreModule, parsed: ParsedNewArgs): string {
  const hasPositionalBody = parsed.body !== undefined

  if (hasPositionalBody && parsed.useClipboard) {
    throw new core.UsageError("Choose either positional body or --clipboard, not both.", {
      hint: 'Run bluenote new "Body text" or bluenote new --clipboard.',
    })
  }

  if (!hasPositionalBody && parsed.useClipboard) {
    throw new core.UsageError("Clipboard support is not available in the distribution CLI yet.", {
      hint: 'Pass a body directly, e.g. bluenote new "Body text".',
    })
  }

  if (!hasPositionalBody) {
    throw new core.UsageError("Missing note body for new note.", {
      hint: 'Pass a positional body, e.g. bluenote new "Body text".',
    })
  }

  return parsed.body ?? ""
}

function assertNewNotePathIsAllowed(core: CoreModule, destinationPath: string | undefined, title: string | undefined): void {
  if (destinationPath === undefined) return

  if (title === undefined || title.trim().length === 0) {
    throw new core.UsageError("--path requires --title for normal note creation.", {
      hint: 'Run bluenote new --path note/<folder> --title "Title" "Body text".',
    })
  }

  if (destinationPath !== "note" && !destinationPath.startsWith("note/")) {
    throw new core.UsageError("--path must point to an existing folder under note/.", {
      hint: "Use --path note or an existing note/<folder> destination.",
    })
  }
}

function formatNewHelp(): string {
  return [
    "Usage:",
    "  bluenote new [--title <title>] [--path note/<folder>] <body>",
    "",
    "Creates a new note from quoted body text.",
    "Without --path, creates a draft under draft/.",
    "With --path note/<folder> and --title, creates a normal note under an existing note folder.",
    "",
    "Options:",
    "  --title, -t <title>  Set the note title",
    "  --path <folder>     Existing note/<folder> destination for a normal note",
  ].join("\n") + "\n"
}

function formatSearchMatches(query: string, matches: SearchNoteMatch[]): string {
  if (matches.length === 0) return `No notes matched \"${query}\".\n`

  return matches.map((match) => {
    const lines = [
      match.title,
      `  key: ${match.key}`,
      `  path: ${match.relativePath}`,
      `  match: ${match.match.label}`,
    ]

    if (match.match.excerpt) {
      lines.push("  excerpt:")
      lines.push(`    ${match.match.excerpt}`)
    }

    return lines.join("\n")
  }).join("\n\n") + "\n"
}

function readWithIndexRetry<T>(core: CoreModule, opts: ReturnType<typeof rootOptions>, fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (error instanceof core.AppError && error.code === "INDEX_UNAVAILABLE") {
      core.rebuildIndexes(opts)
      return fn()
    }
    throw error
  }
}

function resolveEditorCommand(core: CoreModule, env: NodeJS.ProcessEnv): string {
  const editor = env.EDITOR?.trim()
  if (!editor) {
    throw new core.EditorLaunchError("EDITOR is not set.", {
      hint: "Set EDITOR to a command like 'vim' or 'nano' and retry.",
    })
  }
  return editor
}

function parseEditorCommand(editor: string): string[] {
  const parts = editor.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return parts.map((part) => {
    if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) return part.slice(1, -1)
    return part
  })
}

function launchEditor(core: CoreModule, notePath: string, io: CommandIo): void {
  const env = io.env || process.env
  const editor = resolveEditorCommand(core, env)
  const command = [...parseEditorCommand(editor), notePath]
  const result = (io.spawnSync || spawnSync)(command[0], command.slice(1), { stdio: "inherit", env })

  if (result.error) {
    throw new core.EditorLaunchError(`Could not launch editor '${command[0]}'.`, {
      hint: "Ensure EDITOR points to an installed executable.",
      cause: result.error,
    })
  }

  const exitCode = result.status ?? 1
  if (exitCode !== 0) {
    throw new core.EditorLaunchError(`Editor '${editor}' exited with code ${exitCode}.`, {
      hint: "Fix the editor command or exit the editor successfully, then retry.",
    })
  }
}

function extractEditedTitle(body: string, fallbackTitle: string): string {
  const firstMeaningfulLine = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return firstMeaningfulLine && /^#\s+.+$/u.test(firstMeaningfulLine)
    ? firstMeaningfulLine.replace(/^#\s+/u, "").trim()
    : fallbackTitle
}

function runEdit(core: CoreModule, args: string[], io: CommandIo): string {
  const { selector, visibility } = parseSelectorArgs(core, "edit", args)
  const root = core.resolveBlueNoteRoot(rootOptions(io))
  const repository = core.createNoteRepository(root)
  const selected = core.selectNote({ repository, selector, visibility })
  const notePath = path.join(root, selected.sourcePath)

  launchEditor(core, notePath, io)

  const editedRaw = repository.readRaw(notePath)
  const edited = core.parsePlainNote(editedRaw, selected.sourcePath)
  const title = extractEditedTitle(edited.body, selected.frontmatter.title)
  const updatedAt = new Date().toISOString()
  let relativePath: string
  let previousKey: string | undefined
  let key: string | undefined

  if (title !== selected.frontmatter.title) {
    const renamed = core.renameNote({ ...rootOptions(io), selector, title, body: edited.body, updatedAt, visibility })
    previousKey = renamed.previousKey
    key = renamed.key
    relativePath = renamed.relativePath
  } else {
    const synced = repository.syncEditedNote(notePath, { title, body: edited.body, updatedAt })
    previousKey = selected.frontmatter.id
    key = selected.frontmatter.id
    relativePath = synced.relativePath
  }

  core.rebuildIndexes(rootOptions(io) as RebuildIndexesOptions)
  const renameLine = previousKey !== undefined && key !== undefined && previousKey !== key
    ? `Renamed key: ${previousKey} -> ${key}\n`
    : ""
  return `Edited note: ${relativePath}\n${renameLine}`
}

async function loadCore(): Promise<CoreModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<CoreModule>
  return dynamicImport("@lordierclaw/bluenote-core")
}

export async function runNoteCommand(command: NoteCommand, args: string[], io: CommandIo = {}): Promise<number> {
  const core = await loadCore()
  try {
    const opts = rootOptions(io)
    let stdout = ""

    if (command === "init") {
      const summary = core.initRoot(opts)
      stdout = `Initialized BlueNote root: ${summary.rootPath}\n`
    } else if (command === "new") {
      if (args.length === 1 && args[0] === "--help") {
        stdout = formatNewHelp()
      } else {
        const parsed = parseNewArgs(core, args)
        const body = readNewNoteBody(core, parsed)
        assertNewNotePathIsAllowed(core, parsed.path, parsed.title)
        const summary = core.createNote({
          ...opts,
          title: parsed.title,
          body,
          type: parsed.path === undefined ? "draft" : "normal",
          ...(parsed.path === undefined ? {} : { destinationFolder: parsed.path }),
        })
        stdout = `Created note\nKey: ${summary.key}\nPath: ${summary.relativePath}\n`
      }
    } else if (command === "list") {
      const parsed = parseVisibilityArgs(core, args)
      if (parsed.args.length > 0) {
        throw new core.UsageError(`Unknown option for list: ${parsed.args[0]}.`, {
          hint: "Run bluenote list [--drafts|--all].",
        })
      }
      const summaries = readWithIndexRetry(core, opts, () => core.listNotes({ ...opts, visibility: parsed.visibility }))
      const body = summaries.map((summary) => `${summary.title}\t${summary.key}\t${summary.description}\t${summary.relativePath}`).join("\n")
      stdout = body === "" ? "" : `${body}\n`
    } else if (command === "show") {
      const { selector, visibility } = parseSelectorArgs(core, "show", args)
      const shown = readWithIndexRetry(core, opts, () => core.showNote({ ...opts, selector, visibility }))
      stdout = `Title: ${shown.title}\nKey: ${shown.key}\nPath: ${shown.relativePath}\nDescription: ${shown.description}\n\n${shown.body}`
    } else if (command === "search") {
      const parsed = parseVisibilityArgs(core, args)
      const query = parsed.args.join(" ").trim()
      if (query === "") {
        throw new core.UsageError("Missing required query for search.", {
          hint: 'Run bluenote search [--drafts|--all] "keywords".',
        })
      }
      stdout = formatSearchMatches(query, readWithIndexRetry(core, opts, () => core.searchNotes(query, { ...opts, visibility: parsed.visibility })))
    } else if (command === "edit") {
      stdout = runEdit(core, args, io)
    } else if (command === "archive") {
      const { selector, visibility } = parseSelectorArgs(core, "archive", args)
      const shown = core.showNote({ ...opts, selector, visibility })
      core.archiveNote({ ...opts, selector, visibility })
      stdout = `Archived note: ${shown.relativePath}\n`
    } else if (command === "delete") {
      const { selector, force, visibility } = parseSelectorArgs(core, "delete", args, { requireForce: true })
      const summary = core.deleteNote({ ...opts, selector, force, visibility })
      stdout = `Deleted note: ${summary.relativePath}\n`
    } else if (command === "rebuild") {
      const summary = core.rebuildIndexes(opts)
      if (summary.validationErrors.length > 0) {
        write(io.stderr || process.stderr, `Validation failed while rebuilding indexes.\n${summary.validationErrors.join("\n")}\n`)
        return 2
      }
      stdout = `Rebuilt indexes for ${summary.noteCount} note(s).\n`
    }

    write(io.stdout || process.stdout, stdout)
    return 0
  } catch (error) {
    if (error instanceof core.AppError) {
      const formatted = formatCliError(core, error)
      write(io.stderr || process.stderr, formatted.stderr)
      return formatted.exitCode
    }
    throw error
  }
}
