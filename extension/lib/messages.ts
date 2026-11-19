// Messages and storage keys shared by the content script and the service worker.
// The service worker is the only writer of `queue`. The content script reads
// storage and watches it for changes.

import type { UiEdit } from '@ui-annotate/shared'
import type { EditPatch, NewEdit } from './queue.ts'

export const KEYS = {
  queue: 'queue',
  pickMode: 'pickMode',
  link: 'link',
  lastTell: 'lastTell',
  collapsed: 'collapsed',
} as const

export type LinkState = { connected: boolean }

export type TellResult = { at: number; ok: boolean; count: number; error?: string }

export type StoredState = {
  queue: UiEdit[]
  pickMode: boolean
  link: LinkState
  lastTell?: TellResult
  collapsed: boolean
}

export type BgRequest =
  | { type: 'add'; edit: NewEdit }
  | { type: 'update'; id: string; patch: EditPatch }
  | { type: 'remove'; id: string }
  | { type: 'reset'; id: string }
  | { type: 'clear_done' }
  | { type: 'tell_claude' }
  | { type: 'toggle_pick' }
  | { type: 'set_collapsed'; collapsed: boolean }
  /** Keeps the service worker awake so it can reconnect to Claude quickly. */
  | { type: 'wake' }

export type BgResponse = { ok: true; value?: unknown } | { ok: false; error: string }
