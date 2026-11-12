// Hover preview: after a short pause on a card, asks the worker for your last prompt and the
// agent's last reply and shows them in a popover. Nothing is cached beyond a few seconds.
import { t } from './i18n.ts'

type Preview = { prompt: string | null; message: string | null; at: number | null }

const DELAY_MS = 450
const CACHE_MS = 5000
const cache = new Map<string, { at: number; data: Preview }>()
let timer: ReturnType<typeof setTimeout> | null = null
let pop: HTMLDivElement | null = null
let currentKey: string | null = null

/** Plain text from the agent's markdown: drops emphasis markers and code fences, keeps line breaks. */
function plain(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const head = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s)
const tail = (s: string, n: number) => (s.length > n ? '…' + s.slice(s.length - n).trimStart() : s)

async function load(key: string): Promise<Preview> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const data = (await orca.plugin.request('chat.preview' as never, { key } as never)) as Preview
  cache.set(key, { at: Date.now(), data })
  return data
}

function place(el: HTMLElement, anchor: Element): void {
  const r = anchor.getBoundingClientRect()
  const w = Math.min(380, window.innerWidth - 16)
  el.style.width = `${w}px`
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`
  const below = r.bottom + 6
  const h = el.offsetHeight
  el.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below}px`
}

function render(data: Preview): HTMLDivElement {
  const box = document.createElement('div')
  box.className = 'preview'
  box.setAttribute('role', 'tooltip')
  const section = (who: string, text: string, cls: string) => {
    const s = document.createElement('div')
    s.className = `preview-${cls}`
    const label = document.createElement('div')
    label.className = 'preview-who'
    label.textContent = who
    const body = document.createElement('div')
    body.className = 'preview-text'
    body.textContent = text
    s.append(label, body)
    return s
  }
  if (!data.prompt && !data.message) {
    const empty = document.createElement('div')
    empty.className = 'preview-text preview-empty'
    empty.textContent = t.previewEmpty
    box.append(empty)
  }
  if (data.prompt) box.append(section(t.previewYou, head(plain(data.prompt), 220), 'you'))
  if (data.message) box.append(section(t.previewAgent, tail(plain(data.message), 520), 'agent'))
  return box
}

export function hidePreview(): void {
  if (timer) clearTimeout(timer)
  timer = null
  currentKey = null
  pop?.remove()
  pop = null
  document.removeEventListener('mousemove', onMove, true)
}

/** Hides the popover once the pointer is no longer on that card (cards are redrawn under it). */
function onMove(e: MouseEvent): void {
  const over = (e.target as Element | null)?.closest?.('.card')?.getAttribute('data-key')
  if (over !== currentKey) hidePreview()
}

export function schedulePreview(key: string, anchor: HTMLElement): void {
  hidePreview()
  currentKey = key
  document.addEventListener('mousemove', onMove, true)
  timer = setTimeout(async () => {
    timer = null
    let data: Preview
    try {
      data = await load(key)
    } catch {
      return
    }
    if (currentKey !== key) return
    const target = document.querySelector(`.card[data-key="${CSS.escape(key)}"]`) ?? anchor
    pop = render(data)
    document.body.append(pop)
    place(pop, target)
  }, DELAY_MS)
}
