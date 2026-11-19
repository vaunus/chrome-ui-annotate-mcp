// End-to-end test: real MCP server + e2e extension build + test app in a test Chrome.
// A scripted MCP client plays Claude. It checks the plumbing, not Claude's judgment.
//
// Run: pnpm e2e   (builds the extension in e2e mode first)
// Needs: agent-browser on PATH. Reuses a dev server on :3100 if one runs, else starts one.
// Uses its own port (extension/.env.e2e), so it never takes the link from a real Claude session.

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { UiEdit } from '@ui-annotate/shared'
import { swEval } from './sw-eval.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXT = `${ROOT}extension/.output/chrome-mv3-e2e`
const SERVER = `${ROOT}server/src/index.ts`
const APP_URL = 'http://localhost:3100/'
const SESSION = 'ui-annotate-e2e'
const PORT = Number(readFileSync(`${ROOT}extension/.env.e2e`, 'utf8').match(/WXT_UI_ANNOTATE_PORT=(\d+)/)?.[1])

const exec = promisify(execFile)

// ---- reporting -------------------------------------------------------------------

let failures = 0
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? '✔' : '✘'} ${name}`)
  if (!ok) {
    failures++
    if (detail !== undefined) console.log(`    got: ${JSON.stringify(detail)}`)
  }
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms
  let last = await fn()
  while (!ok(last) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200))
    last = await fn().catch(() => last)
  }
  return last
}

// ---- browser ----------------------------------------------------------------------

async function ab(...args: string[]): Promise<string> {
  const { stdout } = await exec('agent-browser', ['--session', SESSION, ...args], { maxBuffer: 10_000_000 })
  return stdout.trim()
}

/** Helpers available to every page script. The UI lives in an open shadow root. */
const PRELUDE = `
const root = () => document.querySelector('ui-annotate-root')?.shadowRoot
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
const altClick = (el) => el.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true, cancelable: true, composed: true }))
const byText = (sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(t))
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }))
async function queue(el, { text, note } = {}) {
  if (!el) return { error: 'element not found' }
  altClick(el)
  const p = root().querySelector('.popup')
  if (!p) return { error: 'no popup' }
  const areas = p.querySelectorAll('textarea')
  const hasText = areas.length === 2
  if (text !== undefined) areas[0].value = text
  if (note !== undefined) areas[hasText ? 1 : 0].value = note
  const title = p.querySelector('.popup-title').textContent
  key(p, 'Enter')
  await tick()
  return { title, hasText, closed: !root().querySelector('.popup') }
}
`

/** Run an async page script. It must `return` a JSON-able value. */
async function page<T>(body: string): Promise<T> {
  const out = await ab('eval', `(async () => { ${PRELUDE}\n const __r = await (async () => { ${body} })(); return JSON.stringify(__r) })()`)
  return JSON.parse(JSON.parse(out)) as T
}

// ---- Claude stand-in ----------------------------------------------------------

type Claude = { client: Client }

async function startClaude(): Promise<Claude> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...(process.env as Record<string, string>), UI_ANNOTATE_PORT: String(PORT) },
    stderr: 'ignore',
  })
  const client = new Client({ name: 'e2e-claude', version: '0' })
  await client.connect(transport)
  return { client }
}

async function tool(c: Claude, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const res = await c.client.callTool({ name, arguments: args })
  const text = (res.content as Array<{ text?: string }>).map((p) => p.text ?? '').join('\n')
  return { text, isError: res.isError === true }
}

// ---- setup helpers --------------------------------------------------------------

const portBusy = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect(port, '127.0.0.1')
    s.once('connect', () => (s.destroy(), resolve(true)))
    s.once('error', () => resolve(false))
  })

const appUp = () => fetch(APP_URL).then((r) => r.ok, () => false)

async function ensureApp(): Promise<ChildProcess | null> {
  if (await appUp()) return null
  console.log('… starting the test app on :3100')
  const child = spawn('pnpm', ['--filter', 'playground', 'exec', 'next', 'dev', '-p', '3100'], { cwd: ROOT, detached: true, stdio: 'ignore' })
  if (!(await until(appUp, Boolean, 60_000))) throw new Error('test app did not start on :3100')
  return child
}

// ---- the test --------------------------------------------------------------------

async function main(): Promise<void> {
  if (!PORT) throw new Error('no WXT_UI_ANNOTATE_PORT in extension/.env.e2e')
  if (await portBusy(PORT)) throw new Error(`port ${PORT} is busy. Stop whatever uses it, then run again.`)

  const app = await ensureApp()
  let claude: Claude | null = await startClaude()
  let second: Claude | null = null
  try {
    await ab('close').catch(() => {})
    await ab('--extension', EXT, 'open', APP_URL)
    await ab('wait', '1500')
    const cdp = (await ab('get', 'cdp-url')).match(/:(\d+)\//)?.[1]
    if (!cdp) throw new Error('no CDP port from agent-browser')
    const sw = <T>(expr: string) => swEval<T>(cdp, expr)
    const queueNow = () => sw<UiEdit[]>("chrome.storage.local.get('queue').then((s) => s.queue ?? [])")
    const linked = () => sw<boolean>("chrome.storage.local.get('link').then((s) => !!s.link?.connected)")

    console.log('\nConnect')
    check('extension connects to the test server', await until(linked, Boolean, 15_000))
    await sw('chrome.storage.local.set({ queue: [], pickMode: true })')
    check('panel shows in edit mode', await until(() => page<boolean>("return root()?.querySelector('.panel')?.hidden === false"), Boolean, 5000))
    check('no apply hint while the queue is empty', await page<boolean>("return !root().querySelector('.panel .apply code')"))

    console.log('\nPick')
    const hover = await page<{ hidden: boolean; label: string }>(`
      document.querySelector('h1').dispatchEvent(new MouseEvent('mousemove', { altKey: true, bubbles: true, composed: true }))
      await frames()
      const box = root().querySelector('.outline:not(.selected)')
      const r = { hidden: box.hidden, label: box.textContent }
      document.querySelector('h1').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }))
      return r`)
    check('Option hover outlines the block with its component', !hover.hidden && hover.label === 'h1 · Hero', hover)

    const link = await page<{ blocked: boolean; path: string }>(`
      const ok = altClick(byText('a', 'setup guide'))
      await tick()
      const p = root().querySelector('.popup'); if (p) key(p, 'Escape')
      return { blocked: !ok, path: location.pathname }`)
    check('Option+click on a link is blocked (no download, no navigation)', link.blocked && link.path === '/', link)

    const widened = await page<{ before: string; after: string; back: string; title?: string }>(`
      const btn = document.querySelectorAll('button')[1]
      const label = () => root().querySelector('.outline:not(.selected) .outline-label').textContent
      const arrow = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey: true, bubbles: true, cancelable: true }))
      btn.dispatchEvent(new MouseEvent('mousemove', { altKey: true, bubbles: true, composed: true }))
      await frames()
      const before = label()
      arrow('ArrowUp'); await frames()
      const after = label()
      arrow('ArrowDown'); await frames()
      const back = label()
      arrow('ArrowUp')
      altClick(btn)
      const p = root().querySelector('.popup')
      const r = { before, after, back, title: p?.querySelector('.popup-title')?.textContent }
      if (p) key(p, 'Escape')
      btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }))
      return r`)
    check('↑ widens the pick to the card, ↓ goes back, Option+click picks the card',
      widened.before === 'button · PricingCard' && widened.after === 'div · PricingCard · note' && widened.back === 'button · PricingCard' && widened.title === 'Add a note', widened)

    const preview = await page<{ before: string; during: string; after: string; hint: boolean }>(`
      const h1 = document.querySelector('h1')
      const before = h1.textContent
      altClick(h1)
      const p = root().querySelector('.popup')
      const ta = p.querySelector('textarea')
      ta.value = 'Live preview text'
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      const during = h1.textContent
      const hint = !!p.querySelector('.preview-hint')
      key(p, 'Escape')
      await tick()
      return { before, during, after: h1.textContent, hint }`)
    check('live preview shows the text as you type, Esc puts it back', preview.during === 'Live preview text' && preview.after === preview.before && preview.hint, preview)

    const picks = await page<Array<{ title: string; hasText: boolean; closed: boolean }>>(`
      return [
        await queue(document.querySelector('h1'), { text: 'Ship your landing page in a day' }),
        await queue(document.querySelectorAll('button')[1], { text: 'Save plan' }),
        await queue(document.querySelector('img'), { note: 'remove this' }),
        await queue(byText('p', 'Running on'), { text: 'Running on example.com' }),
      ]`)
    check('4 picks open the right popup and close on Enter',
      picks.map((p) => `${p.title}/${p.closed}`).join(',') === 'Edit text/true,Edit text/true,Add a note/true,Edit text/true', picks)

    const q = await queueNow()
    check('queue holds 4 queued items', q.length === 4 && q.every((e) => e.status === 'queued'), q.map((e) => e.status))
    check('heading carries its component (Hero, server)', q[0]?.react?.owners[0] === 'Hero (server)', q[0]?.react)
    check('2nd "Save" carries its card heading ("Team")', !!q[1]?.nearbyText.includes('Team'), q[1]?.nearbyText)
    check('image is a note with no text', q[2]?.kind === 'note' && q[2]?.oldText === undefined, q[2])
    const h1Now = await page<string>("return document.querySelector('h1').textContent")
    check('a queued preview stays on the page, Claude still gets the original text',
      h1Now === 'Ship your landing page in a day' && q[0]?.oldText === preview.before, { h1Now, oldText: q[0]?.oldText, original: preview.before })
    check('one numbered marker per item', (await until(() => page<number>("await frames(); return root().querySelectorAll('.marker').length"), (n) => n === 4, 3000)) === 4)

    const hint = await page<string>("return root().querySelector('.panel .apply')?.textContent ?? ''")
    check('panel tells you how to apply the queue', hint === '/ui-annotate:apply in Claude to apply 4', hint)

    console.log('\nPull')
    const pulled = await tool(claude, 'get_pending_edits')
    check('get_pending_edits returns all 4 edits', !pulled.isError && pulled.text.startsWith('4 UI edits') && q.every((e) => pulled.text.includes(e.id)), pulled.text.slice(0, 200))
    check('pulled items show as working', (await queueNow()).every((e) => e.status === 'working'))
    check('apply hint goes away once nothing is queued', await until(() => page<boolean>("return !root().querySelector('.panel .apply code')"), Boolean, 3000))

    const results: Array<[number, string, string]> = [
      [0, 'done', 'app/components/Hero.tsx'],
      [1, 'needs_input', 'Change all 3 cards or only Team?'],
      [2, 'done', 'Removed the logo'],
      [3, 'failed', 'localhost:3100 comes from window.location at run time'],
    ]
    for (const [i, status, message] of results) await tool(claude, 'mark_edit_done', { id: q[i]!.id, status, message })
    const after = await queueNow()
    check('results reach the browser', after.map((e) => e.status).join(',') === 'done,needs_input,done,failed', after.map((e) => e.status))
    check("Claude's message is stored", after[3]?.result === results[3]![2])
    const pills = await until(() => page<string[]>("return [...root().querySelectorAll('.item .pill')].map((p) => p.textContent)"), (p) => p.includes('failed'), 3000)
    check('panel shows each status', pills.join(',') === 'done,needs input,done,failed', pills)
    const hostText = await until(() => page<string>("return byText('p', 'Running on')?.textContent ?? ''"), (t) => t.endsWith(':3100'), 3000)
    check("a failed item's preview is undone", hostText === 'Running on localhost:3100', hostText)
    check('unknown id is an error', (await tool(claude, 'mark_edit_done', { id: 'nope', status: 'done' })).isError)

    console.log('\nClaude restart')
    await claude.client.close()
    claude = null
    check('link drops when Claude quits', !(await until(linked, (v) => !v, 10_000)))
    check('queue stays in the browser', (await queueNow()).length === 4)
    claude = await startClaude()
    check('link comes back when Claude starts again', await until(linked, Boolean, 30_000))
    await page("return await queue(document.querySelector('footer'), { text: 'Prices shown in USD. Cancel anytime.' })")
    const again = await tool(claude, 'get_pending_edits')
    check('the new session pulls only the new item', again.text.startsWith('1 UI edit from') && again.text.includes('Cancel anytime'), again.text.slice(0, 120))
    const footer = (await queueNow()).find((e) => e.newText === 'Prices shown in USD. Cancel anytime.')
    await tool(claude, 'mark_edit_done', { id: footer!.id, status: 'done' })

    console.log('\nTakeover (two Claude sessions)')
    second = await startClaude()
    const took = await tool(second, 'get_pending_edits')
    check('a tool in the waiting session takes over the link', !took.isError && took.text.startsWith('Took over the browser link'), took.text.slice(0, 120))
    check('the extension follows to the new session', await until(linked, Boolean, 10_000))
    await second.client.close()
    second = null
    await until(linked, (v) => !v, 5000) // the link drops first, then comes back
    check('the first session gets the link back when the second quits', await until(linked, Boolean, 20_000))
    check('…and its tools work again', !(await tool(claude, 'get_pending_edits')).isError)

    console.log('\nReload')
    await ab('reload')
    await ab('wait', '1500')
    const reloaded = await until(
      () => page<{ rows: number; markers: number }>("await frames(); return { rows: root()?.querySelectorAll('.item').length ?? 0, markers: root()?.querySelectorAll('.marker').length ?? 0 }"),
      (r) => r.rows === 5 && r.markers === 5,
      5000,
    )
    check('queue and markers come back after a page reload', reloaded.rows === 5 && reloaded.markers === 5, reloaded)
    await page("[...root().querySelectorAll('.panel .link-btn')].find((b) => b.textContent === 'Clear done').click(); return true")
    const left = await until(queueNow, (x) => x.length === 2, 3000)
    check('Clear done keeps only open items', left.map((e) => e.status).join(',') === 'needs_input,failed', left.map((e) => e.status))
  } finally {
    await second?.client.close().catch(() => {})
    await claude?.client.close().catch(() => {})
    await ab('close').catch(() => {})
    if (app?.pid) process.kill(-app.pid, 'SIGTERM')
  }
}

try {
  await main()
} catch (err) {
  failures++
  console.log(`✘ ${(err as Error).message}`)
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
