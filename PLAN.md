# UI Annotate MCP — v1 Plan

Option+click anything on your local Next.js app. Edit its copy or add a note. Each one goes into a queue in the browser. When you are ready, Claude is told to pull the queue. Claude finds the source, applies each item, and reports back.

## Decisions

- Target stack: React / Next.js (App Router, dev mode only).
- **The browser owns the queue.** The extension keeps every item in `chrome.storage.local`. The queue survives page reloads and Claude restarts. The server stores nothing. It only relays.
- Two item kinds in v1:
  - **Copy edit:** new text for a text block.
  - **Note:** a free-text note on any element ("make this bigger", "remove this").
- Claude always pulls with `get_pending_edits`. Two ways to tell Claude to pull, one server:
  - **VS Code panel:** you tell Claude "apply my UI edits".
  - **VS Code integrated terminal:** run `claude --dangerously-load-development-channels server:ui-annotate`. Click "Tell Claude" in the browser. The server pushes "N UI edits ready" into the session. Claude pulls on its own.
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
  ├─ prompt              apply  (→ /mcp__ui-annotate__apply, if the panel shows MCP prompts)
  └─ channel             "Tell Claude" → notifications/claude/channel → "N UI edits ready"
                                     │ stdio
Claude Code (VS Code panel or terminal)
```

## Pull flow

1. You queue items over time. Each one is `queued`.
2. You tell Claude: type in the panel, or click "Tell Claude" in push mode.
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
- [x] Full pull flow: queue → tell → pull → apply → status back to panel and markers.
- [x] Panel-mode hint after "Tell Claude" with no push: "In Claude, type: apply my UI edits".
- [ ] Push flow from the browser: "Tell Claude" with `claude --dangerously-load-development-channels server:ui-annotate` in the VS Code terminal. Claude should start on its own.
- [ ] Automate the tests as a script (`pnpm e2e`) with `agent-browser --extension extension/.output/chrome-mv3`:
  - `extension/scripts/sw-eval.ts` runs code in the service worker over CDP, e.g. to turn edit mode on.
  - Fake Option+click works: dispatch `MouseEvent('click', { altKey: true, bubbles: true, cancelable: true, composed: true })`.
  - To load a new build, relaunch the browser. `chrome.runtime.reload()` drops an unpacked extension in the test browser.
  - The extension always connects to port 7317. Add a build-time port setting for e2e runs, so the test server does not clash with a real Claude session. (In Phase 2 the test browser used this session's server on purpose.)
- [ ] Test app `playground/` (Next 16, App Router, `pnpm --filter playground exec next dev -p 3100`) with these cases:
  - [x] Plain heading text
  - [x] Text with an inner link
  - [x] CSS `text-transform: uppercase`
  - [x] Text from an i18n JSON file
  - [x] Repeated text ("Save" in 3 places): Claude asks with `needs_input`, the user fixes it in the popup, and it is queued again
  - [x] Text from a server component
  - [ ] Text that is not in the repo (must fail cleanly). The playground API route is in the repo, so Claude could edit it. Add a case with text built at run time.
  - [x] Note on an image ("remove this")
  - [x] Queue survives a page reload
  - [ ] Queue survives a Claude restart

### [ ] Phase 4: v1 polish
- [ ] Optional live preview of the new text on the page.
- [ ] `↑` key while picking widens the pick to the parent.
- [ ] README: install steps, `claude mcp add` command, shell alias for the channel flag.
- [ ] README: allow `mcp__ui-annotate__get_pending_edits` and `mcp__ui-annotate__mark_edit_done` in the target project's `.claude/settings.json`, so Claude does not ask permission for each edit.

## Post-v1

- Style changes: send classes (Tailwind) + computed styles with a note.
- Exact file:line: React 19 `_debugStack` + Next dev source maps, or a build plugin. Client frames point at Turbopack chunk URLs (source maps can resolve them). Server frames point at `about://React/Prerender/file:///…/.next/dev/server/chunks/…`.
- Area select + screenshot.
- Many sessions: port range + session picker in the extension.
- Watch mode for the VS Code panel: a long-poll tool that waits for the next "Tell Claude".

## Install (target)

```bash
claude mcp add --scope user ui-annotate -- node /Users/vaunus/Workspaces/chrome-ui-annotate-mcp/server/src/index.ts
# push mode, in the VS Code integrated terminal:
claude --dangerously-load-development-channels server:ui-annotate
```

Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/.output/chrome-mv3`.
