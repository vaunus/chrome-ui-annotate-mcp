# UI Annotate MCP — v1 Plan

Option+click anything on your local Next.js app. Edit its copy or add a note. Each one goes into a queue in the browser. When you are ready, you run `/ui-annotate:apply` in Claude. Claude pulls the queue, finds the source, applies each item, and reports back.

## Decisions

- Target stack: React / Next.js (App Router, dev mode only).
- **The browser owns the queue.** The extension keeps every item in `chrome.storage.local`. The queue survives page reloads and Claude restarts. The server stores nothing. It only relays.
- Two item kinds in v1:
  - **Copy edit:** new text for a text block.
  - **Note:** a free-text note on any element ("make this bigger", "remove this").
- Pull only. You run `/ui-annotate:apply` (or say "apply my UI edits"). Claude calls `get_pending_edits`. No push into the session.
- Edit in a popup, not inline. Inline edits fight React re-renders and break text with inner links.
- Build our own. No fork.

## Architecture

```
Chrome page (localhost)
  ├─ MAIN-world script   reads React fiber → component name + owner chain
  ├─ content script      Option+click, highlight, popup, queue panel, markers (Shadow DOM)
  └─ service worker      owns the queue (chrome.storage.local)
                         WebSocket client → ws://127.0.0.1:7317
                                     │
Local MCP server (Node, stdio) ◄─────┘
  ├─ WebSocket server    Origin check: chrome-extension://<pinned id>
  ├─ relay               tool call → request to extension → reply (5 s timeout)
  ├─ tools               get_pending_edits, mark_edit_done
  └─ prompt              apply  (→ /ui-annotate:apply, also /mcp__ui-annotate__apply)
                                     │ stdio
Claude Code (VS Code panel or terminal)
```

## Pull flow

1. You queue items over time. Each one is `queued`.
2. You run `/ui-annotate:apply` in Claude. The panel shows this command while items are queued.
3. Claude calls `get_pending_edits`. The server asks the extension. The extension returns all `queued` items and sets them to `working`.
4. Claude applies each item. It calls `mark_edit_done` for each one.
5. The extension updates the item: `done`, `failed` or `needs_input`, with Claude's message.
6. Next.js fast refresh shows the change on the page.

Browser not connected → the tool says so. Nothing is lost, because the queue stays in the browser.

## Queue item

```ts
type UiEdit = {
  id: string
  kind: 'copy' | 'note'
  status: 'queued' | 'working' | 'done' | 'failed' | 'needs_input'
  url: string             // route hints the App Router file, e.g. /pricing → app/pricing/page.tsx
  oldText?: string        // textContent, NOT innerText (innerText applies CSS text-transform)
  newText?: string        // copy edits only
  note?: string           // required for notes, optional for copy edits
  selector: string        // also used to put the marker back after a reload
  outerHTML: string       // trimmed to ~2 KB
  nearbyText: string[]    // siblings / heading above, to tell apart repeated text
  react?: { component: string; owners: string[] }  // e.g. ['PricingCard', 'PricingPage', 'RootLayout']
  result?: string         // Claude's message from mark_edit_done
  createdAt: number
}
```

## Phases

### [x] Phase 0: Spikes and repo setup

### [x] Phase 1: Local MCP server (relay)

### [x] Phase 2: Extension — pick, queue, track

### [ ] Phase 3: End to end
- [ ] **You:** test by hand in your real Chrome with a real Option key and mouse. My tests sent fake (synthetic) Option+click events.
  - Load `extension/.output/chrome-mv3` unpacked. Check that `Alt+Shift+E` toggles edit mode and the badge shows `ON`.
  - Check that Option+click on a link does not download it.
- [x] Service worker WebSocket client: auto reconnect, ping every `PING_INTERVAL_MS`, connection dot in the queue panel. Set `onmessage` straight after `new WebSocket()`: the server sends saved results as soon as the extension connects.
- [x] Full pull flow: queue → pull → apply → status back to panel and markers.
- [x] Panel shows `/ui-annotate:apply in Claude to apply N` while items are queued.
- [x] Automate the tests: `pnpm e2e` (`e2e/run.ts`). It uses the e2e build (`.output/chrome-mv3-e2e`, port 7399 from `extension/.env.e2e`) and a scripted MCP client in place of Claude. It never touches the extension you have loaded or a real Claude session.
- [ ] Test app `playground/` (Next 16, App Router, `pnpm --filter playground exec next dev -p 3100`) with these cases:
  - [x] Plain heading text
  - [x] Text with an inner link
  - [x] CSS `text-transform: uppercase`
  - [x] Text from an i18n JSON file
  - [x] Repeated text ("Save" in 3 places): Claude asks with `needs_input`, the user fixes it in the popup, and it is queued again
  - [x] Text from a server component
  - [ ] **You + Claude:** text that is not in the repo must fail cleanly. Test it on "Running on localhost:3100" (`HostNote`: the host comes from `window.location`). Option+click it, change it, then run `/ui-annotate:apply`. Claude should mark it `failed`.
  - [x] Note on an image ("remove this")
  - [x] Queue survives a page reload
  - [x] Queue survives a Claude restart

### [x] Phase 4: v1 polish

## Post-v1

- Style changes: send classes (Tailwind) + computed styles with a note.
- Exact file:line: React 19 `_debugStack` + Next dev source maps, or a build plugin. Client frames point at Turbopack chunk URLs (source maps can resolve them). Server frames point at `about://React/Prerender/file:///…/.next/dev/server/chunks/…`.
- Area select + screenshot.
- Many sessions: port range + session picker in the extension.

## Install

See `README.md`.
