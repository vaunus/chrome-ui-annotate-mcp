// WebSocket messages between the extension service worker and the MCP server.
// All messages are JSON text frames.

import type { UiEdit } from './index.ts'

export const DEFAULT_PORT = 7317

/** The extension pings at this rate. MV3 stops an idle service worker after 30 s. */
export const PING_INTERVAL_MS = 20_000

export type EditResultStatus = 'done' | 'failed' | 'needs_input'

export type EditResult = {
  id: string
  status: EditResultStatus
  message?: string
}

/** Server → extension. Each request expects exactly one reply with the same id. */
export type ServerRequest =
  /** Reply result: UiEdit[]. The extension sets the returned items to `working`. */
  | { type: 'request'; id: string; method: 'get_pending_edits' }
  /** Reply result: null. Reply error if the edit id is unknown. */
  | { type: 'request'; id: string; method: 'mark_edit_done'; params: EditResult }

export type ServerMessage = ServerRequest | { type: 'pong' }

export type ExtensionMessage =
  | { type: 'reply'; id: string; ok: true; result: unknown }
  | { type: 'reply'; id: string; ok: false; error: string }
  | { type: 'ping' }

export type RequestResult = {
  get_pending_edits: UiEdit[]
  mark_edit_done: null
}
