// What a pick targets, and the context Claude needs to find it in the code.

const TEXT_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'A', 'BUTTON', 'LABEL', 'TD', 'TH',
  'DT', 'DD', 'FIGCAPTION', 'BLOCKQUOTE', 'SUMMARY', 'LEGEND', 'CAPTION', 'OPTION',
])
/** Picked as themselves, for a note. */
const MEDIA_TAGS = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'PICTURE', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT'])
const BLOCKISH = new Set(['block', 'flex', 'grid', 'list-item', 'inline-block', 'inline-flex', 'table-cell'])

const MAX_HTML = 2000
const MAX_NEARBY = 80

export type Pick = { el: Element; hasText: boolean }

export const collapse = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

function hasDirectText(el: Element): boolean {
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) return true
  return false
}

/** A text block by the pick rule: a text tag, or a block element with its own text. */
function isTextBlock(el: Element): boolean {
  if (!collapse(el.textContent)) return false
  return TEXT_TAGS.has(el.tagName) || (hasDirectText(el) && BLOCKISH.has(getComputedStyle(el).display))
}

const isTop = (el: Element | null) => !el || el === document.body || el === document.documentElement

/** The block a click on `start` picks. The hover outline uses the same rule. */
export function pickTarget(start: Element): Pick {
  const media = start.closest('svg') ?? start
  if (MEDIA_TAGS.has(media.tagName.toUpperCase())) return { el: media, hasText: false }
  for (let cur: Element | null = start; !isTop(cur); cur = cur!.parentElement) {
    if (isTextBlock(cur!)) return { el: cur!, hasText: true }
  }
  return { el: start, hasText: false }
}

/** ↑ while picking: the next parent with its own box (wrappers of the same size are skipped). */
export function widen(el: Element): Pick | null {
  const r = el.getBoundingClientRect()
  for (let cur = el.parentElement; !isTop(cur); cur = cur!.parentElement) {
    const c = cur!.getBoundingClientRect()
    if (c.left === r.left && c.top === r.top && c.width === r.width && c.height === r.height) continue
    return { el: cur!, hasText: isTextBlock(cur!) }
  }
  return null
}

/** The element's only child, when that is a text node. Live preview edits it in place. */
export function soleTextNode(el: Element): Text | null {
  const only = el.childNodes.length === 1 ? el.firstChild : null
  return only?.nodeType === Node.TEXT_NODE ? (only as Text) : null
}

/** Ids React makes up (useId) or UI kits generate change between renders, so skip them. */
const stableId = (id: string) => !!id && !/[«»:]|^radix-|^_r_?/i.test(id)

function uniqueId(el: Element): string | null {
  if (!stableId(el.id)) return null
  const sel = `#${CSS.escape(el.id)}`
  return document.querySelectorAll(sel).length === 1 ? sel : null
}

export function selectorFor(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const id = uniqueId(cur)
    if (id) {
      parts.unshift(id)
      return parts.join(' > ')
    }
    const tag = cur.tagName.toLowerCase()
    const parent: Element | null = cur.parentElement
    const same = parent ? [...parent.children].filter((c) => c.tagName === cur!.tagName) : []
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag)
    cur = parent
  }
  parts.unshift('body')
  return parts.join(' > ')
}

const clip = (s: string) => (s.length > MAX_NEARBY ? `${s.slice(0, MAX_NEARBY - 1)}…` : s)

/** Text with a space between text nodes. textContent runs blocks together ("TeamSave"). */
function readable(el: Element): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? '')
  return collapse(parts.join(' '))
}

/** More headings than this means a page-level container, not a card or section. */
const MAX_HEADINGS = 3

/** The nearest heading and short sibling texts. Tells repeated text apart ("Save" × 3). */
export function nearbyText(el: Element): string[] {
  const own = collapse(el.textContent)
  const out: string[] = []
  const add = (t: string) => {
    if (t && t !== own && !out.includes(t)) out.push(clip(t))
  }
  // The closest heading above the element, in the same card or section.
  const above = (h: Element) => h !== el && !h.contains(el) && !!(h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
  let anc = el.parentElement
  for (let i = 0; anc && i < 4; i++, anc = anc.parentElement) {
    const headings = anc.querySelectorAll('h1,h2,h3,h4,h5,h6')
    if (headings.length > MAX_HEADINGS) break
    const heading = [...headings].filter(above).at(-1)
    if (heading) {
      add(readable(heading))
      break
    }
  }
  // Long siblings are whole sections: noise, not hints.
  for (const sib of [el.previousElementSibling, el.nextElementSibling]) {
    const t = sib ? readable(sib) : ''
    if (t.length <= MAX_NEARBY) add(t)
  }
  return out.slice(0, 4)
}

export function trimmedHtml(el: Element): string {
  const html = el.outerHTML
  return html.length > MAX_HTML ? `${html.slice(0, MAX_HTML)}…` : html
}

/** Links, bold and other tags inside the text. Claude must keep them. */
export const hasInnerMarkup = (el: Element) => [...el.children].some((c) => c.tagName !== 'BR')

/** Find a queued item's element again, e.g. after a reload or a code change. */
export function locate(selector: string, texts: Array<string | undefined>): Element | null {
  const wanted = texts.filter((t): t is string => !!t)
  try {
    const el = document.querySelector(selector)
    if (el && (wanted.length === 0 || wanted.includes(collapse(el.textContent)))) return el
  } catch {
    // bad selector: fall through to the text search
  }
  if (wanted.length === 0) return null
  const tag = selector.split('>').pop()?.trim().split(/[:#.[]/)[0]
  const candidates = tag && /^[a-z0-9-]+$/.test(tag) ? document.querySelectorAll(tag) : document.body.querySelectorAll('*')
  for (const c of candidates) if (wanted.includes(collapse(c.textContent))) return c
  return document.querySelector(selector)
}

/** e.g. "h2 · PricingCard" */
export function label(tag: string, component?: string | null): string {
  return component ? `${tag} · ${component}` : tag
}

export const tagName = (el: Element) => el.tagName.toLowerCase()
