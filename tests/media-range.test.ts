// The mediagram:// range policy. Chromium treats 416 as a fatal media error, so every branch here
// that answers "the bytes are not here yet" must stream and wait instead — getting that wrong ships
// as "the video buffers forever and never plays".
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { declaredSize, resolveMediaRange, TAIL_WINDOW } from '../electron/mediaRange.ts'

const MB = 1024 * 1024

test('resolveMediaRange: a forward read inside the download is streamed, never sent to the tail', () => {
  // A 5 MB video: a start the sequential download has already covered is an ordinary forward read,
  // never a tail fetch — routing it there used to make the tail cache miss and answer 416.
  const total = 5 * MB
  const d = resolveMediaRange({ start: 1 * MB, requestedEnd: -1, totalSize: total, readableEnd: 2 * MB, isGrowing: true, knownId: true })
  assert.equal(d.kind, 'stream')
  assert.equal(d.kind === 'stream' && d.end, total - 1)
})

test('resolveMediaRange: a tail range the download has not reached takes the tail path', () => {
  const total = 20 * MB
  const d = resolveMediaRange({ start: total - 1 * MB, requestedEnd: -1, totalSize: total, readableEnd: 1 * MB, isGrowing: true, knownId: true })
  assert.equal(d.kind, 'tail')
})

test('resolveMediaRange: seeking into a faststart tail waits on the prefix without a tail download', () => {
  // The current-session regression: the head moov is already parsed and seeking past 45s to
  // 119s must not repurpose TDLib's sequential download into a 5 MB moov fetch.
  const total = 10967770
  const d = resolveMediaRange({ start: 8290304, requestedEnd: -1, totalSize: total,
    readableEnd: 6160384, isGrowing: true, knownId: true, needsTail: false })
  assert.deepEqual(d, { kind: 'stream', start: 8290304, end: total - 1 })
})

test('resolveMediaRange: a range in a file no bigger than the tail window stays sequential', () => {
  // Answering this out of order downloads from the middle of the file and leaves everything before
  // it unwritten — a hole of zeros the decoder reports as an unsupported format. Below the window
  // the whole file is one sequential read away, so there is nothing to gain.
  const total = 5 * MB
  const d = resolveMediaRange({ start: 4 * MB, requestedEnd: -1, totalSize: total, readableEnd: 1 * MB, isGrowing: true, knownId: true })
  assert.equal(d.kind, 'stream')
})

test('resolveMediaRange: a missing tail is a stream, not a 416', () => {
  const total = 5 * MB
  const d = resolveMediaRange({ start: 4 * MB, requestedEnd: -1, totalSize: total, readableEnd: 1 * MB, isGrowing: true, knownId: true })
  assert.notEqual(d.kind, 'unsatisfiable')
})

test('resolveMediaRange: a large file streams a forward read ahead of the prefix but outside the tail window', () => {
  const total = 64 * MB
  const d = resolveMediaRange({ start: 8 * MB, requestedEnd: -1, totalSize: total, readableEnd: 1 * MB, isGrowing: true, knownId: true })
  assert.equal(d.kind, 'stream')
})

test('resolveMediaRange: a hole outside the tail window waits on the stream instead of 416', () => {
  // A previous tail fetch left [1 MB, 3 MB) unwritten while stat().size already reads 20 MB.
  const total = 20 * MB
  const d = resolveMediaRange({ start: 1 * MB, requestedEnd: -1, totalSize: total, readableEnd: 1 * MB, isGrowing: true, knownId: true })
  assert.equal(d.kind, 'stream')
})

test('resolveMediaRange: only a range Chromium should never have asked for is unsatisfiable', () => {
  const base = { totalSize: 10 * MB, readableEnd: 10 * MB, isGrowing: false, knownId: false }
  assert.equal(resolveMediaRange({ ...base, start: 10 * MB, requestedEnd: -1 }).kind, 'unsatisfiable')
  assert.equal(resolveMediaRange({ ...base, start: 12 * MB, requestedEnd: 11 * MB }).kind, 'unsatisfiable')
  assert.equal(resolveMediaRange({ ...base, start: 5 * MB, requestedEnd: 4 * MB }).kind, 'unsatisfiable')
  assert.equal(resolveMediaRange({ ...base, start: -1, requestedEnd: -1 }).kind, 'unsatisfiable')
  assert.equal(resolveMediaRange({ totalSize: 0, readableEnd: 0, isGrowing: false, knownId: false, start: 0, requestedEnd: -1 }).kind, 'unsatisfiable')
})

test('resolveMediaRange: an open-ended request runs to the declared end of the file', () => {
  const total = 10 * MB
  const d = resolveMediaRange({ start: 0, requestedEnd: -1, totalSize: total, readableEnd: 10 * MB, isGrowing: false, knownId: false })
  assert.deepEqual(d, { kind: 'stream', start: 0, end: total - 1 })
})

test('resolveMediaRange: a bounded request is clamped to the file, not to the requested end', () => {
  const total = 10 * MB
  const d = resolveMediaRange({ start: 0, requestedEnd: 40 * MB, totalSize: total, readableEnd: total, isGrowing: false, knownId: false })
  assert.equal(d.kind === 'stream' && d.end, total - 1)
})

test('resolveMediaRange: the tail path also requires the file to still be growing', () => {
  const total = 4 * MB
  const d = resolveMediaRange({ start: total - 1, requestedEnd: -1, totalSize: total, readableEnd: 0, isGrowing: false, knownId: true })
  assert.equal(d.kind, 'stream')
})

test('resolveMediaRange: without a TDLib file id there is no tail cache to consult', () => {
  const total = 4 * MB
  const d = resolveMediaRange({ start: total - 1, requestedEnd: -1, totalSize: total, readableEnd: 0, isGrowing: true, knownId: false })
  assert.equal(d.kind, 'stream')
})

test('resolveMediaRange: the tail window boundary is exclusive below it', () => {
  const total = 20 * MB
  const justBelow = total - TAIL_WINDOW - 1
  const d = resolveMediaRange({ start: justBelow, requestedEnd: -1, totalSize: total, readableEnd: 0, isGrowing: true, knownId: true })
  assert.equal(d.kind, 'stream')
})

test('resolveMediaRange: the tail floor is aligned exactly as the fetch window is', () => {
  // The tail is fetched from an aligned offset, so the policy has to treat everything from there as
  // tail. A range in the gap below the raw floor would otherwise be parked on a sequential download
  // that is five megabytes short of where Chromium is waiting — and nothing plays until it arrives.
  const total = 20 * MB + 100
  const floor = Math.floor((total - TAIL_WINDOW) / 4096) * 4096
  assert.equal(floor % 4096, 0)
  const atFloor = resolveMediaRange({ start: floor, requestedEnd: -1, totalSize: total, readableEnd: 1024, isGrowing: true, knownId: true })
  assert.equal(atFloor.kind, 'tail')
  const justBelow = resolveMediaRange({ start: floor - 1, requestedEnd: -1, totalSize: total, readableEnd: 1024, isGrowing: true, knownId: true })
  assert.equal(justBelow.kind, 'stream')
})

test('declaredSize: a finished file declares exactly what is on disk', () => {
  assert.equal(declaredSize({ currentSize: 100, queryTotal: 500, isGrowing: false }), 100)
  assert.equal(declaredSize({ currentSize: 100, queryTotal: 0, isGrowing: false }), 100)
})

test('declaredSize: a growing file declares its final size so Chromium never sees a short body', () => {
  assert.equal(declaredSize({ currentSize: 100, queryTotal: 500, isGrowing: true }), 500)
  assert.equal(declaredSize({ currentSize: 600, queryTotal: 500, isGrowing: true }), 600)
  assert.equal(declaredSize({ currentSize: 100, queryTotal: 0, isGrowing: true }), 100)
})
