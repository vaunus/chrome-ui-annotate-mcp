import { WebSocket } from 'ws'
import type { ExtensionMessage, ServerMessage, ServerRequest, UiEdit } from '@ui-annotate/shared'

export const ORIGIN = 'chrome-extension://testtesttesttesttesttesttesttest'

export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const end = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor: timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** Try to open a socket. Resolves with the open socket or the HTTP status that refused it. */
export function connect(port: number, origin?: string): Promise<{ ws?: WebSocket; status?: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {})
    ws.once('open', () => resolve({ ws }))
    ws.once('unexpected-response', (_req, res) => resolve({ status: res.statusCode }))
    ws.once('error', (err) => reject(err))
  })
}

type Handler = (req: ServerRequest) => { ok: true; result: unknown } | { ok: false; error: string } | 'ignore'

/** Stands in for the extension service worker. */
export class FakeExtension {
  readonly requests: ServerRequest[] = []
  readonly messages: ServerMessage[] = []
  handler: Handler = () => ({ ok: true, result: null })
  ws!: WebSocket

  static async open(port: number, origin = ORIGIN): Promise<FakeExtension> {
    const ext = new FakeExtension()
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin })
    ext.ws = ws
    // Listen before 'open': the server can send in the same packet as the handshake.
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as ServerMessage
      ext.messages.push(msg)
      if (msg.type !== 'request') return
      ext.requests.push(msg)
      const reply = ext.handler(msg)
      if (reply !== 'ignore') ext.send({ type: 'reply', id: msg.id, ...reply } as ExtensionMessage)
    })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('unexpected-response', (_req, res) => reject(new Error(`FakeExtension: refused (${res.statusCode})`)))
      ws.once('error', reject)
    })
    return ext
  }

  send(msg: ExtensionMessage): void {
    this.ws.send(JSON.stringify(msg))
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve) => {
      this.ws.once('close', () => resolve())
      this.ws.close()
    })
  }
}

export function makeEdit(over: Partial<UiEdit> = {}): UiEdit {
  return {
    id: 'e1',
    kind: 'copy',
    status: 'queued',
    url: 'http://localhost:3100/pricing',
    oldText: 'Save',
    newText: 'Save plan',
    selector: 'main > div:nth-child(3) > div:nth-child(2) > button',
    outerHTML: '<button class="rounded-lg">Save</button>',
    nearbyText: ['Team', '$29'],
    react: { component: 'PricingCard', owners: ['PricingCard (client)', 'Home (server)'] },
    createdAt: 0,
    ...over,
  }
}
