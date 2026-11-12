// Panel <-> worker contract, shared by src/worker.ts and panel/index.ts.

export type AgentState = 'working' | 'blocked' | 'waiting' | 'done'

export type Column = {
  id: string
  title: string
  /** Shown as a narrow strip with its title and count, Jira style. */
  collapsed?: boolean
}

/** What the board remembers about one chat (one Orca terminal tab running an agent). */
export type StoredCard = {
  /** Orca tab id of the chat. */
  key: string
  column: string
  order: number
  /** Optional name the person gives the card; falls back to the terminal title. */
  label: string
  note: string
  /** Last terminal title seen, without the agent's spinner prefix. */
  title: string
  agent: string | null
  worktreeId: string
  worktreeName: string
  ptyId: string
  closed: boolean
  closedAt: number | null
  /** When the agent finished (or started waiting) while you were not looking; null once seen. */
  unseenAt?: number | null
  addedAt: number
}

export type BoardState = {
  version: 1
  columns: Column[]
  cards: Record<string, StoredCard>
}

export type CardView = StoredCard & {
  /** Live terminal handle (`term_…`), null when the chat is closed. */
  handle: string | null
  state: AgentState | null
  stateAt: number | null
  /** How the agent's last turn ended, when Orca says: `interruption`, `failure`, `success`… */
  outcome: string | null
  lastOutputAt: number | null
  monitor: MonitorInfo | null
  /** The chat's tab is the one on screen in the focused workspace. */
  active: boolean
}

export type BoardView = {
  columns: Column[]
  cards: CardView[]
  refreshedAt: number
  /** Why listing terminals failed (raw detail, the panel words it); the board then shows what it last knew. */
  error: string | null
}

/** A loop, schedule or background watcher an agent left running (seen through its tool calls). */
export type MonitorInfo = {
  kind: 'loop' | 'cron' | 'monitor'
  /** Seconds between runs, when the agent said. */
  everySec: number | null
  /** When the agent said it wakes up next. */
  nextAt: number | null
  /** Last time it set the monitor up or ran a turn. */
  lastRunAt: number
  /** No sign of life for about twice the interval. */
  stale: boolean
  /** Cron expression or short description, when the agent gave one. */
  label: string | null
}

export type CardPatch = { key: string; label?: string; note?: string }

declare module 'orca' {
  interface PluginRequests {
    /** Lists live chats, merges them into the stored board and answers the view. */
    'board.get': { input: { refresh?: boolean; locale?: string }; output: BoardView }
    /** Moves a card to `index` among the open cards of `column`. */
    'board.move': { input: { key: string; column: string; index: number }; output: BoardView }
    /** Replaces the column list; cards in a removed column go to the first one. */
    'board.columns.set': { input: { columns: Column[] }; output: BoardView }
    'card.update': { input: CardPatch; output: BoardView }
    /** Forgets a card; only closed chats can be deleted. */
    'card.delete': { input: { key: string }; output: BoardView }
    /** Re-checks which chats are on screen: open-chat highlight, and clears their unseen mark. */
    'seen.check': { input: Record<string, never>; output: BoardView }
    /** Forgets every closed chat. */
    'archive.clear': { input: Record<string, never>; output: BoardView }
    /** Shows the chat's terminal tab in Orca. */
    'chat.focus': { input: { key: string }; output: { ok: boolean; error: 'closed' | string | null } }
  }
  interface PluginPanelEvents {
    'board.changed': BoardView
  }
}
