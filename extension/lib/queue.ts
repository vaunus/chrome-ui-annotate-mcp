// Pure queue logic. The service worker is the only writer: it runs these
// against chrome.storage.local, one at a time.

import type { EditResult, UiEdit } from '@ui-annotate/shared'

/** What the content script sends to add an item. The service worker fills in the rest. */
export type NewEdit = Omit<UiEdit, 'id' | 'status' | 'createdAt' | 'result'>

export type EditPatch = Partial<Pick<UiEdit, 'kind' | 'newText' | 'note'>>

export type Change<T> = { queue: UiEdit[]; value: T }

export class QueueError extends Error {}

export function makeId(): string {
  return `e${Math.random().toString(36).slice(2, 8)}`
}

function find(queue: UiEdit[], id: string): UiEdit {
  const edit = queue.find((e) => e.id === id)
  if (!edit) throw new QueueError(`Unknown edit id ${id}.`)
  return edit
}

export function addEdit(queue: UiEdit[], input: NewEdit, id = makeId(), now = Date.now()): Change<UiEdit> {
  const edit: UiEdit = { ...input, id, status: 'queued', createdAt: now }
  return { queue: [...queue, edit], value: edit }
}

/** Change a queued item, or fix a failed / needs_input one. Saving puts it back in the queue. */
export function updateEdit(queue: UiEdit[], id: string, patch: EditPatch): Change<UiEdit> {
  const edit = find(queue, id)
  if (edit.status === 'working') throw new QueueError('Claude is working on this edit. Reset it first.')
  if (edit.status === 'done') throw new QueueError('This edit is done.')
  const next: UiEdit = { ...edit, ...patch, status: 'queued' }
  delete next.result
  if (next.kind === 'note') delete next.newText
  return { queue: queue.map((e) => (e.id === id ? next : e)), value: next }
}

export function removeEdit(queue: UiEdit[], id: string): Change<null> {
  const edit = find(queue, id)
  if (edit.status === 'working') throw new QueueError('Claude is working on this edit. Reset it first.')
  return { queue: queue.filter((e) => e.id !== id), value: null }
}

/** Put a working, failed or needs_input item back in the queue. */
export function resetEdit(queue: UiEdit[], id: string): Change<UiEdit> {
  const edit = find(queue, id)
  if (edit.status === 'queued' || edit.status === 'done') return { queue, value: edit }
  const next: UiEdit = { ...edit, status: 'queued' }
  delete next.result
  return { queue: queue.map((e) => (e.id === id ? next : e)), value: next }
}

export function clearDone(queue: UiEdit[]): Change<number> {
  const kept = queue.filter((e) => e.status !== 'done')
  return { queue: kept, value: queue.length - kept.length }
}

/** get_pending_edits: hand every queued item to Claude and mark it working. */
export function takePending(queue: UiEdit[]): Change<UiEdit[]> {
  const taken: UiEdit[] = []
  const next = queue.map((e) => {
    if (e.status !== 'queued') return e
    const working: UiEdit = { ...e, status: 'working' }
    taken.push(working)
    return working
  })
  return { queue: next, value: taken }
}

/** mark_edit_done: store Claude's result. Throws for an unknown id. */
export function markDone(queue: UiEdit[], result: EditResult): Change<null> {
  find(queue, result.id)
  const next = queue.map((e) => {
    if (e.id !== result.id) return e
    const done: UiEdit = { ...e, status: result.status }
    if (result.message) done.result = result.message
    else delete done.result
    return done
  })
  return { queue: next, value: null }
}

export function queuedCount(queue: UiEdit[]): number {
  return queue.filter((e) => e.status === 'queued').length
}
