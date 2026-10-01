import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { fail } from '../core/db.ts'
import { pageKey, resolvePaths } from '../core/storage.ts'
import { createMethods, handleCall, id, oneOf, page, pageSize, q, repoUrl, shape, type Ctx } from '../electron/ipc.ts'

const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
const repo = 'C:\\src\\teleflow'

test('resolvePaths: TELEFLOW_HOME wins over packaged and dev defaults', () => {
  for (const packaged of [true, false]) {
    assert.equal(resolvePaths({ env: { ...env, TELEFLOW_HOME: 'D:\\tf-home' }, packaged, appDir: repo }).home, 'D:\\tf-home')
  }
})

test('resolvePaths: packaged uses %LOCALAPPDATA%\\TeleFlow, dev uses TeleFlow-dev', () => {
  assert.equal(resolvePaths({ env, packaged: true, appDir: 'C:\\Users\\u\\AppData\\Local\\Programs\\TeleFlow' }).home, 'C:\\Users\\u\\AppData\\Local\\TeleFlow')
  assert.equal(resolvePaths({ env, packaged: false, appDir: repo }).home, 'C:\\Users\\u\\AppData\\Local\\TeleFlow-dev')
})

test('resolvePaths: home inside or equal to appDir throws (any case)', () => {
  for (const home of ['C:\\src\\teleflow\\data', 'c:\\SRC\\TeleFlow', 'C:\\src\\teleflow']) {
    assert.throws(() => resolvePaths({ env: { ...env, TELEFLOW_HOME: home }, packaged: false, appDir: repo }), /inside its own folder/)
  }
  // A sibling whose name starts like the app folder is fine.
  assert.equal(resolvePaths({ env: { ...env, TELEFLOW_HOME: 'C:\\src\\teleflow-data' }, packaged: false, appDir: repo }).home, 'C:\\src\\teleflow-data')
})

test('pageKey: drive-letter case and hash are ignored; sibling pages differ', () => {
  const index = pathToFileURL('c:\\x\\out\\renderer\\index.html').href
  assert.equal(pageKey('file:///C:/X/out/renderer/index.html#/queue'), pageKey(index))
  assert.notEqual(pageKey('file:///C:/X/out/renderer/other.html'), pageKey(index))
})

test('pageKey: dev URLs compare as lowercased hrefs; an encoded slash throws', () => {
  assert.equal(pageKey('http://localhost:5173/#/a'), pageKey('http://localhost:5173'))
  assert.throws(() => pageKey('file:///C:/x/out%2Frenderer/index.html'))
})

const rendererUrl = pathToFileURL('C:\\Program Files\\TeleFlow\\resources\\app.asar\\out\\renderer\\index.html').href
const key = pageKey(rendererUrl)
const ctx: Ctx = {
  version: '9.9.9', tdlib: '0.0.1', installedAt: 42, home: 'C:\\tmp\\home',
  repository: 'git+https://example.test/team/app.git', licenses: [{ name: 'x', version: '1.2.3', license: 'MIT' }],
  auth: () => ({ step: 'credentials', connection: 'offline' }),
}
const methods = createMethods(ctx)

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
    data: { version: '9.9.9', tdlib: '0.0.1', installedAt: 42, home: 'C:\\tmp\\home', repository: 'https://example.test/team/app', licenses: ctx.licenses },
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
