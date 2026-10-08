// How the mediagram:// protocol reads a local file (ARCHITECTURE > mediagram:// protocol).
//
// Two things make this different from a plain file stream, and both of them have previously shipped
// as "video buffers forever and never plays":
//
//   1. The file may still be downloading. Truncating the response at the current disk size leaves a
//      body shorter than the declared Content-Length, which Chromium reports as a net error and
//      turns into a fatal media error. So the response stays open and delivers bytes as they land.
//   2. TDLib's temp file may hold holes. A tail (moov) fetch writes near the end while the region
//      before it is left unwritten, and unwritten bytes read back as zeros. The decoder treats those
//      as corrupt media rather than as "not here yet", so nothing may be served past the contiguous
//      from offset 0. Waiting for the download is always correct; serving zeros never is.
//
// The policy lives here, away from the protocol handler, so it can be tested against a real file.

import fs from 'node:fs'

export type MediaWatermarks = {
  /** Bytes of the file contiguous from offset 0 — the only bytes safe to serve. */
  prefix: number
  /** Total bytes downloaded, counting out-of-order parts. */
  downloaded: number
  /** Final size of the file; 0 when unknown. */
  size: number
  /** The download is finished: everything on disk is real. */
  done: boolean
}

export type MediaStreamDeps = {
  /** Fresh watermark for a growing file; null when the download layer cannot say. */
  watermarks(fileId: number): Promise<MediaWatermarks | null>
  /** Re-asserts the sequential download from byte 0, which fills holes and restarts a stalled one. */
  resume?(fileId: number): void
  /** True while a moov tail fetch is running — a nudge would cancel the very read about to be asked for. */
  tailBusy?(fileId: number): boolean
  /** Delivery diagnostics: position is the first byte of this chunk. */
  onChunk?(position: number, count: number): void
  /** Called once, when the stream gives up rather than pretend the file ended. */
  onStall?(detail: string): void
  /** Resolve the actual TDLib path when a temp file is created or moved during this response. */
  resolvePath?(fileId: number): Promise<string | null>
  /** Silence allowed before the response fails. Default 30 minutes. */
  idleLimitMs?: number
  /** Silence before the download is nudged. Default 8 seconds. */
  nudgeAfterMs?: number
}

export type MediaStreamOptions = {
  filePath: string
  /** First byte to send. */
  startPos: number
  /** Last byte to send (inclusive); the declared length of this response is `endPos - startPos + 1`. */
  endPos: number
  /** The file may still grow: wait for bytes instead of closing at disk EOF. */
  isGrowing: boolean
  /** TDLib file id, enabling the watermark and the nudges. */
  fileId?: number
  /** Watermark captured when the request was accepted; the fallback when TDLib cannot be asked again. */
  requestPrefix: number
  deps: MediaStreamDeps
}

const DEFAULT_IDLE_LIMIT_MS = 30 * 60 * 1000
const DEFAULT_NUDGE_AFTER_MS = 8000
const CHUNK_SIZE = 128 * 1024

/** A ReadableStream that serves `startPos..endPos` of a local file, waiting for a download to catch up. */
export function createMediaStream(options: MediaStreamOptions): ReadableStream<Uint8Array> {
  const { filePath, startPos, endPos, isGrowing, fileId, requestPrefix, deps } = options
  const idleLimitMs = deps.idleLimitMs ?? DEFAULT_IDLE_LIMIT_MS
  const nudgeAfterMs = deps.nudgeAfterMs ?? DEFAULT_NUDGE_AFTER_MS

  let handle: fs.promises.FileHandle | null = null
  let currentPath = filePath
  let nextPathCheckAt = 0
  let currentPos = startPos
  let closed = false
  let idleMs = 0
  let nextNudgeAt = nudgeAfterMs

  const closeStream = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    closed = true
    if (handle) {
      try { await handle.close() } catch {}
      handle = null
    }
    controller.close()
  }

  /** Highest offset this stream may serve right now. `prefix` bytes are valid, so the last valid
   *  one is `prefix - 1` — clamping that at 0 would make a zero watermark look like one safe byte. */
  const safeEnd = async (): Promise<number> => {
    if (!isGrowing || fileId === undefined) return endPos
    const w = await deps.watermarks(fileId).catch(() => null)
    if (w) return Math.min(endPos, w.prefix - 1)
    // A downloading file may already be full-size yet contain sparse holes or garbage. A failed
    // metadata query cannot authorize new bytes, even before this process has requested a tail.
    return Math.min(endPos, requestPrefix - 1)
  }

  const failStream = async (controller: ReadableStreamDefaultController<Uint8Array>, error: unknown) => {
    if (closed) return
    closed = true
    if (handle) {
      try { await handle.close() } catch {}
      handle = null
    }
    controller.error(error)
  }

  const refreshPath = async (beforeRead = false) => {
    if (fileId === undefined || !deps.resolvePath || (!beforeRead && Date.now() < nextPathCheckAt)) return
    nextPathCheckAt = Date.now() + 1000
    const resolved = await deps.resolvePath(fileId).catch(() => null)
    if (closed || !resolved || resolved === currentPath) return
    if (handle) {
      try { await handle.close() } catch {}
      handle = null
    }
    currentPath = resolved
  }

  // The wait happens *inside* one pull, not by returning and hoping to be called again: the stream
  // only requests another pull once a new read arrives, so returning empty with a read already
  // outstanding leaves the response hung forever — which is exactly the reported symptom.
  return new ReadableStream<Uint8Array>({
    async start() {
      try {
        handle = await fs.promises.open(filePath, 'r')
      } catch {
        // Handled in the first pull
      }
    },
    async pull(controller) {
      while (!closed) {
        if (currentPos > endPos) {
          await closeStream(controller)
          return
        }

        // Probe even when the file doesn't exist yet. Otherwise a guessed/stale temp path prevents
        // both prefix diagnostics and prefetch from ever observing the first downloaded bytes.
        const limit = await safeEnd()
        if (closed) return
        // Coverage belongs to TDLib's current file, not necessarily the handle from the last pull.
        // An old sparse file can still return bytes (zeros) after TDLib moves to a new path.
        if (limit >= currentPos) await refreshPath(true)
        if (closed) return
        if (!handle) {
          await refreshPath()
          if (closed) return
          try {
            const opened = await fs.promises.open(currentPath, 'r')
            if (closed) { await opened.close(); return }
            handle = opened
          } catch (error) {
            if (!isGrowing) {
              await failStream(controller, error)
              return
            }
          }
        }

        if (handle) {
          if (limit >= currentPos) {
            const toRead = Math.min(CHUNK_SIZE, limit - currentPos + 1)
            const buf = Buffer.allocUnsafe(toRead)
            let bytesRead = 0
            try {
              const res = await handle.read(buf, 0, toRead, currentPos)
              bytesRead = res.bytesRead
            } catch (err: unknown) {
              if (closed) return
              await failStream(controller, err)
              return
            }
            if (closed) return
            if (bytesRead > 0) {
              idleMs = 0
              nextNudgeAt = nudgeAfterMs
              deps.onChunk?.(currentPos, bytesRead)
              currentPos += bytesRead
              controller.enqueue(new Uint8Array(buf.subarray(0, bytesRead)))
              return
            }
          }
        }

        // Nothing to serve yet: disk has not caught up, or the next bytes sit in a hole. Both resolve
        // on their own once the download moves.
        if (!isGrowing) {
          await failStream(controller, new Error(`${currentPath} ended at ${currentPos}, before declared end ${endPos + 1}`))
          return
        }
        await refreshPath()
        if (closed) return

        idleMs += 100
        // Nudge repeatedly, not once: TDLib may be busy with a tail range when the first nudge
        // lands, and a stream that gives up after a single attempt waits out the rest of the
        // response on a download nothing has asked for since.
        if (fileId !== undefined && idleMs >= nextNudgeAt && !deps.tailBusy?.(fileId)) {
          nextNudgeAt = idleMs + nudgeAfterMs
          deps.resume?.(fileId)
        }
        if (idleMs > idleLimitMs) {
          const detail = `${currentPath} stalled at ${currentPos}/${endPos} for ${Math.round(idleMs / 1000)}s`
          deps.onStall?.(detail)
          await failStream(controller, new Error(detail))
          return
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    },
    async cancel() {
      closed = true
      if (handle) {
        try { await handle.close() } catch {}
        handle = null
      }
    },
  })
}
