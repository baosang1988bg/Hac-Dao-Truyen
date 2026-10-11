import test from 'node:test'
import assert from 'node:assert/strict'
import { fmtTimeAgo, fmtChapterDate, isRecentChapter } from '../src/utils/format.js'
import { isNovelCompleted } from '../src/utils/novelStatus.js'
import { getCatalogChapterNumber, normalizeChapterCatalog } from '../src/utils/chapters.js'

const NOW = Date.parse('2026-09-17T00:00:00Z')

test('fmtTimeAgo accepts seconds, milliseconds and SQL/ISO dates', () => {
  assert.equal(fmtTimeAgo(NOW / 1000 - 45, NOW), 'vừa xong')
  assert.equal(fmtTimeAgo(NOW - 5 * 60 * 1000, NOW), '5 phút trước')
  assert.equal(fmtTimeAgo('2026-09-16 22:00:00', NOW), '2 giờ trước')
  assert.equal(fmtTimeAgo('2026-09-15T00:00:00Z', NOW), '2 ngày trước')
  assert.equal(fmtTimeAgo('not-a-date', NOW), '')
})

test('fmtChapterDate formats recent chapters as relative and older chapters as DD/MM/YYYY', () => {
  assert.equal(fmtChapterDate(NOW - 3600 * 1000, NOW), '1 giờ trước')
  assert.equal(fmtChapterDate(NOW - 3 * 86400 * 1000, NOW), '3 ngày trước')
  // 10 ngày trước: 2026-09-07
  assert.equal(fmtChapterDate(NOW - 10 * 86400 * 1000, NOW), '07/09/2026')
  assert.equal(fmtChapterDate(null, NOW), '')
})

test('isRecentChapter detects chapters within threshold', () => {
  assert.equal(isRecentChapter(NOW - 2 * 3600 * 1000, 72, NOW), true)
  assert.equal(isRecentChapter(NOW - 71 * 3600 * 1000, 72, NOW), true)
  assert.equal(isRecentChapter(NOW - 73 * 3600 * 1000, 72, NOW), false)
  assert.equal(isRecentChapter(null, 72, NOW), false)
})

test('explicit novel status wins over inconsistent chapter counts', () => {
  assert.equal(isNovelCompleted({ status: 'ongoing', chapter_count: 1669, total_chapters: 1513 }), false)
  assert.equal(isNovelCompleted({ status: 'completed', chapter_count: 3, total_chapters: 10 }), true)
  assert.equal(isNovelCompleted({ chapter_count: 10, total_chapters: 10 }), true)
  assert.equal(isNovelCompleted({ chapter_count: 9, total_chapters: 10 }), false)
})

test('chapter catalog keeps one canonical row per number and puts notes last', () => {
  const catalog = normalizeChapterCatalog([
    { filename: 'foreign-zero.md', title: 'Gián điệp thê thảm', chapter_number: 0 },
    { filename: 'Tình báo bịa đặt -1.md', title: 'Tình báo bịa đặt -1', chapter_number: 1 },
    { filename: '0001_chuong-1.md', title: 'Chương 1: Khởi đầu', chapter_number: 1 },
    { filename: '0002_chuong-2.md', title: 'Chương 2: Tiếp tục', chapter_number: '2' },
    { filename: 'loi-tac-gia.md', title: 'Lời tác giả', chapter_number: null },
    { filename: '0002_chuong-2.md', title: 'Bản trùng filename', chapter_number: 2 },
  ])

  assert.deepEqual(catalog.map(chapter => chapter.filename), [
    '0001_chuong-1.md',
    '0002_chuong-2.md',
    'foreign-zero.md',
    'loi-tac-gia.md',
  ])
  assert.deepEqual(catalog.map(getCatalogChapterNumber), [1, 2, null, null])
})
