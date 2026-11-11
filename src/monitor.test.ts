import { assert, test } from 'orca/testing'
import { applyToolCall, cronEverySec, monitorView, onRun } from './monitor.ts'

test('ScheduleWakeup starts a loop with its next run; stop clears it', () => {
  const m = applyToolCall(null, { tool: 'ScheduleWakeup', input: { delaySeconds: 180, reason: 'check CI' } }, 1000)!
  assert.equal(m.kind, 'loop')
  assert.equal(m.everySec, 180)
  assert.equal(m.nextAt, 1000 + 180_000)
  assert.equal(m.label, 'check CI')
  assert.equal(applyToolCall(m, { tool: 'ScheduleWakeup', input: { stop: true } }, 2000), null)
})

test('CronCreate reads simple intervals; CronDelete clears only a cron', () => {
  assert.equal(cronEverySec('*/5 * * * *'), 300)
  assert.equal(cronEverySec('0 */2 * * *'), 7200)
  assert.equal(cronEverySec('30 9 * * 1'), null)
  const c = applyToolCall(null, { tool: 'CronCreate', input: { cron: '*/5 * * * *', prompt: 'x' } }, 0)!
  assert.equal(c.kind, 'cron')
  assert.equal(c.everySec, 300)
  assert.equal(applyToolCall(c, { tool: 'CronDelete', input: { id: '1' } }, 1), null)
  const loop = applyToolCall(null, { tool: 'ScheduleWakeup', input: { delaySeconds: 60 } }, 0)!
  assert.equal(applyToolCall(loop, { tool: 'CronDelete', input: {} }, 1), undefined)
})

test('Monitor runs until stopped or timed out; Bash, even in background, says nothing', () => {
  assert.equal(applyToolCall(null, { tool: 'Bash', input: { command: 'ls' } }, 0), undefined)
  assert.equal(applyToolCall(null, { tool: 'Bash', input: { command: 'npm run build', run_in_background: true } }, 0), undefined)
  const timed = applyToolCall(null, { tool: 'Monitor', input: { description: 'ci', timeout_ms: 60_000 } }, 0)!
  assert.equal(monitorView(timed, 100_000)?.stale, false)
  assert.equal(monitorView(timed, 130_000), null) // timed out: finished
  const mon0 = applyToolCall(null, { tool: 'Monitor', input: { description: 'deploy' } }, 0)!
  assert.equal(applyToolCall(mon0, { tool: 'TaskStop', input: {} }, 1), null)
  const mon = applyToolCall(null, { tool: 'Monitor', input: { description: 'deploy' } }, 0)!
  assert.equal(mon.kind, 'monitor')
  assert.equal(applyToolCall(mon, { tool: 'Read', input: {} }, 1), undefined)
})

test('a loop that misses its run by about one interval loses its signal', () => {
  const m = applyToolCall(null, { tool: 'ScheduleWakeup', input: { delaySeconds: 300 } }, 0)!
  assert.equal(monitorView(m, 300_000)!.stale, false) // on time
  assert.equal(monitorView(m, 500_000)!.stale, false) // a bit late
  assert.equal(monitorView(m, 601_000)!.stale, true) // missed it
  const ran = onRun(m, 590_000) // it did run
  assert.equal(monitorView(ran, 601_000)!.stale, false)
  assert.equal(monitorView(m, 601_000 + 31 * 60_000), null) // long dead: forgotten
})
