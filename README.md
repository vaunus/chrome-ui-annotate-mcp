# UI Annotate for Claude

Point at your local app instead of describing it. Option+click any text or element in Chrome, type the new copy or a note ("make this bigger", "remove this"), and queue it. When you are ready, Claude Code pulls the queue, finds each item in your code, applies it, and reports back on the page.

https://github.com/user-attachments/assets/1cdfeff4-5524-4422-ae62-07a7524b3f8c

```
Chrome (localhost)                         Claude Code
  Option+click → popup → queue    ──▶   MCP server "ui-annotate"
  panel + numbered markers        ◀──   get_pending_edits / mark_edit_done
```

- **Copy edits**: new text for a text block. The page previews it as you type.
- **Notes**: a request about any element, including layout and style.
- **Context for Claude**: page route, React component chain (server and client components), nearby text, a CSS selector and the HTML. This is usually enough to find the right file at once.
- **The queue lives in the browser.** It survives page reloads and Claude restarts.

## Requirements

- Node 24 or later and pnpm 10
- Google Chrome
- Claude Code
- Your app runs on `http://localhost:<port>` or `http://127.0.0.1:<port>`. Component names need a React dev build, for example `next dev`.

## Install

1. Install and build:
   ```bash
   pnpm install
   pnpm build
   ```
2. Load the extension. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `extension/.output/chrome-mv3`.
3. Register the MCP server for all your projects:
   ```bash
   claude mcp add --scope user ui-annotate -- node "$PWD/server/src/index.ts"
   ```
   Run this from the repo root. Inside this repo, `.mcp.json` registers the server already.
4. Optional: let Claude use the tools without asking each time. Add this to `.claude/settings.json` in your project:
   ```json
   {
     "permissions": {
       "allow": ["mcp__ui-annotate__get_pending_edits", "mcp__ui-annotate__mark_edit_done"]
     }
   }
   ```

After you rebuild, click the reload icon on the extension in `chrome://extensions`.

## Use

| Action | Keys |
| --- | --- |
| Edit mode on or off (badge shows `ON`) | `⌥⇧E` / `Alt+Shift+E`, or click the toolbar icon |
| Outline the block under the cursor | hold `⌥ Option` |
| Widen the pick to the parent, or go back | `⌥` + `↑` / `↓` |
| Open the popup | `⌥ Option` + click |
| Queue or cancel | `Enter` / `Esc` |

The panel at the bottom right lists every item with a number that matches its marker on the page. Click a queued item to change it. **Reset** puts an item that Claude is working on back in the queue. **Clear done** removes finished items.

### Get Claude to apply the queue

In Claude, run `/ui-annotate:apply`. The `/` menu lists it as `/ui-annotate:apply (MCP)`. `/mcp__ui-annotate__apply` also works, and so does "apply my UI edits". When items are queued, the panel shows the command.

Each item ends as **done**, **failed** (for example, the text comes from an API and is not in the code) or **needs input** (Claude asks a question in the panel). To answer, click the item, add a note, and queue it again.

## Several Claude sessions

Only one session can hold the browser link (port 7317) at a time. When you run a tool in another session, that session takes the link over, and the output says so. The first session waits, and gets the link back when the second one quits.

## Troubleshooting

- **The panel says "Claude not connected".** Start Claude Code in a project where the `ui-annotate` server is registered. Run `/mcp` in Claude to check its status.
- **The shortcut does nothing.** Another extension may use it. Set a new one at `chrome://extensions/shortcuts`.
- **"Another program holds port 7317"** means something that is not this server holds the port. Find it with `lsof -i :7317`.

## Development

```bash
pnpm dev         # test app on http://localhost:3100 (playground/)
pnpm test        # unit tests: server and extension
pnpm typecheck
pnpm build       # extension → extension/.output/chrome-mv3
pnpm e2e         # end to end in a test Chrome; needs agent-browser on PATH
```

`pnpm e2e` builds a separate copy of the extension (`extension/.output/chrome-mv3-e2e`, port 7399 from `extension/.env.e2e`). A scripted MCP client plays Claude. The run never touches the extension you have loaded or a real Claude session.

| Folder | What it holds |
| --- | --- |
| `server/` | MCP server. Node runs the TypeScript directly, with no build step. |
| `extension/` | Chrome extension (MV3, built with [WXT](https://wxt.dev)). |
| `shared/` | Types, the WebSocket protocol, and the pinned extension key. |
| `playground/` | Next.js test app with one case per test. |
| `e2e/` | End-to-end runner. |

Design notes:

- **The extension ID is pinned** by the `key` in `shared/src/extension-key.ts`. The server accepts WebSocket connections only from that origin, so web pages cannot send text to Claude.
- **The server listens on 127.0.0.1 only.** The takeover request refuses anything a browser sends.
- `PLAN.md` holds the build plan and later ideas.
