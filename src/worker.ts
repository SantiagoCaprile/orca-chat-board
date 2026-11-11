// Chat Board worker: keeps the board in storage, lists chats through the orca CLI, tracks agent
// status from events, and answers the panel.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentState, BoardState, BoardView, CardView } from './protocol.ts'
import {
  chatsOf,
  clearArchived,
  deleteCard,
  mergeChats,
  moveCard,
  normalizeBoard,
  setColumns,
  updateCard
} from './board.ts'
import { listTerminals, switchTerminal } from './cli.ts'

const BOARD_KEY = 'board'
const STATUS_KEY = 'status'

type Status = { state: AgentState; at: number; outcome?: string | null }

export default function activate(orca: OrcaWorkerApi): void {
  /** Live handle and last output of each card key, from the latest listing. */
  let handles: Record<string, string> = {}
  let lastOutput: Record<string, number> = {}
  let lastError: string | null = null
  let refreshedAt = 0

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

  async function view(state: BoardState): Promise<BoardView> {
    const status = await loadStatus()
    const cards: CardView[] = Object.values(state.cards).map((c) => {
      const handle = c.closed ? null : (handles[c.key] ?? null)
      const s = handle ? status[handle] : undefined
      return {
        ...c,
        handle,
        state: s?.state ?? null,
        stateAt: s?.at ?? null,
        outcome: s?.outcome ?? null,
        lastOutputAt: lastOutput[c.key] ?? null
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

  async function refresh(): Promise<BoardState> {
    let state = await loadBoard()
    try {
      const chats = chatsOf(await listTerminals())
      const merged = mergeChats(state, chats, Date.now())
      state = merged.state
      handles = merged.handles
      lastOutput = merged.lastOutput
      lastError = null
      refreshedAt = Date.now()
      await orca.storage.set(BOARD_KEY, state)
      // Forget status of terminals that no longer exist.
      const live = new Set(Object.values(handles))
      const status = await loadStatus()
      for (const h of Object.keys(status)) if (!live.has(h)) delete status[h]
      await orca.storage.set(STATUS_KEY, status)
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
  orca.panels.handle('card.update', (patch) => mutate((s) => updateCard(s, patch.key, patch)))
  orca.panels.handle('card.delete', ({ key }) => mutate((s) => deleteCard(s, key)))
  orca.panels.handle('archive.clear', () => mutate(clearArchived))

  orca.panels.handle('chat.focus', async ({ key }) => {
    let handle = handles[key]
    if (!handle) {
      await serial(refresh)
      handle = handles[key]
    }
    if (!handle) return { ok: false, error: 'closed' }
    try {
      await switchTerminal(handle)
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
    })
  )
}
