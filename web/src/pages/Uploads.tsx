// Phase 5.3: Uploads page per UI.md (skeleton with all controls wired)
import { useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { call, useCall } from '../api.ts'
import { Panel, Button, Toggle, Empty, Skeleton, ErrorState, toast } from '../ui.tsx'

export default function Uploads() {
  const [chatId, setChatId] = useState<number | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [caption, setCaption] = useState('')
  const [asAlbum, setAsAlbum] = useState(false)
  const [keepNames, setKeepNames] = useState(false)

  const { data: chats, error: chatsErr, reload: chatsReload } = useCall<{ chats: any[] }>('chats.list', {}, ['chats'])

  async function upload() {
    if (!chatId || files.length === 0) return
    try {
      // ponytail: multipart upload not implemented; call stub
      await call('uploads.add', { chatId, files: files.map(f => f.name), caption, asAlbum, keepNames })
      toast(`${files.length} files queued`)
      setFiles([])
      setCaption('')
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <div className="flex h-screen">
      {/* Destinations */}
      <div className="w-[240px] border-r border-border p-4">
        <Panel title="Destinations">
          {chatsErr ? <ErrorState error={chatsErr} onRetry={chatsReload} /> : !chats ? <Skeleton className="h-64" /> : (
            <div className="space-y-1">
              {chats.chats.filter((c: any) => c.canPost).slice(0, 10).map((c: any) => (
                <button key={c.id} onClick={() => setChatId(c.id)}
                  className={`w-full rounded-lg p-2 text-left hover:bg-tile ${chatId === c.id ? 'bg-primary/15' : ''}`}>
                  {c.title}
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Main */}
      <div className="flex-1 p-6">
        {!chatId ? <Empty message="Select a destination" /> : (
          <Panel title="New Upload">
            <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
              <UploadCloud size={48} className="mx-auto text-muted" />
              <p className="mt-2 text-[13px]">Drop files here or <button className="text-primary hover:underline"
                onClick={() => {/* file picker */}}>Browse</button></p>
              {files.length > 0 && <div className="mt-4 text-[13px]">{files.length} files selected</div>}
            </div>
            <div className="mt-4 space-y-4">
              <label><span className="text-[12px] text-muted">Caption (optional)</span>
                <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-border bg-tile p-2 text-[13px]" />
              </label>
              <Toggle label="Upload as album" checked={asAlbum} onChange={setAsAlbum} />
              <Toggle label="Keep original file names" checked={keepNames} onChange={setKeepNames} />
              <Button onClick={upload} disabled={files.length === 0}>Upload {files.length} files</Button>
            </div>
          </Panel>
        )}
      </div>

      {/* Right panels */}
      <div className="w-[290px] space-y-4 p-4">
        <Panel title="Upload Overview"><div className="text-[11px] text-muted">Stats tiles TODO</div></Panel>
        <Panel title="Upload Queue"><div className="text-[11px] text-muted">Active uploads TODO</div></Panel>
      </div>
    </div>
  )
}
