// ── Logic thuần cho hộp sửa name kiểu sangtacviet (2026-11) ─────────────────
// Kiểu viết hoa nhanh, mở rộng cụm theo từ, xuất/nhập gói name theo truyện.
// KHÔNG import axios/React ở đây → test bằng `node --test` không cần build.

// ── Kiểu viết hoa ────────────────────────────────────────────────────────────
// STV có 5 kiểu ("Dùng", "Hoa chữ đầu", "Hoa 2 chữ đầu", "Thường chữ cuối",
// "Hoa toàn bộ"). Mình chọn 5 kiểu dưới, kiểu thứ 5 "Hoa 2 chữ đầu" lấy theo STV:
// viết hoa 2 âm đầu, phần còn lại viết thường — hợp với họ kép + tên gọi thường
// ("Âu Dương phong", "Thượng Quan cô nương") hoặc tên môn phái kèm danh từ chung
// ("Thanh Vân môn" khi cụm có 3 âm).
export const NAME_CASING_STYLES = [
  { key: 'title', label: 'Viết Hoa Mỗi Chữ', hint: 'Lâm Phong Vân' },
  { key: 'sentence', label: 'Viết hoa chữ đầu', hint: 'Lâm phong vân' },
  { key: 'lower', label: 'chữ thường', hint: 'lâm phong vân' },
  { key: 'upper', label: 'CHỮ HOA', hint: 'LÂM PHONG VÂN' },
  { key: 'first2', label: 'Hoa 2 chữ đầu', hint: 'Âu Dương phong' },
]

const LETTER_RE = /\p{L}/u

function upperVi(s) {
  try { return s.toLocaleUpperCase('vi') } catch { return s.toUpperCase() }
}

function lowerVi(s) {
  try { return s.toLocaleLowerCase('vi') } catch { return s.toLowerCase() }
}

/** Viết hoa chữ cái ĐẦU TIÊN của token (bỏ qua dấu câu mở đầu như “ hoặc ( ), phần còn lại thường. */
function capitalizeToken(token) {
  const lower = lowerVi(token)
  const chars = Array.from(lower)
  const i = chars.findIndex(ch => LETTER_RE.test(ch))
  if (i < 0) return lower
  chars[i] = upperVi(chars[i])
  return chars.join('')
}

/**
 * Đổi kiểu viết hoa của cụm (tiếng Việt có dấu, dùng locale 'vi').
 * Giữ nguyên khoảng trắng gốc giữa các từ.
 * @param {string} text
 * @param {'title'|'sentence'|'lower'|'upper'|'first2'} style
 * @returns {string} style lạ → trả nguyên văn
 */
export function applyCasing(text, style) {
  const s = String(text ?? '')
  if (!s) return s
  switch (style) {
    case 'lower':
      return lowerVi(s)
    case 'upper':
      return upperVi(s)
    case 'title':
    case 'sentence':
    case 'first2': {
      const limit = style === 'title' ? Infinity : style === 'first2' ? 2 : 1
      let seen = 0
      // split giữ lại phần khoảng trắng (nhóm bắt) để ghép lại y nguyên.
      return s.split(/(\s+)/).map(part => {
        if (!part || /^\s+$/.test(part)) return part
        if (!LETTER_RE.test(part)) return lowerVi(part)
        seen++
        return seen <= limit ? capitalizeToken(part) : lowerVi(part)
      }).join('')
    }
    default:
      return s
  }
}

// ── Mở rộng cụm sang trái/phải 1 từ ─────────────────────────────────────────
// "Chữ của từ" = chữ cái/số Unicode + dấu kết hợp. Khoảng trắng được bước qua;
// dấu câu (, . “ ” …) là RANH GIỚI CỨNG — không mở rộng qua dấu câu vì name
// gần như không bao giờ chứa dấu câu, mở qua chỉ ra cụm vô nghĩa.
const WORD_CP_RE = /[\p{L}\p{N}\p{M}]/u
const SPACE_CP_RE = /\s/u

/** Code point bắt đầu tại i + độ dài UTF-16 của nó. */
function cpAt(str, i) {
  const cp = str.codePointAt(i)
  return { ch: String.fromCodePoint(cp), len: cp > 0xffff ? 2 : 1 }
}

/** Code point kết thúc ngay trước i (xử lý cặp surrogate). */
function cpBefore(str, i) {
  const lo = str.charCodeAt(i - 1)
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = str.charCodeAt(i - 2)
    if (hi >= 0xd800 && hi <= 0xdbff) return { ch: str.slice(i - 2, i), len: 2 }
  }
  return { ch: str[i - 1], len: 1 }
}

/**
 * Mở rộng vùng [start, end) trong `context` thêm 1 từ theo hướng cho trước.
 * - Đang chọn dở giữa từ (vd "Lâ|m") → bước đầu chỉ hoàn tất từ đó.
 * - Bước qua khoảng trắng rồi lấy trọn từ kế tiếp; gặp dấu câu/hết chuỗi → null.
 * - Cụm mới dài hơn maxLen → null (ô "Cụm gốc" giới hạn 100 ký tự).
 * Offset là chỉ số UTF-16 (khớp Range/Selection của DOM).
 * @param {string} context đoạn văn bản chứa vùng chọn
 * @param {number} start
 * @param {number} end
 * @param {'left'|'right'} direction
 * @param {number} [maxLen=100]
 * @returns {{ start: number, end: number, text: string } | null}
 */
export function expandSelection(context, start, end, direction, maxLen = 100) {
  if (typeof context !== 'string' || !context) return null
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > context.length || start >= end) return null
  let s = start
  let e = end
  if (direction === 'right') {
    if (e >= context.length) return null
    const first = cpAt(context, e)
    if (!WORD_CP_RE.test(first.ch) || !WORD_CP_RE.test(cpBefore(context, e).ch)) {
      // Không ở giữa từ → bước qua khoảng trắng, cần gặp đầu một từ.
      while (e < context.length && SPACE_CP_RE.test(cpAt(context, e).ch)) e += cpAt(context, e).len
      if (e >= context.length || !WORD_CP_RE.test(cpAt(context, e).ch)) return null
    }
    while (e < context.length && WORD_CP_RE.test(cpAt(context, e).ch)) e += cpAt(context, e).len
  } else if (direction === 'left') {
    if (s <= 0) return null
    const prev = cpBefore(context, s)
    if (!WORD_CP_RE.test(prev.ch) || !WORD_CP_RE.test(cpAt(context, s).ch)) {
      while (s > 0 && SPACE_CP_RE.test(cpBefore(context, s).ch)) s -= cpBefore(context, s).len
      if (s <= 0 || !WORD_CP_RE.test(cpBefore(context, s).ch)) return null
    }
    while (s > 0 && WORD_CP_RE.test(cpBefore(context, s).ch)) s -= cpBefore(context, s).len
  } else {
    return null
  }
  const text = context.slice(s, e)
  if (text.trim().length > maxLen) return null
  return { start: s, end: e, text }
}

// ── Xuất / nhập gói name theo truyện ─────────────────────────────────────────
export const NAME_PACK_FORMAT = 'hacdao-names'
export const NAME_PACK_VERSION = 1
export const NAME_PACK_MAX_BYTES = 200 * 1024
// 400 quy tắc ≈ 30–40 KB JSON: vượt nữa thì truyện đó bị cắt khỏi đồng bộ tài khoản
// (giới hạn prefs 40 KB, userPrefsSync.fitPrefsSize) mà người dùng không biết.
export const NAME_PACK_MAX_RULES = 400
export const NAME_PACK_TEXT_MAX = 100
// Chữ Hán (kể cả mở rộng) — quy tắc của mình thay trên văn bản TIẾNG VIỆT nên
// vế trái chứa chữ Hán (kiểu `$中文=Việt` của STV) không bao giờ khớp → bỏ.
const HAN_RE = /\p{Script=Han}/u

/** Tên file tải về: name-<slug>.json (slug đã là a-z0-9-, vẫn lọc cho chắc). */
export function namePackFilename(slug) {
  const safe = String(slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 100) || 'truyen'
  return `name-${safe}.json`
}

/** Dựng object gói name từ danh sách quy tắc (dạng localStorage). */
export function buildNamePack(slug, rules) {
  const out = []
  for (const r of Array.isArray(rules) ? rules : []) {
    if (!r || typeof r.from !== 'string' || typeof r.to !== 'string' || !r.from.trim()) continue
    out.push({ from: r.from.trim(), to: r.to.trim(), whole: r.whole === true })
  }
  return { format: NAME_PACK_FORMAT, v: NAME_PACK_VERSION, slug: String(slug || ''), rules: out }
}

function byteLength(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length
  return unescape(encodeURIComponent(str)).length
}

function validPackText(v) {
  return typeof v === 'string' && v.trim() !== '' && v.trim().length <= NAME_PACK_TEXT_MAX
}

/** Bỏ trùng `from` (không phân biệt hoa thường) — dòng SAU trong file thắng. */
function dedupeRules(rules) {
  const map = new Map()
  for (const r of rules) {
    const k = r.from.toLowerCase()
    map.delete(k) // đưa xuống cuối để giữ thứ tự lần xuất hiện cuối
    map.set(k, r)
  }
  return [...map.values()]
}

/**
 * Đọc gói name. Nhận:
 *  1. JSON `{ format: "hacdao-names", v: 1, slug, rules: [{from,to,whole}] }`
 *     (cũng nhận object đã parse). `whole` vắng → true (mặc định quy tắc mới).
 *  2. Văn bản kiểu STV: mỗi dòng (hoặc phân cách `~//~`) `A=B` / `$A=B`.
 *     CHỈ nhận khi A không chứa chữ Hán; dòng có chữ Hán bị bỏ và được đếm.
 *     Dòng `#…`, `@…`, `~…`, `//…` (cú pháp riêng của STV / chú thích) bị bỏ.
 * Quy tắc hỏng (from/to rỗng, > 100 ký tự, không phải chuỗi) bị bỏ và đếm.
 * @param {string|object} input nội dung file
 * @param {string} [slug] truyện đang đọc — khác slug trong file → slugMismatch
 * @returns {{ ok: true, rules: Array<{from,to,whole}>, skipped: number, skippedHan: number,
 *   kind: 'json'|'text', fileSlug: string, slugMismatch: boolean } | { ok: false, error: string }}
 */
export function parseNamePack(input, slug = '') {
  let data = input
  if (typeof input === 'string') {
    if (byteLength(input) > NAME_PACK_MAX_BYTES) {
      return { ok: false, error: `File quá lớn (tối đa ${Math.round(NAME_PACK_MAX_BYTES / 1024)} KB).` }
    }
    const trimmed = input.replace(/^\uFEFF/, '').trim()
    if (!trimmed) return { ok: false, error: 'File rỗng.' }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        data = JSON.parse(trimmed)
      } catch {
        return { ok: false, error: 'File JSON hỏng, không đọc được.' }
      }
    } else {
      return parseTextPack(trimmed)
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Không phải gói name của Hắc Đạo Truyện.' }
  }
  if (data.format !== NAME_PACK_FORMAT) return { ok: false, error: 'Không phải gói name của Hắc Đạo Truyện (sai "format").' }
  if (data.v !== NAME_PACK_VERSION) return { ok: false, error: `Phiên bản gói name không hỗ trợ (v=${String(data.v).slice(0, 10)}).` }
  if (!Array.isArray(data.rules)) return { ok: false, error: 'Gói name thiếu danh sách "rules".' }
  if (data.rules.length > NAME_PACK_MAX_RULES) {
    return { ok: false, error: `Gói name có quá nhiều quy tắc (tối đa ${NAME_PACK_MAX_RULES}).` }
  }
  const rules = []
  let skipped = 0
  for (const r of data.rules) {
    if (!r || typeof r !== 'object' || !validPackText(r.from) || !validPackText(r.to)) { skipped++; continue }
    rules.push({ from: r.from.trim(), to: r.to.trim(), whole: r.whole !== false })
  }
  const fileSlug = typeof data.slug === 'string' ? data.slug : ''
  return {
    ok: true,
    kind: 'json',
    rules: dedupeRules(rules),
    skipped,
    skippedHan: 0,
    fileSlug,
    slugMismatch: Boolean(slug && fileSlug && fileSlug !== slug),
  }
}

function parseTextPack(text) {
  const lines = text.split(/\r?\n|~\/\/~/)
  const rules = []
  let skipped = 0
  let skippedHan = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^(#|@|~|\/\/)/.test(line)) { skipped++; continue }
    const body = line.startsWith('$') ? line.slice(1) : line
    const eq = body.indexOf('=')
    if (eq <= 0) { skipped++; continue }
    const from = body.slice(0, eq).trim()
    const to = body.slice(eq + 1).trim()
    if (HAN_RE.test(from)) { skippedHan++; continue }
    if (!validPackText(from) || !validPackText(to)) { skipped++; continue }
    rules.push({ from, to, whole: true })
    if (rules.length > NAME_PACK_MAX_RULES) {
      return { ok: false, error: `File có quá nhiều quy tắc (tối đa ${NAME_PACK_MAX_RULES}).` }
    }
  }
  if (!rules.length && !skipped && !skippedHan) return { ok: false, error: 'File không có dòng nào dạng A=B.' }
  return { ok: true, kind: 'text', rules: dedupeRules(rules), skipped, skippedHan, fileSlug: '', slugMismatch: false }
}
