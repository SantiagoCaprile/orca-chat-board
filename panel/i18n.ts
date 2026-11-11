// UI strings. Spanish when Orca's UI language is Spanish, English otherwise.
import type { StatusKind } from './icons.ts'

const en = {
  status: {
    working: 'Working',
    waiting: 'Waiting for you',
    done: 'Done',
    interrupted: 'Interrupted',
    blocked: 'Needs permission',
    closed: 'Closed'
  } satisfies Record<StatusKind, string>,
  since: (label: string, ago: string) => `${label} · ${ago} ago`,
  now: 'now',
  untitled: '(untitled)',
  error: (msg: string) => `Error: ${msg}`,
  listFailed: (detail: string) => `Could not list chats: ${detail}`,
  chatClosed: 'That chat is already closed.',
  focusFailed: 'Could not open the chat',
  openHint: 'Double-click to open the chat',
  openChat: 'Open chat',
  editCard: 'Edit name and note',
  deleteCard: 'Remove from board',
  name: 'Name',
  cardName: 'Card name',
  note: 'Note',
  noteHint: 'Note (Enter saves, Shift+Enter new line)',
  save: 'Save',
  cancel: 'Cancel',
  columnName: 'Column name',
  renameHint: 'Double-click to rename',
  moveLeft: 'Move column left',
  moveRight: 'Move column right',
  deleteColumn: 'Delete column (its cards move to the first one)',
  confirmDelete: 'Delete?',
  noMatches: 'No matches',
  dropHere: 'Drag chats here',
  filter: 'Filter chats…',
  filterLabel: 'Filter',
  refresh: 'List chats again',
  addColumn: 'Add column',
  addColumnButton: '+ Column',
  newColumn: 'New column',
  collapse: 'Collapse column',
  expand: (title: string, n: number) => `${title} (${n}): click to expand`,
  loading: 'Loading chats…',
  archived: (n: number) => `Archived (${n})`,
  clearArchive: 'Clear',
  clearArchiveHint: 'Remove every archived card',
  confirmClear: (n: number) => `Remove ${n}?`
}

type Strings = typeof en

const es: Strings = {
  status: {
    working: 'Trabajando',
    waiting: 'Te espera',
    done: 'Listo',
    interrupted: 'Interrumpido',
    blocked: 'Pide permiso',
    closed: 'Cerrado'
  },
  since: (label, ago) => `${label} · desde ${ago}`,
  now: 'ahora',
  untitled: '(sin título)',
  error: (msg) => `Error: ${msg}`,
  listFailed: (detail) => `No pude listar los chats: ${detail}`,
  chatClosed: 'Ese chat ya está cerrado.',
  focusFailed: 'No se pudo abrir el chat',
  openHint: 'Doble click: abrir el chat',
  openChat: 'Abrir chat',
  editCard: 'Editar nombre y nota',
  deleteCard: 'Borrar del tablero',
  name: 'Nombre',
  cardName: 'Nombre de la tarjeta',
  note: 'Nota',
  noteHint: 'Nota (Enter guarda, Shift+Enter nueva línea)',
  save: 'Guardar',
  cancel: 'Cancelar',
  columnName: 'Nombre de la columna',
  renameHint: 'Doble click para renombrar',
  moveLeft: 'Mover columna a la izquierda',
  moveRight: 'Mover columna a la derecha',
  deleteColumn: 'Borrar columna (sus tarjetas van a la primera)',
  confirmDelete: '¿Borrar?',
  noMatches: 'Sin coincidencias',
  dropHere: 'Arrastrá chats acá',
  filter: 'Filtrar chats…',
  filterLabel: 'Filtrar',
  refresh: 'Volver a listar los chats',
  addColumn: 'Agregar columna',
  addColumnButton: '+ Columna',
  newColumn: 'Nueva columna',
  collapse: 'Contraer columna',
  expand: (title, n) => `${title} (${n}): click para expandir`,
  loading: 'Cargando chats…',
  archived: (n) => `Archivados (${n})`,
  clearArchive: 'Vaciar',
  clearArchiveHint: 'Borrar todas las tarjetas archivadas',
  confirmClear: (n) => `¿Borrar ${n}?`
}

const orcaLocale: string = (globalThis as { orca?: { locale?: string } }).orca?.locale ?? 'en'

/** The effective UI language tag; also sent to the worker to name a new board's default columns. */
export let locale: string = orcaLocale
export let t: Strings = pick(orcaLocale)

function pick(tag: string): Strings {
  return tag.toLowerCase().startsWith('es') ? es : en
}

/** `auto` follows Orca; `en` / `es` force a language. */
export function setLanguage(choice: unknown): void {
  locale = choice === 'en' || choice === 'es' ? choice : orcaLocale
  t = pick(locale)
}
