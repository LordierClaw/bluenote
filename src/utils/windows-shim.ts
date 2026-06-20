export function isWindowsShellShim(commandPath: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(commandPath)
}

function quoteWindowsCmdArgument(value: string): string {
  if (value.length === 0) return '""'

  const escaped = value.replace(/(["%^&|<>])/g, "^$1")
  return /\s/u.test(value) || escaped !== value ? `"${escaped}"` : escaped
}

function buildWindowsCmdCommandLine(commandPath: string, args: string[]): string {
  return [commandPath, ...args].map((value) => quoteWindowsCmdArgument(value)).join(" ")
}

export function buildWindowsShimInvocation(commandPath: string, args: string[], env: NodeJS.ProcessEnv): {
  command: string
  args: string[]
} {
  const shell = env.ComSpec || env.COMSPEC || "cmd.exe"
  return {
    command: shell,
    args: ["/d", "/s", "/c", buildWindowsCmdCommandLine(commandPath, args)],
  }
}
