// Service worker. It owns the queue (chrome.storage.local) and the WebSocket
// link to the MCP server that Claude Code runs.

import { DEFAULT_PORT, PING_INTERVAL_MS, type ExtensionMessage, type ServerMessage, type UiEdit } from '@ui-annotate/shared'
import { KEYS, type BgRequest, type BgResponse, type LinkState, type TellResult } from '../lib/messages.ts'
import {
  addEdit,
  clearDone,
  markDone,
  queuedCount,
  removeEdit,
  resetEdit,
  takePending,
  updateEdit,
  type Change,
} from '../lib/queue.ts'

const SERVER_URL = `ws://127.0.0.1:${DEFAULT_PORT}`
const RETRY_MS = 2000
const RECONNECT_ALARM = 'reconnect'

export default defineBackground(() => {
  // ---- queue: one writer, one change at a time ---------------------------

  let chain: Promise<unknown> = Promise.resolve()

  function mutate<T>(fn: (queue: UiEdit[]) => Change<T>): Promise<T> {
    const run = chain.then(async () => {
      const got = await browser.storage.local.get(KEYS.queue)
      const { queue, value } = fn((got[KEYS.queue] as UiEdit[] | undefined) ?? [])
      await browser.storage.local.set({ [KEYS.queue]: queue })
      return value
    })
    chain = run.catch(() => {})
    return run
  }

  async function readQueue(): Promise<UiEdit[]> {
    const got = await browser.storage.local.get(KEYS.queue)
    return (got[KEYS.queue] as UiEdit[] | undefined) ?? []
  }

  // ---- link to the MCP server ---------------------------------------------

  let ws: WebSocket | null = null
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const setLink = (link: LinkState) => browser.storage.local.set({ [KEYS.link]: link })

  function connect(): void {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
    clearTimeout(retryTimer)
    const sock = new WebSocket(SERVER_URL)
    ws = sock
    // Set before open: the server sends saved results as soon as we connect.
    sock.onmessage = (e) => void handleServer(sock, String(e.data))
    sock.onopen = () => {
      void setLink({ connected: true })
      pingTimer = setInterval(() => send(sock, { type: 'ping' }), PING_INTERVAL_MS)
    }
    sock.onclose = () => {
      clearInterval(pingTimer)
      if (ws !== sock) return
      ws = null
      void setLink({ connected: false })
      retryTimer = setTimeout(connect, RETRY_MS)
    }
    sock.onerror = () => {} // onclose follows and schedules the retry
  }

  function send(sock: WebSocket, msg: ExtensionMessage): void {
    if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg))
  }

  /** Wait briefly for the link, e.g. when the user clicks Tell Claude right after starting Claude. */
  async function linked(timeoutMs = 1500): Promise<WebSocket | null> {
    connect()
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (ws?.readyState === WebSocket.OPEN) return ws
      await new Promise((r) => setTimeout(r, 50))
    }
    return ws?.readyState === WebSocket.OPEN ? ws : null
  }

  async function handleServer(sock: WebSocket, raw: string): Promise<void> {
    let msg: ServerMessage
    try {
      msg = JSON.parse(raw) as ServerMessage
    } catch {
      return
    }
    if (msg.type !== 'request') return
    const { id } = msg
    try {
      let result: unknown
      if (msg.method === 'get_pending_edits') {
        result = await mutate(takePending)
      } else {
        const params = msg.params
        result = await mutate((q) => markDone(q, params))
      }
      send(sock, { type: 'reply', id, ok: true, result })
    } catch (err) {
      send(sock, { type: 'reply', id, ok: false, error: (err as Error).message })
    }
  }

  // ---- Tell Claude -----------------------------------------------------------

  async function tellClaude(): Promise<TellResult> {
    const count = queuedCount(await readQueue())
    let result: TellResult
    if (count === 0) {
      result = { at: Date.now(), ok: false, count, error: 'Nothing is queued.' }
    } else {
      const sock = await linked()
      result = sock
        ? (send(sock, { type: 'tell_claude', count }), { at: Date.now(), ok: true, count })
        : { at: Date.now(), ok: false, count, error: 'Claude is not connected. Start Claude Code in your project, then try again.' }
    }
    await browser.storage.local.set({ [KEYS.lastTell]: result })
    return result
  }

  // ---- edit mode and badge ---------------------------------------------------

  async function togglePick(): Promise<boolean> {
    const got = await browser.storage.local.get(KEYS.pickMode)
    const next = !got[KEYS.pickMode]
    await browser.storage.local.set({ [KEYS.pickMode]: next })
    return next
  }

  async function updateBadge(): Promise<void> {
    const got = await browser.storage.local.get([KEYS.pickMode, KEYS.queue])
    const queued = queuedCount((got[KEYS.queue] as UiEdit[] | undefined) ?? [])
    const on = !!got[KEYS.pickMode]
    await browser.action.setBadgeText({ text: on ? 'ON' : queued ? String(queued) : '' })
    await browser.action.setBadgeBackgroundColor({ color: on ? '#16a34a' : '#4f46e5' })
  }

  // ---- listeners (registered synchronously, as MV3 requires) -----------------

  browser.runtime.onMessage.addListener((req: BgRequest, _sender, sendResponse: (r: BgResponse) => void) => {
    const handle = async (): Promise<unknown> => {
      switch (req.type) {
        case 'add':
          return mutate((q) => addEdit(q, req.edit))
        case 'update':
          return mutate((q) => updateEdit(q, req.id, req.patch))
        case 'remove':
          return mutate((q) => removeEdit(q, req.id))
        case 'reset':
          return mutate((q) => resetEdit(q, req.id))
        case 'clear_done':
          return mutate(clearDone)
        case 'tell_claude':
          return tellClaude()
        case 'toggle_pick':
          return togglePick()
        case 'set_collapsed':
          return browser.storage.local.set({ [KEYS.collapsed]: req.collapsed })
        case 'wake':
          connect()
          return null
      }
    }
    handle().then(
      (value) => sendResponse({ ok: true, value }),
      (err: Error) => sendResponse({ ok: false, error: err.message }),
    )
    return true // async response
  })

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-pick') void togglePick()
    if (command === 'tell-claude') void tellClaude()
  })

  browser.action.onClicked.addListener(() => void togglePick())

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (KEYS.pickMode in changes || KEYS.queue in changes)) void updateBadge()
  })

  // A sleeping worker cannot hold the link. The alarm wakes it to reconnect.
  browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 })
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) connect()
  })

  void setLink({ connected: false })
  void updateBadge()
  connect()
})
