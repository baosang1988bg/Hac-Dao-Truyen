import test from 'node:test'
import assert from 'node:assert/strict'
import {
  selectProgressToPush, runAuthMerge, parseServerTime, mergeFlagKey, MERGE_LIMIT,
} from '../src/utils/authMerge.js'
import {
  createLoginGate, isLoginCancelled, LOGIN_CANCELLED,
} from '../src/utils/loginGate.js'
import {
  shouldShowOneTap, countReadChapters, describeUserAgent, normalizeSessions,
  emailConfirmMatches, avatarInitial, safeAvatarUrl, googleLoginErrorMessage,
  passwordErrorMessage, friendlyAuthError, fmtServerDateTime,
  linkGoogleErrorMessage, deleteAccountErrorMessage, canSubmitDelete, isReauthRequired, errorReason,
  LINK_REQUIRED_MESSAGE, GOOGLE_CONFLICT_MESSAGE, GOOGLE_TAKEN_MESSAGE, REAUTH_GOOGLE_FAILED_MESSAGE,
} from '../src/utils/authHelpers.js'

const T = Date.parse('2026-11-27T10:00:00Z')

// ── authMerge ──────────────────────────────────────────────────────────────

test('parseServerTime đọc chuỗi SQL UTC của D1, ISO và epoch', () => {
  assert.equal(parseServerTime('2026-11-27 10:00:00'), T)
  assert.equal(parseServerTime('2026-11-27T10:00:00Z'), T)
  assert.equal(parseServerTime(T), T)
  assert.equal(parseServerTime(T / 1000), T) // epoch giây
  assert.equal(parseServerTime(''), 0)
  assert.equal(parseServerTime(null), 0)
  assert.equal(parseServerTime('rác'), 0)
})

test('selectProgressToPush: server chưa có → đẩy; local mới hơn → đẩy; server mới hơn → bỏ', () => {
  const local = [
    { slug: 'moi', chapter: '12', timestamp: T, paragraph: 3 },
    { slug: 'local-moi-hon', chapter: '20', timestamp: T },
    { slug: 'server-moi-hon', chapter: '5', timestamp: T - 3600_000 },
  ]
  const server = [
    { slug: 'local-moi-hon', chapter: 18, type: 'chapter', updated_at: '2026-11-27 09:00:00' },
    { slug: 'server-moi-hon', chapter: 9, type: 'chapter', updated_at: '2026-11-27 09:30:00' },
  ]
  const out = selectProgressToPush(local, server)
  assert.deepEqual(out.map(x => x.slug), ['moi', 'local-moi-hon'])
  assert.deepEqual(out[0].body, { type: 'chapter', chapter: 12, paragraph: 3, client_updated_at: T })
  assert.deepEqual(out[1].body, { type: 'chapter', chapter: 20, client_updated_at: T })
})

test('selectProgressToPush: bỏ chương không phải số, tiến độ EPUB, mục không có mốc khi server đã có', () => {
  const local = [
    { slug: 'file', chapter: 'Chương 1.md', timestamp: T },
    { slug: 'epub', chapter: '3', timestamp: T },
    { slug: 'cookie-cu', chapter: '7', timestamp: 0 },
    { slug: 'cookie-moi', chapter: '2', timestamp: 0 },
    { slug: 'cung-chuong', chapter: '4', timestamp: T },
  ]
  const server = [
    { slug: 'epub', chapter: null, type: 'epub', updated_at: '2026-01-01 00:00:00' },
    { slug: 'cookie-cu', chapter: 1, type: 'chapter', updated_at: '2026-01-01 00:00:00' },
    { slug: 'cung-chuong', chapter: 4, type: 'chapter', updated_at: '2026-01-01 00:00:00' },
  ]
  const out = selectProgressToPush(local, server)
  // cookie-moi: server chưa có → đẩy, nhưng không có client_updated_at (không bịa mốc)
  assert.deepEqual(out, [{ slug: 'cookie-moi', body: { type: 'chapter', chapter: 2 } }])
})

test('selectProgressToPush: tối đa 50 truyện, mới nhất trước, dedupe slug', () => {
  const local = Array.from({ length: 80 }, (_, i) => ({ slug: `s${i}`, chapter: '1', timestamp: T - i }))
  local.push({ slug: 's0', chapter: '99', timestamp: T - 1000 }) // trùng slug, cũ hơn
  const out = selectProgressToPush(local, [])
  assert.equal(out.length, MERGE_LIMIT)
  assert.equal(out[0].slug, 's0')
  assert.equal(out[0].body.chapter, 1)
  assert.equal(out.at(-1).slug, 's49')
})

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }
}

test('runAuthMerge: PUT tuần tự, lỗi từng truyện bỏ qua, đặt cờ authMerged:<id>', async () => {
  const storage = memoryStorage()
  const calls = []
  let active = 0
  const res = await runAuthMerge(7, {
    storage,
    getLocalHistory: () => [
      { slug: 'a', chapter: '3', timestamp: T },
      { slug: 'b', chapter: '4', timestamp: T - 1 },
      { slug: 'c', chapter: '5', timestamp: T - 2 },
    ],
    fetchProgress: async () => [],
    putProgress: async (slug, body) => {
      active += 1
      assert.equal(active, 1, 'không được gọi song song')
      await new Promise(r => setTimeout(r, 2))
      active -= 1
      calls.push([slug, body.chapter])
      if (slug === 'b') throw Object.assign(new Error('409'), { response: { status: 409 } })
    },
  })
  assert.deepEqual(calls, [['a', 3], ['b', 4], ['c', 5]])
  assert.deepEqual(res, { pushed: 2, failed: 1 })
  assert.ok(storage.getItem(mergeFlagKey(7)))

  // Lần 2: đã có cờ → không gọi mạng nữa.
  let fetched = false
  const again = await runAuthMerge(7, {
    storage, getLocalHistory: () => [], fetchProgress: async () => { fetched = true; return [] }, putProgress: async () => {},
  })
  assert.deepEqual(again, { skipped: true })
  assert.equal(fetched, false)
})

test('runAuthMerge: lấy tiến độ server lỗi → ném lỗi, KHÔNG đặt cờ (lần sau thử lại)', async () => {
  const storage = memoryStorage()
  await assert.rejects(runAuthMerge(9, {
    storage, getLocalHistory: () => [], fetchProgress: async () => { throw new Error('offline') }, putProgress: async () => {},
  }))
  assert.equal(storage.getItem(mergeFlagKey(9)), null)
  assert.deepEqual(await runAuthMerge(null, { storage }), { skipped: true })
})

// ── loginGate (hàng đợi requireLogin) ───────────────────────────────────────

test('loginGate: nhiều thao tác cùng chờ → 1 hộp, resolve theo thứ tự với user', async () => {
  const states = []
  const gate = createLoginGate(s => states.push(s))
  const order = []
  const p1 = gate.request('Đăng nhập để bình luận').then(u => order.push(['c', u.id]))
  const p2 = gate.request('Đăng nhập để theo dõi truyện').then(u => order.push(['f', u.id]))
  assert.deepEqual(gate.getState(), { open: true, reason: 'Đăng nhập để bình luận' })
  assert.equal(gate.pendingCount(), 2)
  assert.equal(gate.resolveAll({ id: 5 }), 2)
  await Promise.all([p1, p2])
  assert.deepEqual(order, [['c', 5], ['f', 5]])
  assert.deepEqual(gate.getState(), { open: false, reason: null })
  assert.deepEqual(states.at(-1), { open: false, reason: null })
})

test('loginGate: đóng hộp → mọi Promise reject LOGIN_CANCELLED; gọi lại mở hộp mới', async () => {
  const gate = createLoginGate()
  const p = gate.request('x')
  gate.rejectAll()
  await assert.rejects(p, err => isLoginCancelled(err) && err.code === LOGIN_CANCELLED)
  assert.equal(gate.rejectAll(), 0) // không còn ai chờ
  const p2 = gate.request(null)
  assert.deepEqual(gate.getState(), { open: true, reason: null })
  gate.resolveAll({ id: 1 })
  assert.deepEqual(await p2, { id: 1 })
  assert.equal(isLoginCancelled(new Error('khác')), false)
})

// ── authHelpers ────────────────────────────────────────────────────────────

test('shouldShowOneTap: đủ điều kiện mới hiện', () => {
  const base = { clientId: 'abc.apps.googleusercontent.com', loggedIn: false, chaptersRead: 2, dismissed: false }
  assert.equal(shouldShowOneTap(base), true)
  assert.equal(shouldShowOneTap({ ...base, clientId: '' }), false)
  assert.equal(shouldShowOneTap({ ...base, loggedIn: true }), false)
  assert.equal(shouldShowOneTap({ ...base, chaptersRead: 1 }), false)
  assert.equal(shouldShowOneTap({ ...base, dismissed: true }), false)
  assert.equal(countReadChapters([['1', '2'], ['5'], []]), 3)
})

test('describeUserAgent + normalizeSessions', () => {
  assert.equal(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'), 'Chrome · Windows')
  assert.equal(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari · iPhone')
  assert.equal(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36 Edg/131.0'), 'Edge · Windows')
  assert.equal(describeUserAgent(''), 'Thiết bị không rõ')
  const list = normalizeSessions({ sessions: [
    { id: 'aaa', created_at: '2026-11-01 00:00:00' },
    { id: 'bbb', created_at: '2026-11-20 00:00:00' },
    { id: 'ccc', created_at: '2026-10-01 00:00:00', current: true },
    { nope: 1 },
  ] })
  assert.deepEqual(list.map(s => s.id), ['ccc', 'bbb', 'aaa'])
  assert.deepEqual(normalizeSessions(null), [])
})

test('emailConfirmMatches, avatar, thông báo lỗi', () => {
  assert.equal(emailConfirmMatches('  Doc@Gia.vn ', 'doc@gia.vn'), true)
  assert.equal(emailConfirmMatches('', ''), false)
  assert.equal(emailConfirmMatches('khac@gia.vn', 'doc@gia.vn'), false)
  assert.equal(avatarInitial({ name: 'đạo hữu' }), 'Đ')
  assert.equal(avatarInitial({ email: 'x@y.z' }), 'X')
  assert.equal(avatarInitial(null), '?')
  assert.equal(safeAvatarUrl({ avatar_url: 'https://lh3.googleusercontent.com/a/x=s96-c' }), 'https://lh3.googleusercontent.com/a/x=s96-c')
  assert.equal(safeAvatarUrl({ avatar_url: 'javascript:alert(1)' }), '')
  assert.equal(safeAvatarUrl({ avatar_url: 'http://insecure/x.png' }), '')
  assert.match(googleLoginErrorMessage({ response: { status: 503 } }), /chưa bật đăng nhập Google/)
  // 503 do không tải được JWKS của Google ≠ "chưa bật" (E2E 2026-11-27)
  const jwks = googleLoginErrorMessage({ response: { status: 503, data: { reason: 'jwks_unavailable' } } })
  assert.match(jwks, /Tạm thời chưa xác minh được với Google/)
  assert.doesNotMatch(jwks, /chưa bật/)
  assert.match(googleLoginErrorMessage({ response: { status: 401 } }), /Bấm lại nút Google/)
  assert.match(passwordErrorMessage({ response: { status: 401 } }, true), /hiện tại không đúng/)
  assert.match(friendlyAuthError({ response: { status: 409 } }, 'register'), /đã được đăng ký/)
  assert.match(friendlyAuthError({}, 'login'), /Không kết nối/)
  assert.equal(fmtServerDateTime(null), '—')
  assert.match(fmtServerDateTime('2026-11-27 10:00:00'), /^\d{2}\/\d{2}\/2026 \d{2}:\d{2}$/)
})

// ── Hợp đồng sau review bảo mật: link_required / google_conflict / reauth ──

const httpErr = (status, data) => ({ response: { status, data } })

test('googleLoginErrorMessage: 409 link_required / google_conflict có thông báo riêng', () => {
  const linkMsg = googleLoginErrorMessage(httpErr(409, { reason: 'link_required' }))
  assert.equal(linkMsg, LINK_REQUIRED_MESSAGE)
  assert.match(linkMsg, /đăng nhập bằng mật khẩu, sau đó vào Tài khoản → Liên kết Google/)
  assert.equal(googleLoginErrorMessage(httpErr(409, { reason: 'google_conflict' })), GOOGLE_CONFLICT_MESSAGE)
  assert.match(googleLoginErrorMessage(httpErr(409, {})), /đăng nhập bằng mật khẩu/)
  assert.match(googleLoginErrorMessage(httpErr(429)), /quá nhiều lần/)
})

test('linkGoogleErrorMessage: google_taken / google_conflict / bad_nonce / 503 / 429', () => {
  assert.equal(linkGoogleErrorMessage(httpErr(409, { reason: 'google_taken' })), GOOGLE_TAKEN_MESSAGE)
  assert.match(linkGoogleErrorMessage(httpErr(409, { reason: 'google_conflict' })), /liên kết với một tài khoản Google khác/)
  assert.match(linkGoogleErrorMessage(httpErr(401, { reason: 'bad_nonce' })), /Bấm lại nút Google/)
  assert.match(linkGoogleErrorMessage(httpErr(401, { error: 'Unauthorized' })), /đăng nhập lại/)
  assert.match(linkGoogleErrorMessage(httpErr(503, { reason: 'jwks_unavailable' })), /Thử lại sau/)
  assert.match(linkGoogleErrorMessage(httpErr(503)), /chưa bật đăng nhập Google/)
  assert.match(linkGoogleErrorMessage(httpErr(429)), /quá nhiều lần/)
  assert.match(linkGoogleErrorMessage({ request: {} }), /Không kết nối/)
})

test('isReauthRequired / errorReason chỉ nhận 403 + reason reauth_required', () => {
  assert.equal(isReauthRequired(httpErr(403, { reason: 'reauth_required' })), true)
  assert.equal(isReauthRequired(httpErr(403, { error: 'Mật khẩu hiện tại không đúng' })), false)
  assert.equal(isReauthRequired(httpErr(401, { reason: 'reauth_required' })), false)
  assert.equal(isReauthRequired(null), false)
  assert.equal(errorReason(httpErr(409, { reason: 'link_required' })), 'link_required')
  assert.equal(errorReason(httpErr(409, { reason: 42 })), '')
})

test('passwordErrorMessage: reauth_required (chưa/đã kèm credential), 403 sai mật khẩu, 429', () => {
  const reauth = httpErr(403, { reason: 'reauth_required' })
  assert.match(passwordErrorMessage(reauth, false), /xác nhận lại bằng Google/)
  assert.equal(passwordErrorMessage(reauth, false, { withCredential: true }), REAUTH_GOOGLE_FAILED_MESSAGE)
  assert.match(passwordErrorMessage(httpErr(403, {}), true), /hiện tại không đúng/)
  assert.match(passwordErrorMessage(httpErr(429), true), /quá nhiều lần/)
})

test('deleteAccountErrorMessage: có mật khẩu / chỉ Google / 400 / 429 / 401 im lặng', () => {
  const reauth = httpErr(403, { reason: 'reauth_required' })
  assert.match(deleteAccountErrorMessage(reauth, { hasPassword: true }), /Mật khẩu hiện tại không đúng/)
  assert.match(deleteAccountErrorMessage(reauth, { hasPassword: false }), /xác nhận lại bằng Google/)
  assert.equal(deleteAccountErrorMessage(reauth, { withCredential: true }), REAUTH_GOOGLE_FAILED_MESSAGE)
  assert.match(deleteAccountErrorMessage(httpErr(400)), /không khớp/)
  assert.match(deleteAccountErrorMessage(httpErr(429)), /quá nhiều lần/)
  assert.equal(deleteAccountErrorMessage(httpErr(401)), null)
})

test('canSubmitDelete: đúng email + (có mật khẩu → bắt buộc nhập)', () => {
  const email = 'Ban@Example.com'
  assert.equal(canSubmitDelete({ typed: 'nham@example.com', email, hasPassword: false }), false)
  assert.equal(canSubmitDelete({ typed: ' ban@example.com ', email, hasPassword: false }), true)
  assert.equal(canSubmitDelete({ typed: 'ban@example.com', email, hasPassword: true, password: '' }), false)
  assert.equal(canSubmitDelete({ typed: 'ban@example.com', email, hasPassword: true, password: 'x' }), true)
})
