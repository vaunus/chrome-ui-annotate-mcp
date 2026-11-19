// Styles for the shadow root. The shadow root keeps page CSS out, and ours in.

export const STATUS_COLORS = {
  queued: '#4f46e5',
  working: '#d97706',
  done: '#16a34a',
  failed: '#dc2626',
  needs_input: '#ea580c',
} as const

export const CSS = /* css */ `
:host { all: initial; }

.root {
  --bg: #ffffff;
  --fg: #18181b;
  --muted: #71717a;
  --line: #e4e4e7;
  --soft: #f4f4f5;
  --accent: #4f46e5;
  --accent-fg: #ffffff;
  --shadow: 0 12px 32px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08);
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .root {
    --bg: #18181b;
    --fg: #f4f4f5;
    --muted: #a1a1aa;
    --line: #3f3f46;
    --soft: #27272a;
    --accent: #818cf8;
    --accent-fg: #18181b;
    --shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }

/* ---- outlines -------------------------------------------------------- */
.outline {
  position: fixed;
  border: 2px dashed var(--accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  pointer-events: none;
}
.outline.selected { border-style: solid; }
.outline-label {
  position: absolute;
  left: -2px;
  bottom: 100%;
  margin-bottom: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--accent-fg);
  font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
}
.outline-label.below { bottom: auto; top: 100%; margin: 4px 0 0; }

/* ---- markers --------------------------------------------------------- */
.marker {
  position: fixed;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  border: 2px solid #fff;
  border-radius: 999px;
  color: #fff;
  font: 700 11px/16px ui-sans-serif, system-ui, sans-serif;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  cursor: pointer;
  padding: 0;
}

/* ---- panel ----------------------------------------------------------- */
.panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 340px;
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  pointer-events: auto;
  overflow: hidden;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  user-select: none;
}
.panel.collapsed .panel-head { border-bottom: 0; }
.panel-title { font-weight: 650; }
.link { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; margin-left: auto; }
.dot { width: 8px; height: 8px; border-radius: 999px; background: #a1a1aa; }
.dot.on { background: #16a34a; }
.icon-btn {
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 16px;
  line-height: 1;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
}
.icon-btn:hover { background: var(--soft); color: var(--fg); }
.panel-body { overflow-y: auto; padding: 6px 0; }
.empty { padding: 14px 14px 16px; color: var(--muted); }
kbd {
  font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--soft);
  color: var(--fg);
}
.group { padding: 8px 14px 4px; color: var(--muted); font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; }
.item { display: flex; gap: 10px; align-items: flex-start; padding: 7px 14px; }
.item.editable { cursor: pointer; }
.item.editable:hover { background: var(--soft); }
.num {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  color: #fff;
  font: 700 11px/20px ui-sans-serif, system-ui, sans-serif;
  text-align: center;
}
.item-main { flex: 1; min-width: 0; }
.summary { overflow-wrap: anywhere; }
.summary .old { color: var(--muted); text-decoration: line-through; }
.meta { display: flex; gap: 6px; align-items: center; margin-top: 3px; color: var(--muted); font-size: 12px; }
.pill { font-size: 11px; font-weight: 650; }
.result { margin-top: 3px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.link-btn { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; }
.link-btn:hover { text-decoration: underline; }
.panel-foot { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--line); }
.apply { flex: 1; min-width: 0; color: var(--muted); font-size: 12px; }
.apply code { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fg); user-select: all; }
.hint { padding: 0 12px 10px; color: var(--muted); font-size: 11px; }

.btn {
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.btn:hover { background: var(--soft); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.primary:hover { filter: brightness(1.08); }
.btn.danger { color: #dc2626; }
.btn:disabled { opacity: 0.5; cursor: default; filter: none; }

/* ---- popup ----------------------------------------------------------- */
.popup {
  position: fixed;
  width: 340px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 12px;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.popup-head { display: flex; align-items: baseline; gap: 8px; }
.popup-title { font-weight: 650; }
.popup-where { color: var(--muted); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-label { color: var(--muted); font-size: 12px; font-weight: 600; }
textarea {
  width: 100%;
  min-height: 38px;
  resize: vertical;
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 7px 9px;
}
textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
.warn { color: #b45309; font-size: 12px; }
.preview-hint { margin-top: -4px; color: var(--muted); font-size: 11px; }
.error { color: #dc2626; font-size: 12px; }
.popup-foot { display: flex; align-items: center; gap: 8px; }
.popup-foot .keys { margin-right: auto; color: var(--muted); font-size: 11px; }
`
