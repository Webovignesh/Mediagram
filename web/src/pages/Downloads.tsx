// Phase 5.2: Downloads page per UI.md (skeleton with all controls wired)
import { useState } from 'react'
import { Search, Plus, FileText } from 'lucide-react'
import { call, useCall, navigate } from '../api.ts'
import { Panel, SearchInput, Chip, Select, Button, Avatar, Pill, Progress, Pagination, Empty, Skeleton, ErrorState, fmtBytes, fmtAgo, fmtDuration, toast } from '../ui.tsx'

export default function Downloads() {
  const [chatId, setChatId] = useState<number | null>(null)
  const [view, setView] = useState<'files' | 'chat'>('files')
  const [q, setQ] = useState('')
  
  const { data: chats, error: chatsErr, reload: chatsReload } = useCall<{ chats: any[], folders: any[] }>('chats.list', {}, ['chats'])
  const { data: media, error: mediaErr, reload: mediaReload } = useCall<{ media: any[], total: number }>(
    'chats.media', chatId ? { chatId, view: 'files', q } : null, ['scan']
  )

  async function downloadSelected(messageIds: number[]) {
    try {
      const res = await call<{ added: number, skipped: number }>('downloads.add', { chatId, messageIds })
      toast(`Added ${res.added}, skipped ${res.skipped}`)
      // ponytail: no selection state persistence; clear after download
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <div className="flex h-screen">
      {/* Chat list */}
      <div className="w-[240px] border-r border-border">
        <Panel title="Chats & Channels" action={<Button variant="secondary" onClick={() => {/* OpenChatDialog */}}><Plus size={14} /></Button>}>
          <SearchInput placeholder="Search chats..." value={q} onChange={setQ} />
          <div className="mt-2 flex gap-2">
            <Chip label="All" active={true} onClick={() => {}} />
            <Chip label="Channels" active={false} onClick={() => {}} />
            <Chip label="Groups" active={false} onClick={() => {}} />
          </div>
          {chatsErr ? <ErrorState error={chatsErr} onRetry={chatsReload} /> : !chats ? <Skeleton className="h-64" /> : chats.chats.length === 0 ? (
            <Empty message="No chats" action={{ label: 'Connect Channel', onClick: () => {} }} />
          ) : (
            <div className="mt-2 space-y-1">
              {chats.chats.slice(0, 10).map((c: any) => (
                <button key={c.id} onClick={() => setChatId(c.id)} 
                  className={`flex w-full items-center gap-2 rounded-lg p-2 hover:bg-tile ${chatId === c.id ? 'bg-primary/15' : ''}`}>
                  <Avatar src={c.photo} name={c.title} size={32} />
                  <div className="flex-1 text-left"><div className="text-[13px]">{c.title}</div></div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Main */}
      <div className="flex-1 p-6">
        {!chatId ? <Empty message="Select a chat" /> : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-2">
                <Button variant={view === 'files' ? 'primary' : 'secondary'} onClick={() => setView('files')}>Files View</Button>
                <Button variant={view === 'chat' ? 'primary' : 'secondary'} onClick={() => setView('chat')}>Chat View</Button>
              </div>
              <SearchInput placeholder="Search files..." value={q} onChange={setQ} />
            </div>
            {mediaErr ? <ErrorState error={mediaErr} onRetry={mediaReload} /> : !media ? <Skeleton className="h-96" /> : media.media.length === 0 ? (
              <Empty message="No media in this chat" />
            ) : (
              <div>
                <div className="mb-2 text-[13px] text-muted">{media.total} files</div>
                <Button onClick={() => downloadSelected(media.media.map((m: any) => m.messageId))}>Download All</Button>
                {/* ponytail: table with filters, selection, pagination deferred; skeleton shows structure */}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right panels */}
      <div className="w-[290px] space-y-4 p-4">
        <Panel title="Download Overview"><div className="text-[11px] text-muted">Stats tiles TODO</div></Panel>
        <Panel title="Transfer Queue"><div className="text-[11px] text-muted">Active jobs TODO</div></Panel>
      </div>
    </div>
  )
}
