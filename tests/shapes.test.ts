import assert from 'node:assert/strict'
import { test } from 'node:test'
import tdl from 'tdl'
import type * as Td from 'tdlib-types'
import {
  type Cache, extractMedia, folderOf, isTelegramLink, linkKind, mapAuth, mapConnection, maskPhone, normalizeLink,
  parseFloodWait, rights, tdError, toChat, toMe,
} from '../core/shapes.ts'

const as = <T>(x: unknown) => x as T
const me = toMe(as<Td.user>({ id: 100, first_name: 'Fixture', last_name: 'User', phone_number: '19995550123', is_premium: false }), 2048)

test('mapAuth: every TDLib state, incl. the five TeleFlow cannot complete', () => {
  const s = (_: string, extra = {}) => as<Td.AuthorizationState>({ _, ...extra })
  assert.deepEqual(mapAuth(null, null), { step: 'starting' })
  assert.deepEqual(mapAuth(s('authorizationStateWaitTdlibParameters'), null), { step: 'starting' })
  assert.deepEqual(mapAuth(s('authorizationStateWaitPhoneNumber'), null), { step: 'phone' })
  const via = { authenticationCodeTypeTelegramMessage: 'telegram', authenticationCodeTypeSms: 'sms', authenticationCodeTypeSmsWord: 'sms',
    authenticationCodeTypeSmsPhrase: 'sms', authenticationCodeTypeCall: 'call', authenticationCodeTypeFlashCall: 'other', authenticationCodeTypeFragment: 'other' }
  for (const [type, expected] of Object.entries(via)) {
    assert.deepEqual(mapAuth(s('authorizationStateWaitCode', { code_info: { phone_number: '1 999 555', type: { _: type } } }), null), { step: 'code', phone: '+1999555', via: expected })
  }
  assert.deepEqual(mapAuth(s('authorizationStateWaitPassword', { password_hint: 'fixture hint' }), null), { step: 'password', hint: 'fixture hint' })
  assert.deepEqual(mapAuth(s('authorizationStateReady'), null), { step: 'starting' }) // until getMe answers
  assert.deepEqual(mapAuth(s('authorizationStateReady'), me), { step: 'ready', me })
  for (const t of ['LoggingOut', 'Closing', 'Closed']) assert.deepEqual(mapAuth(s(`authorizationState${t}`), me), { step: 'logging-out' })
  const unsupported = { WaitEmailAddress: 'email setup', WaitEmailCode: 'email setup', WaitRegistration: 'account registration',
    WaitOtherDeviceConfirmation: 'confirmation on another device', WaitPremiumPurchase: 'Telegram Premium' }
  for (const [t, need] of Object.entries(unsupported)) {
    const r = mapAuth(s(`authorizationState${t}`), null)
    assert.equal(r.step, 'phone')
    assert.ok(r.step === 'phone' && r.error?.startsWith(`Telegram needs ${need} for this number`), t)
  }
})

test('mapConnection: the five TDLib connection states', () => {
  const cases = { connectionStateReady: 'ready', connectionStateUpdating: 'updating', connectionStateConnecting: 'connecting',
    connectionStateConnectingToProxy: 'connecting', connectionStateWaitingForNetwork: 'offline' }
  for (const [_, expected] of Object.entries(cases)) assert.equal(mapConnection(as<Td.ConnectionState>({ _ })), expected)
})

test('parseFloodWait: FLOOD_WAIT_n, FLOOD_PREMIUM_WAIT_n, retry after n', () => {
  assert.equal(parseFloodWait('FLOOD_WAIT_17'), 17)
  assert.equal(parseFloodWait('FLOOD_PREMIUM_WAIT_5'), 5)
  assert.equal(parseFloodWait('Too Many Requests: retry after 42'), 42)
  assert.equal(parseFloodWait('PHONE_CODE_INVALID'), null)
})

test('tdError: TDLib codes map to statuses with readable messages; closed clients are 503; bugs pass through', () => {
  const cases: [number, string, number, string?][] = [
    [400, 'PHONE_CODE_INVALID', 400, 'That code is wrong. Check it and try again.'], [406, 'SOMETHING', 400],
    [401, 'Unauthorized', 403], [403, 'CHAT_WRITE_FORBIDDEN', 403, "You can't post in this chat."], [404, 'Not Found', 404],
    [500, 'Request aborted', 503, 'Telegram was interrupted before answering. Try again.'],
  ]
  for (const [code, message, status, text] of cases) {
    const e = tdError(new tdl.TDLibError(code, message)) as Error & { status: number }
    assert.equal(e.status, status, message)
    assert.equal(e.message, text ?? message)
  }
  assert.deepEqual({ ...tdError(new tdl.TDLibError(429, 'Too Many Requests: retry after 9')) as object }, { status: 429, retryAfter: 9 })
  assert.equal((tdError(new tdl.TDLibError(420, 'FLOOD_WAIT_3')) as { retryAfter: number }).retryAfter, 3)
  assert.equal((tdError(new Error('A closed client cannot be reused, create a new client')) as { status: number }).status, 503)
  const bug = new TypeError('x is undefined')
  assert.equal(tdError(bug), bug)
})

const file = (id: number, size: number, remote = `remote-${id}`) => ({ _: 'file', id, size, expected_size: size * 2, remote: { id: remote }, local: {} })
const thumb = (format: string, id: number) => ({ format: { _: format }, file: file(id, 1) })
const msg = (content: object) => as<Td.message>({ id: 5 * 2 ** 20, date: 1, content })
const caption = { caption: { text: 'fixture caption' } }

test('extractMedia: the seven media types, default names, thumbnail formats, largest photo', () => {
  const pick = (m: Td.message) => { const x = extractMedia(m); return x && [x.type, x.name, x.ext, x.size, x.duration, x.thumb, x.file.id, x.caption] }
  assert.deepEqual(pick(msg({ _: 'messageVideo', video: { video: file(1, 10), file_name: '', duration: 61, thumbnail: thumb('thumbnailFormatJpeg', 2) }, ...caption })),
    ['video', 'Video_5.mp4', 'mp4', 10, 61, 'remote-2', 1, 'fixture caption'])
  assert.deepEqual(pick(msg({ _: 'messageVideo', video: { video: file(1, 0), file_name: 'Clip.MKV', duration: 3, thumbnail: thumb('thumbnailFormatMpeg4', 2) }, ...caption }))?.slice(1, 6),
    ['Clip.MKV', 'mkv', 0, 3, null]) // file_name wins; size falls back to expected_size (0 * 2); Mpeg4 thumbs can't render
  const sizes = [{ type: 's', width: 90, height: 90, photo: file(3, 1) }, { type: 'm', width: 320, height: 320, photo: file(4, 2) }, { type: 'y', width: 1280, height: 960, photo: file(5, 9) }]
  assert.deepEqual(pick(msg({ _: 'messagePhoto', photo: { sizes }, ...caption })), ['photo', 'Photo_5.jpg', 'jpg', 9, 0, 'remote-4', 5, 'fixture caption'])
  assert.equal(extractMedia(msg({ _: 'messagePhoto', photo: { sizes: [sizes[2], sizes[0]] }, ...caption }))?.thumb, 'remote-3') // no `m`: smallest
  assert.equal(extractMedia(msg({ _: 'messagePhoto', photo: { sizes: [] }, ...caption })), null)
  assert.deepEqual(pick(msg({ _: 'messageDocument', document: { document: file(6, 4), file_name: '', mime_type: 'application/pdf', thumbnail: thumb('thumbnailFormatWebp', 7) }, ...caption }))?.slice(0, 6),
    ['document', 'File_5.pdf', 'pdf', 4, 0, 'remote-7'])
  assert.deepEqual(pick(msg({ _: 'messageDocument', document: { document: file(6, 4), file_name: '', mime_type: 'application/x-fixture' }, ...caption }))?.slice(1, 3), ['File_5', ''])
  assert.deepEqual(pick(msg({ _: 'messageAudio', audio: { audio: file(8, 4), file_name: '', duration: 200, album_cover_thumbnail: thumb('thumbnailFormatPng', 9) }, ...caption }))?.slice(0, 6),
    ['audio', 'Audio_5.mp3', 'mp3', 4, 200, 'remote-9'])
  assert.deepEqual(pick(msg({ _: 'messageAnimation', animation: { animation: file(10, 4), file_name: '', duration: 2, thumbnail: thumb('thumbnailFormatGif', 11) }, ...caption }))?.slice(0, 6),
    ['animation', 'Animation_5.mp4', 'mp4', 4, 2, 'remote-11'])
  assert.deepEqual(pick(msg({ _: 'messageVoiceNote', voice_note: { voice: file(12, 4), duration: 9 }, ...caption }))?.slice(0, 6),
    ['voice', 'Voice_5.ogg', 'ogg', 4, 9, null])
  assert.deepEqual(pick(msg({ _: 'messageVideoNote', video_note: { video: file(13, 4), duration: 8, thumbnail: thumb('thumbnailFormatWebm', 14) } })),
    ['video_note', 'VideoNote_5.mp4', 'mp4', 4, 8, null, 13, ''])
  for (const _ of ['messageText', 'messageSticker']) assert.equal(extractMedia(msg({ _ })), null)
})

test('isTelegramLink, normalizeLink, linkKind', () => {
  for (const q of ['t.me/x', 'https://t.me/c/1/2', 'http://telegram.me/joinchat/abc', 'telegram.dog/x', 'tg://resolve?domain=x', ' www.t.me/x ']) assert.ok(isTelegramLink(q), q)
  for (const q of ['cats', 'https://example.test/t.me/x', 'nott.me/x', '@fixture_chan']) assert.ok(!isTelegramLink(q), q)
  assert.equal(normalizeLink('@fixture_chan'), 'https://t.me/fixture_chan')
  assert.equal(normalizeLink(' fixture_chan '), 'https://t.me/fixture_chan')
  assert.equal(normalizeLink('t.me/fixture_chan/5'), 'https://t.me/fixture_chan/5')
  assert.equal(normalizeLink('https://t.me/+AbCd'), 'https://t.me/+AbCd')
  const kind = (_: string) => linkKind(as<Td.InternalLinkType>({ _ }))
  assert.deepEqual([kind('internalLinkTypeMessage'), kind('internalLinkTypePublicChat'), kind('internalLinkTypeChatInvite'), kind('internalLinkTypeSettings')],
    [{ kind: 'message' }, { kind: 'chat' }, { kind: 'invite' }, null])
})

test('maskPhone and toMe: only the last four digits stay; upload limit follows Premium', () => {
  assert.equal(maskPhone('12345674567'), '+•• ••• ••45 67')
  assert.equal(maskPhone('+1 (234) 567-8901'), '+•• ••• ••89 01')
  assert.equal(maskPhone('4567'), '+45 67')
  assert.deepEqual(me, { id: 100, name: 'Fixture User', firstName: 'Fixture', username: null, phone: '+•• ••• ••01 23', photo: null, premium: false, captionMax: 2048, uploadMax: 2_097_152_000 })
  const premium = toMe(as<Td.user>({ id: 1, first_name: 'P', last_name: '', phone_number: '1', is_premium: true, usernames: { active_usernames: ['fixture_handle'] }, profile_photo: { small: { remote: { id: 'avatar-1' } } } }), 1)
  assert.deepEqual([premium.name, premium.username, premium.photo, premium.uploadMax], ['P', 'fixture_handle', 'avatar-1', 4_194_304_000])
})

const perms = (documents: boolean, photos: boolean, videos: boolean) => ({ can_send_documents: documents, can_send_photos: photos, can_send_videos: videos })
const admin = (post: boolean) => ({ _: 'chatMemberStatusAdministrator', rights: { can_post_messages: post } })
const cache: Cache = {
  meId: 100,
  users: new Map([[100, as<Td.user>({ id: 100 })], [200, as<Td.user>({ id: 200, usernames: { active_usernames: ['fixture_friend'] } })]]),
  basicGroups: new Map([[10, as<Td.basicGroup>({ status: { _: 'chatMemberStatusMember' } })], [11, as<Td.basicGroup>({ status: admin(false) })]]),
  supergroups: new Map(([
    [20, { is_channel: true, status: { _: 'chatMemberStatusCreator' }, usernames: { active_usernames: ['fixture_news'] } }],
    [21, { is_channel: true, status: admin(false) }], [22, { is_channel: true, status: admin(true) }],
    [23, { status: { _: 'chatMemberStatusRestricted', is_member: true, permissions: perms(false, true, false) } }],
    [24, { status: { _: 'chatMemberStatusLeft' } }],
  ] as [number, object][]).map(([k, v]) => [k, as<Td.supergroup>(v)])),
}
const chatOf = (id: number, type: object, extra = {}) => as<Td.chat>({ id, title: `Chat ${id}`, type, permissions: perms(true, false, true),
  positions: [], chat_lists: [], unread_count: 0, ...extra })
const view = (c: Td.chat) => { const x = toChat(c, cache); return x && [x.kind, x.title, x.username, x.canPost, Object.values(rights(c, cache))] }

test('toChat and rights: kind, Saved Messages, username, canPost, and upload media rights', () => {
  const sg = (id: number, is_channel = false) => ({ _: 'chatTypeSupergroup', supergroup_id: id, is_channel })
  assert.deepEqual(view(chatOf(100, { _: 'chatTypePrivate', user_id: 100 })), ['saved', 'Saved Messages', null, true, [true, true, true]])
  assert.deepEqual(view(chatOf(200, { _: 'chatTypePrivate', user_id: 200 })), ['private', 'Chat 200', 'fixture_friend', true, [true, false, true]])
  assert.deepEqual(view(chatOf(201, { _: 'chatTypePrivate', user_id: 201 }, { permissions: perms(false, false, false) })), ['private', 'Chat 201', null, false, [false, false, false]])
  assert.deepEqual(view(chatOf(-10, { _: 'chatTypeBasicGroup', basic_group_id: 10 })), ['group', 'Chat -10', null, true, [true, false, true]]) // chat permissions
  assert.deepEqual(view(chatOf(-11, { _: 'chatTypeBasicGroup', basic_group_id: 11 })), ['group', 'Chat -11', null, true, [true, true, true]])
  assert.deepEqual(view(chatOf(-20, sg(20, true))), ['channel', 'Chat -20', 'fixture_news', true, [true, true, true]])
  assert.deepEqual(view(chatOf(-21, sg(21, true)))?.[3], false) // admin without can_post_messages
  assert.deepEqual(view(chatOf(-22, sg(22, true)))?.[3], true)
  assert.deepEqual(view(chatOf(-23, sg(23))), ['group', 'Chat -23', null, false, [false, true, false]]) // restricted permissions
  assert.deepEqual(view(chatOf(-24, sg(24)))?.[3], false) // left
  assert.equal(toChat(chatOf(-99, { _: 'chatTypeSecret', secret_chat_id: 1, user_id: 200 }), cache), null)
  const c = toChat(chatOf(-10, { _: 'chatTypeBasicGroup', basic_group_id: 10 }, {
    photo: { small: { remote: { id: 'photo-10' } } }, unread_count: 3, last_message: { date: 1234 },
    positions: [{ list: { _: 'chatListMain' }, order: '9' }, { list: { _: 'chatListFolder', chat_folder_id: 3 }, order: '1' }],
    chat_lists: [{ _: 'chatListFolder', chat_folder_id: 3 }, { _: 'chatListFolder', chat_folder_id: 4 }],
  }), cache)
  assert.deepEqual([c?.photo, c?.unread, c?.lastDate, c?.folders], ['photo-10', 3, 1234, [3, 4]])
})

test('folderOf: chatFolderInfo.name is a chatFolderName object', () => {
  assert.deepEqual(folderOf(as<Td.chatFolderInfo>({ id: 3, name: { text: { text: 'Fixture folder' } } })), { id: 3, name: 'Fixture folder' })
})
