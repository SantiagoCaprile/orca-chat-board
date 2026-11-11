// Runs the `orca` CLI from the worker. The plugin host API only sees the focused workspace and
// cannot focus a terminal; the CLI lists every terminal and switches tabs.
import { execFile } from 'node:child_process'
import type { LiveTerminal } from './board.ts'

export type OrcaRunner = (args: string[]) => Promise<string>

const ORCA_BINS = ['/usr/local/bin/orca', '/opt/homebrew/bin/orca', 'orca']

function execOnce(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`${err.message}${stderr ? `\n${stderr}` : ''}`) as Error & { code?: unknown }
        e.code = (err as { code?: unknown }).code
        reject(e)
      } else resolve(stdout)
    })
  )
}

let resolvedBin: string | null = null

const defaultRunner: OrcaRunner = async (args) => {
  if (resolvedBin) return execOnce(resolvedBin, args)
  let last: unknown
  for (const bin of ORCA_BINS) {
    try {
      const out = await execOnce(bin, args)
      resolvedBin = bin
      return out
    } catch (err) {
      last = err
      if ((err as { code?: unknown }).code !== 'ENOENT') {
        resolvedBin = bin
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

export async function listTerminals(): Promise<LiveTerminal[]> {
  const result = (await runJson(['terminal', 'list'])) as { terminals?: LiveTerminal[] }
  return result.terminals ?? []
}

export async function switchTerminal(handle: string): Promise<void> {
  await runJson(['terminal', 'switch', '--terminal', handle])
}
