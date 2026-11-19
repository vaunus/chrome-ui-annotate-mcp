// Entry point. Claude Code starts this over stdio (see .mcp.json).
// Logs go to stderr only: stdout carries the MCP protocol.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DEFAULT_PORT, EXTENSION_ORIGIN } from '@ui-annotate/shared'
import { createApp } from './app.ts'

const log = (msg: string) => console.error(`[ui-annotate] ${msg}`)

const port = process.env.UI_ANNOTATE_PORT ? Number(process.env.UI_ANNOTATE_PORT) : DEFAULT_PORT

const app = createApp({ port, allowedOrigins: [EXTENSION_ORIGIN], log })

let quitting = false
async function quit(reason: string): Promise<void> {
  if (quitting) return
  quitting = true
  log(`quitting: ${reason}`)
  // Never hang on close. A leftover process would hold the port.
  setTimeout(() => process.exit(0), 1000).unref()
  await app.close().catch(() => {})
  process.exit(0)
}

// Claude Code closes stdin when the session ends. Without this, the WebSocket
// listener keeps the process alive as an orphan that holds the port.
process.stdin.on('end', () => void quit('stdin closed'))
process.stdin.on('close', () => void quit('stdin closed'))
process.on('SIGTERM', () => void quit('SIGTERM'))
process.on('SIGINT', () => void quit('SIGINT'))

await app.mcp.connect(new StdioServerTransport())
app.start()
