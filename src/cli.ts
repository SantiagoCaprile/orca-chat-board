// Runs the `orca` CLI from the worker. The plugin host API only sees the focused workspace and
// cannot focus a terminal; the CLI lists every terminal and switches tabs.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { LiveTerminal } from './board.ts'

export type OrcaRunner = (args: string[]) => Promise<string>

/** What the resolver needs to know about the machine; tests pass a fake one. */
export type OrcaHost = {
  platform: string
  env: Record<string, string | undefined>
  /** The worker's own binary: Orca's Electron, which forks plugin workers as Node. */
  execPath?: string
  resourcesPath?: string
}

/**
 * One way to start the CLI. `exec` runs `file` directly (no shell); `cmd` is a Windows
 * `.cmd`/`.bat` wrapper, which Node can only start through cmd.exe.
 */
export type OrcaCommand = { kind: 'exec' | 'cmd'; file: string; args: string[]; env?: Record<string, string> }

/** A ready-to-spawn process: the arguments for execFile. */
export type OrcaInvocation = { file: string; args: string[]; verbatim: boolean; env?: Record<string, string> }

function envGet(host: OrcaHost, name: string): string | undefined {
  if (host.platform !== 'win32') return host.env[name]
  // Windows variable names are case-insensitive (`Path`, `PATH`, `ComSpec`).
  const key = Object.keys(host.env).find((k) => k.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : host.env[key]
}

function join(host: OrcaHost, ...parts: string[]): string {
  const sep = host.platform === 'win32' ? '\\' : '/'
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join(sep)
}

function dirname(path: string): string {
  return path.replace(/[\\/]+[^\\/]*$/, '')
}

/** Orca's `resources` folder, from Electron's `process.resourcesPath` or the binary's location. */
function resourcesDir(host: OrcaHost): string | null {
  if (host.resourcesPath) return host.resourcesPath
  const exe = host.execPath
  if (!exe || !/^orca/i.test(exe.split(/[\\/]/).pop() ?? '')) return null
  // macOS: Orca.app/Contents/MacOS/Orca -> Orca.app/Contents/Resources; else <install>/resources.
  if (host.platform === 'darwin') return join(host, dirname(dirname(exe)), 'Resources')
  return join(host, dirname(exe), 'resources')
}

/** Orca's bundled launcher name: `orca-ide` on Linux (bare `orca` there is the GNOME screen reader). */
function launcherName(platform: string): string {
  return platform === 'win32' ? 'orca.exe' : platform === 'linux' ? 'orca-ide' : 'orca'
}

/** First `name` on PATH, trying each PATHEXT extension like cmd.exe does. */
export function findOnWindowsPath(host: OrcaHost, name: string, exists: (path: string) => boolean): string | null {
  const exts = (envGet(host, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  const dirs = (envGet(host, 'PATH') ?? '').split(';').map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const path = join(host, dir, name + ext.toLowerCase())
      if (exists(path)) return path
    }
  }
  return null
}

function windowsCommand(file: string): OrcaCommand {
  return { kind: /\.(cmd|bat)$/i.test(file) ? 'cmd' : 'exec', file, args: [] }
}

/**
 * The ways to start the CLI, best first:
 * 1. The launcher Orca ships in `resources/bin` (`orca`, `orca-ide`, or the native `orca.exe`,
 *    which Orca built because cmd.exe/.ps1 shims cannot pass every argument intact).
 * 2. The CLI script itself, run by Orca's Electron as Node, as that launcher does.
 * 3. Wherever the user installed the CLI (`/usr/local/bin/orca`, `~/.local/bin/orca-ide`, PATH).
 */
export function orcaCommands(host: OrcaHost, exists: (path: string) => boolean): OrcaCommand[] {
  const out: OrcaCommand[] = []
  const add = (cmd: OrcaCommand) => {
    if (!out.some((c) => c.file === cmd.file && c.args.join('\0') === cmd.args.join('\0'))) out.push(cmd)
  }
  const resources = resourcesDir(host)
  if (resources) {
    const launcher = join(host, resources, 'bin', launcherName(host.platform))
    if (exists(launcher)) add({ kind: 'exec', file: launcher, args: [] })
    const script = join(host, resources, 'app.asar.unpacked', 'out', 'cli', 'index.js')
    if (host.execPath && exists(host.execPath) && exists(script)) {
      add({ kind: 'exec', file: host.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } })
    }
  }
  const home = envGet(host, host.platform === 'win32' ? 'USERPROFILE' : 'HOME')
  if (host.platform === 'win32') {
    const found = findOnWindowsPath(host, 'orca', exists)
    if (found) add(windowsCommand(found))
  } else if (host.platform === 'linux') {
    if (home && exists(join(host, home, '.local', 'bin', 'orca-ide'))) add({ kind: 'exec', file: join(host, home, '.local', 'bin', 'orca-ide'), args: [] })
    add({ kind: 'exec', file: 'orca-ide', args: [] })
  } else {
    const fixed = ['/usr/local/bin/orca', '/opt/homebrew/bin/orca', ...(home ? [join(host, home, '.local', 'bin', 'orca')] : [])]
    for (const file of fixed) if (exists(file)) add({ kind: 'exec', file, args: [] })
    add({ kind: 'exec', file: 'orca', args: [] })
  }
  return out
}

// cmd.exe metacharacters, escaped with `^` (the approach of the `cross-spawn` package).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/**
 * Quotes one argument for a program started through `cmd.exe /d /s /c "..."`. The inner
 * quoting follows the MSVCRT rules (what the program's argv parser undoes); every cmd
 * metacharacter then gets a `^`, twice for a .cmd/.bat file because cmd parses `%*` again
 * when the batch file forwards it. Line breaks would end the command, so they become spaces.
 */
export function quoteCmdArg(arg: string, batchFile = true): string {
  let a = arg.replace(/\0/g, '').replace(/[\r\n]+/g, ' ')
  a = a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  a = `"${a}"`.replace(CMD_META, '^$1')
  return batchFile ? a.replace(CMD_META, '^$1') : a
}

/** The process to spawn for `command` with the CLI arguments `args`. */
export function orcaInvocation(command: OrcaCommand, args: string[], host: OrcaHost): OrcaInvocation {
  if (command.kind === 'exec') return { file: command.file, args: [...command.args, ...args], verbatim: false, env: command.env }
  const line = [command.file.replace(CMD_META, '^$1'), ...[...command.args, ...args].map((a) => quoteCmdArg(a))].join(' ')
  const comspec = envGet(host, 'ComSpec')
  const systemRoot = envGet(host, 'SystemRoot')
  const shell = comspec && /^[a-z]:\\/i.test(comspec) ? comspec : systemRoot ? join(host, systemRoot, 'System32', 'cmd.exe') : 'cmd.exe'
  return { file: shell, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true, env: command.env }
}

function execOnce(inv: OrcaInvocation): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      inv.file,
      inv.args,
      {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 15000,
        windowsHide: true,
        windowsVerbatimArguments: inv.verbatim,
        ...(inv.env ? { env: { ...process.env, ...inv.env } } : {})
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(`${err.message}${stderr ? `\n${stderr}` : ''}`) as Error & { code?: unknown }
          e.code = (err as { code?: unknown }).code
          reject(e)
        } else resolve(stdout)
      }
    )
  )
}

function currentHost(): OrcaHost {
  return { platform: process.platform, env: process.env, execPath: process.execPath, resourcesPath: process.resourcesPath }
}

let resolved: OrcaCommand | null = null

const defaultRunner: OrcaRunner = async (args) => {
  const host = currentHost()
  if (resolved) return execOnce(orcaInvocation(resolved, args, host))
  const commands = orcaCommands(host, existsSync)
  let last: unknown = new Error('orca CLI not found')
  for (const command of commands) {
    try {
      const out = await execOnce(orcaInvocation(command, args, host))
      resolved = command
      return out
    } catch (err) {
      last = err
      const code = (err as { code?: unknown }).code
      if (code !== 'ENOENT' && code !== 'EACCES') {
        resolved = command
        throw err
      }
    }
  }
  throw last
}

let runner: OrcaRunner = defaultRunner

/** Tests swap the CLI for a fake. */
export function setOrcaRunner(next: OrcaRunner | null): void {
  runner = next ?? defaultRunner
}

async function runJson(args: string[]): Promise<unknown> {
  const out = await runner([...args, '--json'])
  const parsed = JSON.parse(out) as { ok?: boolean; result?: unknown; error?: { message?: string } }
  if (parsed.ok === false) throw new Error(parsed.error?.message ?? 'orca CLI failed')
  return parsed.result
}

export async function listTerminals(): Promise<{ terminals: LiveTerminal[]; layouts: unknown }> {
  const result = (await runJson(['terminal', 'list', '--include-visual-layouts'])) as {
    terminals?: LiveTerminal[]
    visualLayouts?: unknown
  }
  return { terminals: result.terminals ?? [], layouts: result.visualLayouts ?? [] }
}

/** Sets the tab's title; an empty title resets it to the automatic one. */
export async function renameTerminal(handle: string, title: string): Promise<void> {
  await runJson(['terminal', 'rename', '--terminal', handle, '--title', title])
}

/** Orca's chat tabs (not terminals) start with this id prefix; the rest is the chat session id. */
export const CHAT_TAB_PREFIX = 'structured-agent-session-'

/** One agent row of `orca worktree ps` (only the fields the board uses). */
export type PsAgent = {
  paneKey: string
  parentPaneKey?: string | null
  state: 'working' | 'blocked' | 'waiting' | 'done'
  agentType?: string | null
  displayName?: string | null
  conversationName?: string | null
  prompt?: string | null
  hasLivePty?: boolean | null
  interrupted?: boolean
  stateStartedAt?: number
  updatedAt?: number
  activity?: { unread?: boolean; title?: string | null } | null
}
export type PsWorktree = { worktreeId: string; path: string; displayName?: string; agents?: PsAgent[] }

/** Every workspace's agents as Orca tracks them, chat tabs included (`orca worktree ps`). */
export async function listAgents(): Promise<PsWorktree[]> {
  const result = (await runJson(['worktree', 'ps'])) as { worktrees?: PsWorktree[] }
  return result.worktrees ?? []
}

/** Renames a chat tab (`orca chat rename`). */
export async function renameChat(sessionId: string, name: string): Promise<void> {
  await runJson(['chat', 'rename', '--session', sessionId, '--name', name])
}

/** Shows a workspace in Orca. Chat tabs cannot be focused from the CLI yet, so this is the closest. */
export async function activateWorktree(worktreeId: string): Promise<void> {
  await runJson(['worktree', 'activate', '--worktree', `id:${worktreeId}`])
}

export async function switchTerminal(handle: string): Promise<void> {
  await runJson(['terminal', 'switch', '--terminal', handle])
}
