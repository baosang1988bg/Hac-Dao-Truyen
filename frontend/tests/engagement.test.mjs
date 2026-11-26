import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIEW_PERIODS, viewPeriodLabel, isViewPeriod, normalizeViewRankings, rankingDisplayTitle,
  normalizeGuestId, generateGuestId, getOrCreateGuestId, GUEST_ID_KEY,
  clampStars, readMyRating, saveMyRating, nextStarFromKey, ratingSummary,
  readSearchParam, urlWithSearchParam,
  suggestionStatusLabel, SUGGESTION_FILTERS, defaultApplyGlossary, normalizeSlugFilter,
  buildReviewBody, suggestionChapterHref, serverErrorMessage,
  validateSuggestion, isShortSuggestionFrom, suggestionPreview,
} from '../src/utils/engagement.js'

function memoryStorage(init = {}) {
  const map = new Map(Object.entries(init))
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    _map: map,
  }
}

// ── BXH lượt đọc ─────────────────────────────────────────────────────────────

test('VIEW_PERIODS + nhãn kỳ khớp contract Worker (day/week/month)', () => {
  assert.deepEqual(VIEW_PERIODS.map(p => p.key), ['day', 'week', 'month'])
  assert.equal(viewPeriodLabel('day'), 'Ngày')
  assert.equal(viewPeriodLabel('week'), 'Tuần')
  assert.equal(viewPeriodLabel('month'), 'Tháng')
  assert.equal(viewPeriodLabel('year'), '')
  assert.equal(isViewPeriod('month'), true)
  assert.equal(isViewPeriod('all'), false)
})

test('normalizeViewRankings: unavailable/rỗng → không có dòng, bỏ dòng 0 lượt', () => {
  assert.deepEqual(normalizeViewRankings({ items: [{ slug: 'a', period_views: 3 }], unavailable: true }), { items: [], unavailable: true })
  assert.deepEqual(normalizeViewRankings(null), { items: [], unavailable: false })
  assert.deepEqual(normalizeViewRankings({ items: 'x' }), { items: [], unavailable: false })
  const { items } = normalizeViewRankings({ items: [
    { slug: 'a', period_views: 5 }, { slug: 'b', period_views: 0 }, { period_views: 9 }, null,
  ] })
  assert.deepEqual(items.map(i => i.slug), ['a'])
})

test('rankingDisplayTitle dùng tên fallback khi title_is_slug', () => {
  assert.equal(rankingDisplayTitle({ slug: 'xich-tam', title: 'Xích Tâm Tuần Thiên', title_is_slug: false }), 'Xích Tâm Tuần Thiên')
  assert.equal(rankingDisplayTitle({ slug: 'bat-dau', title: 'bat-dau', title_is_slug: true, original_title: '开始' }), '开始')
  assert.equal(rankingDisplayTitle({ slug: 'bat-dau-dung-hop', title: '', title_is_slug: true }), 'Bat Dau Dung Hop')
  assert.equal(rankingDisplayTitle(null), '')
})

// ── guest_id + chấm sao ──────────────────────────────────────────────────────

test('normalizeGuestId chỉ nhận A-Za-z0-9_- (8..100 ký tự)', () => {
  assert.equal(normalizeGuestId('abcDEF12-_x'), 'abcDEF12-_x')
  assert.equal(normalizeGuestId('  abcdefgh  '), 'abcdefgh')
  assert.equal(normalizeGuestId('short'), '')
  assert.equal(normalizeGuestId('có dấu tiếng việt'), '')
  assert.equal(normalizeGuestId('a'.repeat(101)), '')
  assert.equal(normalizeGuestId(null), '')
  assert.equal(normalizeGuestId(12345678), '')
})

test('generateGuestId: randomUUID → getRandomValues → Math.random, luôn hợp lệ', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(generateGuestId({ randomUUID: () => uuid }), uuid)
  const viaBytes = generateGuestId({ getRandomValues: arr => arr.fill(171) })
  assert.equal(viaBytes, 'g' + 'ab'.repeat(16))
  assert.ok(normalizeGuestId(generateGuestId(null)))
  // randomUUID trả rác → rơi xuống getRandomValues
  assert.ok(normalizeGuestId(generateGuestId({ randomUUID: () => '!!', getRandomValues: a => a })))
})

test('getOrCreateGuestId giữ id cũ hợp lệ, thay id hỏng, chịu storage lỗi', () => {
  const ok = memoryStorage({ [GUEST_ID_KEY]: 'existing_id_1' })
  assert.equal(getOrCreateGuestId(ok, null), 'existing_id_1')

  const bad = memoryStorage({ [GUEST_ID_KEY]: 'bad id!' })
  const id = getOrCreateGuestId(bad, { randomUUID: () => 'aaaaaaaa-bbbb' })
  assert.equal(id, 'aaaaaaaa-bbbb')
  assert.equal(bad.getItem(GUEST_ID_KEY), 'aaaaaaaa-bbbb')

  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.ok(normalizeGuestId(getOrCreateGuestId(throwing, null)))
})

test('clampStars / readMyRating / saveMyRating', () => {
  assert.equal(clampStars(3), 3)
  assert.equal(clampStars('5'), 5)
  assert.equal(clampStars(0), 0)
  assert.equal(clampStars(6), 0)
  assert.equal(clampStars(2.5), 0)
  const s = memoryStorage()
  assert.equal(readMyRating(s, 'abc'), 0)
  assert.equal(saveMyRating(s, 'abc', 4), true)
  assert.equal(s.getItem('myRating:abc'), '4')
  assert.equal(readMyRating(s, 'abc'), 4)
  assert.equal(saveMyRating(s, 'abc', 9), false)
  assert.equal(readMyRating(memoryStorage({ 'myRating:x': 'zz' }), 'x'), 0)
})

test('nextStarFromKey: mũi tên vòng quanh, Home/End, phím khác → null', () => {
  assert.equal(nextStarFromKey(3, 'ArrowRight'), 4)
  assert.equal(nextStarFromKey(5, 'ArrowRight'), 1)
  assert.equal(nextStarFromKey(1, 'ArrowLeft'), 5)
  assert.equal(nextStarFromKey(0, 'ArrowRight'), 1)
  assert.equal(nextStarFromKey(0, 'ArrowLeft'), 5)
  assert.equal(nextStarFromKey(2, 'ArrowUp'), 3)
  assert.equal(nextStarFromKey(2, 'ArrowDown'), 1)
  assert.equal(nextStarFromKey(4, 'Home'), 1)
  assert.equal(nextStarFromKey(1, 'End'), 5)
  assert.equal(nextStarFromKey(3, 'Enter'), null)
})

test('ratingSummary chỉ trả khi có số lượt thật > 0', () => {
  assert.deepEqual(ratingSummary(4.26, 7), { rating: 4.3, count: 7 })
  assert.equal(ratingSummary(0, 0), null)
  assert.equal(ratingSummary(undefined, undefined), null)
  assert.equal(ratingSummary('x', 3), null)
})

// ── Tìm kiếm qua URL ─────────────────────────────────────────────────────────

test('readSearchParam đọc q từ query string', () => {
  assert.equal(readSearchParam('?q=xich%20tam'), 'xich tam')
  assert.equal(readSearchParam('?a=1&q=abc'), 'abc')
  assert.equal(readSearchParam(''), '')
  assert.equal(readSearchParam(undefined), '')
})

test('urlWithSearchParam đặt/bỏ q, giữ tham số khác, null khi không đổi', () => {
  assert.equal(urlWithSearchParam({ pathname: '/', search: '' }, 'xích tâm'), '/?q=x%C3%ADch+t%C3%A2m')
  assert.equal(urlWithSearchParam({ pathname: '/', search: '?ga_debug=1' }, 'abc'), '/?ga_debug=1&q=abc')
  assert.equal(urlWithSearchParam({ pathname: '/', search: '?q=abc&ga_debug=1', hash: '#x' }, ''), '/?ga_debug=1#x')
  assert.equal(urlWithSearchParam({ pathname: '/', search: '?q=abc' }, '  abc '), null)
  assert.equal(urlWithSearchParam({ pathname: '/', search: '' }, ''), null)
})

// ── Góp ý name ───────────────────────────────────────────────────────────────

test('nhãn trạng thái góp ý + bộ lọc admin', () => {
  assert.equal(suggestionStatusLabel('pending'), 'Chờ duyệt')
  assert.equal(suggestionStatusLabel('approved'), 'Đã duyệt')
  assert.equal(suggestionStatusLabel('rejected'), 'Từ chối')
  assert.equal(suggestionStatusLabel('weird'), 'weird')
  assert.deepEqual(SUGGESTION_FILTERS.map(f => f.key), ['pending', 'approved', 'rejected', ''])
})

test('defaultApplyGlossary bật khi có chữ gốc', () => {
  assert.equal(defaultApplyGlossary('林动'), true)
  assert.equal(defaultApplyGlossary('  '), false)
  assert.equal(defaultApplyGlossary(null), false)
})

test('normalizeSlugFilter khớp SLUG_RE của Worker', () => {
  assert.equal(normalizeSlugFilter(' Xich-Tam '), 'xich-tam')
  assert.equal(normalizeSlugFilter('a b'), '')
  assert.equal(normalizeSlugFilter(''), '')
  assert.equal(normalizeSlugFilter('a'.repeat(101)), '')
})

test('buildReviewBody: từ chối không gửi to/original; apply_glossary cần chữ gốc', () => {
  assert.deepEqual(buildReviewBody('rejected', { adminNote: ' trùng ', to: 'x', original: 'y', applyGlossary: true }),
    { status: 'rejected', admin_note: 'trùng' })
  assert.deepEqual(buildReviewBody('approved', { to: ' Lâm Động ', original: ' 林动 ', applyGlossary: true }),
    { status: 'approved', admin_note: '', to: 'Lâm Động', original: '林动', apply_glossary: true })
  assert.deepEqual(buildReviewBody('approved', { to: 'A', original: '', applyGlossary: true }),
    { status: 'approved', admin_note: '', to: 'A', original: '', apply_glossary: false })
})

test('suggestionChapterHref + serverErrorMessage', () => {
  assert.equal(suggestionChapterHref('abc', 12), '/novel/abc/read/12')
  assert.equal(suggestionChapterHref('abc', 0), '/novel/abc/read/0')
  assert.equal(suggestionChapterHref('abc', null), null)
  assert.equal(suggestionChapterHref('abc', -1), null)
  assert.equal(suggestionChapterHref('', 3), null)
  assert.equal(serverErrorMessage({ response: { status: 409, data: { error: 'Góp ý này đã được xử lý trước đó' } } }, 'x'),
    'Góp ý này đã được xử lý trước đó')
  assert.equal(serverErrorMessage({ response: { status: 500, data: {} } }, 'Mặc định'), 'Mặc định')
  assert.match(serverErrorMessage(new Error('Network'), 'x'), /kết nối/)
})

// ── validateSuggestion (khớp glossarySuggestionCreate của Worker) ────────────
test('validateSuggestion: hợp lệ → null', () => {
  assert.equal(validateSuggestion({ from: 'Lạc Vũ', to: 'Lạc Vũ Tiên', original: '洛羽', note: 'tên nhân vật' }), null)
  assert.equal(validateSuggestion({ from: '  Ab  ', to: 'Cd' }), null)
})

test('validateSuggestion: thiếu/trùng/cụm gốc < 2 ký tự', () => {
  assert.match(validateSuggestion({ from: '', to: 'x' }), /cả cụm gốc/)
  assert.match(validateSuggestion({ from: 'ab', to: '  ' }), /cả cụm gốc/)
  assert.match(validateSuggestion({ from: 'Lạc  Vũ', to: 'Lạc Vũ' }), /phải khác/, 'gộp khoảng trắng như server')
  assert.match(validateSuggestion({ from: 'a', to: 'b' }), /ít nhất 2 ký tự/)
  assert.match(validateSuggestion({ from: '洛', to: 'Lạc' }), /ít nhất 2 ký tự/)
  assert.match(validateSuggestion({ from: 'x'.repeat(101), to: 'y' }), /tối đa 100/)
})

test('validateSuggestion: từ chối ký tự markdown/HTML ở cả from và to', () => {
  for (const ch of ['[', ']', '(', ')', '!', '<', '>', '*', '_', '#', '`', '|', '~', '\\']) {
    assert.ok(validateSuggestion({ from: `Lạc${ch}Vũ`, to: 'Lạc Vũ' }), `from chứa ${ch}`)
    assert.ok(validateSuggestion({ from: 'Lạc Vũ', to: `X${ch}` }), `to chứa ${ch}`)
  }
  assert.match(validateSuggestion({ from: 'ab', to: '![x](http://a)' }), /không được chứa/)
  // Dấu câu thường vẫn được phép
  assert.equal(validateSuggestion({ from: 'Lạc-Vũ', to: 'Lạc Vũ, đại ca.' }), null)
})

test('validateSuggestion: chữ gốc/ghi chú quá dài', () => {
  assert.match(validateSuggestion({ from: 'ab', to: 'cd', original: '字'.repeat(51) }), /Chữ gốc tối đa 50/)
  assert.match(validateSuggestion({ from: 'ab', to: 'cd', note: 'n'.repeat(301) }), /Ghi chú tối đa 300/)
})

test('isShortSuggestionFrom + suggestionPreview (trang admin)', () => {
  assert.equal(isShortSuggestionFrom('Vũ'), true)
  assert.equal(isShortSuggestionFrom('abc'), true)
  assert.equal(isShortSuggestionFrom('Lạc Vũ'), false)
  assert.equal(isShortSuggestionFrom(''), false)
  assert.deepEqual(suggestionPreview('Lạc Vũ', 'Lạc Vũ Tiên'), { before: '…Lạc Vũ…', after: '…Lạc Vũ Tiên…' })
  assert.equal(suggestionPreview('', 'x'), null)
})
