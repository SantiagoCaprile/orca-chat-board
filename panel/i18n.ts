// UI strings. Spanish when Orca's UI language is Spanish, English otherwise.
import type { StatusKind } from './icons.ts'

const en = {
  status: {
    working: 'Working',
    waiting: 'Waiting for you',
    done: 'Done',
    interrupted: 'Interrupted',
    blocked: 'Needs permission',
    closed: 'Closed',
    monitoring: 'Monitoring',
    stale: 'No sign of life'
  } satisfies Record<StatusKind, string>,
  since: (label: string, ago: string) => `${label} · ${ago} ago`,
  now: 'now',
  monitorKind: { loop: 'Loop', cron: 'Scheduled task', monitor: 'Monitor' },
  nextRun: (d: string) => `next ${d}`,
  dueNow: 'due now',
  lastRun: (d: string) => `last ${d}`,
  noSignal: (d: string) => `no signal ${d}`,
  every: (d: string) => `every ${d}`,
  untitled: '(untitled)',
  error: (msg: string) => `Error: ${msg}`,
  listFailed: (detail: string) => `Could not list chats: ${detail}`,
  chatClosed: 'That chat is already closed.',
  chatTabOpened: "Opened its workspace. Orca can't switch to a chat tab from a plugin yet.",
  focusFailed: 'Could not open the chat',
  openHint: 'Click to open the chat',
  openNow: 'Open now',
  openChat: 'Open chat',
  editCard: 'Rename tab and edit note',
  deleteCard: 'Remove from board',
  name: 'Name',
  cardName: 'Card name',
  tabName: 'Tab name',
  tabNameHint: 'Tab name (empty: automatic)',
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
  unseen: 'Finished while you were away',
  columnUnseen: (n: number) => `${n} not seen yet`,
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
    closed: 'Cerrado',
    monitoring: 'Monitoreando',
    stale: 'Sin señal'
  },
  since: (label, ago) => `${label} · desde ${ago}`,
  now: 'ahora',
  monitorKind: { loop: 'Loop', cron: 'Tarea programada', monitor: 'Monitor' },
  nextRun: (d) => `próx. ${d}`,
  dueNow: 'por correr',
  lastRun: (d) => `últ. ${d}`,
  noSignal: (d) => `sin señal ${d}`,
  every: (d) => `cada ${d}`,
  untitled: '(sin título)',
  error: (msg) => `Error: ${msg}`,
  listFailed: (detail) => `No pude listar los chats: ${detail}`,
  chatClosed: 'Ese chat ya está cerrado.',
  chatTabOpened: 'Abrí su workspace. Orca todavía no deja que un plugin cambie a una pestaña de chat.',
  focusFailed: 'No se pudo abrir el chat',
  openHint: 'Click para abrir el chat',
  openNow: 'Abierto ahora',
  openChat: 'Abrir chat',
  editCard: 'Renombrar tab y editar nota',
  deleteCard: 'Borrar del tablero',
  name: 'Nombre',
  cardName: 'Nombre de la tarjeta',
  tabName: 'Nombre de la tab',
  tabNameHint: 'Nombre de la tab (vacío: automático)',
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
  unseen: 'Terminó mientras no mirabas',
  columnUnseen: (n) => `${n} sin revisar`,
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
