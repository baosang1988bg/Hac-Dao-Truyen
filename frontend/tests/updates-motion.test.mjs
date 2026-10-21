import test from 'node:test'
import assert from 'node:assert/strict'
import {
  vnDay, dayLabel, chapterRangeLabel, cleanChapterTitle, filterUpdates, groupByDay,
  latestUpdateMs, hasUnseenUpdates, readLastSeen, markSeen, LAST_SEEN_KEY,
} from '../src/utils/updatesFeed.js'
import { prefersReducedMotion, withViewTransition, staggerIndex, initReveal } from '../src/utils/motion.js'
import { nextHiddenState } from '../src/hooks/useHideOnScroll.js'

// 2026-10-21 10:00 giờ VN = 03:00 UTC
const NOW = Date.UTC(2026, 9, 21, 3, 0, 0)

const items = [
  { slug: 'a', title: 'Alpha', author: 'Tác giả X', day: '2026-10-21', count: 3, from_chapter: 10, to_chapter: 12, last_at: '2026-10-21T02:00:00Z', is_new_novel: false },
  { slug: 'b', title: 'Beta', author: '', day: '2026-10-21', count: 2, from_chapter: 1, to_chapter: 2, last_at: '2026-10-21T01:00:00Z', is_new_novel: true },
  { slug: 'a', title: 'Alpha', author: 'Tác giả X', day: '2026-10-20', count: 1, from_chapter: 9, to_chapter: 9, last_at: '2026-10-20T05:00:00Z', is_new_novel: false },
  { slug: 'c', title: 'Gamma', author: 'Ai đó', day: '2026-10-14', count: 5, from_chapter: 50, to_chapter: 54, last_at: '2026-10-14T05:00:00Z', is_new_novel: false },
]

test('vnDay: đổi sang ngày giờ VN (UTC+7), qua nửa đêm VN là sang ngày mới', () => {
  assert.equal(vnDay(Date.UTC(2026, 9, 20, 16, 59)), '2026-10-20')
  assert.equal(vnDay(Date.UTC(2026, 9, 20, 17, 0)), '2026-10-21')
})

test('dayLabel: Hôm nay / Hôm qua / Thứ, dd/mm; dữ liệu hỏng → rỗng', () => {
  assert.equal(dayLabel('2026-10-21', NOW), 'Hôm nay')
  assert.equal(dayLabel('2026-10-20', NOW), 'Hôm qua')
  assert.equal(dayLabel('2026-10-14', NOW), 'Thứ tư, 14/10')
  assert.equal(dayLabel('', NOW), '')
  assert.equal(dayLabel(null, NOW), '')
})

test('chapterRangeLabel: 1 chương hoặc khoảng', () => {
  assert.equal(chapterRangeLabel({ from_chapter: 9, to_chapter: 9 }), 'Chương 9')
  assert.equal(chapterRangeLabel({ from_chapter: 10, to_chapter: 12 }), 'Chương 10 – 12')
  assert.equal(chapterRangeLabel({}), '')
})

test('cleanChapterTitle: bỏ tiền tố "Chương N:" để không lặp', () => {
  assert.equal(cleanChapterTitle('Chương 12: Kiếm khí'), 'Kiếm khí')
  assert.equal(cleanChapterTitle('chương 5 - Mở đầu'), 'Mở đầu')
  assert.equal(cleanChapterTitle('Ngoại truyện'), 'Ngoại truyện')
  assert.equal(cleanChapterTitle(null), '')
})

test('filterUpdates: lọc truyện mới / đang đọc / theo từ khoá', () => {
  assert.equal(filterUpdates(items).length, 4)
  assert.deepEqual(filterUpdates(items, { filter: 'new' }).map(i => i.slug), ['b'])
  assert.deepEqual(filterUpdates(items, { filter: 'reading', readingSlugs: ['c'] }).map(i => i.slug), ['c'])
  assert.deepEqual(filterUpdates(items, { query: 'tác giả x' }).map(i => i.day), ['2026-10-21', '2026-10-20'])
  assert.deepEqual(filterUpdates(null), [])
})

test('groupByDay: gom theo ngày, giữ thứ tự, cộng số chương', () => {
  const groups = groupByDay(items, NOW)
  assert.deepEqual(groups.map(g => g.label), ['Hôm nay', 'Hôm qua', 'Thứ tư, 14/10'])
  assert.equal(groups[0].items.length, 2)
  assert.equal(groups[0].chapters, 5)
})

test('hasUnseenUpdates: so mốc đã xem với cập nhật mới nhất', () => {
  const latest = latestUpdateMs(items)
  assert.equal(latest, Date.parse('2026-10-21T02:00:00Z'))
  assert.equal(hasUnseenUpdates(items, 0), true, 'chưa từng xem → có mới')
  assert.equal(hasUnseenUpdates(items, latest), false)
  assert.equal(hasUnseenUpdates(items, latest - 1), true)
  assert.equal(hasUnseenUpdates([], 0), false)
})

test('readLastSeen / markSeen: an toàn khi storage lỗi', () => {
  const mem = new Map()
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
  assert.equal(readLastSeen(storage), 0)
  markSeen(12345, storage)
  assert.equal(mem.get(LAST_SEEN_KEY), '12345')
  assert.equal(readLastSeen(storage), 12345)
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(readLastSeen(broken), 0)
  assert.doesNotThrow(() => markSeen(1, broken))
})

test('nextHiddenState: ẩn khi cuộn xuống, hiện khi cuộn lên, bỏ qua dao động nhỏ', () => {
  assert.equal(nextHiddenState(false, 100, 200), true)
  assert.equal(nextHiddenState(true, 300, 200), false)
  assert.equal(nextHiddenState(true, 300, 296), true, 'dao động < delta giữ nguyên')
  assert.equal(nextHiddenState(true, 300, 40), false, 'gần đầu trang luôn hiện')
  assert.equal(nextHiddenState(false, NaN, 500), false)
})

test('motion: prefersReducedMotion / staggerIndex an toàn', () => {
  assert.equal(prefersReducedMotion(undefined), false)
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true)
  assert.equal(prefersReducedMotion({ matchMedia: () => { throw new Error('x') } }), false)
  assert.equal(staggerIndex(3), 3)
  assert.equal(staggerIndex(50), 8)
  assert.equal(staggerIndex(-1), 0)
  assert.equal(staggerIndex('abc'), 0)
})

test('withViewTransition: không hỗ trợ / giảm chuyển động → gọi thẳng callback', async () => {
  let n = 0
  await withViewTransition(() => { n++ }, { doc: {}, win: {} })
  assert.equal(n, 1)
  const reduce = { matchMedia: () => ({ matches: true }) }
  const doc = { startViewTransition: () => { throw new Error('không được gọi') } }
  await withViewTransition(() => { n++ }, { doc, win: reduce })
  assert.equal(n, 2)
})

test('withViewTransition: có API → chạy qua startViewTransition', async () => {
  let viaVt = false
  let n = 0
  const doc = {
    startViewTransition(cb) { viaVt = true; cb(); return { updateCallbackDone: Promise.resolve() } },
  }
  await withViewTransition(() => { n++ }, { doc, win: { matchMedia: () => ({ matches: false }) } })
  assert.equal(viaVt, true)
  assert.equal(n, 1)
})

test('initReveal: thiếu IntersectionObserver → không gắn hd-motion (nội dung hiện sẵn)', () => {
  const classes = new Set()
  const doc = { documentElement: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } }, body: {} }
  const stop = initReveal({ doc, win: {} })
  assert.equal(classes.has('hd-motion'), false)
  assert.equal(typeof stop, 'function')
})
