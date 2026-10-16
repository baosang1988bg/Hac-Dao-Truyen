import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getChapNum, chapterIdentifier, chapterUrl, findChapterIndex, chapterRequestId,
} from '../src/utils/chapters.js'
import { mergeHistoryEntry, HISTORY_LIMIT } from '../src/utils/readingHistory.js'
import { formatDocumentTitle } from '../src/hooks/useDocumentTitle.js'

test('getChapNum đọc số chương từ nhiều định dạng tiêu đề', () => {
  assert.equal(getChapNum('第12章 Khởi đầu'), '12')
  assert.equal(getChapNum('Chapter 7: x'), '7')
  assert.equal(getChapNum('Chương 30 - y'), '30')
  assert.equal(getChapNum('5. Lời mở'), '5')
  assert.equal(getChapNum('Lời tác giả'), null)
  assert.equal(getChapNum(undefined), null)
})

test('chapterIdentifier: ưu tiên số chương, fallback filename đã encode', () => {
  assert.equal(chapterIdentifier({ number: 3, title: 'Chương 9' }), '3')
  assert.equal(chapterIdentifier({ chapter_number: 4, title: 'x' }), '4')
  assert.equal(chapterIdentifier({ title: '第15章 a', filename: '015.md' }), '15')
  assert.equal(chapterIdentifier({ title: 'Lời tác giả', filename: '0001_VI.md' }), '0001_VI.md')
  assert.equal(chapterIdentifier({ title: 'Ghi chú', filename: 'ghi chú.md' }), encodeURIComponent('ghi chú.md'))
  assert.equal(chapterIdentifier(null), null)
})

test('chapterUrl và nút "Tải 10 chương" dùng cùng định danh', () => {
  const chap = { title: 'Chương 8', filename: '008_VI.md' }
  assert.equal(chapterUrl('abc', chap), '/novel/abc/read/8')
  assert.equal(chapterUrl('abc', null), '#')
  // Reader request: tham số URL (đã decode bởi router) → cùng id với chapterIdentifier
  const note = { title: 'Ghi chú', filename: 'ghi chú.md' }
  assert.equal(chapterRequestId('ghi chú.md'), chapterIdentifier(note))
  assert.equal(chapterRequestId(encodeURIComponent('ghi chú.md')), chapterIdentifier(note))
  assert.equal(chapterRequestId('12'), '12')
})

test('findChapterIndex khớp theo số hoặc filename', () => {
  const list = [
    { filename: 'a.md', title: 'Chương 1', chapter_number: 1 },
    { filename: 'b.md', title: 'Chương 2' },
    { filename: 'ghi chú.md', title: 'Ghi chú' },
  ]
  assert.equal(findChapterIndex(list, '1'), 0)
  assert.equal(findChapterIndex(list, '2'), 1)
  assert.equal(findChapterIndex(list, 'ghi chú.md'), 2)
  assert.equal(findChapterIndex(list, encodeURIComponent('ghi chú.md')), 2)
  assert.equal(findChapterIndex(list, '99'), -1)
  assert.equal(findChapterIndex(null, '1'), -1)
})

test('mergeHistoryEntry: dedupe theo slug, đưa lên đầu, giữ meta cũ, giới hạn', () => {
  let list = mergeHistoryEntry([], { slug: 'a', chapter: 1, title: 'A', cover_url: 'x.jpg', timestamp: 1 })
  list = mergeHistoryEntry(list, { slug: 'b', chapter: 2, timestamp: 2 })
  list = mergeHistoryEntry(list, { slug: 'a', chapter: 5, timestamp: 3 })
  assert.deepEqual(list.map(e => e.slug), ['a', 'b'])
  assert.equal(list[0].chapter, '5')
  assert.equal(list[0].title, 'A')
  assert.equal(list[0].cover_url, 'x.jpg')
  assert.equal(list[1].title, null)

  let big = []
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) big = mergeHistoryEntry(big, { slug: `s${i}`, chapter: 1, timestamp: i })
  assert.equal(big.length, HISTORY_LIMIT)
  assert.equal(big[0].slug, `s${HISTORY_LIMIT + 9}`)

  // Dữ liệu hỏng/cũ không làm crash
  assert.deepEqual(mergeHistoryEntry('rác', null), [])
  assert.equal(mergeHistoryEntry([null, { slug: 'z' }], { slug: 'y', chapter: 1 }).length, 2)
})

test('formatDocumentTitle ghép tên site', () => {
  assert.equal(formatDocumentTitle('Tủ truyện'), 'Tủ truyện – Hắc Đạo Truyện')
  assert.equal(formatDocumentTitle(''), 'Hắc Đạo Truyện')
})
