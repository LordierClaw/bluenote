export interface CommandIo {
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
  env?: NodeJS.ProcessEnv
  nodeVersion?: string
  platform?: NodeJS.Platform
  clientLoader?: (specifier: string) => Promise<unknown>
  spawn?: typeof import("child_process").spawn
  spawnSync?: typeof import("child_process").spawnSync
}

export type CommandRunner = (args: string[], io?: CommandIo) => Promise<number> | number
