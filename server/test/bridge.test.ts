import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Bridge, BridgeError, type BridgeOptions } from '../src/bridge.ts'
import { connect, FakeExtension, makeEdit, ORIGIN, waitFor } from './helpers.ts'

const open: Array<{ close: () => unknown }> = []
afterEach(async () => {
  for (const o of open.splice(0)) await o.close()
})

async function startBridge(opts: Partial<BridgeOptions> = {}): Promise<Bridge> {
  const bridge = new Bridge({ port: 0, allowedOrigins: [ORIGIN], ...opts })
  open.push(bridge)
  bridge.start()
  await waitFor(() => bridge.state === 'listening' || bridge.state === 'port_busy')
  return bridge
}

async function openExt(port: number): Promise<FakeExtension> {
  const ext = await FakeExtension.open(port)
  open.push(ext)
  return ext
}

const codeOf = (err: unknown) => (err as BridgeError).code

test('rejects a web page origin and a missing origin', async () => {
  const bridge = await startBridge()
  assert.equal((await connect(bridge.port, 'http://evil.example')).status, 403)
  assert.equal((await connect(bridge.port, 'http://localhost:3000')).status, 403)
  assert.equal((await connect(bridge.port)).status, 403)
  assert.equal(bridge.connected, false)
})

test('accepts the extension origin and relays a request and its reply', async () => {
  const bridge = await startBridge()
  const ext = await openExt(bridge.port)
  ext.handler = () => ({ ok: true, result: [makeEdit()] })
  await waitFor(() => bridge.connected)

  const edits = await bridge.request('get_pending_edits')
  assert.deepEqual(edits, [makeEdit()])
  assert.equal(ext.requests[0]?.method, 'get_pending_edits')
})

test('sends mark_edit_done params', async () => {
  const bridge = await startBridge()
  const ext = await openExt(bridge.port)
  await waitFor(() => bridge.connected)

  await bridge.request('mark_edit_done', { id: 'e1', status: 'done', message: 'app/page.tsx' })
  assert.deepEqual(ext.requests[0], {
    type: 'request',
    id: ext.requests[0]?.id,
    method: 'mark_edit_done',
    params: { id: 'e1', status: 'done', message: 'app/page.tsx' },
  })
})

test('an error reply rejects with remote_error', async () => {
  const bridge = await startBridge()
  const ext = await openExt(bridge.port)
  ext.handler = () => ({ ok: false, error: 'unknown edit id e9' })
  await waitFor(() => bridge.connected)

  await assert.rejects(bridge.request('mark_edit_done', { id: 'e9', status: 'done' }), (err) => {
    assert.equal(codeOf(err), 'remote_error')
    assert.match((err as Error).message, /unknown edit id e9/)
    return true
  })
})

test('no reply rejects with timeout', async () => {
  const bridge = await startBridge({ requestTimeoutMs: 100 })
  const ext = await openExt(bridge.port)
  ext.handler = () => 'ignore'
  await waitFor(() => bridge.connected)

  await assert.rejects(bridge.request('get_pending_edits'), (err) => codeOf(err) === 'timeout')
})

test('undefined options keep the defaults (a slow reply still arrives)', async () => {
  const bridge = await startBridge({ requestTimeoutMs: undefined, retryMs: undefined, log: undefined })
  const ext = await openExt(bridge.port)
  ext.handler = (req) => {
    setTimeout(() => ext.send({ type: 'reply', id: req.id, ok: true, result: [] }), 100)
    return 'ignore'
  }
  await waitFor(() => bridge.connected)
  assert.deepEqual(await bridge.request('get_pending_edits'), [])
})

test('no extension rejects with not_connected', async () => {
  const bridge = await startBridge()
  await assert.rejects(bridge.request('get_pending_edits'), (err) => codeOf(err) === 'not_connected')
})

test('a disconnect rejects the open request', async () => {
  const bridge = await startBridge({ requestTimeoutMs: 5000 })
  const ext = await openExt(bridge.port)
  ext.handler = () => 'ignore'
  await waitFor(() => bridge.connected)

  const check = assert.rejects(bridge.request('get_pending_edits'), (err) => codeOf(err) === 'not_connected')
  await waitFor(() => ext.requests.length === 1)
  await ext.close()
  await check
})

test('answers ping with pong', async () => {
  const bridge = await startBridge()
  const ext = await openExt(bridge.port)
  ext.send({ type: 'ping' })
  await waitFor(() => ext.messages.some((m) => m.type === 'pong'))
})

test('a new extension connection replaces the old one', async () => {
  const bridge = await startBridge()
  const first = await openExt(bridge.port)
  let closeCode = 0
  first.ws.on('close', (code) => (closeCode = code))
  const second = await openExt(bridge.port)
  second.handler = () => ({ ok: true, result: [] })

  await waitFor(() => closeCode === 4001)
  assert.deepEqual(await bridge.request('get_pending_edits'), [])
  assert.equal(first.requests.length, 0)
})

test('port busy: says so, then takes over when the owner quits', async () => {
  const owner = await startBridge()
  const port = owner.port
  const waiting = await startBridge({ port, retryMs: 50 })
  assert.equal(waiting.state, 'port_busy')
  await assert.rejects(waiting.request('get_pending_edits'), (err) => {
    assert.equal(codeOf(err), 'port_busy')
    assert.match((err as Error).message, /Another Claude session/)
    return true
  })

  await owner.close()
  await waitFor(() => waiting.state === 'listening')
  assert.equal(waiting.port, port)
})

// ---- takeover ---------------------------------------------------------------------

import { createServer, request as httpRequest } from 'node:http'

function post(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/handover', method: 'POST', headers }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

/** A fixed free port. Port 0 would let a bridge that retries bind a new random port. */
async function freePort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  const { port } = s.address() as { port: number }
  await new Promise((r) => s.close(r))
  return port
}

test('takeover: the waiting session takes the link, the old owner lets go and waits', async () => {
  const port = await freePort()
  const owner = await startBridge({ port, retryMs: 50, yieldMs: 300 })
  const oldExt = await openExt(port)
  let oldClosed = false
  oldExt.ws.on('close', () => (oldClosed = true))
  const waiting = await startBridge({ port, retryMs: 50, connectWaitMs: 3000 })
  assert.equal(waiting.state, 'port_busy')

  // The extension reconnects to whoever holds the port, as the real one does.
  const ready = waiting.ready()
  await waitFor(() => waiting.state === 'listening')
  const ext = await openExt(port)
  ext.handler = () => ({ ok: true, result: [] })
  assert.deepEqual(await ready, { tookOver: true })
  assert.deepEqual(await waiting.request('get_pending_edits'), [])

  await waitFor(() => oldClosed)
  assert.equal(owner.state, 'port_busy')
  // Past its yield time, the old owner still waits: it does not grab the port back.
  await new Promise((r) => setTimeout(r, 500))
  assert.equal(owner.state, 'port_busy')
  assert.equal(waiting.state, 'listening')

  // When the new owner quits, the old one takes the port again.
  await waiting.close()
  await waitFor(() => owner.state === 'listening')
})

test('ready() is a no-op for the owner', async () => {
  const bridge = await startBridge()
  assert.deepEqual(await bridge.ready(), { tookOver: false })
})

test('handover refuses browser requests and requests without the header', async () => {
  const owner = await startBridge()
  assert.equal(await post(owner.port, {}), 403)
  assert.equal(await post(owner.port, { 'x-ui-annotate': 'handover', origin: 'http://evil.example' }), 403)
  assert.equal(owner.state, 'listening')
})

test('takeover fails cleanly when another program holds the port', async () => {
  const other = createServer((_req, res) => res.writeHead(404).end())
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()))
  open.push({ close: () => new Promise((r) => other.close(r)) })
  const port = (other.address() as { port: number }).port
  const waiting = await startBridge({ port, retryMs: 50 })
  await assert.rejects(waiting.ready(), (err) => {
    assert.equal(codeOf(err), 'port_busy')
    assert.match((err as Error).message, /did not hand it over/)
    return true
  })
})
