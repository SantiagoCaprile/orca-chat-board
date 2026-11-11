// Chat Board panel: a kanban of agent chats with drag & drop. Data comes from the worker
// (plugin.request / board.changed); agent status updates arrive live via orca.on.
import type { BoardView, CardView, Column } from '../src/protocol.ts'
import { CSS } from './style.ts'
import { AGENT_LOGOS, AGENT_NAMES } from './logos.ts'
import { STATUS_ICON, type StatusKind } from './icons.ts'
import { locale, setLanguage, t } from './i18n.ts'
import { isStale } from '../src/monitor.ts'

const INTERRUPTED = new Set(['interruption', 'failure', 'cancellation'])

/** What the status icon shows: the agent state, with a finished turn that was cut short as `interrupted`. */
function statusOf(c: CardView): StatusKind | null {
  if (c.closed) return 'closed'
  // Like Orca: a running turn, a question or a permission request outrank the monitor.
  if (c.monitor && c.state !== 'working' && c.state !== 'waiting' && c.state !== 'blocked') {
    return isStale(c.monitor, Date.now()) ? 'stale' : 'monitoring'
  }
  if (!c.state) return null
  if (c.state === 'done' && c.outcome && INTERRUPTED.has(c.outcome)) return 'interrupted'
  return c.state
}

function statusIcon(kind: StatusKind, since: number | null): HTMLElement {
  const label = t.status[kind]
  const span = el('span', {
    class: `status ${kind}`,
    role: 'img',
    'aria-label': label,
    title: since ? t.since(label, ago(since)) : label
  })
  span.innerHTML = STATUS_ICON[kind]
  return span
}

/** One hue per column position: blue, violet, amber, green, pink, teal. */
const COLUMN_COLORS = ['#4f8ff7', '#9b6cf2', '#f0a020', '#2fb170', '#e5578f', '#1fb5b5']

let view: BoardView | null = null
let filter = ''
let editingCard: string | null = null
let renamingColumn: string | null = null
let confirmDeleteColumn: string | null = null
let confirmClearArchive = false
let dragKey: string | null = null
let flash: string | null = null
let pendingRender = false

/** What each card shows; mirrors the plugin's settings (Settings → Plugins → Chat Board). */
const show = { agent: true, workspace: true, status: true, time: true, notes: true }

async function loadSettings(): Promise<void> {
  try {
    const s = await orca.settings.get()
    show.agent = s.showAgent !== false
    show.workspace = s.showWorkspace !== false
    show.status = s.showStatus !== false
    show.time = s.showTime !== false
    show.notes = s.showNotes !== false
    setLanguage(s.language)
  } catch {
    // Settings unavailable (older approval): keep everything visible.
  }
}

// ---------- helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue
    if (k === 'class') node.className = String(v)
    else node.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children) if (c !== null && c !== false) node.append(c)
  return node
}

/** A duration as `45s`, `3m`, `2h` or `1d`. */
function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/** The card's time slot for a monitor: next run, or how long it has been silent. */
function monitorTime(c: CardView, kind: StatusKind | null): { text: string; title: string } | null {
  const m = c.monitor
  if (!m || (kind !== 'monitoring' && kind !== 'stale')) return null
  const now = Date.now()
  const parts = [t.monitorKind[m.kind]]
  if (m.everySec) parts.push(t.every(span(m.everySec * 1000)))
  if (m.label) parts.push(m.label)
  parts.push(t.lastRun(span(now - m.lastRunAt)))
  const title = parts.join(' · ')
  if (kind === 'stale') return { text: t.noSignal(span(now - m.lastRunAt)), title }
  if (m.nextAt) return { text: m.nextAt > now ? t.nextRun(span(m.nextAt - now)) : t.dueNow, title }
  return { text: t.lastRun(span(now - m.lastRunAt)), title }
}

function ago(at: number | null): string {
  if (!at) return ''
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return t.now
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** The agent's logo as Orca shows it; an initial for an agent Orca adds later. */
function agentBadge(agent: string): HTMLElement {
  const name = AGENT_NAMES[agent] ?? agent
  const logo = AGENT_LOGOS[agent]
  if (logo && 'svg' in logo) {
    const span = el('span', { class: 'logo', title: name, role: 'img', 'aria-label': name })
    span.innerHTML = logo.svg
    return span
  }
  if (logo) return el('img', { class: 'logo', src: logo.img, alt: name, title: name })
  return el('span', { class: 'logo initial', title: name, role: 'img', 'aria-label': name }, name.charAt(0).toUpperCase())
}

const titleOf = (c: CardView) => c.label || c.title || t.untitled

function matches(c: CardView): boolean {
  if (!filter) return true
  const q = filter.toLowerCase()
  return [c.label, c.title, c.note, c.worktreeName, c.agent ?? ''].some((s) => s.toLowerCase().includes(q))
}

async function request<T>(name: string, input: unknown): Promise<T | null> {
  try {
    return (await orca.plugin.request(name as never, input as never)) as T
  } catch (err) {
    showFlash(t.error((err as Error).message))
    return null
  }
}

function showFlash(msg: string): void {
  flash = msg
  render(true)
  setTimeout(() => {
    if (flash === msg) {
      flash = null
      render()
    }
  }, 5000)
}

function setView(next: BoardView | null): void {
  if (next) view = next
  render()
}

const isEditing = () => {
  const a = document.activeElement
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && !a.classList.contains('search')
}

// ---------- actions ----------

async function load(refresh: boolean): Promise<void> {
  setView(await request<BoardView>('board.get', { refresh, locale }))
}

async function focusChat(c: CardView): Promise<void> {
  if (c.closed) return
  const r = await request<{ ok: boolean; error: string | null }>('chat.focus', { key: c.key })
  if (r && !r.ok) showFlash(r.error === 'closed' ? t.chatClosed : (r.error ?? t.focusFailed))
}

function moveLocal(key: string, column: string, index: number): void {
  if (!view) return
  const card = view.cards.find((c) => c.key === key)
  if (!card) return
  const siblings = view.cards
    .filter((c) => c.column === column && !c.closed && c.key !== key)
    .sort((a, b) => a.order - b.order)
  card.column = column
  siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, card)
  siblings.forEach((c, i) => (c.order = i))
}

async function move(key: string, column: string, index: number): Promise<void> {
  moveLocal(key, column, index)
  render(true)
  setView(await request<BoardView>('board.move', { key, column, index }))
}

async function saveColumns(columns: Column[]): Promise<void> {
  if (view) view.columns = columns
  render(true)
  setView(await request<BoardView>('board.columns.set', { columns }))
}

// ---------- rendering ----------

function renderCard(c: CardView): HTMLElement {
  const kind = statusOf(c)
  const stateBadge =
    kind && show.status ? statusIcon(kind, c.closed ? c.closedAt : kind === 'monitoring' || kind === 'stale' ? (c.monitor?.lastRunAt ?? null) : c.stateAt) : null
  const when = c.closed ? c.closedAt : (c.stateAt ?? c.lastOutputAt)
  const mon = monitorTime(c, kind)

  const card = el(
    'div',
    {
      class: `card${c.closed ? ' closed' : kind ? ` st-${kind}` : ''}${c.unseenAt && !c.closed ? ' unseen' : ''}`,
      draggable: !c.closed && editingCard !== c.key ? 'true' : false,
      tabindex: '0',
      'data-key': c.key,
      title: c.closed ? '' : t.openHint
    },
    el(
      'div',
      { class: 'card-top' },
      c.unseenAt && !c.closed ? el('span', { class: 'unseen-dot', title: t.unseen, role: 'img', 'aria-label': t.unseen }) : null,
      el('span', { class: 'card-title' }, titleOf(c)),
      stateBadge
    ),
    el(
      'div',
      { class: 'card-meta' },
      c.agent && show.agent ? agentBadge(c.agent) : null,
      c.worktreeName && show.workspace ? el('span', { class: 'chip ws' }, c.worktreeName) : null,
      c.label && c.title && c.label !== c.title ? el('span', {}, c.title) : null,
      show.time && mon ? el('span', { class: `time ${kind}`, title: mon.title }, mon.text) : when && show.time ? el('span', { class: 'time' }, ago(when)) : null
    ),
    c.note && show.notes && editingCard !== c.key ? el('div', { class: 'note' }, c.note) : null
  )

  const actions = el('div', { class: 'card-actions' })
  if (!c.closed) {
    const open = el('button', { class: 'ghost', title: t.openChat }, '↗')
    open.onclick = (e) => (e.stopPropagation(), void focusChat(c))
    actions.append(open)
  }
  const edit = el('button', { class: 'ghost', title: t.editCard }, '✎')
  edit.onclick = (e) => {
    e.stopPropagation()
    editingCard = c.key
    render(true)
  }
  actions.append(edit)
  if (c.closed) {
    const del = el('button', { class: 'ghost danger', title: t.deleteCard }, '✕')
    del.onclick = async (e) => {
      e.stopPropagation()
      setView(await request<BoardView>('card.delete', { key: c.key }))
    }
    actions.append(del)
  }
  if (editingCard !== c.key) card.append(actions)

  if (editingCard === c.key) card.append(renderEditor(c))

  card.ondblclick = () => void focusChat(c)
  card.onkeydown = (e) => {
    if (e.target === card && e.key === 'Enter') void focusChat(c)
  }
  card.ondragstart = (e) => {
    dragKey = c.key
    e.dataTransfer?.setData('text/plain', c.key)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => card.classList.add('dragging'))
  }
  card.ondragend = () => {
    dragKey = null
    card.classList.remove('dragging')
    clearDropMarks()
  }
  return card
}

function renderEditor(c: CardView): HTMLElement {
  // Open chats: this field is the Orca tab's name. Closed chats have no tab: it names the card.
  const current = c.label || c.title
  const nameLabel = c.closed ? t.cardName : t.tabName
  const label = el('input', { placeholder: c.closed ? t.name : t.tabNameHint, 'aria-label': nameLabel, title: nameLabel })
  label.value = current
  const note = el('textarea', { rows: '3', placeholder: t.noteHint, 'aria-label': t.note })
  note.value = c.note
  const save = async () => {
    editingCard = null
    const patch: { key: string; note: string; label?: string } = { key: c.key, note: note.value }
    if (label.value.trim() !== current) patch.label = label.value
    if (patch.label !== undefined) {
      const card = view?.cards.find((x) => x.key === c.key)
      if (card) card.label = patch.label.trim() // show the new name while the tab is renamed
    }
    render(true)
    setView(await request<BoardView>('card.update', patch))
  }
  const cancel = () => {
    editingCard = null
    render(true)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancel()
    // Enter saves right away in both fields; Shift+Enter adds a line break to the note.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      void save()
    }
  }
  label.onkeydown = onKey
  note.onkeydown = onKey
  const ok = el('button', { class: 'primary' }, t.save)
  ok.onclick = () => void save()
  const no = el('button', { class: 'ghost' }, t.cancel)
  no.onclick = cancel
  setTimeout(() => label.focus())
  return el('div', { class: 'edit' }, label, note, el('div', { class: 'edit-actions' }, no, ok))
}

function clearDropMarks(): void {
  document.querySelectorAll('.drop-line').forEach((n) => n.remove())
  document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'))
}

/** Index among the column's open cards (the dragged one excluded) for a pointer at `y`. */
function dropIndex(body: HTMLElement, y: number): { index: number; before: Element | null } {
  const cards = Array.from(body.querySelectorAll<HTMLElement>('.card:not(.dragging)'))
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect()
    if (y < r.top + r.height / 2) return { index: i, before: cards[i] }
  }
  return { index: cards.length, before: null }
}

function setCollapsed(col: Column, columns: Column[], collapsed: boolean): void {
  void saveColumns(columns.map((c) => (c.id === col.id ? { ...c, collapsed } : c)))
}

/** Drop handlers shared by open and collapsed columns; `body` is null when collapsed (drop at the end). */
function wireDrop(column: HTMLElement, body: HTMLElement | null, col: Column): void {
  column.ondragover = (e) => {
    if (!dragKey) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    clearDropMarks()
    column.classList.add('drop-target')
    if (!body) return
    const { before } = dropIndex(body, e.clientY)
    const line = el('div', { class: 'drop-line' })
    if (before) body.insertBefore(line, before)
    else body.append(line)
  }
  column.ondragleave = (e) => {
    if (!column.contains(e.relatedTarget as Node | null)) clearDropMarks()
  }
  column.ondrop = (e) => {
    e.preventDefault()
    const key = dragKey ?? e.dataTransfer?.getData('text/plain')
    clearDropMarks()
    if (!key) return
    const all = (view?.cards ?? [])
      .filter((c) => c.column === col.id && !c.closed && c.key !== key)
      .sort((a, b) => a.order - b.order)
    let realIndex = all.length
    if (body) {
      // While filtering, hidden cards sit between visible ones: drop before the visible neighbour.
      const { index, before } = dropIndex(body, e.clientY)
      realIndex = index
      if (filter) {
        const beforeKey = before?.getAttribute('data-key')
        realIndex = beforeKey ? all.findIndex((c) => c.key === beforeKey) : all.length
      }
    }
    dragKey = null
    void move(key, col.id, realIndex)
  }
}

function renderCollapsed(col: Column, i: number, columns: Column[], cards: CardView[]): HTMLElement {
  const count = cards.length
  const unseen = cards.filter((c) => c.unseenAt).length
  const label = t.expand(col.title, count)
  const strip = el(
    'section',
    {
      class: 'column collapsed',
      role: 'button',
      tabindex: '0',
      title: label,
      'aria-label': label,
      style: `--col: ${COLUMN_COLORS[i % COLUMN_COLORS.length]}`
    },
    el('span', { class: 'count' }, String(count)),
    unseen ? el('span', { class: 'unseen-dot', title: t.columnUnseen(unseen) }) : null,
    el('span', { class: 'strip-title' }, col.title)
  )
  strip.onclick = () => setCollapsed(col, columns, false)
  strip.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setCollapsed(col, columns, false)
    }
  }
  wireDrop(strip, null, col)
  return strip
}

function renderColumn(col: Column, i: number, columns: Column[], cards: CardView[]): HTMLElement {
  if (col.collapsed) return renderCollapsed(col, i, columns, cards)
  const head = el('div', { class: 'column-head' })
  if (renamingColumn === col.id) {
    const input = el('input', { 'aria-label': t.columnName })
    input.value = col.title
    const commit = () => {
      renamingColumn = null
      const title = input.value.trim()
      if (title && title !== col.title) void saveColumns(columns.map((c) => (c.id === col.id ? { ...c, title } : c)))
      else render(true)
    }
    input.onkeydown = (e) => {
      if (e.key === 'Enter') commit()
      if (e.key === 'Escape') {
        renamingColumn = null
        render(true)
      }
    }
    input.onblur = commit
    setTimeout(() => (input.focus(), input.select()))
    head.append(input)
  } else {
    const title = el('span', { class: 'column-title', title: t.renameHint }, col.title)
    title.ondblclick = () => {
      renamingColumn = col.id
      render(true)
    }
    const collapse = el('button', { class: 'ghost', title: t.collapse, 'aria-label': t.collapse }, '⇤')
    collapse.onclick = () => setCollapsed(col, columns, true)
    const unseen = cards.filter((c) => c.unseenAt).length
    head.append(title)
    if (unseen) head.append(el('span', { class: 'unseen-dot', title: t.columnUnseen(unseen) }))
    head.append(el('span', { class: 'count' }, String(cards.length)), collapse)
    const swap = (to: number) => {
      const next = [...columns]
      ;[next[i], next[to]] = [next[to], next[i]]
      void saveColumns(next)
    }
    if (i > 0) {
      const left = el('button', { class: 'ghost', title: t.moveLeft }, '‹')
      left.onclick = () => swap(i - 1)
      head.append(left)
    }
    if (i < columns.length - 1) {
      const right = el('button', { class: 'ghost', title: t.moveRight }, '›')
      right.onclick = () => swap(i + 1)
      head.append(right)
    }
    if (columns.length > 1) {
      const confirming = confirmDeleteColumn === col.id
      const del = el(
        'button',
        { class: `ghost${confirming ? ' danger' : ''}`, title: t.deleteColumn },
        confirming ? t.confirmDelete : '✕'
      )
      del.onclick = () => {
        if (confirming) {
          confirmDeleteColumn = null
          void saveColumns(columns.filter((c) => c.id !== col.id))
        } else {
          confirmDeleteColumn = col.id
          render(true)
          setTimeout(() => {
            if (confirmDeleteColumn === col.id) {
              confirmDeleteColumn = null
              render()
            }
          }, 3000)
        }
      }
      head.append(del)
    }
  }

  const body = el('div', { class: 'column-body' })
  for (const c of cards) body.append(renderCard(c))
  if (cards.length === 0) body.append(el('div', { class: 'empty' }, filter ? t.noMatches : t.dropHere))

  const column = el(
    'section',
    { class: 'column', 'aria-label': col.title, style: `--col: ${COLUMN_COLORS[i % COLUMN_COLORS.length]}` },
    head,
    body
  )
  wireDrop(column, body, col)
  return column
}

function render(force = false): void {
  if (!force && isEditing() && !dragKey) {
    pendingRender = true
    return
  }
  pendingRender = false
  const root = document.getElementById('app')!
  const searchHadFocus = document.activeElement?.classList.contains('search')

  const search = el('input', { class: 'search', type: 'search', placeholder: t.filter, 'aria-label': t.filterLabel })
  search.value = filter
  search.oninput = () => {
    filter = search.value
    render(true)
  }
  const refresh = el('button', { class: 'ghost', title: t.refresh }, '⟳')
  refresh.onclick = () => void load(true)
  const addCol = el('button', { class: 'ghost', title: t.addColumn }, t.addColumnButton)
  addCol.onclick = () => {
    if (!view) return
    const id = `col-${Date.now().toString(36)}`
    renamingColumn = id
    void saveColumns([...view.columns, { id, title: t.newColumn }])
  }

  const children: Node[] = [el('div', { class: 'toolbar' }, search, addCol, refresh)]
  const error = flash ?? (view?.error ? t.listFailed(view.error) : null)
  if (error) children.push(el('div', { class: 'error', role: 'status' }, error))

  if (!view) {
    children.push(el('div', { class: 'empty' }, t.loading))
  } else {
    const open = view.cards.filter((c) => !c.closed && matches(c))
    const board = el('div', { class: 'board' })
    view.columns.forEach((col, i) => {
      const cards = open.filter((c) => c.column === col.id).sort((a, b) => a.order - b.order)
      board.append(renderColumn(col, i, view!.columns, cards))
    })
    children.push(board)

    const closed = view.cards
      .filter((c) => c.closed && matches(c))
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    if (closed.length) {
      const wasOpen = (document.querySelector('details.archive') as HTMLDetailsElement | null)?.open ?? false
      const list = el('div', { class: 'list' })
      for (const c of closed) list.append(renderCard(c))
      const clear = el(
        'button',
        { class: `ghost${confirmClearArchive ? ' danger' : ''}`, title: t.clearArchiveHint },
        confirmClearArchive ? t.confirmClear(closed.length) : t.clearArchive
      )
      clear.onclick = async (e) => {
        e.preventDefault() // a button inside <summary> would otherwise toggle the section
        if (confirmClearArchive) {
          confirmClearArchive = false
          setView(await request<BoardView>('archive.clear', {}))
        } else {
          confirmClearArchive = true
          render(true)
          setTimeout(() => {
            if (confirmClearArchive) {
              confirmClearArchive = false
              render()
            }
          }, 3000)
        }
      }
      const summary = el('summary', {}, el('span', { class: 'archive-title' }, t.archived(closed.length)), clear)
      const details = el('details', { class: 'archive' }, summary, list)
      details.open = wasOpen || closed.some((c) => c.key === editingCard)
      children.push(details)
    }
  }

  root.replaceChildren(...children)
  if (searchHadFocus) {
    search.focus()
    search.setSelectionRange(search.value.length, search.value.length)
  }
}

// ---------- boot ----------

function boot(): void {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)
  const app = document.createElement('div')
  app.id = 'app'
  app.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0'
  document.body.append(app)
  document.addEventListener('focusout', () => setTimeout(() => pendingRender && render(), 0))

  orca.plugin.on('board.changed', (next) => setView(next as BoardView))
  orca.on('agent.status.changed', ({ terminalId, state, receivedAt, mainAgent }) => {
    const card = view?.cards.find((c) => c.handle && c.handle === terminalId)
    const outcome = mainAgent?.outcome ?? null
    if (!card || (card.state === state && card.outcome === outcome)) return
    if (card.state !== state) card.stateAt = mainAgent?.stateStartedAt ?? receivedAt
    card.state = state
    card.outcome = outcome
    render()
  })
  // While some chat is unseen, check every few seconds whether you opened it in Orca.
  setInterval(() => {
    if (document.visibilityState !== 'visible' || !view?.cards.some((c) => c.unseenAt && !c.closed)) return
    void orca.plugin.request('seen.check', {}).then((v) => setView(v as BoardView), () => undefined)
  }, 4000)
  // Relative times ("5m") tick locally; this never calls Orca.
  setInterval(() => render(), 30_000)

  orca.settings.onDidChange(() => void loadSettings().then(() => render(true)))

  void loadSettings().then(() => {
    render(true)
    void load(true)
  })
}

boot()
