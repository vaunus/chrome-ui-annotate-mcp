// Content script (isolated world): edit mode, hover outline, Option+click,
// the edit popup, the queue panel and the numbered markers.
// The service worker owns the queue. This script reads storage, watches it,
// and sends changes to the worker.

import type { UiEdit } from '@ui-annotate/shared'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { h, truncate } from '../../lib/dom.ts'
import { KEYS, type BgRequest, type BgResponse, type StoredState } from '../../lib/messages.ts'
import {
  collapse,
  hasInnerMarkup,
  label,
  locate,
  nearbyText,
  pickTarget,
  selectorFor,
  soleTextNode,
  trimmedHtml,
  widen,
  tagName,
  type Pick,
} from '../../lib/pick.ts'
import { probeReact } from '../../lib/probe.ts'
import type { EditPatch, NewEdit } from '../../lib/queue.ts'
import { CSS, STATUS_COLORS } from './styles.ts'

export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*'],
  runAt: 'document_idle',
  main(ctx) {
    void start(ctx)
  },
})

const HOST_TAG = 'ui-annotate-root'
const WAKE_MS = 20_000
const RELOCATE_MS = 1000
const POPUP_W = 340
const MARGIN = 12

const STATUS_TEXT: Record<UiEdit['status'], string> = {
  queued: 'queued',
  working: 'Claude is working…',
  done: 'done',
  failed: 'failed',
  needs_input: 'needs input',
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const OPTION = isMac ? '⌥ Option' : 'Alt'
const EXIT_KEYS = isMac ? '⌥⇧E' : 'Alt+Shift+E'
/** The `apply` MCP prompt, as Claude Code lists it in the `/` menu. */
const APPLY_CMD = '/ui-annotate:apply'

async function send(req: BgRequest): Promise<unknown> {
  const res = (await browser.runtime.sendMessage(req)) as BgResponse | undefined
  if (!res) throw new Error('The extension did not answer.')
  if (!res.ok) throw new Error(res.error)
  return res.value
}

function samePage(url: string): boolean {
  try {
    const u = new URL(url)
    return u.origin === location.origin && u.pathname === location.pathname
  } catch {
    return false
  }
}

function pageLabel(url: string): string {
  try {
    const u = new URL(url)
    return u.origin === location.origin ? u.pathname : `${u.host}${u.pathname}`
  } catch {
    return url
  }
}

const tagOf = (edit: UiEdit) => edit.outerHTML.match(/^<([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? 'element'

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

type Draft = Omit<NewEdit, 'kind' | 'newText' | 'note'>

type PopupOpts = {
  title: string
  where: string
  el: Element | null
  anchor: DOMRect
  side: 'below' | 'left'
  /** Present for text blocks: shows the text field. */
  oldText?: string
  newText?: string
  note: string
  warnMarkup: boolean
  info?: string
  submitLabel: string
  onSubmit: (kind: UiEdit['kind'], patch: EditPatch) => Promise<unknown>
  onDelete?: () => Promise<unknown>
}

async function start(ctx: ContentScriptContext): Promise<void> {
  const got = await browser.storage.local.get(Object.values(KEYS))
  const state: StoredState = {
    queue: (got[KEYS.queue] as UiEdit[] | undefined) ?? [],
    pickMode: !!got[KEYS.pickMode],
    link: (got[KEYS.link] as StoredState['link'] | undefined) ?? { connected: false },
    collapsed: !!got[KEYS.collapsed],
  }

  // ---- shadow root UI ------------------------------------------------------

  const host = document.createElement(HOST_TAG)
  const shadow = host.attachShadow({ mode: 'open' })
  const root = h('div', { class: 'root' })
  const hoverBox = h('div', { class: 'outline', hidden: true })
  const hoverLabel = h('div', { class: 'outline-label' })
  hoverBox.append(hoverLabel)
  const selectedBox = h('div', { class: 'outline selected', hidden: true })
  const markerLayer = h('div')
  const panel = h('div', { class: 'panel', hidden: true })
  let popupEl: HTMLElement | null = null
  root.append(hoverBox, selectedBox, markerLayer, panel)
  shadow.append(h('style', {}, CSS), root)
  document.documentElement.append(host)
  ctx.onInvalidated(() => host.remove())

  // Keys typed in our popup must not reach the page's own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation())

  const insideUi = (e: Event) => e.composedPath().includes(host)

  // ---- hover and selection ---------------------------------------------------

  let hover: Pick | null = null
  /** stack[0] is the block under the cursor. Each ↑ pushes a wider parent; ↓ pops. */
  let stack: Pick[] = []
  let lastTarget: Element | null = null
  let popupFor: Element | null = null

  function setHover(pick: Pick | null): void {
    if (pick?.el === hover?.el) return
    hover = pick
    if (pick) hoverLabel.textContent = label(tagName(pick.el), probeReact(pick.el)?.component) + (pick.hasText ? '' : ' · note')
  }

  /** Outline the block under the cursor. Keeps a widened pick while the cursor stays on the same block. */
  function hoverAt(target: Element): void {
    const base = pickTarget(target)
    if (stack[0]?.el !== base.el) stack = [base]
    setHover(stack.at(-1)!)
  }

  function clearHover(): void {
    stack = []
    setHover(null)
  }

  // ---- live preview ----------------------------------------------------------

  /** Previews kept on the page after queueing: edit id → its text node and the original text. */
  const previews = new Map<string, { node: Text; original: string }>()

  /** Run `fn` with every preview put back to the original, so captured context matches the code. */
  function withOriginals<T>(fn: () => T): T {
    const shown: Array<[Text, string]> = []
    for (const p of previews.values()) {
      if (p.node.isConnected && p.node.data !== p.original) {
        shown.push([p.node, p.node.data])
        p.node.data = p.original
      }
    }
    try {
      return fn()
    } finally {
      for (const [node, data] of shown) node.data = data
    }
  }

  /** Undo previews whose item is gone or failed. Stop tracking done ones: the code has the text now. */
  function syncPreviews(): void {
    for (const [id, p] of previews) {
      const edit = state.queue.find((e) => e.id === id)
      if (edit?.status === 'done') {
        previews.delete(id)
      } else if (!edit || edit.status === 'failed') {
        if (p.node.isConnected) p.node.data = p.original
        previews.delete(id)
      }
    }
  }

  function placeBox(box: HTMLElement, el: Element | null, labelEl?: HTMLElement): void {
    if (!el || !el.isConnected) {
      box.hidden = true
      return
    }
    const r = el.getBoundingClientRect()
    box.hidden = false
    box.style.left = `${r.left - 3}px`
    box.style.top = `${r.top - 3}px`
    box.style.width = `${r.width + 6}px`
    box.style.height = `${r.height + 6}px`
    labelEl?.classList.toggle('below', r.top < 28)
  }

  // ---- markers -------------------------------------------------------------

  const markers = new Map<string, HTMLButtonElement>()
  const located = new Map<string, Element | null>()
  let lastLocate = 0
  let lastHref = ''

  function relocate(): void {
    located.clear()
    for (const edit of state.queue) {
      if (samePage(edit.url)) located.set(edit.id, locate(edit.selector, [edit.oldText, edit.newText]))
    }
    lastLocate = Date.now()
    lastHref = location.href
  }

  function placeMarkers(): void {
    const seen = new Set<string>()
    state.queue.forEach((edit, i) => {
      const el = located.get(edit.id)
      if (!el || !el.isConnected) return
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return
      seen.add(edit.id)
      let m = markers.get(edit.id)
      if (!m) {
        m = h('button', { class: 'marker' })
        m.addEventListener('click', (e) => {
          e.stopPropagation()
          const current = state.queue.find((x) => x.id === edit.id)
          if (current) openEditPopup(current, m!.getBoundingClientRect(), 'below')
        })
        markers.set(edit.id, m)
        markerLayer.append(m)
      }
      m.textContent = String(i + 1)
      m.title = `${i + 1}: ${STATUS_TEXT[edit.status]}`
      m.style.background = STATUS_COLORS[edit.status]
      // Just left of the element's first line, so it does not cover the text.
      m.style.left = `${clamp(r.left - 14, 10, innerWidth - 10)}px`
      m.style.top = `${clamp(r.top + Math.min(r.height / 2, 12), 10, innerHeight - 10)}px`
    })
    for (const [id, m] of markers) {
      if (!seen.has(id)) {
        m.remove()
        markers.delete(id)
      }
    }
  }

  // ---- frame loop (edit mode only) -------------------------------------------

  let raf = 0
  function frame(): void {
    if (!state.pickMode) {
      raf = 0
      return
    }
    if (location.href !== lastHref || Date.now() - lastLocate > RELOCATE_MS) relocate()
    placeBox(hoverBox, hover && hover.el !== popupFor ? hover.el : null, hoverLabel)
    placeBox(selectedBox, popupFor)
    placeMarkers()
    raf = ctx.requestAnimationFrame(frame)
  }

  // ---- popup -----------------------------------------------------------------

  /** Undoes an unsaved live preview. Set by showPopup. */
  let popupCleanup: (() => void) | null = null

  function closePopup(): void {
    popupCleanup?.()
    popupCleanup = null
    popupEl?.remove()
    popupEl = null
    popupFor = null
  }

  function showPopup(o: PopupOpts): void {
    closePopup()
    popupFor = o.el
    const hasText = o.oldText !== undefined
    const textArea = hasText ? h('textarea', { rows: 2, value: o.newText ?? o.oldText }) : null

    // Live preview: only for a plain text node, which React keeps and updates in place.
    const node = textArea && o.el ? soleTextNode(o.el) : null
    const shownAtOpen = node?.data ?? ''
    const original = [...previews.values()].find((p) => p.node === node)?.original ?? shownAtOpen
    let saved = false
    if (node && textArea) {
      textArea.addEventListener('input', () => {
        node.data = textArea.value.trim() ? textArea.value : shownAtOpen
      })
    }
    popupCleanup = () => {
      if (node && !saved && node.isConnected) node.data = shownAtOpen
    }
    const noteArea = h('textarea', {
      rows: 2,
      value: o.note,
      placeholder: hasText ? 'Optional, e.g. "keep it under 5 words"' : 'e.g. "make this bigger" or "remove this"',
    })
    const error = h('div', { class: 'error', hidden: true })
    const submitBtn = h('button', { class: 'btn primary' }, o.submitLabel)

    const submit = async () => {
      const note = noteArea.value.trim()
      const text = textArea?.value.trim()
      const changed = hasText && text !== undefined && collapse(text) !== o.oldText
      if (!changed && !note) {
        error.textContent = hasText ? 'Change the text, or write a note.' : 'Write a note for Claude.'
        error.hidden = false
        return
      }
      submitBtn.disabled = true
      try {
        const edit = (await o.onSubmit(changed ? 'copy' : 'note', {
          kind: changed ? 'copy' : 'note',
          ...(changed ? { newText: text } : {}),
          note: note || undefined,
        })) as UiEdit | null
        saved = true
        if (node && changed && text && edit?.id) {
          node.data = text
          previews.set(edit.id, { node, original })
        } else if (node) {
          // Text unchanged (a note): show the original again and stop previewing.
          node.data = original
          if (edit?.id) previews.delete(edit.id)
        }
        closePopup()
      } catch (err) {
        error.textContent = (err as Error).message
        error.hidden = false
        submitBtn.disabled = false
      }
    }
    submitBtn.addEventListener('click', () => void submit())

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePopup()
      } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        void submit()
      }
    }

    const deleteBtn = o.onDelete
      ? h('button', {
          class: 'btn danger',
          onClick: () => void o.onDelete!().then(closePopup, (err: Error) => {
            error.textContent = err.message
            error.hidden = false
          }),
        }, 'Delete')
      : null

    const el = h(
      'div',
      { class: 'popup', role: 'dialog', 'aria-label': o.title, onKeydown: onKey },
      h('div', { class: 'popup-head' }, h('span', { class: 'popup-title' }, o.title), h('span', { class: 'popup-where' }, o.where)),
      o.info ? h('div', { class: 'warn' }, o.info) : null,
      textArea ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Text'), textArea) : null,
      node ? h('div', { class: 'preview-hint' }, 'The page shows your text as you type.') : null,
      o.warnMarkup ? h('div', { class: 'warn' }, 'This text has links or styling inside. Claude keeps them and changes only the words.') : null,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, hasText ? 'Note for Claude' : 'What should change?'), noteArea),
      error,
      h(
        'div',
        { class: 'popup-foot' },
        h('span', { class: 'keys' }, h('kbd', {}, 'Enter'), ' save · ', h('kbd', {}, 'Esc'), ' cancel'),
        deleteBtn,
        h('button', { class: 'btn', onClick: closePopup }, 'Cancel'),
        submitBtn,
      ),
    )
    el.style.visibility = 'hidden'
    root.append(el)
    popupEl = el

    // Place it: below the element (or above if no room), or left of the panel.
    const height = el.offsetHeight
    let left: number
    let top: number
    if (o.side === 'left') {
      left = o.anchor.left - POPUP_W - MARGIN
      top = o.anchor.top - 20
    } else {
      left = o.anchor.left
      top = o.anchor.bottom + 10
      if (top + height > innerHeight - MARGIN) top = o.anchor.top - 10 - height
    }
    el.style.left = `${clamp(left, MARGIN, innerWidth - POPUP_W - MARGIN)}px`
    el.style.top = `${clamp(top, MARGIN, Math.max(MARGIN, innerHeight - height - MARGIN))}px`
    el.style.visibility = ''

    const focus = textArea ?? noteArea
    focus.focus()
    focus.setSelectionRange(focus.value.length, focus.value.length)
  }

  function openNewPopup(pick: Pick): void {
    closePopup() // undo an unsaved preview before reading the page
    const el = pick.el
    const react = probeReact(el)
    // Read the original text, not a preview: Claude searches the code for it.
    const { oldText, draft } = withOriginals(() => {
      const oldText = pick.hasText ? collapse(el.textContent) : undefined
      const draft: Draft = {
        url: location.href,
        ...(oldText !== undefined ? { oldText } : {}),
        selector: selectorFor(el),
        outerHTML: trimmedHtml(el),
        nearbyText: nearbyText(el),
        ...(react ? { react } : {}),
      }
      return { oldText, draft }
    })
    showPopup({
      title: pick.hasText ? 'Edit text' : 'Add a note',
      where: label(tagName(el), react?.component),
      el,
      anchor: el.getBoundingClientRect(),
      side: 'below',
      oldText,
      note: '',
      warnMarkup: pick.hasText && hasInnerMarkup(el),
      submitLabel: 'Queue',
      onSubmit: (kind, patch) => send({ type: 'add', edit: { ...draft, ...patch, kind } }),
    })
  }

  function openEditPopup(edit: UiEdit, anchor: DOMRect, side: PopupOpts['side']): void {
    if (edit.status === 'working' || edit.status === 'done') return
    const reason = edit.result ? `Claude: ${edit.result}` : undefined
    showPopup({
      title: edit.status === 'queued' ? 'Change queued item' : 'Fix and queue again',
      where: label(tagOf(edit), edit.react?.component),
      el: located.get(edit.id) ?? null,
      anchor,
      side,
      oldText: edit.oldText,
      newText: edit.newText,
      note: edit.note ?? '',
      warnMarkup: false,
      info: reason,
      submitLabel: edit.status === 'queued' ? 'Save' : 'Queue again',
      onSubmit: (_kind, patch) => send({ type: 'update', id: edit.id, patch }),
      onDelete: () => send({ type: 'remove', id: edit.id }),
    })
  }

  // ---- panel -----------------------------------------------------------------

  function itemRow(edit: UiEdit, n: number): HTMLElement {
    const editable = edit.status === 'queued' || edit.status === 'failed' || edit.status === 'needs_input'
    const color = STATUS_COLORS[edit.status]
    const summary =
      edit.kind === 'copy'
        ? h('div', { class: 'summary' }, h('span', { class: 'old' }, `“${truncate(edit.oldText ?? '', 40)}”`), ' → ', `“${truncate(edit.newText ?? '', 60)}”`)
        : h('div', { class: 'summary' }, truncate(edit.note ?? '', 100))
    const action =
      edit.status === 'working'
        ? h('button', { class: 'link-btn', title: 'Put it back in the queue', onClick: (e: Event) => (e.stopPropagation(), void send({ type: 'reset', id: edit.id })) }, 'Reset')
        : h('button', { class: 'link-btn', onClick: (e: Event) => (e.stopPropagation(), void send({ type: 'remove', id: edit.id })) }, 'Remove')
    const row = h(
      'div',
      { class: `item${editable ? ' editable' : ''}`, 'data-id': edit.id },
      h('span', { class: 'num', style: { background: color } }, String(n)),
      h(
        'div',
        { class: 'item-main' },
        summary,
        edit.kind === 'copy' && edit.note ? h('div', { class: 'result' }, `Note: ${truncate(edit.note, 100)}`) : null,
        edit.result ? h('div', { class: 'result' }, `Claude: ${edit.result}`) : null,
        h(
          'div',
          { class: 'meta' },
          h('span', { class: 'pill', style: { color } }, STATUS_TEXT[edit.status]),
          h('span', {}, `· ${edit.kind === 'copy' ? 'text' : 'note'} · ${label(tagOf(edit), edit.react?.component)}`),
          h('span', { style: { marginLeft: 'auto' } }, action),
        ),
      ),
    )
    if (editable) row.addEventListener('click', () => openEditPopup(edit, row.getBoundingClientRect(), 'left'))
    return row
  }

  function panelBody(): HTMLElement {
    if (state.queue.length === 0) {
      return h('div', { class: 'panel-body' }, h('div', { class: 'empty' }, 'Hold ', h('kbd', {}, OPTION), ' and click text to edit it. Click anything else to add a note.'))
    }
    const groups = new Map<string, HTMLElement[]>()
    state.queue.forEach((edit, i) => {
      const key = samePage(edit.url) ? '' : pageLabel(edit.url)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(itemRow(edit, i + 1))
    })
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    const body = h('div', { class: 'panel-body' })
    for (const key of keys) body.append(h('div', { class: 'group' }, key === '' ? 'This page' : key), ...groups.get(key)!)
    return body
  }

  function renderPanel(): void {
    panel.hidden = !state.pickMode
    if (!state.pickMode) return
    panel.classList.toggle('collapsed', state.collapsed)
    const queued = state.queue.filter((e) => e.status === 'queued').length
    const done = state.queue.some((e) => e.status === 'done')
    const head = h(
      'div',
      { class: 'panel-head', onClick: () => void send({ type: 'set_collapsed', collapsed: !state.collapsed }) },
      h('span', { class: 'panel-title' }, 'UI annotations'),
      h(
        'span',
        { class: 'link', title: state.link.connected ? 'The MCP server in Claude Code is connected' : 'Start Claude Code in your project' },
        h('span', { class: `dot${state.link.connected ? ' on' : ''}` }),
        state.link.connected ? 'Claude connected' : 'Claude not connected',
      ),
      h('button', { class: 'icon-btn', title: state.collapsed ? 'Expand' : 'Collapse', 'aria-label': state.collapsed ? 'Expand' : 'Collapse' }, state.collapsed ? '+' : '–'),
    )
    if (state.collapsed) {
      panel.replaceChildren(head)
      return
    }
    // Shown only when there is something for Claude to pull.
    const apply = queued ? h('span', { class: 'apply' }, h('code', {}, APPLY_CMD), ` in Claude to apply ${queued}`) : null
    const clear = done ? h('button', { class: 'link-btn', onClick: () => void send({ type: 'clear_done' }) }, 'Clear done') : null
    panel.replaceChildren(
      head,
      panelBody(),
      apply || clear ? h('div', { class: 'panel-foot' }, apply ?? h('span', { class: 'apply' }), clear) : '',
      h('div', { class: 'hint' }, `${OPTION}+click to pick · ↑ widens · ${EXIT_KEYS} leaves edit mode`),
    )
  }

  // ---- edit mode -------------------------------------------------------------

  function applyPickMode(): void {
    if (state.pickMode) {
      relocate()
      if (!raf) raf = ctx.requestAnimationFrame(frame)
    } else {
      closePopup()
      clearHover()
      hoverBox.hidden = true
      selectedBox.hidden = true
      for (const m of markers.values()) m.remove()
      markers.clear()
    }
    renderPanel()
  }

  // ---- page events -------------------------------------------------------------

  ctx.addEventListener(
    window,
    'mousemove',
    (e) => {
      if (!state.pickMode) return
      if (e.target instanceof Element) lastTarget = e.target
      if (!e.altKey || insideUi(e) || !lastTarget) clearHover()
      else hoverAt(lastTarget)
    },
    { capture: true, passive: true },
  )
  ctx.addEventListener(
    window,
    'keydown',
    (e) => {
      if (!state.pickMode || insideUi(e)) return
      if (e.key === 'Alt' && lastTarget) {
        hoverAt(lastTarget)
      } else if (e.altKey && hover && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // ↑ widens the pick to the parent, ↓ goes back. No page scroll.
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.key === 'ArrowUp') {
          const wider = widen(stack.at(-1)!.el)
          if (wider) stack.push(wider)
        } else if (stack.length > 1) {
          stack.pop()
        }
        setHover(stack.at(-1)!)
      }
    },
    { capture: true },
  )
  ctx.addEventListener(window, 'keyup', (e) => e.key === 'Alt' && clearHover(), { capture: true })
  ctx.addEventListener(window, 'blur', () => clearHover())

  // Option+click belongs to us in edit mode: no link download, no page handler.
  const swallow = (e: MouseEvent) => {
    if (!state.pickMode || !e.altKey || insideUi(e)) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick', 'dblclick'] as const) {
    ctx.addEventListener(window, type, swallow, { capture: true })
  }
  ctx.addEventListener(
    window,
    'click',
    (e) => {
      if (!state.pickMode || !e.altKey || insideUi(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!(e.target instanceof Element)) return
      // Pick what the outline shows: the block under the cursor, or its widened parent.
      const base = pickTarget(e.target)
      openNewPopup(stack[0]?.el === base.el ? stack.at(-1)! : base)
    },
    { capture: true },
  )

  // ---- storage → state -------------------------------------------------------------

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !ctx.isValid) return
    if (KEYS.queue in changes) {
      state.queue = (changes[KEYS.queue]!.newValue as UiEdit[] | undefined) ?? []
      syncPreviews()
      relocate()
    }
    if (KEYS.link in changes) state.link = (changes[KEYS.link]!.newValue as StoredState['link'] | undefined) ?? { connected: false }
    if (KEYS.collapsed in changes) state.collapsed = !!changes[KEYS.collapsed]!.newValue
    if (KEYS.pickMode in changes) {
      state.pickMode = !!changes[KEYS.pickMode]!.newValue
      applyPickMode()
    } else {
      renderPanel()
    }
  })

  // Keep the worker awake while this tab is in view, so it reconnects to Claude fast.
  const wake = () => document.visibilityState === 'visible' && void send({ type: 'wake' }).catch(() => {})
  wake()
  ctx.setInterval(wake, WAKE_MS)

  applyPickMode()
}
