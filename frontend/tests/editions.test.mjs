// Nhiều bản dịch (?ban=): helper URL trong utils/chapters.js + mẫu cache của sw.js.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_EDITION_CODE, normalizeEditionCode, withEditionQuery, chapterListPath, chapterContentPath, chapterUrl,
  continueReadingUrl,
} from '../src/utils/chapters.js'
import {
  mergeHistoryEntry, findHistoryEdition, saveReadProgress, getAllHistory, getHistoryEdition,
  getStoredEdition, setStoredEdition,
} from '../src/utils/readingHistory.js'

test('normalizeEditionCode: chỉ mã hợp lệ khác mặc định', () => {
  assert.equal(DEFAULT_EDITION_CODE, 'he-thong')
  assert.equal(normalizeEditionCode('nhom-a'), 'nhom-a')
  assert.equal(normalizeEditionCode(' nhom-a '), 'nhom-a')
  for (const bad of [null, undefined, '', 'he-thong', 'Nhom-A', 'a_b', 'a'.repeat(41), '../x', 12]) {
    assert.equal(normalizeEditionCode(bad), null, String(bad))
  }
})

test('chapterUrl giữ ?ban cho bản phụ, bản mặc định không đổi URL cũ', () => {
  const ch = { chapter_number: 12, title: 'Chương 12', filename: 'c12_VI.md' }
  assert.equal(chapterUrl('demo', ch), '/novel/demo/read/12')
  assert.equal(chapterUrl('demo', ch, null), '/novel/demo/read/12')
  assert.equal(chapterUrl('demo', ch, 'he-thong'), '/novel/demo/read/12')
  assert.equal(chapterUrl('demo', ch, 'nhom-a'), '/novel/demo/read/12?ban=nhom-a')
  assert.equal(chapterUrl('demo', { filename: 'Lời tác giả.md', title: 'Lời tác giả' }, 'nhom-a'),
    `/novel/demo/read/${encodeURIComponent('Lời tác giả.md')}?ban=nhom-a`)
  assert.equal(chapterUrl('demo', null, 'nhom-a'), '#')
  assert.equal(withEditionQuery('/novel/demo/read/3?x=1', 'nhom-a'), '/novel/demo/read/3?x=1&ban=nhom-a')
  assert.equal(withEditionQuery('/novel/demo/read/3', 'rác!'), '/novel/demo/read/3')
})

test('đường dẫn API: mặc định đi route cũ, bản phụ đi /editions/:code', () => {
  assert.equal(chapterListPath('demo'), '/novels/demo/chapters')
  assert.equal(chapterListPath('demo', 'he-thong'), '/novels/demo/chapters')
  assert.equal(chapterListPath('demo', 'nhom-a'), '/novels/demo/editions/nhom-a/chapters')
  assert.equal(chapterContentPath('demo', '5', null), '/novels/demo/chapters/5')
  assert.equal(chapterContentPath('demo', '5', 'nhom-a'), '/novels/demo/editions/nhom-a/chapters/5')
})

test('sw.js: nội dung chương bản phụ dùng chung CHAPTER_CACHE, mục lục/danh sách bản dịch network-first', async () => {
  const src = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.match(src, /const CHAPTER_CACHE = 'hacdao-chapters-v1'/)
  const contentRe = /^\/api\/novels\/[^/]+\/editions\/[^/]+\/chapters\/.+/
  assert.ok(src.includes(String(contentRe).slice(1, -1)), 'có mẫu cache nội dung chương bản phụ')
  // Trích hàm isCacheableNovelApi để chạy thử.
  const fnSrc = src.match(/function isCacheableNovelApi\(pathname\) \{[\s\S]*?\n\}/)[0]
  const isCacheable = new Function('RESERVED_NOVEL_SEGMENTS', `${fnSrc}; return isCacheableNovelApi`)(new Set(['genres']))
  assert.equal(isCacheable('/api/novels/demo/editions'), true)
  assert.equal(isCacheable('/api/novels/demo/editions/nhom-a/chapters'), true)
  assert.equal(isCacheable('/api/novels/demo/chapters'), true)
  assert.equal(isCacheable('/api/novels/demo/editions/nhom-a/chapters/1'), false)
  assert.equal(isCacheable('/api/novels/genres'), false)
})

// ── "Đọc tiếp" nhớ bản dịch (readingHistory.ban + continueReadingUrl) ────────
test('continueReadingUrl: số → chapterUrl kèm ?ban; filename/EPUB giữ dạng cũ; mặc định không có ?ban', () => {
  assert.equal(continueReadingUrl('demo', '12', null), '/novel/demo/read/12')
  assert.equal(continueReadingUrl('demo', '12', 'nhom-a'), '/novel/demo/read/12?ban=nhom-a')
  assert.equal(continueReadingUrl('demo', 12, 'he-thong'), '/novel/demo/read/12')
  assert.equal(continueReadingUrl('demo', '12', 'rác!'), '/novel/demo/read/12')
  assert.equal(continueReadingUrl('demo', 'loi-tac-gia.md', 'nhom-a'), '/novel/demo/read/loi-tac-gia.md?ban=nhom-a')
  assert.equal(continueReadingUrl('demo', '', 'nhom-a'), '/novel/demo')
  assert.equal(continueReadingUrl('demo', null), '/novel/demo')
})

test('mergeHistoryEntry: lưu ban; có khoá ban=null → về mặc định; không có khoá → giữ ban cũ; dữ liệu cũ không có ban', () => {
  let list = mergeHistoryEntry([], { slug: 'a', chapter: '3', ban: 'nhom-a', timestamp: 1 })
  assert.equal(list[0].ban, 'nhom-a')
  assert.equal(findHistoryEdition(list, 'a'), 'nhom-a')
  list = mergeHistoryEntry(list, { slug: 'a', chapter: '4', timestamp: 2 })
  assert.equal(list[0].ban, 'nhom-a', 'caller không truyền ban → giữ')
  list = mergeHistoryEntry(list, { slug: 'a', chapter: '4', ban: null, timestamp: 3 })
  assert.equal('ban' in list[0], false, 'về bản mặc định → không ghi field')
  assert.equal(findHistoryEdition(list, 'a'), null)
  assert.equal('ban' in mergeHistoryEntry([], { slug: 'b', chapter: '1', ban: 'he-thong' })[0], false)
  assert.equal('ban' in mergeHistoryEntry([], { slug: 'b', chapter: '1', ban: '../x' })[0], false)
  const legacy = [{ slug: 'c', chapter: '5', title: 'T', cover_url: null, timestamp: 1 }]
  assert.equal(findHistoryEdition(legacy, 'c'), null)
  assert.equal(findHistoryEdition([{ slug: 'd', chapter: '1', ban: 'NHOM' }], 'd'), null, 'ban rác trong storage bị bỏ')
  assert.equal(findHistoryEdition(null, 'a'), null)
})

function installBrowserStubs() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: k => { store.delete(k) },
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
  const cookies = new Map()
  globalThis.document = {
    get cookie() { return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
    set cookie(str) { const [kv] = str.split(';'); const eq = kv.indexOf('='); cookies.set(kv.slice(0, eq).trim(), kv.slice(eq + 1)) },
  }
  return store
}

test('saveReadProgress + getAllHistory: mục lịch sử mang ban; hd:ban:<slug> đọc/ghi qua get/setStoredEdition', () => {
  const store = installBrowserStubs()
  saveReadProgress('demo', '7', { title: 'Demo', ban: 'nhom-a' })
  saveReadProgress('khac', '2', { title: 'Khác', ban: null })
  let hist = getAllHistory()
  assert.equal(hist.find(h => h.slug === 'demo').ban, 'nhom-a')
  assert.equal(hist.find(h => h.slug === 'khac').ban, null)
  assert.equal(getHistoryEdition('demo'), 'nhom-a')
  // Dữ liệu cũ: chỉ khoá per-slug, không có reading_history_v2 → ban null.
  store.set('last_read_chapter_cu', '9')
  store.set('last_read_time_cu', '1')
  hist = getAllHistory()
  assert.equal(hist.find(h => h.slug === 'cu').ban, null)
  assert.equal(continueReadingUrl('demo', hist.find(h => h.slug === 'demo').chapter, hist.find(h => h.slug === 'demo').ban),
    '/novel/demo/read/7?ban=nhom-a')
  // Khoá per-slug mới hơn v2 (chương khác) → không gán ban cũ cho chương mới.
  store.set('last_read_chapter_demo', '8')
  assert.equal(getAllHistory().find(h => h.slug === 'demo').ban, null)

  assert.equal(getStoredEdition('demo'), null)
  setStoredEdition('demo', 'nhom-a')
  assert.equal(store.get('hd:ban:demo'), 'nhom-a')
  assert.equal(getStoredEdition('demo'), 'nhom-a')
  setStoredEdition('demo', 'he-thong')
  assert.equal(store.has('hd:ban:demo'), false, 'bản mặc định → xoá khoá')
  store.set('hd:ban:demo', '<script>')
  assert.equal(getStoredEdition('demo'), null)
})
