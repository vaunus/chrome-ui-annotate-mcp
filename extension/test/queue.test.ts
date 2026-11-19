import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { UiEdit } from '@ui-annotate/shared'
import {
  addEdit,
  clearDone,
  markDone,
  queuedCount,
  QueueError,
  removeEdit,
  resetEdit,
  takePending,
  updateEdit,
  type NewEdit,
} from '../lib/queue.ts'

const input: NewEdit = {
  kind: 'copy',
  url: 'http://localhost:3100/',
  oldText: 'Save',
  newText: 'Save plan',
  selector: 'button',
  outerHTML: '<button>Save</button>',
  nearbyText: ['Team'],
}

function queueOf(...statuses: UiEdit['status'][]): UiEdit[] {
  return statuses.map((status, i) => ({ ...addEdit([], input, `e${i}`, i).value, status }))
}

test('add sets id, status and time', () => {
  const { queue, value } = addEdit([], input, 'e1', 42)
  assert.equal(queue.length, 1)
  assert.deepEqual(value, { ...input, id: 'e1', status: 'queued', createdAt: 42 })
})

test('takePending hands over only queued items and marks them working', () => {
  const q = queueOf('queued', 'done', 'queued', 'failed')
  const { queue, value } = takePending(q)
  assert.deepEqual(value.map((e) => e.id), ['e0', 'e2'])
  assert.ok(value.every((e) => e.status === 'working'))
  assert.deepEqual(queue.map((e) => e.status), ['working', 'done', 'working', 'failed'])
  assert.deepEqual(takePending(queue).value, [])
})

test('markDone stores the status and message', () => {
  const { queue } = markDone(queueOf('working'), { id: 'e0', status: 'done', message: 'app/page.tsx' })
  assert.equal(queue[0]?.status, 'done')
  assert.equal(queue[0]?.result, 'app/page.tsx')
})

test('markDone with an unknown id throws', () => {
  assert.throws(() => markDone(queueOf('working'), { id: 'nope', status: 'done' }), QueueError)
})

test('update re-queues a failed item and clears the old result', () => {
  const failed = markDone(queueOf('working'), { id: 'e0', status: 'failed', message: 'from an API' }).queue
  const { value } = updateEdit(failed, 'e0', { note: 'it is in en.json' })
  assert.equal(value.status, 'queued')
  assert.equal(value.note, 'it is in en.json')
  assert.equal(value.result, undefined)
})

test('update to a note drops the new text', () => {
  const { value } = updateEdit(queueOf('queued'), 'e0', { kind: 'note', note: 'remove this' })
  assert.equal(value.newText, undefined)
})

test('working and done items are locked', () => {
  assert.throws(() => updateEdit(queueOf('working'), 'e0', { note: 'x' }), /working/)
  assert.throws(() => removeEdit(queueOf('working'), 'e0'), /working/)
  assert.throws(() => updateEdit(queueOf('done'), 'e0', { note: 'x' }), /done/)
})

test('reset puts a working item back in the queue', () => {
  const { value } = resetEdit(queueOf('working'), 'e0')
  assert.equal(value.status, 'queued')
})

test('clearDone removes only done items', () => {
  const { queue, value } = clearDone(queueOf('done', 'queued', 'done', 'failed'))
  assert.equal(value, 2)
  assert.deepEqual(queue.map((e) => e.status), ['queued', 'failed'])
})

test('queuedCount', () => {
  assert.equal(queuedCount(queueOf('queued', 'working', 'queued')), 2)
})
