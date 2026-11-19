// Runs the real entry point as Claude Code does: a child process over stdio.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { EXTENSION_ORIGIN } from '@ui-annotate/shared'
import { FakeExtension, makeEdit, waitFor } from './helpers.ts'

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))

function startServer() {
  const child = spawn(process.execPath, [ENTRY], { env: { ...process.env, UI_ANNOTATE_PORT: '0' } })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (stderr += d))
  return { child, out: () => stdout, err: () => stderr }
}

test('never picks protocol 2026-07-28, which drops channel messages', async () => {
  const s = startServer()
  s.child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    }) + '\n',
  )
  await waitFor(() => s.out().includes('"id":1'), 5000)
  const reply = JSON.parse(s.out().split('\n')[0]!)
  assert.notEqual(reply.result.protocolVersion, '2026-07-28')
  assert.deepEqual(reply.result.capabilities.experimental, { 'claude/channel': {} })
  s.child.kill()
})

test('end to end over stdio with the pinned extension origin', async () => {
  const s = startServer()
  const rpc = (msg: object) => s.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
  try {
    await waitFor(() => /listening on 127\.0\.0\.1:\d+/.test(s.err()), 5000)
    const port = Number(s.err().match(/listening on 127\.0\.0\.1:(\d+)/)![1])
    rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } })
    rpc({ method: 'notifications/initialized' })

    const ext = await FakeExtension.open(port, EXTENSION_ORIGIN)
    ext.handler = () => ({ ok: true, result: [makeEdit()] })
    rpc({ id: 2, method: 'tools/call', params: { name: 'get_pending_edits', arguments: {} } })
    await waitFor(() => s.out().includes('"id":2'), 5000)
    assert.match(s.out(), /1 UI edit from the browser/)

    ext.send({ type: 'tell_claude', count: 1 })
    await waitFor(() => s.out().includes('notifications/claude/channel'), 5000)
    assert.match(s.out(), /1 UI edit ready in the browser/)
    await ext.close()
  } finally {
    s.child.kill()
  }
})

test('quits when stdin closes, so no leftover process holds the port', async () => {
  const s = startServer()
  await waitFor(() => s.err().includes('listening on'), 5000)
  s.child.stdin.end()
  const [code] = await Promise.race([
    once(s.child, 'exit'),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still running after 2 s')), 2000)),
  ])
  assert.equal(code, 0)
})
