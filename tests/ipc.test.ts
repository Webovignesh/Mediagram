import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { type AppEvent, fail, getSettings, openDb, putMedia, readSetting } from '../core/db.ts'
import { library, pageKey, realRoots, resolvePaths } from '../core/storage.ts'
import { createEngine } from '../core/transfers.ts'
import { createMethods, type Ctx, handleCall, id, oneOf, page, pageSize, protocolFile, q, repoUrl, shape } from '../electron/ipc.ts'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))
after(() => fs.rmSync(temp, { recursive: true, force: true }))

function fixture(tg: Partial<Ctx['tg']> = {}) {
  const paths = resolvePaths({ env: { TELEFLOW_HOME: path.join(temp, `home${Math.random()}`) }, packaged: true, appDir: path.join(temp, 'app') })
  const root = path.join(temp, `root${Math.random()}`)
  const db = openDb(':memory:')
  const events: AppEvent[] = []
  const login = { on: false, sets: [] as boolean[] }
  const fakeTg = { authState: () => ({ step: 'credentials', connection: 'offline' }), chatList: () => { throw fail(503, 'Telegram is not connected yet') },
    chat: () => null, invoke: () => Promise.reject(fail(503, 'Telegram is not connected yet')), onUpdate: () => () => {}, ...tg } as unknown as Ctx['tg']
  const settings = () => getSettings(db, root)
  const emit = (e: AppEvent) => { events.push(e) }
  const engine = createEngine({ db, invoke: fakeTg.invoke, onUpdate: fakeTg.onUpdate, auth: fakeTg.authState, chat: fakeTg.chat, emit, paths, settings, finished() {} })
  const ctx: Ctx = {
    version: '9.9.9', tdlib: '0.0.1', installedAt: 42, repository: 'git+https://example.test/team/app.git',
    licenses: [{ name: 'x', version: '1.2.3', license: 'MIT' }], paths, db, settings,
    roots: { sealed: [paths.home], guarded: [] }, emit, tg: fakeTg, engine,
    native: {
      pickFolder: async () => null, openPath: async () => '', reveal() {}, trashItem: async () => {}, cacheSize: async () => 0,
      loginItem: { get: () => login.on, set: (on) => { login.sets.push(on) } }, clearCache: async () => {}, clearStorageData: async () => {},
    },
  }
  return { ctx, methods: createMethods(ctx), db, root, paths, events, login }
}

const rendererUrl = pathToFileURL('C:\\Program Files\\TeleFlow\\resources\\app.asar\\out\\renderer\\index.html').href
const key = pageKey(rendererUrl)
const { ctx, methods } = fixture()

test('handleCall: 403 for a null sender, a sibling page, another local page (same "null" origin), and an unparsable URL', async () => {
  const otherApp = pathToFileURL('C:\\Users\\u\\Downloads\\evil\\index.html').href
  assert.equal(new URL(otherApp).origin, new URL(rendererUrl).origin) // file: origins are all "null": comparing them would accept any page
  for (const sender of [null, rendererUrl.replace('index.html', 'other.html'), otherApp, 'not a url']) {
    assert.deepEqual(await handleCall(methods, key, sender, { method: 'app.info' }), { ok: false, status: 403, error: 'Not allowed' })
  }
  assert.equal((await handleCall(methods, key, `${rendererUrl}?x=1#/queue`, { method: 'app.info' })).ok, true) // query and hash are stripped
})

test('handleCall: 404 for unknown methods, including inherited names', async () => {
  for (const method of ['nope', '__proto__', 'toString', 'constructor', 42]) {
    assert.deepEqual(await handleCall(methods, key, rendererUrl, { method }), { ok: false, status: 404, error: 'Unknown method' })
  }
})

test('handleCall: 400 names the unknown field', async () => {
  assert.deepEqual(await handleCall(methods, key, rendererUrl, { method: 'auth.get', args: { extra: 1 } }), { ok: false, status: 400, error: 'Unknown field extra' })
  assert.equal((await handleCall(methods, key, rendererUrl, { method: 'auth.get', args: [1] })).ok, false)
})

test('handleCall: app.info and auth.get answer with data from ctx (sender URL case differs)', async () => {
  const upper = rendererUrl.replace('file:///C:', 'file:///c:') + '#/login'
  assert.deepEqual(await handleCall(methods, key, upper, { method: 'app.info' }), {
    ok: true,
    data: { version: '9.9.9', tdlib: '0.0.1', installedAt: 42, home: ctx.paths.home, repository: 'https://example.test/team/app', licenses: ctx.licenses },
  })
  assert.deepEqual(await handleCall(methods, key, rendererUrl, { method: 'auth.get' }), { ok: true, data: { step: 'credentials', connection: 'offline' } })
})

test('handleCall: fail() passes through with retryAfter; anything else is a 500', async () => {
  const fake = {
    flood: { validate: () => ({}), run: () => { throw fail(429, 'Slow down', { retryAfter: 7 }) } },
    boom: { validate: () => ({}), run: () => { throw new Error('internal detail') } },
  }
  assert.deepEqual(await handleCall(fake, key, rendererUrl, { method: 'flood' }), { ok: false, status: 429, error: 'Slow down', retryAfter: 7 })
  const res = await handleCall(fake, key, rendererUrl, { method: 'boom' })
  assert.equal(res.ok === false && res.status, 500)
  assert.ok(res.ok === false && !res.error.includes('internal detail'))
})

test('common validators: defaults, ranges, enums, trimming; each 400 names the field', () => {
  const check = shape({ id, page, pageSize, q, sort: oneOf('newest', 'oldest') })
  assert.deepEqual(check({ id: -5, sort: 'oldest' }), { id: -5, page: 1, pageSize: 25, q: '', sort: 'oldest' })
  assert.equal(check({ id: 1, q: '  cats ', sort: 'newest' }).q, 'cats')
  const bad: [Record<string, unknown>, string][] = [
    [{ id: 0, sort: 'newest' }, 'id'], [{ id: 1.5, sort: 'newest' }, 'id'], [{ id: 1, page: 0, sort: 'newest' }, 'page'],
    [{ id: 1, pageSize: 101, sort: 'newest' }, 'pageSize'], [{ id: 1, q: 'x'.repeat(201), sort: 'newest' }, 'q'], [{ id: 1, sort: 'size' }, 'sort'],
  ]
  for (const [args, field] of bad) {
    assert.throws(() => check(args), (e: Error & { status?: number }) => e.status === 400 && e.message.startsWith(field + ' '))
  }
})

test('repoUrl: strips git+ and .git; only https links survive', () => {
  assert.equal(repoUrl('git+https://example.test/a/b.git'), 'https://example.test/a/b')
  assert.equal(repoUrl('git@example.test:a/b.git'), null)
  assert.equal(repoUrl(undefined), null)
})

const phase2 = ['app.info', 'app.storage', 'app.pickFolder', 'app.openPath', 'auth.get', 'auth.credentials', 'auth.phone', 'auth.code',
  'auth.password', 'auth.logout', 'chats.list', 'chats.open', 'chats.messages', 'search.global', 'library.list', 'library.missing',
  'library.open', 'library.reveal', 'library.trash', 'settings.get', 'settings.set']
const phase3 = ['app.clearCache', 'app.clearData', 'app.clearAll', 'chats.media', 'downloads.add', 'uploads.add', 'jobs.list', 'jobs.action',
  'stats.live', 'stats.overview', 'stats.activity', 'stats.chats']
const validate = (name: string, args: unknown) => (methods as Record<string, { validate(a: unknown): unknown }>)[name].validate(args)
const rejects400 = (cases: [string, unknown, string][]) => {
  for (const [name, args, field] of cases) {
    assert.throws(() => validate(name, args), (e: Error & { status?: number }) => e.status === 400 && e.message.startsWith(field), `${name} ${field}`)
  }
}

test('validators: all 33 methods are registered; the 12 Phase 3 methods accept valid args and reject bad ones naming the field', () => {
  assert.deepEqual(Object.keys(methods).sort(), [...phase2, ...phase3].sort())
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ chatId: -100, messageId: (i + 1) * 2 ** 20 }))
  const good: [string, unknown, unknown?][] = [
    ['app.clearCache', undefined, {}], ['app.clearData', {}], ['app.clearAll', { deleteDownloads: false }, { deleteDownloads: false }],
    ['chats.media', { chatId: 5 }, { chatId: 5, type: undefined, ext: undefined, duration: undefined, size: undefined, status: undefined, q: '', sort: undefined, page: 1, pageSize: 25 }],
    ['chats.media', { chatId: 5, type: 'animation', ext: ' MP4 ', duration: 'xlong', size: 'small', status: 'downloaded', q: ' cat ', sort: 'longest', page: 3, pageSize: 100 }],
    ['downloads.add', { items: items(10_000) }], ['downloads.add', { items: items(1), force: true }, { items: items(1), force: true }],
    ['downloads.add', { chatId: 5, filters: {} }], ['downloads.add', { chatId: 5, filters: { type: 'video', sort: 'oldest' } }],
    ['downloads.add', { link: ' t.me/fixture/42 ' }, { link: 't.me/fixture/42' }],
    ['uploads.add', { chatId: 5, paths: Array(500).fill('C:\\x.jpg'), caption: '', album: true, keepNames: false }],
    ['jobs.list', {}, { kind: undefined, status: undefined, q: '', page: 1, pageSize: 25 }], ['jobs.list', { kind: 'upload', status: 'open' }],
    ['jobs.list', { status: 'failed', q: '100%' }], ['jobs.action', { action: 'pause' }, { action: 'pause', ids: undefined }],
    ['jobs.action', { action: 'cancel', ids: Array.from({ length: 1000 }, (_, i) => i + 1) }], ['jobs.action', { action: 'up', ids: [7] }],
    ['jobs.action', { action: 'clear-completed' }], ['stats.live', undefined], ['stats.overview', {}],
    ['stats.activity', { range: '24h' }], ['stats.chats', { range: '30d' }],
  ]
  for (const [name, args, expected] of good) {
    const out = validate(name, args)
    if (expected !== undefined) assert.deepEqual(out, expected, name)
  }
  assert.equal((validate('chats.media', { chatId: 5, ext: ' MP4 ' }) as { ext: string }).ext, 'mp4')
  rejects400([
    ['app.clearAll', {}, 'deleteDownloads'], ['app.clearAll', { deleteDownloads: 'yes' }, 'deleteDownloads'], ['app.clearCache', { x: 1 }, 'Unknown field x'],
    ['chats.media', {}, 'chatId'], ['chats.media', { chatId: 5, type: 'voice' }, 'type'], ['chats.media', { chatId: 5, ext: '.mp4' }, 'ext'],
    ['chats.media', { chatId: 5, ext: 'x'.repeat(17) }, 'ext'], ['chats.media', { chatId: 5, duration: 'huge' }, 'duration'],
    ['chats.media', { chatId: 5, size: 'tiny' }, 'size'], ['chats.media', { chatId: 5, status: 'done' }, 'status'], ['chats.media', { chatId: 5, sort: 'size' }, 'sort'],
    ['chats.media', { chatId: 5, pageSize: 101 }, 'pageSize'],
    ['downloads.add', {}, 'items'], ['downloads.add', { items: [] }, 'items'], ['downloads.add', { items: items(10_001) }, 'items'],
    ['downloads.add', { items: [{ chatId: 1, messageId: 0 }] }, 'items[0].messageId'], ['downloads.add', { items: [{ chatId: 1, messageId: 1, x: 1 }] }, 'Unknown field items[0].x'],
    ['downloads.add', { items: [5] }, 'items[0]'], ['downloads.add', { items: items(1), force: 1 }, 'force'],
    ['downloads.add', { chatId: 0, filters: {} }, 'chatId'], ['downloads.add', { chatId: 5, filters: { type: 'gif' } }, 'filters.type'],
    ['downloads.add', { chatId: 5, filters: { page: 2 } }, 'Unknown field filters.page'], ['downloads.add', { chatId: 5, filters: [] }, 'filters'],
    ['downloads.add', { link: 'x' }, 'link'], ['downloads.add', { link: 'x'.repeat(301) }, 'link'], ['downloads.add', { link: 't.me/a/1', force: true }, 'Unknown field force'],
    ['uploads.add', { chatId: 5, paths: [], caption: '', album: true, keepNames: true }, 'paths'],
    ['uploads.add', { chatId: 5, paths: Array(501).fill('C:\\x'), caption: '', album: true, keepNames: true }, 'paths'],
    ['uploads.add', { chatId: 5, paths: ['C:\\x', ''], caption: '', album: true, keepNames: true }, 'paths[1]'],
    ['uploads.add', { chatId: 5, paths: ['C:\\x'], caption: 'x'.repeat(4097), album: true, keepNames: true }, 'caption'],
    ['uploads.add', { chatId: 5, paths: ['C:\\x'], caption: '', keepNames: true }, 'album'],
    ['uploads.add', { chatId: 5, paths: ['C:\\x'], caption: '', album: true, keepNames: 'no' }, 'keepNames'],
    ['jobs.list', { kind: 'all' }, 'kind'], ['jobs.list', { status: 'canceled' }, 'status'], ['jobs.list', { q: 'x'.repeat(201) }, 'q'],
    ['jobs.action', {}, 'action'], ['jobs.action', { action: 'delete' }, 'action'], ['jobs.action', { action: 'pause', ids: [] }, 'ids'],
    ['jobs.action', { action: 'pause', ids: Array(1001).fill(1) }, 'ids'], ['jobs.action', { action: 'retry', ids: [0] }, 'ids[0]'],
    ['jobs.action', { action: 'up' }, 'ids'], ['jobs.action', { action: 'down', ids: [1, 2] }, 'ids'],
    ['stats.activity', {}, 'range'], ['stats.chats', { range: '1y' }, 'range'], ['stats.live', { x: 1 }, 'Unknown field x'],
  ])
})

test('validators: the 21 Phase 2 methods accept valid args and reject bad ones with a 400 naming the field', () => {
  const hash = 'ABCDEF0123456789abcdef0123456789'
  const good: [string, unknown, unknown?][] = [
    ['app.pickFolder', undefined, { title: undefined }], ['app.pickFolder', { title: ' Pick ' }, { title: 'Pick' }], ['app.openPath', { target: 'logs' }],
    ['auth.credentials', { apiId: 2_147_483_647, apiHash: hash }], ['auth.phone', { phone: '+1 (234) 567-8901' }], ['auth.phone', { phone: '12345' }],
    ['auth.code', { code: ' 12345 ' }, { code: '12345' }], ['auth.code', { code: '12345678' }], ['auth.password', { password: ' pass word ' }, { password: ' pass word ' }],
    ['chats.open', { link: 'ab' }, { link: 'ab', join: false }], ['chats.open', { link: 't.me/x', join: true }],
    ['chats.messages', { chatId: -100123 }, { chatId: -100123, limit: 30 }], ['chats.messages', { chatId: 5, limit: 1000 }],
    ['search.global', { q: 'x'.repeat(300) }], ['library.list', {}, { q: '', type: undefined, chat: undefined, sort: undefined, page: 1, pageSize: 25 }],
    ['library.list', { type: 'archive', sort: 'name', chat: 'Fixture chat', page: 2, pageSize: 100 }],
    ['library.open', { path: 'Chat\\a.mp4' }], ['library.reveal', { path: 'C:\\x\\a.mp4' }], ['library.trash', { paths: Array(1000).fill('a') }],
    ['settings.set', { maxDownloads: 5, folderTemplate: '{chat}' }],
  ]
  for (const [name, args, expected] of good) {
    const out = validate(name, args)
    if (expected !== undefined) assert.deepEqual(out, expected, name)
  }
  const bad: [string, unknown, string][] = [
    ['app.pickFolder', { title: 'x'.repeat(81) }, 'title'], ['app.pickFolder', { title: 5 }, 'title'],
    ['app.openPath', { target: 'home' }, 'target'], ['app.openPath', {}, 'target'],
    ['auth.credentials', { apiId: 0, apiHash: hash }, 'apiId'], ['auth.credentials', { apiId: 2_147_483_648, apiHash: hash }, 'apiId'],
    ['auth.credentials', { apiId: '123', apiHash: hash }, 'apiId'], ['auth.credentials', { apiId: 1, apiHash: 'g'.repeat(32) }, 'apiHash'],
    ['auth.credentials', { apiId: 1, apiHash: hash.slice(1) }, 'apiHash'], ['auth.credentials', { apiId: 1, apiHash: hash + 'a' }, 'apiHash'],
    ['auth.phone', { phone: '1234' }, 'phone'], ['auth.phone', { phone: '+12a45' }, 'phone'], ['auth.phone', { phone: '+' + '1'.repeat(25) }, 'phone'],
    ['auth.code', { code: '123' }, 'code'], ['auth.code', { code: '123456789' }, 'code'], ['auth.code', { code: '12a45' }, 'code'],
    ['auth.password', { password: '' }, 'password'], ['auth.password', { password: 'x'.repeat(257) }, 'password'], ['auth.password', { password: 5 }, 'password'],
    ['chats.open', { link: 'a' }, 'link'], ['chats.open', { link: 'x'.repeat(301) }, 'link'], ['chats.open', { link: 'ab', join: 'yes' }, 'join'],
    ['chats.messages', { chatId: 0 }, 'chatId'], ['chats.messages', {}, 'chatId'], ['chats.messages', { chatId: 1, limit: 0 }, 'limit'],
    ['chats.messages', { chatId: 1, limit: 1001 }, 'limit'],
    ['search.global', { q: '' }, 'q'], ['search.global', { q: '   ' }, 'q'], ['search.global', { q: 'x'.repeat(301) }, 'q'],
    ['library.list', { type: 'photo' }, 'type'], ['library.list', { sort: 'size' }, 'sort'], ['library.list', { chat: 'x'.repeat(201) }, 'chat'],
    ['library.list', { q: 'x'.repeat(201) }, 'q'], ['library.list', { page: 0 }, 'page'], ['library.list', { pageSize: 101 }, 'pageSize'],
    ['library.open', { path: '' }, 'path'], ['library.reveal', { path: 'x'.repeat(4097) }, 'path'], ['library.open', {}, 'path'],
    ['library.trash', { paths: [] }, 'paths'], ['library.trash', { paths: Array(1001).fill('a') }, 'paths'], ['library.trash', { paths: ['ok', 5] }, 'paths[1]'],
    ['settings.set', { maxDownloads: 6 }, 'maxDownloads'], ['settings.set', { apiId: 5 }, 'apiId'],
    ...['app.info', 'app.storage', 'auth.get', 'auth.logout', 'chats.list', 'library.missing', 'settings.get'].map((m): [string, unknown, string] => [m, { x: 1 }, 'Unknown field x']),
  ]
  for (const [name, args, field] of bad) {
    assert.throws(() => validate(name, args), (e: Error & { status?: number }) => e.status === 400 && e.message.startsWith(field) && !e.message.includes(hash), `${name} ${field}`)
  }
})

test('search.global: link is null when TDLib rejects it; chats are empty while signed out; files come from the cached scan', async () => {
  const seen: string[] = []
  const f = fixture({
    linkType: async (link: string) => {
      seen.push(link)
      if (link.includes('broken')) throw fail(400, "That link isn't a chat or message link")
      return { _: 'internalLinkTypeMessage', url: link }
    },
  } as Partial<Ctx['tg']>)
  fs.mkdirSync(path.join(f.root, 'Chat'), { recursive: true })
  for (const name of ['Chat\\fixture cats.mp4', 'dogs.mp4']) fs.writeFileSync(path.join(f.root, name), 'x')
  const run = (q: string) => f.methods['search.global'].run({ q })
  assert.deepEqual(await run('cats'), { chats: [], files: [], link: null }) // nothing cached yet, and no scan is triggered
  await library(f.root)
  const r = await run('CATS')
  assert.deepEqual(r.files.map((x) => [x.path, x.chat, x.type]), [['Chat\\fixture cats.mp4', 'Chat', 'video']])
  assert.equal((await run('t.me/broken/1')).link, null)
  assert.deepEqual((await run('t.me/fixture/1')).link, { kind: 'message' })
  assert.deepEqual(seen, ['t.me/broken/1', 't.me/fixture/1']) // non-links never reach TDLib
})

test('settings.set: download root rules, folder creation, login item, and topics; nothing is written on a 400', async () => {
  const f = fixture({ chat: (chatId: number) => ({ canPost: chatId === 42 }) } as Partial<Ctx['tg']>)
  const set = (patch: object) => f.methods['settings.set'].run(f.methods['settings.set'].validate(patch))
  await assert.rejects(set({ maxDownloads: 4, downloadRoot: path.join(f.paths.home, 'media') }), { status: 400, message: /system or app data/ })
  await assert.rejects(set({ maxDownloads: 4, defaultUploadChat: 7 }), { status: 400, message: /^defaultUploadChat/ })
  assert.equal(f.ctx.settings().maxDownloads, 2)
  const next = path.join(temp, 'picked', 'TeleFlow')
  const r = await set({ downloadRoot: next, defaultUploadChat: 42, startWithSystem: true })
  assert.ok(fs.statSync(next).isDirectory())
  assert.deepEqual([r.downloadRoot, r.defaultUploadChat, r.startWithSystem], [next, 42, false]) // read back from the (fake) login item
  assert.deepEqual(f.login.sets, [true])
  assert.equal(readSetting(f.db, 'startWithSystem'), undefined)
  assert.deepEqual(f.events, [{ type: 'invalidate', topics: ['settings', 'library', 'storage'] }])
})

test('settings.set: junctions cannot lead into protected folders, either way round; nothing is created on a 400', async () => {
  const f = fixture()
  const links = path.join(temp, `links${Math.random()}`)
  const docsTarget = path.join(temp, `DocsTarget${Math.random()}`)
  for (const d of [links, docsTarget, f.paths.home]) fs.mkdirSync(d, { recursive: true })
  const knownDocs = path.join(links, 'Documents') // a known folder that is itself a junction, as app.getPath reports it
  fs.symlinkSync(docsTarget, knownDocs, 'junction')
  fs.symlinkSync(f.paths.home, path.join(links, 'home'), 'junction')
  f.ctx.roots = realRoots({ sealed: [f.paths.home], guarded: [knownDocs] }) // as main builds them
  const set = (downloadRoot: string) => f.methods['settings.set'].run(f.methods['settings.set'].validate({ downloadRoot }))
  await assert.rejects(set(docsTarget), { status: 400, message: /subfolder/ }) // picked by the junction's target
  await assert.rejects(set(knownDocs), { status: 400, message: /subfolder/ })
  await assert.rejects(set(path.join(links, 'home', 'media')), { status: 400, message: /system or app data/ }) // a junction into home
  assert.ok(!fs.existsSync(path.join(f.paths.home, 'media')))
  assert.deepEqual(f.events, [])
  const ok = path.join(knownDocs, 'TeleFlow') // a subfolder of a known folder is fine; the picked path is stored
  assert.equal((await set(ok)).downloadRoot, ok)
  assert.ok(fs.statSync(path.join(docsTarget, 'TeleFlow')).isDirectory())
})

test('library.open and app.openPath: a shell refusal is a readable 409, not a 500', async () => {
  const f = fixture()
  const refusal = 'No application is associated with the specified file for this operation.'
  f.ctx.native.openPath = async () => refusal
  fs.mkdirSync(path.join(f.root, 'Chat'), { recursive: true })
  fs.writeFileSync(path.join(f.root, 'Chat', 'a.fixture'), 'x')
  await assert.rejects(f.methods['library.open'].run({ path: 'Chat\\a.fixture' }), { status: 409, message: `Windows couldn't open a.fixture: ${refusal}` })
  await assert.rejects(f.methods['app.openPath'].run({ target: 'downloads' }), { status: 409, message: `Windows couldn't open ${path.basename(f.root)}: ${refusal}` })
})

test('protocolFile: thumb ids, saved thumbnails, and images confined to the download root', async () => {
  const f = fixture({ thumbFile: async (remoteId: string) => `X:\\cache\\${remoteId}.jpg` } as Partial<Ctx['tg']>)
  fs.mkdirSync(f.paths.thumbs, { recursive: true })
  fs.writeFileSync(path.join(f.paths.thumbs, '12.jpg'), 'x')
  fs.mkdirSync(path.join(f.root, 'Chat'), { recursive: true })
  for (const name of ['Chat\\p.jpg', 'Chat\\v.mp4']) fs.writeFileSync(path.join(f.root, name), 'x')
  const outside = path.join(temp, 'outside')
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'o.jpg'), 'x')
  fs.symlinkSync(outside, path.join(f.root, 'link'), 'junction')
  const img = (rel: string) => protocolFile(`teleflow://image/${encodeURIComponent(rel)}`, f.ctx)
  assert.equal(await protocolFile('teleflow://thumb/AgACAgIAAxk-_9', f.ctx), 'X:\\cache\\AgACAgIAAxk-_9.jpg')
  for (const bad of ['short', 'has.dot.in.it', 'x'.repeat(201)]) assert.equal(await protocolFile(`teleflow://thumb/${bad}`, f.ctx), null, bad)
  assert.equal(await protocolFile('teleflow://saved/12', f.ctx), path.join(f.paths.thumbs, '12.jpg'))
  for (const bad of ['0', '012', 'abc', '13', '..%5C12']) assert.equal(await protocolFile(`teleflow://saved/${bad}`, f.ctx), null, bad)
  assert.equal(await img('Chat\\p.jpg'), fs.realpathSync.native(path.join(f.root, 'Chat', 'p.jpg')))
  for (const bad of ['Chat\\v.mp4', 'Chat\\gone.jpg', `..\\outside\\o.jpg`, path.join(outside, 'o.jpg'), 'link\\o.jpg']) assert.equal(await img(bad), null, bad)
  assert.equal(await protocolFile('teleflow://other/x', f.ctx), null)
})

// ---- Phase 3 methods ----

const call = (f: ReturnType<typeof fixture>, name: string, args: unknown) => {
  const m = (f.methods as unknown as Record<string, { validate(a: unknown): unknown, run(a: unknown): Promise<unknown> }>)[name]
  return Promise.resolve().then(() => m.run(m.validate(args))) as Promise<any>
}

test('uploads.add: needs Telegram, a chat you can post to, a caption within captionMax, and existing files within uploadMax', async () => {
  const me = { id: 1, captionMax: 10, uploadMax: 4 }
  const chats: Record<number, object> = { 5: { id: 5, title: 'Fixture channel', canPost: true }, 6: { id: 6, title: 'Fixture read-only', canPost: false } }
  const f = fixture({ authState: () => ({ step: 'ready', connection: 'ready', me }), chat: (id: number) => chats[id] ?? null,
    mediaRights: () => ({ post: true, photos: true, videos: false }), invoke: () => new Promise(() => {}) } as unknown as Partial<Ctx['tg']>)
  const dir = path.join(temp, `up${Math.random()}`)
  fs.mkdirSync(dir)
  const file = (name: string, body: string) => { fs.writeFileSync(path.join(dir, name), body); return path.join(dir, name) }
  const [photo, clip, empty, big] = [file('a.jpg', 'abc'), file('clip.mp4', 'abcd'), file('empty.txt', ''), file('big.bin', 'abcde')]
  const add = (a: object) => call(f, 'uploads.add', { chatId: 5, caption: '', album: true, keepNames: true, ...a })
  await assert.rejects(add({ chatId: 9, paths: [photo] }), { status: 404 })
  await assert.rejects(add({ chatId: 6, paths: [photo] }), { status: 403 })
  await assert.rejects(add({ paths: [photo], caption: 'x'.repeat(11) }), { status: 400, message: /^caption/ })
  await assert.rejects(add({ paths: ['a.jpg'] }), { status: 400, message: /^paths\[0\]/ })
  await assert.rejects(add({ paths: [photo, path.join(dir, 'gone.jpg')] }), { status: 400, message: /^gone\.jpg is missing/ })
  await assert.rejects(add({ paths: [dir] }), { status: 400 }) // a folder
  await assert.rejects(add({ paths: [empty] }), { status: 400, message: /is empty/ })
  await assert.rejects(add({ paths: [big] }), { status: 413 })
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM jobs').get()!.n, 0)
  assert.deepEqual(await add({ paths: [photo, clip], caption: ' Fixture ' }), { added: 2 })
  const jobs = f.db.prepare('SELECT type, caption, files FROM jobs ORDER BY position').all()
  // Videos are not allowed in this chat, so the clip goes as a document and the two files no longer share an album.
  assert.deepEqual(jobs.map((j) => [j.type, j.caption, JSON.parse(j.files as string)[0].path]), [['photo', 'Fixture', photo], ['document', null, clip]])
  const signedOut = fixture({ chat: (id: number) => chats[id] ?? null } as unknown as Partial<Ctx['tg']>)
  await assert.rejects(call(signedOut, 'uploads.add', { chatId: 5, paths: [photo], caption: '', album: true, keepNames: true }), { status: 503 })
})

test('chats.media and downloads.add: unknown chats are 404s; filters select from the media index; chats.media starts the scan', async () => {
  const scans: number[] = []
  const f = fixture({ chat: (id: number) => (id === 5 ? { id: 5, title: 'Fixture channel', canPost: false } : null),
    ensureScan: (id: number) => { scans.push(id) }, scanInfo: () => ({ state: 'scanning', indexed: 2, total: 9 }) } as unknown as Partial<Ctx['tg']>)
  const item = (messageId: number, type: 'video' | 'photo', name: string) => ({ chatId: 5, messageId, date: messageId, type, name, ext: name.split('.')[1], size: 1, duration: 0, caption: '', thumb: null })
  putMedia(f.db, [item(1, 'video', 'v.mp4'), item(2, 'photo', 'p.jpg')])
  await assert.rejects(call(f, 'chats.media', { chatId: 6 }), { status: 404 })
  const media = await call(f, 'chats.media', { chatId: 5, type: 'video' })
  assert.deepEqual([media.items.map((i: { messageId: number }) => i.messageId), media.total, media.exts, media.scan, scans],
    [[1], 1, ['jpg', 'mp4'], { state: 'scanning', indexed: 2, total: 9 }, [5]])
  await assert.rejects(call(f, 'downloads.add', { chatId: 6, filters: {} }), { status: 404 })
  await assert.rejects(call(f, 'downloads.add', { items: [{ chatId: 6, messageId: 1 }] }), { status: 404 })
  assert.deepEqual(await call(f, 'downloads.add', { chatId: 5, filters: { type: 'photo' } }), { added: 1, skipped: 0 })
  assert.deepEqual(await call(f, 'downloads.add', { chatId: 5, filters: {} }), { added: 1, skipped: 1 }) // the photo is already queued
  assert.deepEqual((await call(f, 'jobs.list', { status: 'open' })).items.map((j: { name: string }) => j.name), ['p.jpg', 'v.mp4'])
  assert.ok(f.events.some((e) => e.type === 'invalidate' && e.topics.includes('media:5')))
})
