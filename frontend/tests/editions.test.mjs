// Nhiều bản dịch (?ban=): helper URL trong utils/chapters.js + mẫu cache của sw.js.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_EDITION_CODE, normalizeEditionCode, withEditionQuery, chapterListPath, chapterContentPath, chapterUrl,
} from '../src/utils/chapters.js'

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
