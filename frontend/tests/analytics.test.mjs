import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isTrackingAllowed, sanitizeParams, pageTypeOf, parseNovelHref, isAdminPath,
  createChapterTracker, bumpCompletedCount, trackEvent,
  COMPLETE_MIN_ACTIVE_MS,
} from '../src/utils/analytics.js'

test('isTrackingAllowed: DNT / GPC / opt-out đều chặn đo', () => {
  assert.equal(isTrackingAllowed({}), true)
  assert.equal(isTrackingAllowed({ doNotTrack: '1' }), false)
  assert.equal(isTrackingAllowed({ doNotTrack: 'unspecified' }), true)
  assert.equal(isTrackingAllowed({ globalPrivacyControl: true }), false)
  assert.equal(isTrackingAllowed({ optOut: true }), false)
})

test('sanitizeParams: bỏ rỗng/NaN/object, boolean → yes/no, cắt chuỗi 100 ký tự', () => {
  const out = sanitizeParams({
    a: undefined, b: null, c: NaN, d: { x: 1 }, e: true, f: false, g: 'x'.repeat(150), h: 3,
  })
  assert.deepEqual(Object.keys(out), ['e', 'f', 'g', 'h'])
  assert.equal(out.e, 'yes')
  assert.equal(out.f, 'no')
  assert.equal(out.g.length, 100)
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, i]))
  assert.equal(Object.keys(sanitizeParams(many)).length, 25)
})

test('pageTypeOf gộp URL theo loại trang', () => {
  assert.equal(pageTypeOf('/'), 'home')
  assert.equal(pageTypeOf('/novel/abc'), 'novel')
  assert.equal(pageTypeOf('/novel/abc/read/12'), 'reader')
  assert.equal(pageTypeOf('/novel/abc/epub-reader'), 'epub_reader')
  assert.equal(pageTypeOf('/library?x=1'), 'library')
  assert.equal(pageTypeOf('/cap-nhat'), 'updates')
  assert.equal(pageTypeOf('/khac'), 'other')
})

test('parseNovelHref nhận diện truyện / chương / EPUB', () => {
  assert.deepEqual(parseNovelHref('/novel/xich-tam'), { content_type: 'novel', novel_slug: 'xich-tam', chapter_number: undefined })
  assert.deepEqual(parseNovelHref('/novel/xich-tam/read/42'), { content_type: 'chapter', novel_slug: 'xich-tam', chapter_number: 42 })
  assert.equal(parseNovelHref('/novel/xich-tam/read/note_1').chapter_number, undefined)
  assert.equal(parseNovelHref('/novel/xich-tam/epub-reader').content_type, 'epub')
  assert.equal(parseNovelHref('/account'), null)
})

test('isAdminPath', () => {
  assert.equal(isAdminPath('/admin/novels'), true)
  assert.equal(isAdminPath('/login'), true)
  assert.equal(isAdminPath('/novel/x'), false)
})

test('trackEvent an toàn ngoài trình duyệt (không ném lỗi, trả false)', () => {
  assert.equal(trackEvent('x', { a: 1 }), false)
})

function fakeClock() {
  let t = 0
  return { now: () => t, advance: (ms) => { t += ms } }
}

test('chapter tracker: start, mốc 25/50/75 mỗi mốc 1 lần', () => {
  const clock = fakeClock()
  const events = []
  const tr = createChapterTracker({ base: { novel_slug: 's' }, emit: (n, p) => events.push([n, p]), now: clock.now })
  tr.progress(0.3) // trước start → bỏ qua
  assert.equal(events.length, 0)
  tr.start()
  tr.start() // idempotent
  tr.progress(0.3)
  tr.progress(0.2) // lùi lại không bắn lại
  tr.progress(0.8)
  const names = events.map(([n, p]) => (p.percent ? `${n}:${p.percent}` : n))
  assert.deepEqual(names, ['chapter_start', 'chapter_progress:25', 'chapter_progress:50', 'chapter_progress:75'])
})

test('chapter tracker: lướt nhanh tới cuối KHÔNG tính hoàn thành; đủ thời gian thì tính 1 lần', () => {
  const clock = fakeClock()
  const events = []
  let completes = 0
  const tr = createChapterTracker({ emit: (n, p) => events.push([n, p]), now: clock.now, onComplete: () => { completes += 1 } })
  tr.start()
  clock.advance(3000)
  tr.progress(1)
  assert.equal(events.filter(([n]) => n === 'chapter_complete').length, 0)
  clock.advance(COMPLETE_MIN_ACTIVE_MS)
  tr.tick()
  tr.tick()
  const done = events.filter(([n]) => n === 'chapter_complete')
  assert.equal(done.length, 1)
  assert.equal(done[0][1].read_time_sec, 18)
  assert.equal(completes, 1)
  assert.equal(tr.end().completed, true)
})

test('chapter tracker: thời gian tab ẩn không được tính', () => {
  const clock = fakeClock()
  const events = []
  const tr = createChapterTracker({ emit: (n, p) => events.push([n, p]), now: clock.now })
  tr.start()
  clock.advance(5000)
  tr.setVisible(false)
  clock.advance(60_000) // bỏ tab đi làm việc khác
  tr.progress(0.95)
  assert.equal(events.some(([n]) => n === 'chapter_complete'), false)
  tr.setVisible(true)
  clock.advance(10_000)
  const summary = tr.end()
  assert.equal(summary.readTimeSec, 15)
  assert.equal(summary.completed, true)
  assert.equal(summary.maxPercent, 95)
})

test('bumpCompletedCount trả mốc đúng lúc đạt', () => {
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const results = Array.from({ length: 5 }, () => bumpCompletedCount(storage))
  assert.deepEqual(results.map(r => r.milestone), [1, null, 3, null, 5])
  assert.equal(results[4].count, 5)
})
