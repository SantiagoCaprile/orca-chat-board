// Chat Board worker: keeps the board in storage, lists chats through the orca CLI, tracks agent
// status from events, and answers the panel.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentState, BoardState, BoardView, CardView } from './protocol.ts'
import {
  activeTabsByWorktree,
  chatsOf,
  tabTitlesOf,
  clearArchived,
  deleteCard,
  markUnseen,
  mergeChats,
  moveCard,
  normalizeBoard,
  setColumns,
  startInProgress,
  updateCard
} from './board.ts'
import { listTerminals, renameTerminal, switchTerminal } from './cli.ts'
import { applyToolCall, monitorView, onRun, type StoredMonitor } from './monitor.ts'

const BOARD_KEY = 'board'
const STATUS_KEY = 'status'
const MONITORS_KEY = 'monitors'

type Status = { state: AgentState; at: number; outcome?: string | null }

export default function activate(orca: OrcaWorkerApi): void {
  /** Live handle and last output of each card key, from the latest listing. */
  let handles: Record<string, string> = {}
  let lastOutput: Record<string, number> = {}
  let lastError: string | null = null
  let refreshedAt = 0
  /** Tab ids on screen in the focused workspace at the last listing. */
  let visible = new Set<string>()

  // Every read-modify-write of storage goes through this queue.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  /** UI language of the last panel that asked; only names the default columns of a new board. */
  let locale = 'en'
  const loadBoard = async (): Promise<BoardState> => normalizeBoard(await orca.storage.get(BOARD_KEY), locale)
  const loadStatus = async (): Promise<Record<string, Status>> =>
    ((await orca.storage.get(STATUS_KEY)) as Record<string, Status> | null) ?? {}
  /** Monitors by terminal handle. */
  const loadMonitors = async (): Promise<Record<string, StoredMonitor>> =>
    ((await orca.storage.get(MONITORS_KEY)) as Record<string, StoredMonitor> | null) ?? {}
  const liveMonitor = async (handle: string): Promise<boolean> => {
    const m = (await loadMonitors())[handle]
    return !!m && monitorView(m, Date.now())?.stale === false
  }

  async function view(state: BoardState): Promise<BoardView> {
    const status = await loadStatus()
    const monitors = await loadMonitors()
    const now = Date.now()
    const cards: CardView[] = Object.values(state.cards).map((c) => {
      const handle = c.closed ? null : (handles[c.key] ?? null)
      const s = handle ? status[handle] : undefined
      const m = handle ? monitors[handle] : undefined
      return {
        ...c,
        handle,
        state: s?.state ?? null,
        stateAt: s?.at ?? null,
        outcome: s?.outcome ?? null,
        lastOutputAt: lastOutput[c.key] ?? null,
        monitor: m ? monitorView(m, now) : null
      }
    })
    return { columns: state.columns, cards, refreshedAt, error: lastError }
  }

  async function seedStatus(): Promise<void> {
    try {
      const { agents } = await orca.host.call('agents.list')
      const status = await loadStatus()
      for (const a of agents) {
        if (!a.terminalId) continue
        const prev = status[a.terminalId]
        if (!prev || prev.at < a.stateStartedAt) status[a.terminalId] = { state: a.state, at: a.stateStartedAt, outcome: null }
      }
      await orca.storage.set(STATUS_KEY, status)
    } catch (err) {
      orca.log(`agents.list failed: ${(err as Error).message}`)
    }
  }

  /** Tabs on screen: the active tab of each split group in the focused workspace. */
  async function visibleTabs(terminals: { handle: string; worktreeId: string }[], layouts: unknown): Promise<Set<string>> {
    try {
      const ctx = await orca.host.call('workspace.readContext')
      const ids = new Set((ctx?.terminals ?? []).map((t) => t.id))
      const focused = terminals.find((t) => ids.has(t.handle))?.worktreeId
      return (focused && activeTabsByWorktree(layouts).get(focused)) || new Set()
    } catch (err) {
      orca.log(`workspace.readContext failed: ${(err as Error).message}`)
      return new Set()
    }
  }

  const autoMoveOn = async (): Promise<boolean> => {
    try {
      return (await orca.settings.get('autoMoveToInProgress')) !== false
    } catch {
      return true
    }
  }

  const keyOfHandle = (handle: string) => Object.keys(handles).find((k) => handles[k] === handle) ?? null

  async function refresh(): Promise<BoardState> {
    let state = await loadBoard()
    try {
      const { terminals, layouts } = await listTerminals()
      const titles = tabTitlesOf(layouts)
      const withTabTitles = terminals.map((t) => ({ ...t, tabTitle: titles.get(t.tabId) ?? null }))
      const merged = mergeChats(state, chatsOf(withTabTitles), Date.now())
      state = merged.state
      handles = merged.handles
      lastOutput = merged.lastOutput
      visible = await visibleTabs(terminals, layouts)
      state = markUnseen(state, visible, null)
      lastError = null
      refreshedAt = Date.now()
      await orca.storage.set(BOARD_KEY, state)
      // Forget status of terminals that no longer exist.
      const live = new Set(Object.values(handles))
      const status = await loadStatus()
      for (const h of Object.keys(status)) if (!live.has(h)) delete status[h]
      await orca.storage.set(STATUS_KEY, status)
      const monitors = await loadMonitors()
      const now = Date.now()
      let dropped = false
      for (const [h, m] of Object.entries(monitors)) {
        if (!live.has(h) || !monitorView(m, now)) {
          delete monitors[h]
          dropped = true
        }
      }
      if (dropped) await orca.storage.set(MONITORS_KEY, monitors)
    } catch (err) {
      lastError = (err as Error).message.split('\n')[0]
      orca.log(`terminal list failed: ${lastError}`)
    }
    await seedStatus()
    return state
  }

  async function mutate(fn: (s: BoardState) => BoardState): Promise<BoardView> {
    return serial(async () => {
      if (refreshedAt === 0) await refresh()
      const next = fn(await loadBoard())
      await orca.storage.set(BOARD_KEY, next)
      const v = await view(next)
      orca.panels.post('board.changed', v)
      return v
    })
  }

  orca.panels.handle('board.get', (input) =>
    serial(async () => {
      if (input?.locale) locale = input.locale
      const state = input?.refresh || refreshedAt === 0 ? await refresh() : await loadBoard()
      return view(state)
    })
  )

  orca.panels.handle('board.move', ({ key, column, index }) => mutate((s) => moveCard(s, key, column, index)))
  orca.panels.handle('board.columns.set', ({ columns }) => mutate((s) => setColumns(s, columns)))
  // The name of an open chat is its Orca tab's title: rename the tab, then re-list.
  orca.panels.handle('card.update', async (patch) => {
    const handle = handles[patch.key]
    if (typeof patch.label === 'string' && handle) {
      try {
        await renameTerminal(handle, patch.label.trim())
        const { label: _label, ...rest } = patch
        await serial(refresh)
        return mutate((s) => updateCard(s, patch.key, { ...rest, label: '' }))
      } catch (err) {
        orca.log(`terminal rename failed: ${(err as Error).message}`)
      }
    }
    return mutate((s) => updateCard(s, patch.key, patch))
  })
  orca.panels.handle('card.delete', ({ key }) => mutate((s) => deleteCard(s, key)))
  orca.panels.handle('archive.clear', () => mutate(clearArchived))

  orca.panels.handle('seen.check', () =>
    serial(async () => {
      const before = await loadBoard()
      const state = await refresh()
      const v = await view(state)
      const cleared = Object.values(before.cards).some((c) => c.unseenAt && !state.cards[c.key]?.unseenAt)
      if (cleared) orca.panels.post('board.changed', v)
      return v
    })
  )

  orca.panels.handle('chat.focus', async ({ key }) => {
    let handle = handles[key]
    if (!handle) {
      await serial(refresh)
      handle = handles[key]
    }
    if (!handle) return { ok: false, error: 'closed' }
    try {
      await switchTerminal(handle)
      void mutate((s) => markUnseen(s, [key], null))
      return { ok: true, error: null }
    } catch (err) {
      // The handle may be stale (terminal restarted): list again and retry once.
      await serial(refresh)
      const fresh = handles[key]
      if (fresh && fresh !== handle) {
        try {
          await switchTerminal(fresh)
          return { ok: true, error: null }
        } catch {}
      }
      return { ok: false, error: (err as Error).message.split('\n')[0] }
    }
  })

  // Terminals opened, closed or renamed, or focus moved: re-list, debounced.
  let timer: ReturnType<typeof setTimeout> | null = null
  orca.events.on('workspace.changed', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void serial(async () => {
        const state = await refresh()
        orca.panels.post('board.changed', await view(state))
      })
    }, 400)
  })

  // Loops, schedules and background watchers, recognised from the tools the agent calls.
  orca.hooks.on('agent.tool.after', (event) => {
    const handle = event.terminalId
    if (!handle) return
    void serial(async () => {
      const monitors = await loadMonitors()
      const next = applyToolCall(monitors[handle] ?? null, event, Date.now())
      if (next === undefined) return
      if (next) monitors[handle] = next
      else if (monitors[handle]) delete monitors[handle]
      else return
      await orca.storage.set(MONITORS_KEY, monitors)
      orca.panels.post('board.changed', await view(await loadBoard()))
    })
  })

  orca.events.on('agent.status.changed', ({ terminalId, state, receivedAt, mainAgent }) =>
    serial(async () => {
      if (!terminalId) return
      const status = await loadStatus()
      const prev = status[terminalId]
      const outcome = mainAgent?.outcome ?? null
      if (prev && prev.state === state && (prev.outcome ?? null) === outcome) return
      status[terminalId] = {
        state,
        at: prev && prev.state === state ? prev.at : (mainAgent?.stateStartedAt ?? receivedAt),
        outcome
      }
      await orca.storage.set(STATUS_KEY, status)

      // A turn of a loop or schedule is its sign of life.
      if (state === 'working') {
        const monitors = await loadMonitors()
        if (monitors[terminalId]) {
          monitors[terminalId] = onRun(monitors[terminalId], receivedAt)
          await orca.storage.set(MONITORS_KEY, monitors)
        }
      }

      // Unseen mark: set when an agent stops working while you are not looking at it,
      // cleared as soon as it works again.
      // A loop finishing one of its runs is not news.
      const needsYou = prev?.state === 'working' && state !== 'working' && !(await liveMonitor(terminalId))
      if (state !== 'working' && !needsYou) return
      let board = await refresh()
      const key = keyOfHandle(terminalId)
      if (!key) return
      let next =
        state === 'working'
          ? markUnseen(board, [key], null)
          : visible.has(key)
            ? board
            : markUnseen(board, [key], receivedAt)
      // You started talking to a Backlog chat (not a loop waking up by itself): it is in progress now.
      if (state === 'working' && prev?.state !== 'working' && !(await liveMonitor(terminalId)) && (await autoMoveOn())) {
        next = startInProgress(next, key)
      }
      if (next !== board) {
        board = next
        await orca.storage.set(BOARD_KEY, board)
      }
      orca.panels.post('board.changed', await view(board))
    })
  )
}
