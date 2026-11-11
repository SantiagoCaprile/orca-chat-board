// The one Node API the worker uses, so `tsc` passes without @types/node.
declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: readonly string[],
    options: { maxBuffer?: number; timeout?: number },
    callback: (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void
  ): unknown
}
