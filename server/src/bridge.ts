// WebSocket link to the extension service worker.
// - Listens on 127.0.0.1 only.
// - Accepts only the pinned extension Origin, so web pages cannot reach Claude.
// - One extension connection at a time. A new one replaces the old one.
// - If the port is busy (another Claude session owns it), retries until it frees.
// - Takeover: when a tool runs in a waiting session, it asks the owner to hand
//   over (POST /handover). The owner lets go and waits. The session you use wins.

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type {
  EditResult,
  ExtensionMessage,
  RequestResult,
  ServerMessage,
  ServerRequest,
} from '@ui-annotate/shared'

export type BridgeErrorCode = 'port_busy' | 'not_connected' | 'timeout' | 'remote_error'

export class BridgeError extends Error {
  readonly code: BridgeErrorCode
  constructor(code: BridgeErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export type BridgeOptions = {
  port: number
  allowedOrigins: string[]
  host?: string
  requestTimeoutMs?: number
  retryMs?: number
  /** After a takeover, how long to wait for the extension to reconnect. */
  connectWaitMs?: number
  /** After handing over, how long to wait before trying the port again. */
  yieldMs?: number
  log?: (msg: string) => void
  /** An extension connected (or reconnected). */
  onConnected?: () => void
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

type Method = ServerRequest['method']

const MAX_PAYLOAD = 1024 * 1024

/** Sent on /handover. A custom header makes a browser send a CORS preflight first, which we never allow. */
const HANDOVER_HEADER = 'x-ui-annotate'
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Bridge {
  state: 'starting' | 'listening' | 'port_busy' | 'closed' = 'starting'

  private readonly opts: Required<Omit<BridgeOptions, 'onConnected'>> & Pick<BridgeOptions, 'onConnected'>
  private readonly http: HttpServer
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })
  private socket: WebSocket | null = null
  private readonly pending = new Map<string, Pending>()
  private nextId = 1
  private retryTimer: NodeJS.Timeout | null = null
  private warnedBusy = false
  private takingOver = false

  constructor(options: BridgeOptions) {
    // `??` per field: callers pass `undefined` for "use the default", and a
    // spread would let that undefined wipe the default out.
    this.opts = {
      ...options,
      host: options.host ?? '127.0.0.1',
      requestTimeoutMs: options.requestTimeoutMs ?? 5000,
      retryMs: options.retryMs ?? 2000,
      connectWaitMs: options.connectWaitMs ?? 8000,
      yieldMs: options.yieldMs ?? 5000,
      log: options.log ?? (() => {}),
    }
    this.http = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/handover') this.handleHandover(req, res)
      else res.writeHead(426).end('WebSocket only\n')
    })
    this.http.on('upgrade', (req, sock, head) => this.handleUpgrade(req, sock, head))
    this.http.on('listening', () => {
      this.state = 'listening'
      this.warnedBusy = false
      this.opts.log(`listening on ${this.opts.host}:${this.port}`)
    })
    this.http.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') {
        this.opts.log(`http error: ${err.message}`)
        return
      }
      this.state = 'port_busy'
      if (!this.warnedBusy) this.opts.log(`port ${this.opts.port} busy, retrying every ${this.opts.retryMs} ms`)
      this.warnedBusy = true
      // During a takeover the old owner is letting go right now: retry fast.
      this.retryTimer = setTimeout(() => this.listen(), this.takingOver ? 50 : this.opts.retryMs)
    })
  }

  /** The bound port. Useful when the port option is 0. */
  get port(): number {
    const addr = this.http.address()
    return typeof addr === 'object' && addr ? addr.port : this.opts.port
  }

  get connected(): boolean {
    return this.socket?.readyState === 1
  }

  start(): void {
    this.listen()
  }

  async close(): Promise<void> {
    this.state = 'closed'
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.rejectAll(new BridgeError('not_connected', 'Server is shutting down.'))
    this.socket?.terminate()
    this.socket = null
    this.wss.close()
    await new Promise<void>((resolve) => (this.http.listening ? this.http.close(() => resolve()) : resolve()))
  }

  /**
   * Make sure this session holds the link before a tool call. If another
   * session owns the port, take it over and wait for the extension to reconnect.
   */
  async ready(): Promise<{ tookOver: boolean }> {
    if (this.state !== 'port_busy') return { tookOver: false }
    if (!(await this.takeOver())) {
      throw new BridgeError(
        'port_busy',
        `Another program holds port ${this.opts.port} and did not hand it over. ` +
          'If it is an older Claude session, close it or use it instead.',
      )
    }
    const end = Date.now() + this.opts.connectWaitMs
    while (!this.connected && Date.now() < end) await sleep(50)
    return { tookOver: true }
  }

  request(method: 'get_pending_edits'): Promise<RequestResult['get_pending_edits']>
  request(method: 'mark_edit_done', params: EditResult): Promise<RequestResult['mark_edit_done']>
  request(method: Method, params?: EditResult): Promise<unknown> {
    if (this.state === 'port_busy') {
      return Promise.reject(
        new BridgeError(
          'port_busy',
          `Another Claude session owns the browser link (port ${this.opts.port}). ` +
            'Close that session, or use it instead. This session takes over when the port frees.',
        ),
      )
    }
    const socket = this.socket
    if (!socket || socket.readyState !== 1) {
      return Promise.reject(
        new BridgeError(
          'not_connected',
          'The UI Annotate browser extension is not connected. Open Chrome with the extension on, then try again.',
        ),
      )
    }
    const id = `r${this.nextId++}`
    const msg = (method === 'mark_edit_done' ? { type: 'request', id, method, params } : { type: 'request', id, method }) as ServerRequest
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BridgeError('timeout', `The browser extension did not answer ${method} within ${this.opts.requestTimeoutMs} ms.`))
      }, this.opts.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send(socket, msg)
    })
  }

  private listen(): void {
    if (this.state === 'closed' || this.http.listening) return
    this.http.listen(this.opts.port, this.opts.host)
  }

  /** Ask the owner to hand over, then bind the port. True when this session now holds it. */
  private async takeOver(): Promise<boolean> {
    const accepted = await new Promise<boolean>((resolve) => {
      const req = httpRequest(
        { host: this.opts.host, port: this.opts.port, path: '/handover', method: 'POST', headers: { [HANDOVER_HEADER]: 'handover' }, timeout: 2000 },
        (res) => {
          res.resume()
          resolve(res.statusCode === 200)
        },
      )
      req.on('timeout', () => req.destroy())
      req.on('error', () => resolve(false))
      req.end()
    })
    if (!accepted) return false

    this.opts.log('took over the browser link from another session')
    this.takingOver = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.listen()
    const end = Date.now() + 3000
    while (this.state !== 'listening' && Date.now() < end) await sleep(25)
    this.takingOver = false
    return this.state === 'listening'
  }

  /** Another session asks for the link. Only a local, non-browser caller may ask. */
  private handleHandover(req: IncomingMessage, res: ServerResponse): void {
    const local = LOCAL_ADDRESSES.has(req.socket.remoteAddress ?? '')
    if (!local || req.headers.origin || req.headers[HANDOVER_HEADER] !== 'handover') {
      res.writeHead(403).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}', () => this.yieldPort())
  }

  /** Let go of the port and the extension, then wait. Do not grab the port back right away. */
  private yieldPort(): void {
    this.opts.log('handed the browser link to another session')
    this.rejectAll(new BridgeError('not_connected', 'Another Claude session took over the browser link.'))
    this.socket?.terminate()
    this.socket = null
    this.http.close()
    this.http.closeAllConnections()
    this.state = 'port_busy'
    this.warnedBusy = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.listen(), this.opts.yieldMs)
  }

  private handleUpgrade(req: IncomingMessage, sock: Duplex, head: Buffer): void {
    const origin = req.headers.origin ?? ''
    if (!this.opts.allowedOrigins.includes(origin)) {
      this.opts.log(`rejected connection from origin "${origin}"`)
      sock.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    this.wss.handleUpgrade(req, sock, head, (ws) => this.attach(ws))
  }

  private attach(ws: WebSocket): void {
    if (this.socket) {
      this.opts.log('new extension connection replaces the old one')
      this.rejectAll(new BridgeError('not_connected', 'The browser extension reconnected. Try again.'))
      this.socket.close(4001, 'replaced')
    }
    this.socket = ws
    this.opts.log('extension connected')
    ws.on('message', (data) => this.handleMessage(ws, String(data)))
    ws.on('close', () => {
      if (this.socket !== ws) return
      this.socket = null
      this.rejectAll(new BridgeError('not_connected', 'The browser extension disconnected.'))
      this.opts.log('extension disconnected')
    })
    ws.on('error', (err) => this.opts.log(`socket error: ${err.message}`))
    this.opts.onConnected?.()
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let msg: ExtensionMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      this.opts.log('dropped a message that is not JSON')
      return
    }
    switch (msg.type) {
      case 'ping':
        this.send(ws, { type: 'pong' })
        return
      case 'reply': {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new BridgeError('remote_error', msg.error))
        return
      }
      default:
        this.opts.log(`dropped unknown message type "${(msg as { type?: string }).type}"`)
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    ws.send(JSON.stringify(msg))
  }

  private rejectAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
      this.pending.delete(id)
    }
  }
}
