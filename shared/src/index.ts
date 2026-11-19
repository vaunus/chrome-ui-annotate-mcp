// Types shared by the extension and the MCP server.

export type UiEditKind = 'copy' | 'note'

export type UiEditStatus = 'queued' | 'working' | 'done' | 'failed' | 'needs_input'

export type UiEdit = {
  id: string
  kind: UiEditKind
  status: UiEditStatus
  /** Route hints the App Router file, e.g. /pricing → app/pricing/page.tsx */
  url: string
  /** textContent, NOT innerText (innerText applies CSS text-transform) */
  oldText?: string
  /** Copy edits only */
  newText?: string
  /** Required for notes, optional for copy edits */
  note?: string
  /** Also used to put the marker back after a reload */
  selector: string
  /** Trimmed to ~2 KB */
  outerHTML: string
  /** Siblings / heading above, to tell apart repeated text */
  nearbyText: string[]
  /** Owner chain, nearest first, e.g. ['PricingCard (client)', 'Home (server)'] */
  react?: { component: string; owners: string[] }
  /** Claude's message from mark_edit_done */
  result?: string
  createdAt: number
}

export * from './protocol.ts'
export * from './extension-key.ts'
