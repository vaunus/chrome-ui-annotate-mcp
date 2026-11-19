import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatEdits } from '../src/format.ts'
import { makeEdit } from './helpers.ts'

test('empty queue', () => {
  assert.equal(formatEdits([]), 'No queued UI edits in the browser.')
})

test('one edit uses the singular and shows the route', () => {
  const out = formatEdits([makeEdit()])
  assert.match(out, /^1 UI edit from the browser\./)
  assert.match(out, /Page: `\/pricing`/)
})

test('text keeps exact whitespace and quotes', () => {
  const out = formatEdits([makeEdit({ oldText: 'Say "hi"\n  there' })])
  assert.ok(out.includes('Old text: "Say \\"hi\\"\\n  there"'))
})

test('page HTML with backticks cannot break out of its code fence', () => {
  const out = formatEdits([makeEdit({ outerHTML: '<code>```</code>' })])
  assert.ok(out.includes('````html\n<code>```</code>\n````'))
})

test('long HTML is cut', () => {
  const out = formatEdits([makeEdit({ outerHTML: `<div>${'x'.repeat(5000)}</div>` })])
  assert.ok(out.includes('x'.repeat(100)))
  assert.ok(!out.includes('x'.repeat(2500)))
})
