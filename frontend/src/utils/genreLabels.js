// ── Nhãn thể loại ────────────────────────────────────────────────────────────
// Cột `genre` trong DB lẫn lộn nhiều kiểu: chuỗi gộp "Tiên Hiệp, Huyền Huyễn",
// mã tiếng Anh do crawler đặt ("cultivation", "other"), đôi khi tiếng Trung
// ("玄幻") hoặc "Unknown". File này gom về MỘT bộ nhãn tiếng Việt để hiển thị
// chip/badge/bảng cho đồng nhất. Hàm thuần — không import React/API, test được
// bằng `node --test`.
//
// Giá trị gửi lên API (`?genre=`) cũng dùng nhãn tiếng Việt: Worker hiểu cả
// nhãn Việt lẫn mã thô.

// GenreChips (trang chủ) và EpubCatalogPage gọi cachedGet(GENRES_URL, {ttl})
// với cùng tham số → apiCache gộp thành 1 request.
export const GENRES_URL = '/novels/genres'
export const GENRES_TTL = 10 * 60_000

const RAW_TO_VI = {
  // Mã tiếng Anh từ crawler / nguồn
  cultivation: 'Tu Tiên',
  xianxia: 'Tiên Hiệp',
  xuanhuan: 'Huyền Huyễn',
  fantasy: 'Huyền Huyễn',
  wuxia: 'Võ Hiệp',
  urban: 'Đô Thị',
  city: 'Đô Thị',
  romance: 'Ngôn Tình',
  scifi: 'Khoa Huyễn',
  'sci-fi': 'Khoa Huyễn',
  'science fiction': 'Khoa Huyễn',
  history: 'Lịch Sử',
  historical: 'Lịch Sử',
  game: 'Võng Du',
  games: 'Võng Du',
  military: 'Quân Sự',
  mystery: 'Huyền Nghi',
  horror: 'Linh Dị',
  sports: 'Thể Thao',
  other: 'Khác',
  others: 'Khác',
  // Tiếng Trung (giản thể + phồn thể phổ biến)
  '玄幻': 'Huyền Huyễn',
  '仙侠': 'Tiên Hiệp',
  '仙俠': 'Tiên Hiệp',
  '修真': 'Tu Chân',
  '武侠': 'Võ Hiệp',
  '武俠': 'Võ Hiệp',
  '都市': 'Đô Thị',
  '言情': 'Ngôn Tình',
  '历史': 'Lịch Sử',
  '歷史': 'Lịch Sử',
  '科幻': 'Khoa Huyễn',
  '游戏': 'Võng Du',
  '遊戲': 'Võng Du',
  '网游': 'Võng Du',
  '奇幻': 'Kỳ Huyễn',
  '军事': 'Quân Sự',
  '軍事': 'Quân Sự',
  '悬疑': 'Huyền Nghi',
  '懸疑': 'Huyền Nghi',
  '灵异': 'Linh Dị',
  '靈異': 'Linh Dị',
  '体育': 'Thể Thao',
  '體育': 'Thể Thao',
  '其他': 'Khác',
}

// Giá trị coi như "không có thể loại" → bỏ hẳn, không hiện chip/badge rỗng.
const EMPTY_VALUES = new Set(['', 'unknown', 'none', 'null', 'undefined', 'n/a', 'na', '-', '—', 'chưa rõ', 'đang cập nhật'])

// Dấu phân tách gặp trong dữ liệu: phẩy (ASCII/toàn khổ), dấu 、, chấm phẩy, gạch đứng, gạch chéo.
const SEPARATORS = /[,，、;；|/]+/

/** Ánh xạ 1 nhãn thô → nhãn tiếng Việt ('' nếu là giá trị rỗng/Unknown). */
export function genreLabel(raw) {
  if (raw === null || raw === undefined) return ''
  const text = String(raw).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const key = text.toLowerCase()
  if (EMPTY_VALUES.has(key)) return ''
  if (Object.prototype.hasOwnProperty.call(RAW_TO_VI, key)) return RAW_TO_VI[key]
  if (Object.prototype.hasOwnProperty.call(RAW_TO_VI, text)) return RAW_TO_VI[text]
  // Nhãn đã là tiếng Việt (hoặc mã lạ chưa biết) → giữ nguyên, không đoán.
  return text
}

/**
 * Tách chuỗi/mảng thể loại thành danh sách nhãn tiếng Việt, bỏ trùng
 * (không phân biệt hoa thường) và bỏ giá trị rỗng/Unknown.
 *   splitGenres('Tiên Hiệp, Huyền Huyễn, fantasy') → ['Tiên Hiệp', 'Huyền Huyễn']
 */
// Chuỗi thể loại SAI do bug crawler cũ (download_epubs.fetch_genres lấy cả menu
// điều hướng) — bị gán cho gần như MỌI truyện EPUB. Coi như chưa có thể loại
// cho tới khi tools/fix_epub_metadata.py sửa xong dữ liệu D1 (không hiển thị
// thông tin sai cho người đọc).
const KNOWN_BAD_COMBOS = new Set(['tiên hiệp, huyền huyễn, đô thị'])

export function isKnownBadGenre(value) {
  return typeof value === 'string' && KNOWN_BAD_COMBOS.has(value.replace(/\s+/g, ' ').trim().toLowerCase())
}

export function splitGenres(value) {
  if (isKnownBadGenre(value)) return []
  const parts = Array.isArray(value)
    ? value.flatMap(v => String(v ?? '').split(SEPARATORS))
    : String(value ?? '').split(SEPARATORS)
  const seen = new Set()
  const out = []
  for (const part of parts) {
    const label = genreLabel(part)
    if (!label) continue
    const k = label.toLocaleLowerCase('vi')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(label)
  }
  return out
}

/** Thể loại đầu tiên (dùng cho badge/cột bảng), '' nếu không có. */
export function primaryGenre(value) {
  return splitGenres(value)[0] || ''
}

/**
 * Chuẩn hoá response GET /api/novels/genres thành mảng nhãn tiếng Việt duy nhất.
 * Chịu được cả response cũ (mảng chuỗi thô, có chuỗi gộp nhiều thể loại) lẫn
 * response mới (mảng nhãn đã tách, hoặc mảng object {label|name|genre}, hoặc
 * bọc trong {genres: [...]}).
 */
export function normalizeGenreList(data) {
  const list = Array.isArray(data) ? data : (Array.isArray(data?.genres) ? data.genres : [])
  const raw = list.map(item => {
    if (item && typeof item === 'object') return item.label ?? item.name ?? item.genre ?? ''
    return item
  })
  return splitGenres(raw)
}

export default genreLabel
