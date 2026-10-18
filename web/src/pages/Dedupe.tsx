import { useState, useEffect, useMemo, useRef } from 'react'
import {
  FolderSearch, FolderPlus, Play, Trash2,
  Sparkles, Film, Image as ImageIcon, CheckCircle2, Loader2, ArrowLeft,
  Columns2
} from 'lucide-react'
import { call } from '../api.ts'
import { fmtBytes, Button, SearchInput, Select, Dialog, toast, CustomVideoPlayer, MediaPreviewModal } from '../ui.tsx'
import { fmtDuration } from '../format.ts'

type MediaKind = 'video' | 'image'

type MediaItem = {
  id: string
  path: string
  name: string
  size: number
  mtime: number
  kind: MediaKind
  probed?: boolean
  duration?: number | null
  width?: number | null
  height?: number | null
  thumb?: string | null
  dh?: string | null
  dh2?: string | null
  csig?: string | null
  csig2?: string | null
  deleted?: boolean
  deleting?: boolean
}

type DupGroup = {
  id: string
  kind: 'duplicate'
  files: MediaItem[]
  keepId: string
}

type DedupePhase = 'idle' | 'staged' | 'scanning' | 'scanned'

const DUP_DIST_IMG = 30
const DUP_DIST_VID = 40
const DUP_DIST_VID_NODUR = 12
const CSIG_MAX = 96
const SCAN_CONC = 4
const STORAGE_KEY = 'mediagram_dedupe_session_v3'

function extOf(name: string) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function mediaUrlOf(filePath: string, size: number) {
  const ext = extOf(filePath).replace('.', '')
  return `mediagram://file/${encodeURIComponent(filePath)}?total=${size}&ext=${encodeURIComponent(ext)}`
}

function dhWords(hex: string) {
  const s = (hex || '').padStart(64, '0')
  const w = new Uint32Array(8)
  for (let i = 0; i < 8; i++) w[i] = parseInt(s.substring(i * 8, (i + 1) * 8), 16) >>> 0
  return w
}

function popcount(x: number) {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function hamDist(wa: Uint32Array, wb: Uint32Array, limit: number) {
  let n = 0
  for (let i = 0; i < 8; i++) {
    n += popcount(wa[i] ^ wb[i])
    if (n > limit) return n
  }
  return n
}

function csigDist(a: string | null, b: string | null) {
  if (!a || !b) return 999
  const A = a.split(',').map(Number), B = b.split(',').map(Number)
  if (A.length !== 3 || B.length !== 3 || A.some(isNaN) || B.some(isNaN)) return 999
  return Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) + Math.abs(A[2] - B[2])
}

function dhashFromCanvas(canvas: HTMLCanvasElement) {
  const S = 16
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { dh: '', csig: '' }
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, S, S)
  ctx.drawImage(canvas, 0, 0, S, S)
  const d = ctx.getImageData(0, 0, S, S).data
  const g = new Float64Array(S * S)
  let sr = 0, sg = 0, sb = 0
  for (let i = 0; i < S * S; i++) {
    const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]
    g[i] = (r + gg + b) / 3
    sr += r
    sg += gg
    sb += b
  }
  let bits = 0n
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S - 1; x++) {
      bits = (bits << 1n) | (g[y * S + x] > g[y * S + x + 1] ? 1n : 0n)
    }
  }
  const n = S * S
  return {
    dh: bits.toString(16).padStart(60, '0'),
    csig: `${Math.round(sr / n)},${Math.round(sg / n)},${Math.round(sb / n)}`,
  }
}

function computeHashFromDataUrl(dataUrl: string): Promise<{ dh: string, csig: string } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 160
        c.height = Math.max(16, Math.round((160 * (img.naturalHeight || 90)) / (img.naturalWidth || 160)))
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(img, 0, 0, c.width, c.height)
          resolve(dhashFromCanvas(c))
          return
        }
      } catch {}
      resolve(null)
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

export default function Dedupe() {
  const [folder, setFolder] = useState<string | null>(null)
  const [phase, setPhase] = useState<DedupePhase>('idle')
  const [recursive, setRecursive] = useState<boolean>(true)
  const [files, setFiles] = useState<MediaItem[]>([])
  const [scanProgress, setScanProgress] = useState<{ done: number, total: number }>({ done: 0, total: 0 })
  const [statusText, setStatusText] = useState('Select a folder to begin visual duplicate scanning.')

  const [dupGroups, setDupGroups] = useState<DupGroup[]>([])
  const [freedStats, setFreedStats] = useState<{ count: number, bytes: number }>({ count: 0, bytes: 0 })

  const [view, setView] = useState<'duplicates' | 'library'>('duplicates')
  const [typeFilter, setTypeFilter] = useState<'all' | 'video' | 'image'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'name' | 'size-desc' | 'size-asc' | 'dur-desc' | 'newest'>('size-desc')
  const [density, setDensity] = useState<'sm' | 'md' | 'lg'>('md')

  const [subfolderPrompt, setSubfolderPrompt] = useState<{ open: boolean, folder: string } | null>(null)

  // In-page Compare View group ID
  const [compareGroupId, setCompareGroupId] = useState<string | null>(null)

  // Single file preview modal (using Mediagram's standard MediaPreviewModal)
  const [previewItem, setPreviewItem] = useState<{ name: string, path?: string, size?: number, duration?: number, type?: string } | null>(null)

  // Custom delete confirmation modal state
  const [deleteConfirm, setDeleteConfirm] = useState<{ items: MediaItem[] } | null>(null)

  const abortScanRef = useRef<boolean>(false)

  // 1. Restore session from localStorage on initial load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const s = JSON.parse(raw)
        if (s.folder && Array.isArray(s.files) && s.files.length > 0) {
          setFolder(s.folder)
          setPhase(s.phase || (s.dupGroups?.length > 0 ? 'scanned' : 'staged'))
          setRecursive(s.recursive ?? true)
          setDupGroups(s.dupGroups || [])
          setFreedStats(s.freedStats || { count: 0, bytes: 0 })
          setView(s.view || 'duplicates')
          setFiles(s.files)
          if (s.compareGroupId) setCompareGroupId(s.compareGroupId)
          setStatusText(`Loaded folder: ${s.folder} (${s.files.length} files).`)
        }
      }
    } catch {}
  }, [])

  // 2. Persist state changes to localStorage
  useEffect(() => {
    if (phase === 'idle' || !folder) return
    try {
      const s = {
        folder,
        phase: phase === 'scanning' ? 'staged' : phase,
        recursive,
        files,
        dupGroups,
        freedStats,
        view,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch {}
  }, [folder, phase, recursive, files, dupGroups, freedStats, view])

  // Browse folder using native dialog
  const browseFolder = async () => {
    try {
      const res = await call<{ path: string | null }>('app.pickFolder', { title: 'Select folder for duplicate review' })
      if (!res?.path) return
      const target = res.path
      const hasSubs = await call<{ hasSubfolders: boolean }>('dedupe.hasSubfolders', { folderPath: target }).catch(() => ({ hasSubfolders: false }))
      if (hasSubs.hasSubfolders) {
        setSubfolderPrompt({ open: true, folder: target })
      } else {
        await startFolderStage(target, false)
      }
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  const startFolderStage = async (targetFolder: string, isRecursive: boolean) => {
    setStatusText(`Scanning media files in ${targetFolder}…`)
    try {
      const r = await call<{ files: { path: string, name: string, size: number, mtime: number, kind: MediaKind }[], folder: string }>(
        'dedupe.scan', { folderPath: targetFolder, recursive: isRecursive }
      )
      const items: MediaItem[] = r.files.map((f) => ({
        id: `f:${f.path}:${f.size}:${f.mtime}`,
        path: f.path,
        name: f.name,
        size: f.size,
        mtime: f.mtime,
        kind: f.kind,
        probed: false,
      }))
      setFolder(r.folder)
      setFiles(items)
      setDupGroups([])
      setRecursive(isRecursive)
      setCompareGroupId(null)

      if (items.length === 0) {
        setPhase('idle')
        setStatusText(`No media files found in ${r.folder}.`)
        toast(`No media files found in ${r.folder}.`, 'warning')
      } else {
        setPhase('staged')
        setStatusText(`${items.length.toLocaleString()} files staged. Press Start Visual Scan to detect duplicates.`)
      }
    } catch (e) {
      toast((e as Error).message, 'danger')
      setStatusText('Failed to read folder.')
    }
  }

  const clearSession = () => {
    abortScanRef.current = true
    setFolder(null)
    setFiles([])
    setDupGroups([])
    setCompareGroupId(null)
    setPhase('idle')
    setStatusText('Select a folder to begin visual duplicate scanning.')
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  // Visual capture of thumbnail + dhash using backend ffmpeg + canvas
  const captureItem = async (it: MediaItem): Promise<MediaItem> => {
    if (it.probed && it.thumb && it.dh) return it

    try {
      // 1. Call native backend ffmpeg thumbnailer (returns 0.5s frame and 75% frame for videos)
      const r = await call<{ thumb?: string, thumb2?: string, duration?: number, width?: number, height?: number }>('dedupe.thumb', { path: it.path })
      if (r && r.thumb) {
        it.thumb = r.thumb
        if (r.duration != null) it.duration = r.duration
        if (r.width != null) it.width = r.width
        if (r.height != null) it.height = r.height

        // Calculate dhash and color signature from 0.5s frame
        const h1 = await computeHashFromDataUrl(r.thumb)
        if (h1) {
          it.dh = h1.dh
          it.csig = h1.csig
        }

        // Calculate dhash and color signature from 75% video frame for multi-point verification
        if (r.thumb2) {
          const h2 = await computeHashFromDataUrl(r.thumb2)
          if (h2) {
            it.dh2 = h2.dh
            it.csig2 = h2.csig
          }
        }

        it.probed = true
        return it
      }
    } catch {}

    // 2. Fallback for images if ffmpeg didn't run: load directly in Image()
    if (it.kind === 'image') {
      const url = mediaUrlOf(it.path, it.size)
      await new Promise<void>((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          try {
            const S = 160
            const c = document.createElement('canvas')
            c.width = S
            c.height = Math.max(16, Math.round((S * (img.naturalHeight || S)) / (img.naturalWidth || S)))
            const ctx = c.getContext('2d', { willReadFrequently: true })
            if (ctx) {
              ctx.drawImage(img, 0, 0, c.width, c.height)
              it.thumb = c.toDataURL('image/jpeg', 0.65)
              const h = dhashFromCanvas(c)
              it.dh = h.dh
              it.csig = h.csig
              it.width = img.naturalWidth
              it.height = img.naturalHeight
            }
          } catch {}
          it.probed = true
          resolve()
        }
        img.onerror = () => {
          it.probed = true
          resolve()
        }
        img.src = url
      })
    } else {
      it.probed = true
    }

    return it
  }

  // Start visual scanning and run duplicate detection
  const startScanning = async () => {
    if (!files.length || phase === 'scanning') return
    abortScanRef.current = false
    setPhase('scanning')
    setStatusText('Capturing visual frames and computing fingerprints…')

    const unprobed = files.filter((f) => !f.probed || !f.thumb || !f.dh)
    setScanProgress({ done: 0, total: unprobed.length })

    let completed = 0
    let lastRender = Date.now()

    const pool = async () => {
      let idx = 0
      const runWorker = async () => {
        while (idx < unprobed.length && !abortScanRef.current) {
          const item = unprobed[idx++]
          await captureItem(item)
          completed++
          setScanProgress({ done: completed, total: unprobed.length })

          // Batch React render so user sees thumbnails popping in dynamically
          const now = Date.now()
          if (now - lastRender > 300 || completed === unprobed.length) {
            lastRender = now
            setFiles([...files])
          }
        }
      }
      await Promise.all(Array.from({ length: SCAN_CONC }, runWorker))
    }

    await pool()

    if (abortScanRef.current) {
      setPhase('staged')
      setStatusText('Scan cancelled.')
      return
    }

    // Matching phase
    setStatusText('Matching visual duplicates…')
    const valid = files.filter((f) => f.dh && !f.deleted)
    const words = new Map<string, Uint32Array>()
    const words2 = new Map<string, Uint32Array>()
    for (const f of valid) {
      words.set(f.id, dhWords(f.dh!))
      if (f.dh2) words2.set(f.id, dhWords(f.dh2))
    }

    // Union-Find
    const parent = new Map<string, string>(valid.map((f) => [f.id, f.id]))
    const find = (x: string): string => {
      const p = parent.get(x)!
      if (p === x) return x
      const root = find(p)
      parent.set(x, root)
      return root
    }
    const union = (a: string, b: string) => parent.set(find(a), find(b))

    // LSH banding (20 slices x 12 bits)
    const bands = new Map<string, MediaItem[]>()
    for (const f of valid) {
      for (let i = 0; i < 60; i += 3) {
        const k = f.dh!.substring(i, i + 3)
        let arr = bands.get(k)
        if (!arr) bands.set(k, arr = [])
        arr.push(f)
      }
    }

    for (const arr of bands.values()) {
      if (arr.length <= 1) continue
      for (let a = 0; a < arr.length; a++) {
        for (let b = a + 1; b < arr.length; b++) {
          const A = arr[a], B = arr[b]
          if (find(A.id) === find(B.id)) continue
          if (A.kind !== B.kind) continue
          const wa = words.get(A.id)!, wb = words.get(B.id)!
          const lim = A.kind === 'video' ? DUP_DIST_VID : DUP_DIST_IMG
          if (hamDist(wa, wb, lim) > lim) continue
          if (csigDist(A.csig || null, B.csig || null) > CSIG_MAX) continue

          if (A.kind === 'video') {
            // 1. Exact runtime duration match (|Δt| <= 0.6s)
            const da = A.duration, db = B.duration
            if (da != null && db != null && !isNaN(da) && !isNaN(db)) {
              if (Math.abs(da - db) > 0.6) continue
            } else if (hamDist(wa, wb, DUP_DIST_VID_NODUR) > DUP_DIST_VID_NODUR) {
              continue
            }

            // 2. 75% video frame visual match
            const wa2 = words2.get(A.id), wb2 = words2.get(B.id)
            if (wa2 && wb2) {
              if (hamDist(wa2, wb2, lim) > lim) continue
              if (A.csig2 && B.csig2 && csigDist(A.csig2, B.csig2) > CSIG_MAX) continue
            }

            // 3. File size consistency (must be within 25% tolerance or < 1 MB diff)
            const minSize = Math.min(A.size, B.size)
            const maxSize = Math.max(A.size, B.size)
            if (maxSize > 0 && (minSize / maxSize) < 0.75 && (maxSize - minSize) > 1024 * 1024) {
              continue
            }
          }
          union(A.id, B.id)
        }
      }
    }

    const buckets = new Map<string, MediaItem[]>()
    for (const f of valid) {
      const r = find(f.id)
      let b = buckets.get(r)
      if (!b) buckets.set(r, b = [])
      b.push(f)
    }

    const groups: DupGroup[] = []
    let grpIdx = 1
    for (const groupFiles of buckets.values()) {
      if (groupFiles.length > 1) {
        groupFiles.sort((a, b) => b.size - a.size || (b.duration || 0) - (a.duration || 0))
        groups.push({
          id: `grp-${grpIdx++}`,
          kind: 'duplicate',
          files: groupFiles,
          keepId: groupFiles[0].id,
        })
      }
    }

    setDupGroups(groups)
    setPhase('scanned')
    setFiles([...files])

    if (groups.length > 0) {
      setView('duplicates')
      setStatusText(`Scan complete: Found ${groups.length} duplicate group(s) across ${valid.length} files.`)
      toast(`Found ${groups.length} duplicate group(s).`, 'success')
    } else {
      setView('library')
      setStatusText(`Scan complete: all ${valid.length} files are unique. No duplicates detected.`)
      toast('No visual duplicates detected.', 'info')
    }
  }

  // Request delete for single file (triggers Mediagram confirmation dialog)
  const requestDelete = (item: MediaItem) => {
    if (item.deleted || item.deleting) return
    setDeleteConfirm({ items: [item] })
  }

  // Delete all extras across duplicate groups (triggers Mediagram confirmation dialog)
  const deleteExtras = () => {
    const toDelete: MediaItem[] = []
    for (const g of dupGroups) {
      const live = g.files.filter((f) => !f.deleted)
      if (live.length <= 1) continue
      for (const f of live) {
        if (f.id !== g.keepId) toDelete.push(f)
      }
    }
    if (!toDelete.length) {
      toast('No extra duplicates to delete.', 'info')
      return
    }
    setDeleteConfirm({ items: toDelete })
  }

  // Execute deletion to Recycle Bin after user confirms in dialog
  const executeDeleteConfirmed = async () => {
    if (!deleteConfirm?.items.length) return
    const targets = deleteConfirm.items
    setDeleteConfirm(null)
    for (const it of targets) it.deleting = true
    setFiles([...files])
    try {
      const res = await call<{ trashed: number, freed: number, failed: string[] }>('dedupe.trash', {
        paths: targets.map((f) => f.path),
      })
      for (const item of targets) {
        item.deleting = false
        if (!res.failed.includes(item.name)) item.deleted = true
      }
      setFreedStats((prev) => ({ count: prev.count + res.trashed, bytes: prev.bytes + res.freed }))
      setFiles([...files])
      if (res.trashed > 0) {
        toast(`Moved ${res.trashed} file(s) to Recycle Bin (freed ${fmtBytes(res.freed)}).`, 'success')
        setStatusText(`Freed ${fmtBytes(res.freed)} across ${res.trashed} duplicate file(s).`)
      } else {
        toast('Could not delete files. They may be locked by another application.', 'danger')
      }
    } catch (e) {
      for (const it of targets) it.deleting = false
      setFiles([...files])
      toast((e as Error).message, 'danger')
    }
  }

  // Filtered & sorted for library view
  const filteredLibrary = useMemo(() => {
    let list = files.filter((f) => !f.deleted)
    if (typeFilter !== 'all') list = list.filter((f) => f.kind === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((f) => f.name.toLowerCase().includes(q))
    }
    return list.sort((a, b) => {
      if (sort === 'size-desc') return b.size - a.size
      if (sort === 'size-asc') return a.size - b.size
      if (sort === 'dur-desc') return (b.duration || 0) - (a.duration || 0)
      if (sort === 'newest') return (b.mtime || 0) - (a.mtime || 0)
      return a.name.localeCompare(b.name)
    })
  }, [files, typeFilter, search, sort])

  // Count active extras
  const activeExtrasCount = useMemo(() => {
    let count = 0
    for (const g of dupGroups) {
      const live = g.files.filter((f) => !f.deleted)
      if (live.length > 1) count += live.length - 1
    }
    return count
  }, [dupGroups, files])

  // Potential reclaimable space
  const reclaimableBytes = useMemo(() => {
    let bytes = 0
    for (const g of dupGroups) {
      const live = g.files.filter((f) => !f.deleted)
      if (live.length > 1) {
        for (const f of live) {
          if (f.id !== g.keepId) bytes += f.size
        }
      }
    }
    return bytes
  }, [dupGroups, files])

  const activeCompareGroup = useMemo(() => {
    if (!compareGroupId) return null
    return dupGroups.find((g) => g.id === compareGroupId) || null
  }, [compareGroupId, dupGroups])

  // Escape key handler to return from Compare View
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && compareGroupId) {
        setCompareGroupId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compareGroupId])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-text">
      {/* Top Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-sidebar px-5 py-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary border border-primary/25 shadow-xs">
            <Sparkles size={19} />
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-tight text-text">
              Duplicate Cleaner
            </div>
            <div className="text-[11.5px] text-muted truncate max-w-xl">
              {folder ? (
                <span className="font-mono text-text-2">{folder}</span>
              ) : (
                'Find visual duplicate videos and images using perceptual fingerprinting'
              )}
            </div>
          </div>
        </div>

        {/* Source actions */}
        <div className="flex items-center gap-2">
          {folder && (
            <Button
              variant="secondary"
              onClick={clearSession}
              disabled={phase === 'scanning'}
              className="text-[12px]"
            >
              Change Folder
            </Button>
          )}
          <Button
            onClick={browseFolder}
            disabled={phase === 'scanning'}
            className="flex items-center gap-1.5 text-[12px]"
          >
            <FolderPlus size={15} />
            {folder ? 'Select Another Folder…' : 'Browse Folder…'}
          </Button>
        </div>
      </div>

      {/* IN-PAGE COMPARE VIEW (Rendered directly in page, 100% reliable back button) */}
      {activeCompareGroup ? (
        <CompareView
          group={activeCompareGroup}
          onBack={() => setCompareGroupId(null)}
          onDelete={requestDelete}
          onSetKeeper={(itemId) => {
            activeCompareGroup.keepId = itemId
            setDupGroups([...dupGroups])
          }}
        />
      ) : (
        <>
          {/* SCANNING PROGRESS BAR */}
          {phase === 'scanning' && (
            <div className="border-b border-border bg-panel px-5 py-3 shadow-inner">
              <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                <span className="text-text font-medium flex items-center gap-2">
                  <Loader2 size={15} className="animate-spin text-primary" />
                  Analyzing media frames & computing visual fingerprints…
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-muted tabular-nums font-mono text-[12px]">
                    {scanProgress.done} / {scanProgress.total} ({scanProgress.total ? Math.round((scanProgress.done / scanProgress.total) * 100) : 0}%)
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => { abortScanRef.current = true }}
                    className="text-[11px] py-0.5 px-2 h-7"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-tile border border-border/40">
                <div
                  className="h-full bg-primary transition-all duration-150"
                  style={{ width: `${scanProgress.total ? (scanProgress.done / scanProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* TOOLBAR (Only shown when scanned results exist) */}
          {phase === 'scanned' && files.length > 0 && (
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-2.5 gap-4 bg-sidebar/60">
              {/* View Mode Tabs */}
              <div className="flex items-center gap-1 rounded-lg bg-tile p-1 border border-border">
                <button
                  onClick={() => setView('duplicates')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${
                    view === 'duplicates'
                      ? 'bg-primary text-white shadow-xs font-semibold'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  Duplicates
                  <span className={`rounded-full px-1.5 py-0.2 text-[10.5px] ${
                    view === 'duplicates'
                      ? 'bg-white/25 text-white font-bold'
                      : 'bg-tile border border-border text-muted font-medium'
                  }`}>
                    {dupGroups.length}
                  </span>
                </button>
                <button
                  onClick={() => setView('library')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${
                    view === 'library'
                      ? 'bg-primary text-white shadow-xs font-semibold'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  All Media
                  <span className={`rounded-full px-1.5 py-0.2 text-[10.5px] ${
                    view === 'library'
                      ? 'bg-white/25 text-white font-bold'
                      : 'bg-tile border border-border text-muted font-medium'
                  }`}>
                    {files.filter((f) => !f.deleted).length}
                  </span>
                </button>
              </div>

              {/* Duplicates bulk delete action */}
              {view === 'duplicates' && activeExtrasCount > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-[12px] text-muted">
                    Reclaimable: <strong className="text-text">{fmtBytes(reclaimableBytes)}</strong> across {activeExtrasCount} files
                  </span>
                  <Button
                    variant="danger"
                    onClick={deleteExtras}
                    className="flex items-center gap-1.5 text-[12px]"
                  >
                    <Trash2 size={14} />
                    Delete Duplicate Extras ({activeExtrasCount})
                  </Button>
                </div>
              )}

              {/* Library filters */}
              {view === 'library' && (
                <div className="flex items-center gap-3">
                  <div className="w-56">
                    <SearchInput
                      value={search}
                      onChange={setSearch}
                      placeholder="Filter by filename…"
                    />
                  </div>

                  {/* Type chips */}
                  <div className="flex items-center gap-1 rounded-lg bg-tile p-0.5 border border-border text-[12px]">
                    {(['all', 'video', 'image'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTypeFilter(t)}
                        className={`capitalize px-2.5 py-1 rounded-md transition-colors ${
                          typeFilter === t ? 'bg-primary/20 text-primary font-semibold' : 'text-muted hover:text-text'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  {/* Sort */}
                  <Select
                    value={sort}
                    onChange={(val) => setSort(val as any)}
                    options={[
                      { value: 'size-desc', label: 'Size (Largest)' },
                      { value: 'size-asc', label: 'Size (Smallest)' },
                      { value: 'name', label: 'Name (A-Z)' },
                      { value: 'dur-desc', label: 'Duration (Longest)' },
                      { value: 'newest', label: 'Recently Modified' },
                    ]}
                  />

                  {/* Density */}
                  <div className="flex items-center gap-1 text-[11px] font-bold text-muted border border-border rounded-md p-0.5 bg-tile">
                    {(['sm', 'md', 'lg'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDensity(d)}
                        className={`size-6 rounded flex items-center justify-center uppercase transition-colors ${
                          density === d ? 'bg-primary text-white shadow-xs' : 'hover:bg-tile/80'
                        }`}
                      >
                        {d[0]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Main Content Area */}
          <div className="flex-1 overflow-auto p-5">
            {/* IDLE STATE */}
            {phase === 'idle' && (
              <div className="flex h-full flex-col items-center justify-center text-center max-w-lg mx-auto py-12">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-panel border border-border text-primary mb-4 shadow-sm">
                  <FolderSearch size={32} />
                </div>
                <h2 className="text-[18px] font-bold text-text">Select a folder to review duplicates</h2>
                <p className="text-[13px] text-muted leading-relaxed mt-2 mb-6">
                  Compare video frames and images side by side using perceptual fingerprinting.
                  Detected duplicates can be safely moved to your Windows Recycle Bin.
                </p>
                <Button onClick={browseFolder} className="flex items-center gap-2 px-5 py-2.5 text-[13px]">
                  <FolderPlus size={17} />
                  Select Folder to Scan
                </Button>
              </div>
            )}

            {/* STAGED STATE: Clean single view without duplicate banners or start-over button */}
            {phase === 'staged' && (
              <div className="space-y-4 max-w-2xl mx-auto py-12">
                <div className="rounded-2xl border border-border bg-panel p-8 shadow-sm text-center">
                  <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto mb-4 border border-primary/20">
                    <FolderSearch size={30} />
                  </div>
                  <h3 className="text-[17px] font-bold text-text mb-1.5">
                    Folder Ready for Duplicate Analysis
                  </h3>
                  <p className="text-[12.5px] text-muted font-mono break-all max-w-xl mx-auto mb-5">
                    {folder}
                  </p>
                  <div className="inline-flex items-center gap-3 bg-tile px-4 py-2 rounded-xl border border-border text-[12.5px] text-text-2 mb-7">
                    <span><strong>{files.length.toLocaleString()}</strong> media files</span>
                    <span>•</span>
                    <span>{files.filter((f) => f.kind === 'video').length} videos</span>
                    <span>•</span>
                    <span>{files.filter((f) => f.kind === 'image').length} images</span>
                    <span>•</span>
                    <span>{fmtBytes(files.reduce((a, b) => a + b.size, 0))}</span>
                  </div>
                  <div>
                    <Button onClick={startScanning} className="inline-flex items-center gap-2 px-7 py-3 text-[14px] shadow-md font-semibold">
                      <Play size={16} className="fill-current" />
                      Start Visual Duplicate Scan
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* SCANNING STATE (Skeleton / In-progress) */}
            {phase === 'scanning' && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Loader2 size={36} className="animate-spin text-primary mb-4" />
                <div className="text-[15px] font-semibold text-text">Scanning and Fingerprinting Media</div>
                <div className="text-[12.5px] text-muted mt-1 max-w-md">
                  Decoding first-frames and computing visual perceptual hashes…
                </div>
              </div>
            )}

            {/* SCANNED: DUPLICATES VIEW */}
            {phase === 'scanned' && view === 'duplicates' && (
              <div className="space-y-6">
                {dupGroups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-success/10 text-success mb-3 border border-success/20">
                      <CheckCircle2 size={32} />
                    </div>
                    <div className="text-[16px] font-bold text-text">No duplicates detected</div>
                    <div className="text-[13px] text-muted mt-1 mb-6 leading-relaxed">
                      All {files.filter((f) => !f.deleted).length} media files in this folder are visually distinct.
                    </div>
                    <div className="flex items-center gap-3">
                      <Button variant="secondary" onClick={() => setView('library')}>
                        View All Media
                      </Button>
                      <Button onClick={browseFolder}>
                        Scan Another Folder
                      </Button>
                    </div>
                  </div>
                ) : (
                  dupGroups.map((group, gIdx) => {
                    const liveFiles = group.files.filter((f) => !f.deleted)
                    const groupReclaimable = liveFiles.filter((f) => f.id !== group.keepId).reduce((a, b) => a + b.size, 0)
                    return (
                      <div
                        key={group.id}
                        className="rounded-xl border border-border bg-panel p-4 shadow-sm"
                      >
                        <div className="flex items-center justify-between border-b border-border pb-3 mb-3">
                          <div className="flex items-center gap-2">
                            <span className="flex size-6 items-center justify-center rounded-full bg-primary/20 text-primary text-[11px] font-bold">
                              {gIdx + 1}
                            </span>
                            <span className="text-[13.5px] font-bold text-text">
                              Duplicate Group ({group.files.length} copies)
                            </span>
                            {groupReclaimable > 0 && (
                              <span className="text-[11px] text-muted ml-2">
                                Reclaimable: <strong className="text-text">{fmtBytes(groupReclaimable)}</strong>
                              </span>
                            )}
                          </div>

                          <Button
                            variant="secondary"
                            onClick={() => setCompareGroupId(group.id)}
                            className="flex items-center gap-1.5 text-[11.5px] py-1 px-3 h-7"
                          >
                            <Columns2 size={13} />
                            Compare Side-by-Side
                          </Button>
                        </div>

                        {/* Cards side by side */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {group.files.map((item) => {
                            const isKeeper = item.id === group.keepId
                            const imgUrl = item.thumb || (item.kind === 'image' ? mediaUrlOf(item.path, item.size) : null)
                            return (
                              <div
                                key={item.id}
                                className={`group relative flex flex-col rounded-lg border overflow-hidden transition-all ${
                                  item.deleted
                                    ? 'border-dashed border-border/40 bg-tile/30 opacity-60'
                                    : isKeeper
                                    ? 'border-success/60 bg-tile/70 ring-1 ring-success/40 shadow-xs'
                                    : 'border-border bg-panel hover:border-primary/50 hover:shadow-md'
                                }`}
                              >
                                {/* Thumbnail area */}
                                <div
                                  onClick={() => setCompareGroupId(group.id)}
                                  className="relative aspect-video w-full cursor-pointer overflow-hidden bg-tile/50 flex items-center justify-center border-b border-border/30"
                                >
                                  {imgUrl ? (
                                    <img
                                      src={imgUrl}
                                      alt={item.name}
                                      loading="lazy"
                                      className={`size-full object-contain ${item.deleted ? 'grayscale' : ''}`}
                                    />
                                  ) : (
                                    <div className="text-muted flex flex-col items-center gap-1 text-[11px]">
                                      {item.kind === 'video' ? <Film size={22} /> : <ImageIcon size={22} />}
                                      <span>Preview</span>
                                    </div>
                                  )}

                                  {/* Badges overlay */}
                                  <div className="absolute top-2 left-2 flex items-center gap-1">
                                    {isKeeper && !item.deleted && (
                                      <span className="rounded bg-success px-1.5 py-0.5 text-[10px] font-bold text-white uppercase shadow-xs">
                                        Keep
                                      </span>
                                    )}
                                    {item.deleted && (
                                      <span className="rounded bg-danger/80 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase shadow-xs">
                                        Deleted
                                      </span>
                                    )}
                                  </div>

                                  {item.duration != null && (
                                    <div className="absolute bottom-1.5 right-1.5 rounded bg-black/75 backdrop-blur-xs px-1.5 py-0.5 text-[10.5px] font-mono text-white shadow-xs">
                                      {fmtDuration(item.duration)}
                                    </div>
                                  )}
                                </div>

                                {/* Info & action bar */}
                                <div className="flex flex-col p-2.5 text-[12px] gap-1 bg-panel">
                                  <div className={`truncate font-medium ${item.deleted ? 'line-through text-muted' : 'text-text'}`} title={item.name}>
                                    {item.name}
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] text-muted">
                                    <span>{fmtBytes(item.size)}</span>
                                    {item.width && <span>{item.width}×{item.height}</span>}
                                  </div>

                                  {/* Actions */}
                                  {!item.deleted && (
                                    <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                                      {!isKeeper ? (
                                        <button
                                          onClick={() => {
                                            group.keepId = item.id
                                            setDupGroups([...dupGroups])
                                          }}
                                          className="text-[11px] text-primary hover:underline font-medium cursor-pointer"
                                        >
                                          Keep this
                                        </button>
                                      ) : (
                                        <span className="text-[11px] text-success font-medium flex items-center gap-1">
                                          <CheckCircle2 size={12} /> Keeper
                                        </span>
                                      )}

                                      <button
                                        onClick={() => requestDelete(item)}
                                        title="Move to Recycle Bin"
                                        disabled={item.deleting}
                                        className="rounded p-1 text-muted hover:bg-danger/15 hover:text-danger transition-colors cursor-pointer"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {/* SCANNED: LIBRARY (ALL MEDIA) VIEW */}
            {phase === 'scanned' && view === 'library' && (
              <div className={`grid gap-4 ${
                density === 'sm'
                  ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
                  : density === 'lg'
                  ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
                  : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
              }`}>
                {filteredLibrary.map((item) => {
                  const imgUrl = item.thumb || (item.kind === 'image' ? mediaUrlOf(item.path, item.size) : null)
                  return (
                    <div
                      key={item.id}
                      className="group relative flex flex-col rounded-lg border border-border bg-panel overflow-hidden hover:border-primary/50 hover:shadow-md transition-all"
                    >
                      <div
                        onClick={() => setPreviewItem({
                          name: item.name,
                          path: item.path,
                          size: item.size,
                          duration: item.duration ?? undefined,
                          type: item.kind,
                        })}
                        className="relative aspect-video w-full cursor-pointer overflow-hidden bg-tile/50 flex items-center justify-center border-b border-border/30"
                      >
                        {imgUrl ? (
                          <img src={imgUrl} alt={item.name} loading="lazy" className="size-full object-contain" />
                        ) : (
                          <div className="text-muted flex flex-col items-center gap-1 text-[11px]">
                            {item.kind === 'video' ? <Film size={20} /> : <ImageIcon size={20} />}
                          </div>
                        )}
                        {item.duration != null && (
                          <div className="absolute bottom-1 right-1 rounded bg-black/75 backdrop-blur-xs px-1.5 py-0.5 text-[10px] font-mono text-white shadow-xs">
                            {fmtDuration(item.duration)}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col p-2 text-[11.5px] gap-1 bg-panel">
                        <div className="truncate font-medium text-text" title={item.name}>
                          {item.name}
                        </div>
                        <div className="flex items-center justify-between text-[10.5px] text-muted">
                          <span>{fmtBytes(item.size)}</span>
                          <button
                            onClick={() => requestDelete(item)}
                            title="Move to Recycle Bin"
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted hover:text-danger transition-opacity cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Status Bar */}
          <div className="flex shrink-0 items-center justify-between border-t border-border bg-sidebar px-5 py-2 text-[12px] text-muted">
            <span className="truncate max-w-xl">{statusText}</span>
            {files.length > 0 && (
              <span className="tabular-nums font-mono text-[11.5px]">
                {files.filter((f) => !f.deleted).length} files · {fmtBytes(files.filter((f) => !f.deleted).reduce((a, b) => a + b.size, 0))}
              </span>
            )}
          </div>
        </>
      )}

      {/* Subfolder choice dialog */}
      {subfolderPrompt?.open && (
        <Dialog
          title="Include Subfolders?"
          open={subfolderPrompt.open}
          onClose={() => setSubfolderPrompt(null)}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const target = subfolderPrompt.folder
                  setSubfolderPrompt(null)
                  startFolderStage(target, false)
                }}
              >
                Top Level Only
              </Button>
              <Button
                onClick={() => {
                  const target = subfolderPrompt.folder
                  setSubfolderPrompt(null)
                  startFolderStage(target, true)
                }}
              >
                Include Subfolders
              </Button>
            </div>
          }
        >
          <div className="text-[13px] text-muted leading-relaxed">
            The selected folder contains subdirectories. Do you want to scan files from subdirectories recursively, or only files directly in the root folder?
          </div>
        </Dialog>
      )}

      {/* Proper Delete Confirmation Dialog */}
      {deleteConfirm && (
        <Dialog
          open={Boolean(deleteConfirm)}
          onClose={() => setDeleteConfirm(null)}
          title={deleteConfirm.items.length === 1 ? 'Move File to Recycle Bin?' : 'Move Duplicates to Recycle Bin?'}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-danger/10 border border-danger/25">
              <div className="size-9 rounded-xl bg-danger/20 text-danger flex items-center justify-center shrink-0">
                <Trash2 size={18} />
              </div>
              <div className="space-y-1">
                <div className="text-[13.5px] font-semibold text-text">
                  {deleteConfirm.items.length === 1
                    ? `Move "${deleteConfirm.items[0].name}" to Recycle Bin?`
                    : `Move ${deleteConfirm.items.length} duplicate extra files to Recycle Bin?`}
                </div>
                <p className="text-[12px] text-muted leading-relaxed">
                  Total reclaimable space:{' '}
                  <strong className="text-text font-semibold">
                    {fmtBytes(deleteConfirm.items.reduce((acc, it) => acc + it.size, 0))}
                  </strong>
                  . Files will be safely moved to your system's Recycle Bin so they can be restored if needed.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="secondary"
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-1.5 text-[12.5px]"
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={executeDeleteConfirmed}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[12.5px] font-semibold"
              >
                <Trash2 size={14} />
                <span>Delete to Recycle Bin</span>
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Standard Media Preview Modal for single file viewing */}
      <MediaPreviewModal
        open={Boolean(previewItem)}
        item={previewItem ? {
          name: previewItem.name,
          path: previewItem.path,
          size: previewItem.size,
          duration: previewItem.duration,
          type: previewItem.type as any,
        } : null}
        onClose={() => setPreviewItem(null)}
      />
    </div>
  )
}

/**
 * IN-PAGE COMPARE VIEW
 * Renders directly in the document flow with zero modal overlay issues.
 * The Back button is impossible to block or misclick.
 */
function CompareView({
  group,
  onBack,
  onDelete,
  onSetKeeper,
}: {
  group: DupGroup
  onBack: () => void
  onDelete: (item: MediaItem) => void
  onSetKeeper: (itemId: string) => void
}) {
  const [speed, setSpeed] = useState<number>(1)
  const groupFiles = group.files.filter((f) => !f.deleted)

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      {/* Top Sub-Header with Prominent In-Page Back Button */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-sidebar px-5 py-2.5 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-tile border border-border text-text hover:border-primary hover:text-primary transition-colors cursor-pointer font-medium text-[12.5px] shadow-xs active:scale-95"
            title="Return to duplicate groups (Esc)"
          >
            <ArrowLeft size={15} />
            <span>Back to Duplicates</span>
          </button>
          <span className="text-[14px] font-bold text-text">
            Comparing Duplicate Group ({groupFiles.length} copies)
          </span>
        </div>

        <div className="text-[12px] text-muted">
          Review files side-by-side · Set one keeper
        </div>
      </div>

      {/* Main Compare Stage */}
      <div className="flex-1 overflow-auto p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-6xl mx-auto items-start">
          {groupFiles.map((p) => {
            const isKeeper = p.id === group.keepId
            const url = mediaUrlOf(p.path, p.size)
            return (
              <div
                key={p.id}
                className={`flex flex-col rounded-xl border bg-panel overflow-hidden shadow-sm transition-all ${
                  isKeeper ? 'border-success ring-2 ring-success/30' : 'border-border'
                }`}
              >
                {/* Header with name & keeper status */}
                <div className="flex items-center justify-between bg-tile px-4 py-2.5 border-b border-border text-[12px]">
                  <span className="truncate max-w-xs font-semibold text-text" title={p.name}>
                    {p.name}
                  </span>
                  <div className="flex items-center gap-2">
                    {isKeeper ? (
                      <span className="rounded bg-success px-2 py-0.5 text-[10px] font-bold text-white uppercase shadow-xs">
                        Keeper
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSetKeeper(p.id)}
                        className="text-primary hover:underline text-[11.5px] font-medium cursor-pointer"
                      >
                        Set as Keeper
                      </button>
                    )}
                    <span className="text-muted tabular-nums">{fmtBytes(p.size)}</span>
                  </div>
                </div>

                {/* Player / Preview Stage */}
                <div className="relative aspect-video w-full bg-black/90 flex items-center justify-center overflow-hidden">
                  {p.kind === 'video' ? (
                    <CustomVideoPlayer
                      src={url}
                      speed={speed}
                      onSpeedChange={setSpeed}
                      poster={p.thumb || undefined}
                      initialDuration={p.duration ?? undefined}
                      downloadProgress={null}
                      isCompleted={true}
                      className="size-full max-w-none min-h-0 rounded-none shadow-none"
                    />
                  ) : (
                    <img src={url} alt={p.name} className="max-h-full max-w-full rounded object-contain" />
                  )}
                </div>

                {/* Metadata & Actions Footer */}
                <div className="p-4 bg-panel space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-[12px] bg-tile/60 p-2.5 rounded-lg border border-border/50">
                    <div>
                      <span className="text-muted text-[11px] block">Dimensions</span>
                      <strong className="text-text">{p.width && p.height ? `${p.width} × ${p.height}` : 'Unknown'}</strong>
                    </div>
                    {p.duration != null && (
                      <div>
                        <span className="text-muted text-[11px] block">Duration</span>
                        <strong className="text-text">{fmtDuration(p.duration)}</strong>
                      </div>
                    )}
                    <div>
                      <span className="text-muted text-[11px] block">File Size</span>
                      <strong className="text-text">{fmtBytes(p.size)}</strong>
                    </div>
                    <div>
                      <span className="text-muted text-[11px] block">Modified</span>
                      <span className="text-text">{new Date(p.mtime).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Button
                      variant="secondary"
                      onClick={() => call('dedupe.reveal', { path: p.path })}
                      className="text-[11.5px] py-1 px-2.5 h-7"
                    >
                      Reveal in Folder
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => onDelete(p)}
                      className="text-[11.5px] py-1 px-2.5 h-7 flex items-center gap-1"
                    >
                      <Trash2 size={12} />
                      Delete to Recycle Bin
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
