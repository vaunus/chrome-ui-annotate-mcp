import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApp } from '../src/app.ts'
import { FakeExtension, makeEdit, ORIGIN, waitFor } from './helpers.ts'

let app: ReturnType<typeof createApp>
let client: Client
let exts: FakeExtension[]

beforeEach(async () => {
  app = createApp({ port: 0, allowedOrigins: [ORIGIN], requestTimeoutMs: 300, retryMs: 50 })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await app.mcp.connect(serverSide)
  app.start()
  await waitFor(() => app.bridge.state === 'listening')
  client = new Client({ name: 'test', version: '0' })
  await client.connect(clientSide)
  exts = []
})

afterEach(async () => {
  for (const e of exts) await e.close().catch(() => {})
  await client.close()
  await app.close()
})

async function openExt(): Promise<FakeExtension> {
  const ext = await FakeExtension.open(app.bridge.port)
  exts.push(ext)
  await waitFor(() => app.bridge.connected)
  return ext
}

const textOf = (res: Awaited<ReturnType<Client['callTool']>>) =>
  (res.content as Array<{ type: string; text: string }>).map((c) => c.text).join('\n')

test('declares the instructions', () => {
  assert.match(client.getInstructions() ?? '', /get_pending_edits/)
  assert.match(client.getInstructions() ?? '', /mark_edit_done/)
})

test('lists the two tools and the apply prompt', async () => {
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name), ['get_pending_edits', 'mark_edit_done'])
  const { prompts } = await client.listPrompts()
  assert.deepEqual(prompts.map((p) => p.name), ['apply'])
  const prompt = await client.getPrompt({ name: 'apply' })
  assert.match(JSON.stringify(prompt.messages), /get_pending_edits/)
})

test('get_pending_edits says when the browser is not connected', async () => {
  const res = await client.callTool({ name: 'get_pending_edits', arguments: {} })
  assert.equal(res.isError, true)
  assert.match(textOf(res), /not connected/)
})

test('get_pending_edits returns the browser queue as Markdown', async () => {
  const ext = await openExt()
  ext.handler = () => ({
    ok: true,
    result: [makeEdit(), makeEdit({ id: 'e2', kind: 'note', newText: undefined, note: 'remove this' })],
  })
  const res = await client.callTool({ name: 'get_pending_edits', arguments: {} })
  const out = textOf(res)
  assert.equal(res.isError, false)
  assert.match(out, /^2 UI edits from the browser/)
  assert.match(out, /1\/2 · copy · id `e1`/)
  assert.match(out, /Old text: "Save"/)
  assert.match(out, /New text: "Save plan"/)
  assert.match(out, /Components \(nearest first\): PricingCard \(client\) ← Home \(server\)/)
  assert.match(out, /2\/2 · note · id `e2`/)
  assert.match(out, /Note from the user: "remove this"/)
})

test('mark_edit_done checks its input', async () => {
  await openExt()
  const noMsg = await client.callTool({ name: 'mark_edit_done', arguments: { id: 'e1', status: 'failed' } })
  assert.equal(noMsg.isError, true)
  assert.match(textOf(noMsg), /message is required/)
  const badStatus = await client.callTool({ name: 'mark_edit_done', arguments: { id: 'e1', status: 'nope' } })
  assert.equal(badStatus.isError, true)
})

test('mark_edit_done forwards the result to the browser', async () => {
  const ext = await openExt()
  const res = await client.callTool({
    name: 'mark_edit_done',
    arguments: { id: 'e1', status: 'done', message: 'app/components/PricingCard.tsx' },
  })
  assert.equal(res.isError, false)
  assert.deepEqual(ext.requests.at(-1), {
    type: 'request',
    id: ext.requests.at(-1)?.id,
    method: 'mark_edit_done',
    params: { id: 'e1', status: 'done', message: 'app/components/PricingCard.tsx' },
  })
})

test('mark_edit_done while the browser is away is sent on reconnect', async () => {
  const res = await client.callTool({ name: 'mark_edit_done', arguments: { id: 'e1', status: 'done' } })
  assert.equal(res.isError, false)
  assert.match(textOf(res), /gets this status when it reconnects/)

  const ext = await openExt()
  await waitFor(() => ext.requests.length === 1)
  assert.equal(ext.requests[0]?.method, 'mark_edit_done')
})

test('a tool in a waiting session takes over the link and says so', async () => {
  const second = createApp({ port: app.bridge.port, allowedOrigins: [ORIGIN], requestTimeoutMs: 300, retryMs: 50, connectWaitMs: 3000, yieldMs: 300 })
  const [c2, s2] = InMemoryTransport.createLinkedPair()
  await second.mcp.connect(s2)
  second.start()
  await waitFor(() => second.bridge.state === 'port_busy')
  const client2 = new Client({ name: 'test2', version: '0' })
  await client2.connect(c2)
  try {
    const call = client2.callTool({ name: 'get_pending_edits', arguments: {} })
    await waitFor(() => second.bridge.state === 'listening')
    const ext = await FakeExtension.open(second.bridge.port)
    exts.push(ext)
    ext.handler = () => ({ ok: true, result: [makeEdit()] })
    const res = await call
    assert.equal(res.isError, false)
    assert.match(textOf(res), /^Took over the browser link from another Claude session\./)
    assert.match(textOf(res), /1 UI edit from the browser/)
    assert.equal(app.bridge.state, 'port_busy')
  } finally {
    await client2.close()
    await second.close()
  }
})
