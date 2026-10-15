// Range-request policy for the mediagram:// media server (ARCHITECTURE > mediagram:// protocol).
//
// Chromium treats 416 as a *fatal* media error: once it sees one the decoder is dead for that
// resource and no amount of buffering will start playback. So 416 may only ever be returned for a
// genuinely unsatisfiable range — never as a "the bytes are not here yet" answer.
//
// Two independent reasons a byte at `start` may be unavailable:
//   1. The file is still downloading (TDLib temp file) and the sequential prefix has not reached it.
//   2. A tail (moov) fetch punched a hole: on-disk size then overstates what is readable from 0.
// Case 2 is why `readableEnd` exists — it is the contiguous-from-0 watermark, not `stat().size`.

/** Chromium asks for the last N bytes to parse a non-faststart MP4's moov atom.
 *  This must match `TAIL_BASE` in core/telegram.ts: the fetch and the range policy have to agree
 *  on where the tail begins, or the policy sends a request the cache can never satisfy.
 *  It is deliberately NOT the whole file for anything under this size — a range in the middle of a
 *  small file is an ordinary continuation read, and answering it out of order punches a hole of
 *  zeros into TDLib's temp file. */
export const TAIL_WINDOW = 5 * 1024 * 1024

export type MediaRangeInput = {
  /** First byte Chromium asked for. */
  start: number
  /** Last byte it asked for; negative means "through the end of the file". */
  requestedEnd: number
  /** Final size of the media, as declared to Chromium in Content-Range / Content-Length. */
  totalSize: number
  /** Contiguous bytes readable from offset 0 (never greater than what is on disk). */
  readableEnd: number
  /** True while the file may still grow, i.e. TDLib is still writing it. */
  isGrowing: boolean
  /** A TDLib file id is known, so the tail cache / download nudges are usable. */
  knownId: boolean
  /** False for a verified faststart MP4 (or a non-MP4 resource): a seek isn't a moov probe. */
  needsTail?: boolean
}

export type MediaRangeDecision =
  /** Only for a range Chromium should never have asked for — a real 416. */
  | { kind: 'unsatisfiable' }
  /** Bytes are missing but sit in the tail window: answer from the cached/fetched moov tail. */
  | { kind: 'tail'; start: number; end: number }
  /** Serve `start..end` from disk, waiting for the download to catch up when `isGrowing`. */
  | { kind: 'stream'; start: number; end: number }

/**
 * Decides how a `Range: bytes=start-end` request is answered. Pure so the policy that used to be
 * buried in the protocol handler can be unit tested — every regression in this file has previously
 * shipped as "video buffers forever and never plays".
 */
export function resolveMediaRange(input: MediaRangeInput): MediaRangeDecision {
  const { start, requestedEnd, totalSize, readableEnd, isGrowing, knownId, needsTail = true } = input

  if (!Number.isFinite(start) || start < 0) return { kind: 'unsatisfiable' }
  // Beyond the declared end of the media: the only range Chromium cannot be told anything about.
  if (totalSize <= 0 || start >= totalSize) return { kind: 'unsatisfiable' }
  if (Number.isFinite(requestedEnd) && requestedEnd >= 0 && start > requestedEnd) {
    return { kind: 'unsatisfiable' }
  }

  const end = Math.min(endOf(requestedEnd, totalSize), totalSize - 1)

  // Already readable from offset 0 → a plain forward read, whatever else is going on.
  if (start < readableEnd) return { kind: 'stream', start, end }

  // The floor the tail window begins at, aligned down exactly as `TAIL_BASE` is in core/telegram.ts.
  // The two must agree byte for byte: a range this policy calls "tail" has to be one the tail cache
  // actually covers, and one it does not call "tail" must never be left waiting on a download that is
  // five megabytes short of where it is parked.
  const tailFloor = Math.floor((totalSize - TAIL_WINDOW) / 4096) * 4096
  // Only a range that really sits in a distinct tail is worth an out-of-order fetch. Below this
  // floor the whole file is within reach of the sequential download, and fetching from the middle
  // of it only leaves unwritten bytes behind the watermark.
  const inTailWindow = start > 0 && tailFloor > 0 && start >= tailFloor

  if (knownId && isGrowing && needsTail && inTailWindow) return { kind: 'tail', start, end }

  // Not readable yet: wait for the sequential prefix. Moving TDLib to this byte would cancel
  // the download filling that prefix and leave a hole underneath another open media response.
  return { kind: 'stream', start, end }
}

function endOf(requestedEnd: number, totalSize: number): number {
  return Number.isFinite(requestedEnd) && requestedEnd >= 0 ? requestedEnd : totalSize - 1
}

/**
 * The size to declare to Chromium. A complete file is exactly what is on disk — trusting a stale
 * `?total=` there makes Content-Length promise bytes the stream can never produce, which Chromium
 * reports as a network error and kills playback. A file still downloading must declare its final
 * size up front or Chromium would think the media ended at the current download frontier.
 */
export function declaredSize(opts: { currentSize: number; queryTotal: number; isGrowing: boolean }): number {
  const { currentSize, queryTotal, isGrowing } = opts
  if (!isGrowing) return currentSize
  return queryTotal > currentSize ? queryTotal : currentSize
}
