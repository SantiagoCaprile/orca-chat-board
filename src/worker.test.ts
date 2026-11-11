// Worker tests: the orca CLI is faked through setOrcaRunner, the host through mockHost.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker.ts'
import { setOrcaRunner } from './cli.ts'
import { activeTabsByWorktree, cleanTitle, defaultColumns, emptyBoard, mergeChats, moveCard, setColumns, type LiveTerminal } from './board.ts'
import type { BoardView } from './protocol.ts'

const WT = 'repo::/Users/me/toolbox::workspace:1'

function term(n: number, extra: Partial<LiveTerminal> = {}): LiveTerminal {
  return {
    handle: `term_${n}`,
    tabId: `tab${n}`,
    ptyId: `${WT}@@p${n}`,
    worktreeId: WT,
    worktreePath: '/Users/me/toolbox',
    title: `Chat ${n}`,
    agentIdentity: 'claude',
    lastOutputAt: 1000 + n,
    ...extra
  }
}

function fakeCli(terminals: () => LiveTerminal[], calls: string[][] = [], layouts: () => unknown = () => []) {
  setOrcaRunner(async (args) => {
    calls.push(args)
    if (args[0] === 'terminal' && args[1] === 'list') {
      return JSON.stringify({ ok: true, result: { terminals: terminals(), visualLayouts: layouts() } })
    }
    if (args[0] === 'terminal' && args[1] === 'switch') return JSON.stringify({ ok: true, result: {} })
    throw new Error(`unexpected ${args.join(' ')}`)
  })
}

const host = (storage: Record<string, unknown> = {}, focusedHandles: () => string[] = () => []) =>
  mockHost({
    storage: storage as never,
    results: {
      'agents.list': { agents: [] },
      'workspace.readContext': () => ({
        branch: '',
        displayName: 'toolbox',
        terminals: focusedHandles().map((id) => ({ id }))
      })
    }
  })

afterEach(() => setOrcaRunner(null))

test('new agent chats land in the first column; plain shells are skipped', async () => {
  fakeCli(() => [term(1), term(2), term(3, { agentIdentity: null, title: 'zsh' })])
  const worker = await mountWorker(main, { host: host() })
  const v = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.deepEqual(
    v.cards.map((c) => [c.key, c.column, c.order, c.handle]),
    [
      ['tab1', 'backlog', 0, 'term_1'],
      ['tab2', 'backlog', 1, 'term_2']
    ]
  )
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a chat that disappears is archived with its column and note', async () => {
  let live = [term(1), term(2)]
  fakeCli(() => live)
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  await worker.request('board.move', { key: 'tab2', column: 'doing', index: 0 })
  await worker.request('card.update', { key: 'tab2', note: 'esperando a Juan' })
  live = [term(1)]
  const v = (await worker.request('board.get', { refresh: true })) as BoardView
  const c2 = v.cards.find((c) => c.key === 'tab2')!
  assert.equal(c2.closed, true)
  assert.equal(c2.column, 'doing')
  assert.equal(c2.note, 'esperando a Juan')
  assert.equal(c2.handle, null)
  // Only closed cards can be deleted.
  const after = (await worker.request('card.delete', { key: 'tab2' })) as BoardView
  assert.equal(after.cards.some((c) => c.key === 'tab2'), false)
  const kept = (await worker.request('card.delete', { key: 'tab1' })) as BoardView
  assert.equal(kept.cards.some((c) => c.key === 'tab1'), true)
  await worker.deactivate()
})

test('a restored chat with a new tab id keeps its card (pty id, then title)', () => {
  let s = mergeChats(emptyBoard(), [term(1), term(2)], 1).state
  s = moveCard(s, 'tab1', 'waiting', 0)
  s = moveCard(s, 'tab2', 'done', 0)
  s = mergeChats(s, [], 2).state
  const restored = mergeChats(
    s,
    [term(1, { tabId: 'new1' }), term(2, { tabId: 'new2', ptyId: 'other' })],
    3
  ).state
  assert.deepEqual(Object.keys(restored.cards).sort(), ['new1', 'new2'])
  assert.equal(restored.cards.new1.column, 'waiting')
  assert.equal(restored.cards.new2.column, 'done')
  assert.equal(restored.cards.new1.closed, false)
})

test('moving reorders within and across columns', () => {
  let s = mergeChats(emptyBoard(), [term(1), term(2), term(3)], 1).state
  s = moveCard(s, 'tab3', 'backlog', 0)
  const order = (col: string) =>
    Object.values(s.cards)
      .filter((c) => c.column === col)
      .sort((a, b) => a.order - b.order)
      .map((c) => c.key)
  assert.deepEqual(order('backlog'), ['tab3', 'tab1', 'tab2'])
  s = moveCard(s, 'tab1', 'doing', 99)
  assert.deepEqual(order('backlog'), ['tab3', 'tab2'])
  assert.deepEqual(order('doing'), ['tab1'])
})

test('removing a column sends its cards to the first column', () => {
  let s = mergeChats(emptyBoard(), [term(1)], 1).state
  s = moveCard(s, 'tab1', 'waiting', 0)
  s = setColumns(s, [
    { id: 'backlog', title: 'Backlog' },
    { id: 'done', title: 'Hecho' }
  ])
  assert.equal(s.cards.tab1.column, 'backlog')
  assert.equal(setColumns(s, []).columns.length, 2, 'cannot remove every column')
})

test('focus switches to the live handle', async () => {
  const calls: string[][] = []
  fakeCli(() => [term(1)], calls)
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  assert.deepEqual(await worker.request('chat.focus', { key: 'tab1' }), { ok: true, error: null })
  assert.deepEqual(calls.at(-1), ['terminal', 'switch', '--terminal', 'term_1', '--json'])
  await worker.deactivate()
})

test('agent status events show on the card', async () => {
  fakeCli(() => [term(1)])
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  await worker.emit('agent.status.changed', {
    workspaceId: null,
    paneKey: 'p',
    terminalId: 'term_1',
    state: 'waiting',
    receivedAt: 5000
  })
  const v = (await worker.request('board.get', {})) as BoardView
  assert.equal(v.cards[0].state, 'waiting')
  assert.equal(v.cards[0].stateAt, 5000)
  await worker.emit('agent.status.changed', {
    workspaceId: null,
    paneKey: 'p',
    terminalId: 'term_1',
    state: 'done',
    receivedAt: 6000,
    mainAgent: { state: 'done', outcome: 'interruption', stateStartedAt: 5900 }
  })
  const v2 = (await worker.request('board.get', {})) as BoardView
  assert.equal(v2.cards[0].state, 'done')
  assert.equal(v2.cards[0].outcome, 'interruption')
  assert.equal(v2.cards[0].stateAt, 5900)
  await worker.deactivate()
})

test('a failing CLI keeps the stored board and reports the error', async () => {
  setOrcaRunner(async () => {
    throw new Error('boom')
  })
  const stored = mergeChats(emptyBoard(), [term(1)], 1).state
  const worker = await mountWorker(main, { host: host({ board: stored }) })
  const v = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.equal(v.cards.length, 1)
  assert.match(v.error ?? '', /boom/)
  await worker.deactivate()
})

test('spinner prefixes are stripped from titles', () => {
  assert.equal(cleanTitle('✳ Ticket PROJ-123'), 'Ticket PROJ-123')
  assert.equal(cleanTitle('⠂ Revisión'), 'Revisión')
  assert.equal(cleanTitle('Plain'), 'Plain')
})

test('default columns follow the UI language', async () => {
  assert.equal(defaultColumns('es-AR')[1].title, 'En curso')
  assert.equal(defaultColumns('en-US')[1].title, 'In progress')
  assert.equal(defaultColumns('fr')[1].title, 'In progress')
  fakeCli(() => [])
  const worker = await mountWorker(main, { host: host() })
  const v = (await worker.request('board.get', { refresh: true, locale: 'es-419' })) as BoardView
  assert.equal(v.columns[3].title, 'Hecho')
  await worker.deactivate()
})

test('a collapsed column stays collapsed and keeps its cards', () => {
  let s = mergeChats(emptyBoard(), [term(1)], 1).state
  s = moveCard(s, 'tab1', 'done', 0)
  s = setColumns(
    s,
    s.columns.map((c) => (c.id === 'done' ? { ...c, collapsed: true } : c))
  )
  assert.equal(s.columns.find((c) => c.id === 'done')?.collapsed, true)
  assert.equal(s.columns.find((c) => c.id === 'backlog')?.collapsed, undefined)
  assert.equal(s.cards.tab1.column, 'done')
})

test('clearing the archive forgets only closed chats', async () => {
  let live = [term(1), term(2), term(3)]
  fakeCli(() => live)
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  live = [term(1)]
  await worker.request('board.get', { refresh: true })
  const v = (await worker.request('archive.clear', {})) as BoardView
  assert.deepEqual(v.cards.map((c) => c.key), ['tab1'])
  await worker.deactivate()
})

test('a chat that finishes while you look elsewhere is marked unseen until you see it', async () => {
  let activeTab = 'tab2'
  fakeCli(
    () => [term(1), term(2)],
    [],
    () => [{ worktreeId: WT, worktreePath: '/Users/me/toolbox', root: { type: 'group', activeTabId: activeTab, tabs: [] } }]
  )
  const worker = await mountWorker(main, { host: host({}, () => ['term_1', 'term_2']) })
  await worker.request('board.get', { refresh: true })
  const status = (terminalId: string, state: 'working' | 'done', receivedAt: number) =>
    worker.emit('agent.status.changed', { workspaceId: null, paneKey: terminalId, terminalId, state, receivedAt })
  const unseen = async () =>
    ((await worker.request('board.get', {})) as BoardView).cards.filter((c) => c.unseenAt).map((c) => c.key)

  await status('term_1', 'working', 10)
  await status('term_1', 'done', 20) // tab1 is not on screen
  await status('term_2', 'working', 10)
  await status('term_2', 'done', 20) // tab2 is on screen
  assert.deepEqual(await unseen(), ['tab1'])

  activeTab = 'tab1' // you switch to it in Orca
  await worker.request('seen.check', {})
  assert.deepEqual(await unseen(), [])

  activeTab = 'tab2'
  await status('term_1', 'working', 30)
  await status('term_1', 'done', 40)
  assert.deepEqual(await unseen(), ['tab1'])
  await worker.request('chat.focus', { key: 'tab1' }) // opened from the board
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(await unseen(), [])

  await status('term_1', 'working', 50)
  await status('term_1', 'done', 60)
  await status('term_1', 'working', 70) // you answered it: working again clears the mark
  assert.deepEqual(await unseen(), [])
  await worker.deactivate()
})

test('active tabs are read from every split group of a workspace', () => {
  const tabs = activeTabsByWorktree([
    {
      worktreeId: 'w1',
      root: { type: 'split', children: [{ type: 'group', activeTabId: 'a', tabs: [] }, { type: 'group', activeTabId: 'b', tabs: [] }] }
    }
  ])
  assert.deepEqual([...(tabs.get('w1') ?? [])].sort(), ['a', 'b'])
})
