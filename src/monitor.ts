// Monitors: loops, schedules and background watchers an agent leaves running, recognised from
// the tools it calls (Orca's own "monitoring" mode is not exposed to plugins).
import type { MonitorInfo } from './protocol.ts'

export type StoredMonitor = Omit<MonitorInfo, 'stale'> & {
  since: number
  /** A Monitor with a timeout is over after this. */
  until?: number | null
}

type ToolCall = { tool: string; input: unknown }

const STOP_TOOLS = new Set(['TaskStop', 'KillShell', 'KillBash'])
/** Monitor without a timeout: trusted this long after its last sign of life. */
const MONITOR_GRACE_MS = 2 * 60 * 60 * 1000
/** A monitor with no interval is trusted this long after its last sign of life. */
const UNTIMED_GRACE_MS = 6 * 60 * 60 * 1000
/** A stale monitor is forgotten after this long. */
const FORGET_STALE_MS = 30 * 60 * 1000

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null)

/** Every N minutes / hours from a simple cron expression (`*\/5 * * * *`, `0 * * * *`). */
export function cronEverySec(expr: string | null): number | null {
  if (!expr) return null
  const f = expr.trim().split(/\s+/)
  if (f.length < 5) return null
  const step = (field: string) => (field === '*' ? 1 : /^\*\/(\d+)$/.test(field) ? Number(field.slice(2)) : null)
  const allRest = (from: number) => f.slice(from, 5).every((x) => x === '*')
  const m = step(f[0])
  if (m && allRest(1)) return m * 60
  if (/^\d+$/.test(f[0])) {
    const h = step(f[1])
    if (h && allRest(2)) return h * 3600
  }
  return null
}

/**
 * Applies one tool call to a terminal's monitor: answers the new monitor, null to clear it, or
 * undefined when the call says nothing about monitoring.
 */
export function applyToolCall(prev: StoredMonitor | null, call: ToolCall, now: number): StoredMonitor | null | undefined {
  const input = obj(call.input)
  const since = prev?.since ?? now
  switch (call.tool) {
    case 'ScheduleWakeup': {
      if (input.stop === true) return null
      const delay = num(input.delaySeconds)
      return {
        kind: 'loop',
        everySec: delay,
        nextAt: delay ? now + delay * 1000 : null,
        lastRunAt: now,
        label: str(input.reason),
        since
      }
    }
    case 'CronCreate': {
      const expr = str(input.cron) ?? str(input.schedule) ?? str(input.cronExpression) ?? str(input.expression)
      const every = cronEverySec(expr)
      return { kind: 'cron', everySec: every, nextAt: every ? now + every * 1000 : null, lastRunAt: now, label: expr, since }
    }
    case 'CronDelete':
      return prev?.kind === 'cron' ? null : undefined
    case 'Monitor': {
      // A watch with a timeout ends by itself: trust it until then (plus a minute).
      const timeoutMs = num(input.timeout_ms)
      return {
        kind: 'monitor',
        everySec: null,
        nextAt: null,
        lastRunAt: now,
        label: str(input.description) ?? str(input.command),
        until: timeoutMs && input.persistent !== true ? now + timeoutMs + 60_000 : null,
        since
      }
    }
    default:
      if (STOP_TOOLS.has(call.tool) && prev?.kind === 'monitor') return null
      return undefined
  }
}

/** A run of the agent (it started working) counts as a sign of life and moves the next run on. */
export function onRun(prev: StoredMonitor, now: number): StoredMonitor {
  return { ...prev, lastRunAt: now, nextAt: prev.everySec ? now + prev.everySec * 1000 : prev.nextAt }
}

/** After this moment without a run, the monitor has lost its signal (about one interval late). */
export function monitorDeadline(m: Pick<MonitorInfo, 'everySec' | 'nextAt' | 'lastRunAt'>): number {
  return m.nextAt
    ? m.nextAt + Math.max(60_000, (m.everySec ?? 60) * 1000)
    : m.lastRunAt + (m.everySec ? 2 * m.everySec * 1000 : UNTIMED_GRACE_MS)
}

/** Whether a monitor (as the panel sees it) has lost its signal at `now`. */
export function isStale(m: MonitorInfo, now: number): boolean {
  if (m.stale) return true
  const deadline = m.kind === 'monitor' && !m.everySec ? m.lastRunAt + MONITOR_GRACE_MS : monitorDeadline(m)
  return now > deadline
}

/** Live view of a monitor at `now`; null when it went stale long ago and should be forgotten. */
export function monitorView(m: StoredMonitor, now: number): MonitorInfo | null {
  if (m.until && now > m.until) return null // the watch timed out: finished, not lost
  const deadline = m.kind === 'monitor' && !m.everySec ? m.lastRunAt + MONITOR_GRACE_MS : monitorDeadline(m)
  const stale = now > deadline
  if (stale && now > deadline + FORGET_STALE_MS) return null
  const { since: _since, until: _until, ...rest } = m
  return { ...rest, stale }
}
