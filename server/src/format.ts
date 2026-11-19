// Turns queued edits into compact Markdown for Claude.

import type { UiEdit } from '@ui-annotate/shared'

const MAX_HTML = 2000

/** A code fence longer than any backtick run inside the text, so page HTML cannot break out. */
function fence(text: string, lang = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const ticks = '`'.repeat(longest + 1)
  return `${ticks}${lang}\n${text}\n${ticks}`
}

function route(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function formatEdit(edit: UiEdit, index: number, total: number): string {
  const lines = [`## ${index + 1}/${total} · ${edit.kind} · id \`${edit.id}\``]
  lines.push(`- Page: \`${route(edit.url)}\` (${edit.url})`)
  if (edit.react?.owners.length) lines.push(`- Components (nearest first): ${edit.react.owners.join(' ← ')}`)
  if (edit.oldText !== undefined) lines.push(`- Old text: ${JSON.stringify(edit.oldText)}`)
  if (edit.kind === 'copy' && edit.newText !== undefined) lines.push(`- New text: ${JSON.stringify(edit.newText)}`)
  if (edit.note) lines.push(`- Note from the user: ${JSON.stringify(edit.note)}`)
  if (edit.nearbyText.length) lines.push(`- Nearby text: ${edit.nearbyText.map((t) => JSON.stringify(t)).join(', ')}`)
  lines.push(`- Selector: \`${edit.selector}\``)
  const html = edit.outerHTML.length > MAX_HTML ? `${edit.outerHTML.slice(0, MAX_HTML)}…` : edit.outerHTML
  lines.push('', fence(html, 'html'))
  return lines.join('\n')
}

export function formatEdits(edits: UiEdit[]): string {
  if (edits.length === 0) return 'No queued UI edits in the browser.'
  const head =
    `${edits.length} UI edit${edits.length === 1 ? '' : 's'} from the browser. ` +
    'Apply each one, then call mark_edit_done once per id.'
  return [head, ...edits.map((e, i) => formatEdit(e, i, edits.length))].join('\n\n')
}
