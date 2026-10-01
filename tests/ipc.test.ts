import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { type AppEvent, fail, getSettings, openDb, readSetting } from '../core/db.ts'
import { library, pageKey, resolvePaths } from '../core/storage.ts'
import { createMethods, type Ctx, handleCall, id, oneOf, page, pageSize, protocolFile, q, repoUrl, shape } from '../electron/ipc.ts'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teleflow-'))
after(() => fs.rmSync(temp, { recursive: true, force: true }))

function fixture(tg: Partial<Ctx['tg']> = {}) {
  const paths = resolvePaths({ env: { TELEFLOW_HOME: path.join(temp, `home${Math.random()}`) }, packaged: true, appDir: path.join(temp, 'app') })
  const root = path.join(temp, `root${Math.random()}`)
  const db = openDb(':memory:')
  const events: AppEvent[] = []
  const login = { on: false, sets: [] as boolean[] }
  const ctx: Ctx = {
    version: '9.9.9', tdlib: '0.0.1', installedAt: 42, repository: 'git+https://example.test/team/app.git',
    licenses: [{ name: 'x', version: '1.2.3', license: 'MIT' }], paths, db, settings: () => getSettings(db, root),
    roots: { sealed: [paths.home], guarded: [] }, emit: (e) => events.push(e),
    tg: { authState: () => ({ step: 'credentials', connection: 'offline' }), chatList: () => { throw fail(503, 'Telegram is not connected yet') }, chat: () => null, ...tg } as Ctx['tg'],
    native: {
      pickFolder: async () => null, openPath: async () => '', reveal() {}, trashItem: async () => {}, cacheSize: async () => 0,
      loginItem: { get: () => login.on, set: (on) => { login.sets.push(on) } },
    },
  }
  return { ctx, methods: createMethods(ctx), db, root, paths, events, login }
}

const rendererUrl = pathToFileURL('C:\\Program Files\\TeleFlow\\resources\\app.asar\\out\\renderer\\index.html').href
const key = pageKey(rendererUrl)
const { ctx, methods } = fixture()

test('handleCall: 403 for a null sender, a sibling page, and an unparsable URL', async () => {
  for (const sender of [null, rendererUrl.replace('index.html', 'other.html'), 'not a url']) {
    assert.deepEqual(await handleCall(methods, key, sender, { method: 'app.info' }), { ok: false, status: 403, error: 'Not allowed' })
  }
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
const validate = (name: string, args: unknown) => (methods as Record<string, { validate(a: unknown): unknown }>)[name].validate(args)

test('validators: the 21 Phase 2 methods accept valid args and reject bad ones with a 400 naming the field', () => {
  assert.deepEqual(Object.keys(methods).sort(), [...phase2].sort())
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
