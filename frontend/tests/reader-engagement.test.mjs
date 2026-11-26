import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createReadTracker, normalizeMinSeconds, contentScrollRatio, readViewKey,
} from '../src/utils/readTracking.js'
import { mergeReplacementRules, applyReplacements } from '../src/utils/readerReplacements.js'
import {
  buildPrefs, fitPrefsSize, prefsByteSize, mergeReplacementLists, applyRemoteReaderSettings,
  syncableReaderSettings, createPrefsSync, PREFS_MAX_BYTES,
} from '../src/utils/userPrefsSync.js'
import {
  mergeHistoryEntry, setHistoryParagraph, findHistoryParagraph,
} from '../src/utils/readingHistory.js'

// ── readTracking ─────────────────────────────────────────────────────────────
function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

test('readTracking: chưa start thì không tính giờ, không báo', () => {
  const c = clock()
  const tr = createReadTracker({ now: c.now })
  tr.setScrollRatio(1)
  c.advance(60_000)
  assert.equal(tr.elapsedMs(), 0)
  assert.equal(tr.shouldReport(), false)
})

test('readTracking: cần đủ 30 giây HIỂN THỊ và cuộn ≥ 80%', () => {
  const c = clock()
  const tr = createReadTracker({ now: c.now })
  tr.start(true)
  c.advance(29_000)
  tr.setScrollRatio(0.9)
  assert.equal(tr.shouldReport(), false, 'mới 29 giây')
  c.advance(1_000)
  assert.equal(tr.shouldReport(), true)
  tr.markReported()
  assert.equal(tr.shouldReport(), false, 'chỉ báo 1 lần')
})

test('readTracking: tab ẩn thì dừng đồng hồ, hiện lại thì chạy tiếp', () => {
  const c = clock()
  const tr = createReadTracker({ now: c.now, minSeconds: 30 })
  tr.start(true)
  tr.setScrollRatio(1)
  c.advance(10_000)
  tr.setVisible(false)
  c.advance(120_000) // ẩn 2 phút — không tính
  assert.equal(tr.elapsedMs(), 10_000)
  assert.equal(tr.shouldReport(), false)
  tr.setVisible(true)
  c.advance(19_999)
  assert.equal(tr.shouldReport(), false)
  c.advance(1)
  assert.equal(tr.shouldReport(), true)
})

test('readTracking: bắt đầu khi tab đang ẩn → chưa tính tới khi hiện', () => {
  const c = clock()
  const tr = createReadTracker({ now: c.now, requireScroll: false })
  tr.start(false)
  c.advance(60_000)
  assert.equal(tr.elapsedMs(), 0)
  tr.setVisible(true)
  c.advance(30_000)
  assert.equal(tr.shouldReport(), true)
})

test('readTracking: chưa cuộn đủ thì không báo; tỉ lệ giữ giá trị lớn nhất', () => {
  const c = clock()
  const tr = createReadTracker({ now: c.now })
  tr.start(true)
  c.advance(100_000)
  tr.setScrollRatio(0.5)
  assert.equal(tr.shouldReport(), false)
  tr.setScrollRatio(0.85)
  tr.setScrollRatio(0.1) // cuộn lên lại
  assert.equal(tr.scrolledEnough, true)
  assert.equal(tr.shouldReport(), true)
})

test('readTracking: requireScroll=false (EPUB) chỉ cần thời gian; min_seconds từ server', () => {
  const c = clock()
  const tr = createReadTracker({ now: c.now, requireScroll: false })
  tr.setMinSeconds(10)
  tr.start(true)
  c.advance(10_000)
  assert.equal(tr.shouldReport(), true)
})

test('normalizeMinSeconds / contentScrollRatio / readViewKey', () => {
  assert.equal(normalizeMinSeconds(undefined), 30)
  assert.equal(normalizeMinSeconds('abc'), 30)
  assert.equal(normalizeMinSeconds(1), 5)
  assert.equal(normalizeMinSeconds(99999), 600)
  assert.equal(normalizeMinSeconds(45), 45)
  // khối nội dung cao 2000px, đỉnh ở 100px, màn hình 800px → đã thấy 700/2000
  assert.equal(contentScrollRatio(100, 2000, 800), 0.35)
  // chương ngắn vừa màn hình → 1
  assert.equal(contentScrollRatio(50, 400, 800), 1)
  assert.equal(contentScrollRatio(0, 0, 800), 0)
  assert.equal(contentScrollRatio(NaN, 100, 800), 0)
  assert.equal(readViewKey('abc', 12), 'realread_abc:12')
  assert.equal(readViewKey('abc', '0001_VI.md'), 'realread_abc:0001_VI.md')
})

// ── mergeReplacementRules ────────────────────────────────────────────────────
test('mergeReplacementRules: công khai trước, cá nhân sau; trùng from → cá nhân thắng', () => {
  const pub = [{ from: 'Lạc Lông Vũ', to: 'Lạc Vũ' }, { from: 'Diệp Phàm', to: 'Diệp Phàm (công khai)' }]
  const mine = [{ id: 'r1', from: 'diệp phàm', to: 'Diệp Phàm (của tôi)', createdAt: 1 }]
  const merged = mergeReplacementRules(pub, mine)
  assert.deepEqual(merged.map(r => r.to), ['Lạc Vũ', 'Diệp Phàm (của tôi)'])
  assert.equal(applyReplacements('Lạc Lông Vũ gặp diệp phàm', merged), 'Lạc Vũ gặp Diệp Phàm (của tôi)')
})

test('mergeReplacementRules: bỏ quy tắc hỏng, trùng lặp công khai; input không phải mảng', () => {
  const pub = [null, { from: '', to: 'x' }, { from: 'A', to: 1 }, { from: 'B', to: 'b1' }, { from: 'b', to: 'b2' }]
  assert.deepEqual(mergeReplacementRules(pub, null), [{ from: 'B', to: 'b1' }])
  assert.deepEqual(mergeReplacementRules(undefined, undefined), [])
  assert.deepEqual(mergeReplacementRules([], [{ from: 'X', to: 'Y' }]), [{ from: 'X', to: 'Y' }])
})

// ── userPrefsSync (phần thuần) ───────────────────────────────────────────────
test('buildPrefs: sanitize cài đặt, bỏ ttsVoice, gọn quy tắc, slug sắp xếp', () => {
  const prefs = buildPrefs(
    { fontSize: 999, theme: 'dark', ttsVoice: 'Giọng máy A', junk: 1 },
    {
      zeta: [{ id: '1', from: ' A ', to: 'B ', createdAt: 5 }],
      alpha: [{ id: '2', from: 'C', to: 'D', createdAt: 1, updatedAt: 9 }, { from: '', to: 'x' }],
      empty: [],
    },
  )
  assert.equal(prefs.v, 1)
  assert.equal(prefs.reader.theme, 'dark')
  assert.equal(prefs.reader.fontSize, 21, 'fontSize sai → mặc định')
  assert.equal('ttsVoice' in prefs.reader, false)
  assert.equal('junk' in prefs.reader, false)
  assert.deepEqual(Object.keys(prefs.replacements), ['alpha', 'zeta'])
  assert.deepEqual(prefs.replacements.alpha, [{ from: 'C', to: 'D', updatedAt: 9 }])
  assert.deepEqual(prefs.replacements.zeta, [{ from: 'A', to: 'B', updatedAt: 5 }])
})

test('fitPrefsSize: vượt 40 KB → bỏ truyện có quy tắc cũ nhất trước', () => {
  const big = (n, t) => Array.from({ length: n }, (_, i) => ({ from: `Từ gốc dài số ${i} ${'x'.repeat(40)}`, to: `Bản dịch ${i} ${'ý'.repeat(40)}`, updatedAt: t }))
  const prefs = buildPrefs({}, { old: big(150, 100), mid: big(150, 200), newest: big(20, 300) })
  assert.ok(prefsByteSize(prefs) >= PREFS_MAX_BYTES, 'dữ liệu thử phải vượt ngưỡng')
  const fitted = fitPrefsSize(prefs)
  assert.ok(prefsByteSize(fitted) < PREFS_MAX_BYTES)
  assert.equal('old' in fitted.replacements, false, 'truyện cũ nhất bị bỏ')
  assert.ok('newest' in fitted.replacements, 'truyện mới nhất còn')
  assert.ok('old' in prefs.replacements, 'không sửa input')
  // Nhỏ sẵn → giữ nguyên
  const small = buildPrefs({}, { a: [{ from: 'x', to: 'y', createdAt: 1 }] })
  assert.deepEqual(fitPrefsSize(small), small)
})

test('mergeReplacementLists: updatedAt mới hơn thắng, thêm quy tắc mới từ server', () => {
  const local = [
    { id: 'l1', from: 'A', to: 'a-local', createdAt: 100 },
    { id: 'l2', from: 'B', to: 'b-local', createdAt: 100, updatedAt: 500 },
  ]
  const remote = [
    { from: 'a', to: 'a-remote', updatedAt: 200 },
    { from: 'B', to: 'b-remote', updatedAt: 300 },
    { from: 'C', to: 'c-remote', updatedAt: 400 },
  ]
  const merged = mergeReplacementLists(local, remote, 0, 999)
  assert.equal(merged.length, 3)
  assert.equal(merged[0].id, 'l1')
  assert.equal(merged[0].to, 'a-remote')
  assert.equal(merged[0].updatedAt, 200)
  assert.equal(merged[1].to, 'b-local', 'local mới hơn → giữ')
  assert.equal(merged[2].from, 'C')
  assert.equal(merged[2].createdAt, 400)
  assert.ok(typeof merged[2].id === 'string' && merged[2].id)
})

test('mergeReplacementLists: quy tắc đã đồng bộ mà server không còn → coi là đã xoá; quy tắc mới chưa đẩy → giữ', () => {
  const local = [
    { id: 'old', from: 'X', to: 'x', createdAt: 100 }, // trước mốc đồng bộ 150
    { id: 'new', from: 'Y', to: 'y', createdAt: 200 }, // sau mốc → chưa kịp đẩy
  ]
  const merged = mergeReplacementLists(local, [], 150)
  assert.deepEqual(merged.map(r => r.id), ['new'])
  // Chưa từng đồng bộ (mốc 0) → không xoá gì
  assert.equal(mergeReplacementLists(local, [], 0).length, 2)
})

test('applyRemoteReaderSettings: áp server qua sanitize, giữ ttsVoice của máy', () => {
  const out = applyRemoteReaderSettings(
    { theme: 'sepia', fontSize: 20, ttsVoice: 'Máy này' },
    { theme: 'green', fontSize: 'x', ttsVoice: 'Máy khác', lineHeight: 2 },
  )
  assert.equal(out.theme, 'green')
  assert.equal(out.fontSize, 20, 'giá trị server hỏng → giữ local')
  assert.equal(out.lineHeight, 2)
  assert.equal(out.ttsVoice, 'Máy này')
  assert.equal('ttsVoice' in syncableReaderSettings(out), false)
})

// ── createPrefsSync (luồng kéo/đẩy với hàm giả) ─────────────────────────────
function fakeEnv({ loggedIn = true, remote = null, mark = 0, local } = {}) {
  const store = new Map()
  if (mark) store.set('prefsSyncedAt:user:1', String(mark))
  const state = {
    reader: local?.reader || { theme: 'sepia' },
    reps: local?.reps || {},
    saved: [],
    events: [],
    timers: [],
    t: 10_000,
  }
  const sync = createPrefsSync({
    fetchUserPrefs: async () => remote,
    saveUserPrefs: async (prefs, ts) => { state.saved.push({ prefs, ts }); return true },
    isLoggedIn: () => loggedIn,
    getIdentityNamespace: () => 'user:1',
    readLocal: () => ({ reader: state.reader, replacementsBySlug: state.reps }),
    applyReader: (r) => { state.reader = r },
    applyReplacements: (slug, list) => { state.reps = { ...state.reps, [slug]: list } },
    storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    now: () => state.t,
    setTimeout: (fn) => { state.timers.push(fn); return state.timers.length },
    clearTimeout: () => {},
  })
  sync.subscribe(e => state.events.push(e))
  return { sync, state, store }
}

test('createPrefsSync: chưa đăng nhập → không gọi mạng', async () => {
  const { sync, state } = fakeEnv({ loggedIn: false, remote: { prefs: { v: 1, reader: { theme: 'dark' } }, client_updated_at: 9e12 } })
  await sync.start()
  sync.schedulePush()
  assert.equal(state.timers.length, 0)
  assert.equal(state.reader.theme, 'sepia', 'không kéo prefs')
  assert.equal(await sync.pushNow(), false)
  assert.equal(state.saved.length, 0)
})

test('createPrefsSync: server mới hơn mốc local → áp cài đặt + gộp quy tắc + lưu mốc', async () => {
  const { sync, state, store } = fakeEnv({
    mark: 100,
    remote: {
      prefs: { v: 1, reader: { theme: 'dark', fontSize: 24 }, replacements: { truyen: [{ from: 'A', to: 'B', updatedAt: 500 }] } },
      client_updated_at: 600,
    },
  })
  await sync.start()
  assert.equal(state.reader.theme, 'dark')
  assert.equal(state.reader.fontSize, 24)
  assert.equal(state.reps.truyen[0].to, 'B')
  assert.equal(store.get('prefsSyncedAt:user:1'), '600')
  assert.deepEqual(state.events.map(e => e.type), ['reader', 'replacements'])
})

test('createPrefsSync: server cũ hơn mốc local → không áp; đẩy khi local khác server', async () => {
  const { sync, state, store } = fakeEnv({
    mark: 900,
    local: { reader: { theme: 'blue' } },
    remote: { prefs: { v: 1, reader: { theme: 'dark' }, replacements: {} }, client_updated_at: 600 },
  })
  await sync.start()
  assert.equal(state.reader.theme, 'blue')
  sync.schedulePush()
  assert.equal(state.timers.length, 1)
  await sync.pushNow()
  assert.equal(state.saved.length, 1)
  assert.equal(state.saved[0].prefs.reader.theme, 'blue')
  assert.equal(store.get('prefsSyncedAt:user:1'), String(state.t))
  // Không đổi gì nữa → không ghi lại
  await sync.pushNow()
  assert.equal(state.saved.length, 1)
})

// ── Tín hiệu xoá quy tắc qua mảng rỗng ───────────────────────────────────────
test('buildPrefs: truyện đã đồng bộ mà hết quy tắc → giữ [] (tín hiệu xoá); chưa đồng bộ → bỏ', () => {
  const prefs = buildPrefs({}, { a: [], b: [{ from: 'X', to: 'Y', createdAt: 1 }] }, ['a', 'gone'])
  assert.deepEqual(Object.keys(prefs.replacements), ['a', 'b', 'gone'])
  assert.deepEqual(prefs.replacements.a, [])
  assert.deepEqual(prefs.replacements.gone, [], 'khoá localStorage đã bị xoá vẫn gửi []')
  assert.equal('c' in buildPrefs({}, { c: [] }, []).replacements, false)
})

test('fitPrefsSize: không cắt mảng rỗng (tín hiệu xoá) khi phải bỏ bớt truyện', () => {
  const big = (n, t) => Array.from({ length: n }, (_, i) => ({ from: `Từ gốc dài số ${i} ${'x'.repeat(40)}`, to: `Bản dịch ${i} ${'ý'.repeat(40)}`, updatedAt: t }))
  const prefs = buildPrefs({}, { old: big(150, 100), mid: big(150, 200), newest: big(20, 300) }, ['deleted'])
  const fitted = fitPrefsSize(prefs)
  assert.ok(prefsByteSize(fitted) < PREFS_MAX_BYTES)
  assert.deepEqual(fitted.replacements.deleted, [], 'mảng rỗng còn nguyên')
  assert.equal('old' in fitted.replacements, false)
})

test('createPrefsSync: remote [] → xoá quy tắc local cũ hơn mốc, giữ quy tắc mới chưa đẩy', async () => {
  const { sync, state } = fakeEnv({
    mark: 100,
    local: { reps: { truyen: [
      { id: 'cu', from: 'A', to: 'a', createdAt: 50 },
      { id: 'moi', from: 'B', to: 'b', createdAt: 150 },
    ] } },
    remote: { prefs: { v: 1, reader: {}, replacements: { truyen: [] } }, client_updated_at: 600 },
  })
  await sync.start()
  assert.deepEqual(state.reps.truyen.map(r => r.id), ['moi'])
  assert.deepEqual(state.events.find(e => e.type === 'replacements')?.slugs, ['truyen'])
})

test('createPrefsSync: xoá hết quy tắc sau khi đã đồng bộ → lần đẩy gửi [] (không để quy tắc sống lại)', async () => {
  const { sync, state, store } = fakeEnv({
    remote: { prefs: { v: 1, reader: {}, replacements: { truyen: [{ from: 'A', to: 'B', updatedAt: 500 }] } }, client_updated_at: 600 },
  })
  await sync.start()
  assert.equal(state.reps.truyen.length, 1)
  assert.equal(store.get('prefsSyncedSlugs:user:1'), JSON.stringify(['truyen']))
  // Người đọc xoá quy tắc cuối cùng (writeReplacements([]) xoá luôn khoá localStorage).
  state.reps = {}
  await sync.pushNow()
  assert.equal(state.saved.length, 1)
  assert.deepEqual(state.saved[0].prefs.replacements, { truyen: [] })
})

test('createPrefsSync: dùng client_updated_at server trả về làm mốc đồng bộ; ghi nhận slug đã đẩy', async () => {
  const store = new Map()
  const saved = []
  const sync = createPrefsSync({
    fetchUserPrefs: async () => null,
    saveUserPrefs: async (prefs, ts) => { saved.push(ts); return { ok: true, client_updated_at: 4242 } },
    isLoggedIn: () => true,
    getIdentityNamespace: () => 'user:1',
    readLocal: () => ({ reader: {}, replacementsBySlug: { t: [{ from: 'A', to: 'B', createdAt: 1 }], rong: [] } }),
    applyReader: () => {},
    applyReplacements: () => {},
    storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    now: () => 9_999_999,
    setTimeout: () => 0,
    clearTimeout: () => {},
  })
  assert.equal(await sync.pushNow(), true)
  assert.deepEqual(saved, [9_999_999])
  assert.equal(store.get('prefsSyncedAt:user:1'), '4242', 'mốc server, không phải đồng hồ máy')
  assert.equal(store.get('prefsSyncedSlugs:user:1'), JSON.stringify(['t']), 'slug rỗng chưa từng đồng bộ → không ghi')
})

// ── readingHistory: field paragraph ──────────────────────────────────────────
test('mergeHistoryEntry: lưu paragraph; cùng chương không kèm paragraph → giữ; đổi chương → bỏ', () => {
  let list = mergeHistoryEntry([], { slug: 'a', chapter: '12', paragraph: 34, timestamp: 1 })
  assert.equal(list[0].paragraph, 34)
  list = mergeHistoryEntry(list, { slug: 'a', chapter: 12, timestamp: 2 })
  assert.equal(list[0].paragraph, 34, 'mở lại cùng chương')
  list = mergeHistoryEntry(list, { slug: 'a', chapter: 13, timestamp: 3 })
  assert.equal('paragraph' in list[0], false, 'sang chương khác')
  // Dữ liệu cũ (không có paragraph) vẫn hợp lệ, không thêm khoá thừa
  const legacy = mergeHistoryEntry([{ slug: 'b', chapter: '5', title: 'T', cover_url: null, timestamp: 1 }], { slug: 'b', chapter: '5', timestamp: 2 })
  assert.equal('paragraph' in legacy[0], false)
  // paragraph sai kiểu bị bỏ
  assert.equal('paragraph' in mergeHistoryEntry([], { slug: 'c', chapter: '1', paragraph: -1 })[0], false)
  assert.equal('paragraph' in mergeHistoryEntry([], { slug: 'c', chapter: '1', paragraph: 1.5 })[0], false)
})

test('setHistoryParagraph / findHistoryParagraph chỉ áp đúng chương đang lưu', () => {
  const list = [{ slug: 'a', chapter: '12', timestamp: 1 }, { slug: 'b', chapter: '3', timestamp: 1 }]
  const next = setHistoryParagraph(list, 'a', 12, 7)
  assert.notEqual(next, list)
  assert.equal(next[0].paragraph, 7)
  assert.equal(list[0].paragraph, undefined, 'không sửa input')
  assert.equal(setHistoryParagraph(next, 'a', '13', 9), next, 'chương khác → không đổi')
  assert.equal(setHistoryParagraph(next, 'zzz', '1', 9), next, 'slug chưa có → không tạo mới')
  assert.equal(setHistoryParagraph(next, 'a', '12', 7), next, 'giống cũ → giữ tham chiếu')
  assert.equal(findHistoryParagraph(next, 'a', '12'), 7)
  assert.equal(findHistoryParagraph(next, 'a', 13), null)
  assert.equal(findHistoryParagraph(next, 'b', '3'), null)
  assert.equal(findHistoryParagraph(null, 'a', '12'), null)
})
