import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fmtNovelTitle, novelDisplayTitle, cleanAuthor, fmtStatLabel, parseZhNumber, fmtNumber,
} from '../src/utils/format.js'
import { genreLabel, splitGenres, primaryGenre, normalizeGenreList } from '../src/utils/genreLabels.js'
import { fetchNovelsBySlugsBatch, SLUGS_BATCH_MAX } from '../src/utils/novelsApi.js'

// ── genreLabels ──────────────────────────────────────────────────────────────

test('genreLabel ánh xạ mã thô sang nhãn tiếng Việt, bỏ Unknown/rỗng', () => {
  assert.equal(genreLabel('cultivation'), 'Tu Tiên')
  assert.equal(genreLabel('Other'), 'Khác')
  assert.equal(genreLabel(' fantasy '), 'Huyền Huyễn')
  assert.equal(genreLabel('urban'), 'Đô Thị')
  assert.equal(genreLabel('romance'), 'Ngôn Tình')
  assert.equal(genreLabel('scifi'), 'Khoa Huyễn')
  assert.equal(genreLabel('history'), 'Lịch Sử')
  assert.equal(genreLabel('game'), 'Võng Du')
  assert.equal(genreLabel('玄幻'), 'Huyền Huyễn')
  assert.equal(genreLabel('Unknown'), '')
  assert.equal(genreLabel(''), '')
  assert.equal(genreLabel(null), '')
  // Nhãn đã là tiếng Việt → giữ nguyên
  assert.equal(genreLabel('Tiên Hiệp'), 'Tiên Hiệp')
})

test('splitGenres tách theo dấu phẩy, Việt hoá và bỏ trùng', () => {
  assert.deepEqual(splitGenres('Tiên Hiệp, Huyền Huyễn, Võng Du'), ['Tiên Hiệp', 'Huyền Huyễn', 'Võng Du'])
  // Chuỗi gán sai hàng loạt do bug crawler menu → coi như chưa có thể loại
  assert.deepEqual(splitGenres('Tiên Hiệp, Huyền Huyễn, Đô Thị'), [])
  assert.deepEqual(splitGenres('fantasy, Huyền Huyễn，cultivation、Unknown'), ['Huyền Huyễn', 'Tu Tiên'])
  assert.deepEqual(splitGenres(['other', 'Khác', 'tiên hiệp', 'Tiên Hiệp']), ['Khác', 'tiên hiệp'])
  assert.deepEqual(splitGenres(''), [])
  assert.deepEqual(splitGenres(undefined), [])
  assert.equal(primaryGenre('Unknown, cultivation'), 'Tu Tiên')
  assert.equal(primaryGenre(null), '')
})

test('normalizeGenreList chịu được response cũ lẫn mới', () => {
  // Cũ: mảng chuỗi thô, có chuỗi gộp
  assert.deepEqual(
    normalizeGenreList(['Tiên Hiệp, Huyền Huyễn, Đô Thị', 'cultivation', 'other', 'Unknown', 'Huyền Huyễn']),
    ['Tiên Hiệp', 'Huyền Huyễn', 'Đô Thị', 'Tu Tiên', 'Khác'],
  )
  // Mới: object hoặc bọc {genres}
  assert.deepEqual(normalizeGenreList({ genres: [{ label: 'Tu Tiên', count: 3 }, { name: 'Đô Thị' }] }), ['Tu Tiên', 'Đô Thị'])
  assert.deepEqual(normalizeGenreList(null), [])
})

// ── fmtNovelTitle ────────────────────────────────────────────────────────────

test('fmtNovelTitle giữ nguyên tiêu đề hợp lệ', () => {
  assert.equal(fmtNovelTitle('Sớm Đăng Lục', 'som-dang-luc'), 'Sớm Đăng Lục')
  assert.equal(fmtNovelTitle('  Xích Tâm Tuần Thiên ', 'xich-tam'), 'Xích Tâm Tuần Thiên')
  assert.equal(fmtNovelTitle('诡秘之主', 'quy-bi-chi-chu', 'Lord of Mysteries'), '诡秘之主')
})

test('fmtNovelTitle: tiêu đề là slug → ưu tiên original_title có chữ, rồi title-case slug', () => {
  assert.equal(fmtNovelTitle('bat-dau-dung-hop', 'bat-dau-dung-hop'), 'Bat Dau Dung Hop')
  assert.equal(fmtNovelTitle('bat-dau-dung-hop', 'bat-dau-dung-hop', '开局融合'), '开局融合')
  assert.equal(fmtNovelTitle('', 'xich-tam', '赤心巡天'), '赤心巡天')
  assert.equal(fmtNovelTitle(null, 'xich-tam'), 'Xich Tam')
  // original_title không có chữ (chỉ số/ký hiệu) hoặc cũng là slug → bỏ qua
  assert.equal(fmtNovelTitle('abc-def', 'abc-def', '123 - 456'), 'Abc Def')
  assert.equal(fmtNovelTitle('abc-def', 'abc-def', 'abc-def'), 'Abc Def')
  assert.equal(fmtNovelTitle('', ''), '')
  assert.equal(novelDisplayTitle({ title: 'kiem-lai', slug: 'kiem-lai', original_title: '剑来' }), '剑来')
  assert.equal(novelDisplayTitle(null), '')
})

test('cleanAuthor bỏ placeholder tác giả', () => {
  assert.equal(cleanAuthor('Nhĩ Căn'), 'Nhĩ Căn')
  assert.equal(cleanAuthor('  Đang cập nhật '), '')
  assert.equal(cleanAuthor('Unknown'), '')
  assert.equal(cleanAuthor('Tác giả'), '')
  assert.equal(cleanAuthor('未知'), '')
  assert.equal(cleanAuthor(null), '')
})

// ── fmtStatLabel ─────────────────────────────────────────────────────────────

test('parseZhNumber hiểu số thường, dấu phẩy và đơn vị 万/亿', () => {
  assert.deepEqual(parseZhNumber('462859'), { value: 462859, rest: '' })
  assert.deepEqual(parseZhNumber('1,234 票'), { value: 1234, rest: '票' })
  assert.deepEqual(parseZhNumber('46.2万'), { value: 462000, rest: '' })
  assert.deepEqual(parseZhNumber('1.5亿字'), { value: 150000000, rest: '字' })
  assert.equal(parseZhNumber('abc'), null)
})

test('fmtStatLabel dịch nhãn tiếng Trung và định dạng số vi-VN', () => {
  assert.equal(fmtStatLabel('月点击：462859'), `Lượt click tháng: ${fmtNumber(462859)}`)
  assert.equal(fmtStatLabel('月点击：462859'), 'Lượt click tháng: 462.859')
  assert.equal(fmtStatLabel('周点击: 1200'), 'Lượt click tuần: 1.200')
  assert.equal(fmtStatLabel('总点击 98765'), 'Tổng click: 98.765')
  assert.equal(fmtStatLabel('月票：3456票'), 'Phiếu tháng: 3.456')
  assert.equal(fmtStatLabel('推荐：120'), 'Đề cử: 120')
  assert.equal(fmtStatLabel('总推荐：120'), 'Tổng đề cử: 120')
  assert.equal(fmtStatLabel('收藏：8.5万'), 'Lượt lưu: 85.000')
  assert.equal(fmtStatLabel('字数：356.2万字'), 'Số chữ: 3.562.000')
  assert.equal(fmtStatLabel('畅销'), 'Bán chạy')
  // Không nhận ra → giữ nguyên văn; số trơn → chỉ định dạng
  assert.equal(fmtStatLabel('Hot 99'), 'Hot 99')
  assert.equal(fmtStatLabel('12345'), '12.345')
  assert.equal(fmtStatLabel(''), '')
  assert.equal(fmtStatLabel(null), '')
})

// ── fetchNovelsBySlugsBatch ──────────────────────────────────────────────────

function fakeApi(handler) {
  const calls = []
  return {
    calls,
    async get(url, opts = {}) {
      calls.push({ url, params: opts.params })
      return handler(url, opts.params || {})
    },
  }
}

test('fetchNovelsBySlugsBatch: backend mới → 1 request/lô, không gọi lẻ', async () => {
  const api = fakeApi((url, params) => {
    assert.equal(url, '/novels')
    const slugs = params.slugs.split(',')
    return { data: { novels: slugs.filter(s => s !== 'mat').map(slug => ({ slug, title: slug.toUpperCase() })), total: 2 } }
  })
  const map = await fetchNovelsBySlugsBatch(api, ['a', 'b', 'a', '', 'mat'])
  assert.equal(api.calls.length, 1)
  assert.equal(api.calls[0].params.slugs, 'a,b,mat')
  assert.equal(map.get('a').title, 'A')
  assert.equal(map.has('mat'), false)
})

test('fetchNovelsBySlugsBatch: backend cũ bỏ qua slugs → fallback gọi lẻ', async () => {
  const api = fakeApi((url) => {
    if (url === '/novels') return { data: { novels: [{ slug: 'khac-han' }], total: 1 } }
    const slug = decodeURIComponent(url.replace('/novels/', ''))
    if (slug === 'x') throw new Error('404')
    return { data: { slug, title: `T-${slug}` } }
  })
  const map = await fetchNovelsBySlugsBatch(api, ['a', 'x'])
  assert.equal(map.get('a').title, 'T-a')
  assert.equal(map.has('x'), false)
  assert.equal(map.has('khac-han'), false)
  assert.deepEqual(api.calls.map(c => c.url).sort(), ['/novels', '/novels/a', '/novels/x'])
})

test('fetchNovelsBySlugsBatch: chia lô theo SLUGS_BATCH_MAX và bỏ qua danh sách rỗng', async () => {
  const api = fakeApi((url, params) => ({ data: { novels: params.slugs.split(',').map(slug => ({ slug })) } }))
  const slugs = Array.from({ length: SLUGS_BATCH_MAX + 3 }, (_, i) => `s${i}`)
  const map = await fetchNovelsBySlugsBatch(api, slugs)
  assert.equal(api.calls.length, 2)
  assert.equal(map.size, slugs.length)
  const empty = await fetchNovelsBySlugsBatch(api, [])
  assert.equal(empty.size, 0)
  assert.equal(api.calls.length, 2)
})
