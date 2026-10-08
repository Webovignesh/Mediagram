// The mediagram:// read path. Two regressions here have already shipped as "the video buffers
// forever and never plays": serving the unwritten part of a TDLib temp file (which reads back as
// zeros and the decoder rejects as corrupt media), and closing a growing response early (a body
// shorter than the declared Content-Length is a net error, and equally fatal). Both must wait
// instead — so both are pinned here against a real file.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { createMediaStream, type MediaStreamDeps, type MediaWatermarks } from '../electron/mediaStream.ts'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediagram-stream-'))
after(() => fs.rmSync(temp, { recursive: true, force: true }))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

/** Resolves with the read, or fails the test instead of hanging on bytes that never come. */
async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${what}`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Reads until the stream closes or `timeout` elapses with nothing more to read. Never issues two
 *  concurrent reads: a read raced against the clock is kept and awaited on the next turn. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, timeout: number): Promise<Uint8Array> {
  const deadline = Date.now() + timeout
  const chunks: Uint8Array[] = []
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null
  while (Date.now() < deadline) {
    pending = pending ?? reader.read()
    const left = Math.max(1, deadline - Date.now())
    const res = await Promise.race([
      pending.then((read) => ({ read })),
      sleep(left).then(() => ({ timeout: true as const })),
    ])
    if ('timeout' in res) break
    pending = null
    if (res.read.done) break
    chunks.push(res.read.value)
  }
  return concat(chunks)
}

/** True when nothing arrives on an already-issued read — the shape of "it is waiting, not done". */
async function stallsFor(read: Promise<ReadableStreamReadResult<Uint8Array>>, ms: number): Promise<boolean> {
  return (await Promise.race([read.then(() => 'read' as const), sleep(ms).then(() => 'wait' as const)])) === 'wait'
}

function file(name: string, bytes: Buffer): string {
  const p = path.join(temp, name)
  fs.writeFileSync(p, bytes)
  return p
}

test('createMediaStream: never serves the unwritten part of a hole — it waits for the download', async () => {
  const REAL = Buffer.alloc(512, 0x41)         // what TDLib has actually written from offset 0
  const HOLE = Buffer.alloc(4096 - 512, 0x00)  // extended by a tail fetch, never written: reads as zeros
  const p = file('hole.bin', Buffer.concat([REAL, HOLE]))

  const wm: MediaWatermarks = { prefix: REAL.length, downloaded: REAL.length, size: 4096, done: false }
  const reader = createMediaStream({
    filePath: p, startPos: 0, endPos: 4095, isGrowing: true, fileId: 7, requestPrefix: REAL.length,
    deps: { watermarks: async () => wm },
  }).getReader()

  const first = await within(reader.read(), 3000, 'the readable prefix')
  assert.equal(first.done, false)
  assert.equal(hex(first.value!), hex(REAL), 'exactly the bytes TDLib has written, no further')

  // Answering this would hand the decoder zeros out of the hole, which it reports as corrupt media
  // rather than as data still to come.
  const pending = reader.read()
  assert.equal(await stallsFor(pending, 400), true, 'a read past the watermark waits instead of returning zeros')

  const FULL = Buffer.concat([REAL, Buffer.alloc(4096 - 512, 0x42)])
  fs.writeFileSync(p, FULL)
  wm.prefix = 4096
  wm.done = true

  const rest = await within(pending, 3000, 'the rest of the file')
  assert.equal(rest.done, false)
  assert.equal((await within(reader.read(), 3000, 'the stream to close')).done, true)

  const got = concat([first.value!, rest.value!])
  assert.equal(got.length, 4096)
  assert.equal(hex(got), hex(FULL), 'the whole file arrives intact, with no zeros from the hole')
})

test('createMediaStream: a stalled download is nudged repeatedly, and never while a moov tail fetch runs', async () => {
  const p = file('stalled.bin', Buffer.alloc(64, 0x43))
  const wm: MediaWatermarks = { prefix: 0, downloaded: 0, size: 64, done: false }

  const nudges: number[] = []
  const deps = (tailBusy: boolean): MediaStreamDeps => ({
    watermarks: async () => wm,
    resume: (id) => nudges.push(id),
    tailBusy: () => tailBusy,
    nudgeAfterMs: 300,
    idleLimitMs: 60_000,
  })

  const reader = createMediaStream({
    filePath: p, startPos: 0, endPos: 63, isGrowing: true, fileId: 11, requestPrefix: 0,
    deps: deps(false),
  }).getReader()
  await sleep(900)
  // One nudge is not enough: TDLib may be busy with a tail range when it lands, and a stream that
  // gives up after that waits out the rest of the response on an untouched download.
  assert.ok(nudges.length >= 2, `expected repeated nudges, got ${nudges.length}`)
  assert.ok(nudges.every((id) => id === 11), 'every nudge names this file')
  await reader.cancel()

  nudges.length = 0
  const quiet = createMediaStream({
    filePath: p, startPos: 0, endPos: 63, isGrowing: true, fileId: 12, requestPrefix: 0,
    deps: deps(true),
  }).getReader()
  await sleep(900)
  assert.deepEqual(nudges, [], 'a nudge would cancel the very tail fetch the player is about to ask for')
  await quiet.cancel()
})

test('createMediaStream: gives up on a dead download by saying so, not by silently ending the body', async () => {
  const p = file('dead.bin', Buffer.alloc(32, 0x44))
  const stalls: string[] = []
  const reader = createMediaStream({
    filePath: p, startPos: 0, endPos: 4095, isGrowing: true, fileId: 13, requestPrefix: 0,
    deps: {
      watermarks: async () => ({ prefix: 0, downloaded: 0, size: 4096, done: false }),
      nudgeAfterMs: 60_000,
      idleLimitMs: 400,
      onStall: (detail) => stalls.push(detail),
    },
  }).getReader()

  await assert.rejects(within(reader.read(), 5000, 'the stream to give up'), /stalled at 0\/4095/)
  assert.equal(stalls.length, 1, 'the stall is reported so it shows up in main.log')
  assert.match(stalls[0], /stalled at 0\/4095/)
})

test('createMediaStream: TDLib unreachable never advances past the confirmed request prefix', async () => {
  const p = file('ondisk.bin', Buffer.alloc(256, 0x45))
  const reader = createMediaStream({
    filePath: p, startPos: 0, endPos: 4095, isGrowing: true, fileId: 14, requestPrefix: 256,
    deps: { watermarks: async () => null, nudgeAfterMs: 60_000, idleLimitMs: 60_000 },
  }).getReader()

  const first = await within(reader.read(), 3000, 'the bytes already on disk')
  assert.equal(first.value!.length, 256, 'only what the disk really holds')

  const pending = reader.read()
  assert.equal(await stallsFor(pending, 300), true, 'the response stays open rather than ending early')

  fs.writeFileSync(p, Buffer.alloc(512, 0x46))
  assert.equal(await stallsFor(pending, 300), true, 'disk growth is not evidence of downloaded coverage')
  await reader.cancel()
})

test('createMediaStream: missing initial path still probes coverage and follows TDLib\'s actual path', async () => {
  const guessed = path.join(temp, 'missing-guessed-id')
  const actual = path.join(temp, 'actual-tdlib-temp-name')
  const wm: MediaWatermarks = { prefix: 0, downloaded: 0, size: 1024, done: false }
  let probes = 0
  const chunks: number[] = []
  const reader = createMediaStream({
    filePath: guessed, startPos: 0, endPos: 1023, isGrowing: true, fileId: 15, requestPrefix: 0,
    deps: {
      watermarks: async () => { probes++; return wm },
      resolvePath: async () => wm.prefix > 0 ? actual : null,
      onChunk: (_position, count) => chunks.push(count),
    },
  }).getReader()
  const pending = reader.read()
  assert.equal(await stallsFor(pending, 300), true)
  assert.ok(probes > 0, 'prefix probing starts before there is a file handle')
  fs.writeFileSync(actual, Buffer.alloc(1024, 0))
  const handle = fs.openSync(actual, 'r+')
  fs.writeSync(handle, Buffer.alloc(256, 0x47), 0, 256, 0)
  fs.closeSync(handle)
  wm.prefix = wm.downloaded = 256
  const first = await within(pending, 3000, 'the prefix at the actual path')
  assert.equal(first.value!.length, 256)
  assert.equal(hex(first.value!), hex(Buffer.alloc(256, 0x47)))
  assert.deepEqual(chunks, [256], 'the head is delivered without waiting for completion')
  assert.equal(wm.done, false)
  await reader.cancel()
})

test('createMediaStream: metadata failure with a full-size sparse file never exposes its hole', async () => {
  const p = file('metadata-hole.bin', Buffer.concat([Buffer.alloc(128, 0x48), Buffer.alloc(3968)]))
  const reader = createMediaStream({
    filePath: p, startPos: 128, endPos: 4095, isGrowing: true, fileId: 16, requestPrefix: 128,
    deps: { watermarks: async () => { throw new Error('TDLib temporarily unavailable') } },
  }).getReader()
  assert.equal(await stallsFor(reader.read(), 300), true)
  await reader.cancel()
})

test('createMediaStream: an open response follows a partial file that TDLib moves on completion', async () => {
  const original = file('before-move.bin', Buffer.alloc(256, 0x49))
  const completed = file('after-move.bin', Buffer.concat([Buffer.alloc(256, 0x49), Buffer.alloc(256, 0x4a)]))
  const wm: MediaWatermarks = { prefix: 256, downloaded: 256, size: 512, done: false }
  const reader = createMediaStream({
    filePath: original, startPos: 0, endPos: 511, isGrowing: true, fileId: 17, requestPrefix: 256,
    deps: { watermarks: async () => wm, resolvePath: async () => wm.done ? completed : original },
  }).getReader()
  const first = await within(reader.read(), 3000, 'the original prefix')
  wm.prefix = wm.downloaded = 512
  wm.done = true
  const rest = await within(reader.read(), 3000, 'bytes at the completed path')
  assert.equal(hex(concat([first.value!, rest.value!])), hex(fs.readFileSync(completed)))
  assert.equal((await reader.read()).done, true)
})

test('createMediaStream: new coverage never authorizes holes in a readable old file handle', async () => {
  const oldPath = file('stale-sparse.bin', Buffer.concat([Buffer.alloc(256, 0x49), Buffer.alloc(256)]))
  const newPath = file('replacement.bin', Buffer.concat([Buffer.alloc(256, 0x49), Buffer.alloc(256, 0x4a)]))
  const wm: MediaWatermarks = { prefix: 256, downloaded: 256, size: 512, done: false }
  let actualPath = oldPath
  const reader = createMediaStream({
    filePath: oldPath, startPos: 0, endPos: 511, isGrowing: true, fileId: 18, requestPrefix: 256,
    deps: { watermarks: async () => wm, resolvePath: async () => actualPath },
  }).getReader()
  const first = await within(reader.read(), 3000, 'the original prefix')
  actualPath = newPath
  wm.prefix = wm.downloaded = 512
  wm.done = true
  const rest = await within(reader.read(), 3000, 'the replacement bytes, not the old hole')
  assert.equal(hex(concat([first.value!, rest.value!])), hex(fs.readFileSync(newPath)))
  assert.equal((await reader.read()).done, true)
})

test('createMediaStream: a short completed file errors rather than silently truncating the body', async () => {
  const p = file('short-complete.bin', Buffer.alloc(32, 0x4b))
  const reader = createMediaStream({
    filePath: p, startPos: 0, endPos: 63, isGrowing: false, requestPrefix: 32,
    deps: { watermarks: async () => null },
  }).getReader()
  assert.equal((await reader.read()).value!.length, 32)
  await assert.rejects(reader.read(), /ended at 32, before declared end 64/)
})

test('createMediaStream: a finished file streams straight through with no waiting', async () => {
  const body = Buffer.from('0123456789'.repeat(20))
  const p = file('done.bin', body)
  const reader = createMediaStream({
    filePath: p, startPos: 0, endPos: body.length - 1, isGrowing: false, requestPrefix: body.length,
    deps: { watermarks: async () => ({ prefix: body.length, downloaded: body.length, size: body.length, done: true }) },
  }).getReader()

  const got = await within(drain(reader, 2000), 3000, 'a complete file')
  assert.equal(hex(got), hex(body))
})
