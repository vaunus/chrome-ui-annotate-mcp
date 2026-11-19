// Run a JS expression in the extension's service worker over CDP.
// As a command: node e2e/sw-eval.ts <cdp-port> "<expression>"
// Example:      node e2e/sw-eval.ts 9222 "chrome.storage.local.get('queue')"
// Uses Node's built-in WebSocket and fetch, so it needs no packages.

import { EXTENSION_ID } from '@ui-annotate/shared'

type Target = { type: string; url: string; webSocketDebuggerUrl: string }
type EvalReply = { result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } } }

export async function swEval<T = unknown>(cdpPort: number | string, expression: string): Promise<T> {
  const targets = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()) as Target[]
  const sw = targets.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${EXTENSION_ID}/`))
  if (!sw) throw new Error('extension service worker not found (asleep or not loaded)')

  const ws = new WebSocket(sw.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('could not open the CDP socket'))
    })
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    const reply = await new Promise<EvalReply>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data))
        if (msg.id === 1) resolve(msg)
      }
    })
    const ex = reply.result?.exceptionDetails
    if (ex) throw new Error(ex.exception?.description ?? ex.text ?? 'evaluation failed')
    return (reply.result?.result?.value ?? null) as T
  } finally {
    ws.close()
  }
}

if (import.meta.main) {
  const [port, expression] = process.argv.slice(2)
  if (!port || !expression) {
    console.error('usage: node e2e/sw-eval.ts <cdp-port> "<expression>"')
    process.exit(2)
  }
  try {
    console.log(JSON.stringify(await swEval(port, expression), null, 2))
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}
