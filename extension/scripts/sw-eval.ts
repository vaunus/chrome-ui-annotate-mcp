// Test helper: run a JS expression in the extension's service worker over CDP.
// Usage: node scripts/sw-eval.ts <cdp-port> "<expression>"
// Example: node scripts/sw-eval.ts 9222 "chrome.storage.local.get('queue')"
// Uses Node's built-in WebSocket, so it needs no packages.

import { EXTENSION_ID } from '@ui-annotate/shared'

type Target = { type: string; url: string; webSocketDebuggerUrl: string }

const [port, expression] = process.argv.slice(2)
if (!port || !expression) {
  console.error('usage: node scripts/sw-eval.ts <cdp-port> "<expression>"')
  process.exit(2)
}

const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Target[]
const sw = targets.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${EXTENSION_ID}/`))
if (!sw) {
  console.error('extension service worker not found (asleep or not loaded)')
  process.exit(1)
}

const ws = new WebSocket(sw.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
const reply = await new Promise<{ result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }>((resolve) => {
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data))
    if (msg.id === 1) resolve(msg)
  }
})
ws.close()
if (reply.result?.exceptionDetails) {
  console.error(JSON.stringify(reply.result.exceptionDetails, null, 2))
  process.exit(1)
}
console.log(JSON.stringify(reply.result?.result?.value ?? null, null, 2))
