// ── Logic thuần cho đợt "học từ đối thủ" (2026-11) ──────────────────────────
// BXH lượt đọc theo kỳ, chấm sao, tìm kiếm qua URL, góp ý name.
// KHÔNG import axios/React ở đây → test bằng `node --test` không cần build.

import { fmtNovelTitle } from './format.js'

// ── BXH lượt đọc Ngày/Tuần/Tháng ─────────────────────────────────────────────
/** Thứ tự nút chọn kỳ — key khớp VIEW_PERIOD_DAYS của Worker (getViewRankings). */
export const VIEW_PERIODS = [
  { key: 'day', label: 'Ngày' },
  { key: 'week', label: 'Tuần' },
  { key: 'month', label: 'Tháng' },
]

/** 'week' → 'Tuần'; kỳ lạ → '' (nơi gọi tự ẩn). */
export function viewPeriodLabel(key) {
  return VIEW_PERIODS.find(p => p.key === key)?.label || ''
}

/** Kỳ hợp lệ hay không (chặn giá trị lạ trước khi gọi API → tránh 400). */
export function isViewPeriod(key) {
  return VIEW_PERIODS.some(p => p.key === key)
}

/**
 * Chuẩn hoá response /api/rankings/views → { items, unavailable }.
 * - `unavailable: true` (migration 015 chưa chạy) → coi như rỗng.
 * - Chỉ giữ dòng có slug và period_views > 0 — KHÔNG tự điền số.
 */
export function normalizeViewRankings(data) {
  const unavailable = Boolean(data?.unavailable)
  const raw = Array.isArray(data?.items) ? data.items : []
  const items = unavailable ? [] : raw.filter(it => it && it.slug && Number(it.period_views) > 0)
  return { items, unavailable }
}

/**
 * Tên hiển thị của 1 dòng BXH: Worker gắn `title_is_slug` khi tên trống/trùng
 * slug → bỏ title, để fmtNovelTitle dùng tên gốc hoặc làm đẹp slug (giống
 * displayNovelTitle của NovelPage).
 */
export function rankingDisplayTitle(item) {
  if (!item) return ''
  return fmtNovelTitle(item.title_is_slug ? '' : item.title, item.slug, item.original_title)
}

// ── Chấm sao ─────────────────────────────────────────────────────────────────
export const GUEST_ID_KEY = 'guestId'
export const MY_RATING_PREFIX = 'myRating:'
const GUEST_ID_RE = /^[A-Za-z0-9_-]{8,100}$/

/** Giá trị hợp lệ theo Worker (rateNovel: A-Za-z0-9_-, ≤ 100 ký tự) hoặc ''. */
export function normalizeGuestId(raw) {
  const id = typeof raw === 'string' ? raw.trim() : ''
  return GUEST_ID_RE.test(id) ? id : ''
}

/**
 * Sinh guest_id ngẫu nhiên: ưu tiên crypto.randomUUID (gạch nối hợp lệ),
 * rồi crypto.getRandomValues, cuối cùng Math.random (trình duyệt rất cũ).
 * guest_id chỉ chống gửi trùng vô ý — không phải bí mật.
 */
export function generateGuestId(cryptoObj = globalThis.crypto) {
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    const id = normalizeGuestId(cryptoObj.randomUUID())
    if (id) return id
  }
  const bytes = new Uint8Array(16)
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return 'g' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** Lấy guest_id đã lưu (sửa nếu hỏng) hoặc sinh mới + lưu. Storage lỗi → vẫn trả id dùng tạm. */
export function getOrCreateGuestId(storage, cryptoObj) {
  let saved = ''
  try { saved = normalizeGuestId(storage?.getItem(GUEST_ID_KEY)) } catch { /* storage bị chặn */ }
  if (saved) return saved
  const id = generateGuestId(cryptoObj)
  try { storage?.setItem(GUEST_ID_KEY, id) } catch { /* private mode — dùng tạm trong phiên */ }
  return id
}

/** Số sao hợp lệ 1..5 (số nguyên) hoặc 0. */
export function clampStars(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 0
}

export function readMyRating(storage, slug) {
  if (!slug) return 0
  try { return clampStars(storage?.getItem(MY_RATING_PREFIX + slug)) } catch { return 0 }
}

export function saveMyRating(storage, slug, stars) {
  const n = clampStars(stars)
  if (!slug || !n) return false
  try { storage?.setItem(MY_RATING_PREFIX + slug, String(n)); return true } catch { return false }
}

/**
 * Điều hướng phím trong radiogroup sao (mẫu WAI-ARIA radio): mũi tên đổi 1
 * sao (vòng quanh), Home/End về 1/5. Trả số sao mới hoặc null nếu phím khác.
 */
export function nextStarFromKey(current, key, max = 5) {
  const cur = clampStars(current)
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return cur >= max ? 1 : cur + 1
    case 'ArrowLeft':
    case 'ArrowDown':
      return cur <= 1 ? max : cur - 1
    case 'Home':
      return 1
    case 'End':
      return max
    default:
      return null
  }
}

/** Điểm TB + số lượt từ dữ liệu truyện, chỉ khi server thật sự trả (không đoán). */
export function ratingSummary(rating, count) {
  const c = Number(count)
  const r = Number(rating)
  if (!Number.isInteger(c) || c <= 0 || !Number.isFinite(r)) return null
  return { rating: Math.round(r * 10) / 10, count: c }
}

// ── Tìm kiếm qua URL /?q= ────────────────────────────────────────────────────
/** Đọc từ khoá từ query string ('?q=abc&x=1' → 'abc'). */
export function readSearchParam(search) {
  try {
    return new URLSearchParams(search || '').get('q') || ''
  } catch {
    return ''
  }
}

/**
 * URL mới (pathname + search + hash) sau khi đặt/bỏ `q`, giữ nguyên tham số
 * khác. q rỗng (sau trim) → bỏ hẳn `q`. Trả null nếu không có gì thay đổi.
 */
export function urlWithSearchParam({ pathname = '/', search = '', hash = '' }, q) {
  const params = new URLSearchParams(search)
  const value = String(q || '').trim()
  const before = params.get('q') || ''
  if (value === before) return null
  if (value) params.set('q', value)
  else params.delete('q')
  const qs = params.toString()
  return `${pathname}${qs ? `?${qs}` : ''}${hash || ''}`
}

// ── Góp ý name ───────────────────────────────────────────────────────────────
export const SUGGESTION_STATUS_LABELS = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
}

/** Bộ lọc trang admin — '' = Tất cả (không gửi status). */
export const SUGGESTION_FILTERS = [
  { key: 'pending', label: 'Chờ duyệt' },
  { key: 'approved', label: 'Đã duyệt' },
  { key: 'rejected', label: 'Từ chối' },
  { key: '', label: 'Tất cả' },
]

export function suggestionStatusLabel(status) {
  return SUGGESTION_STATUS_LABELS[status] || String(status || '')
}

/** Mặc định tick "Ghi luôn vào glossary" khi có chữ Hán gốc. */
export function defaultApplyGlossary(original) {
  return String(original || '').trim().length > 0
}

/** Slug lọc hợp lệ (khớp SLUG_RE của Worker: a-z0-9-, ≤ 100 ký tự) hoặc ''. */
export function normalizeSlugFilter(raw) {
  const s = String(raw || '').trim().toLowerCase()
  return /^[a-z0-9-]{1,100}$/.test(s) ? s : ''
}

/**
 * Body gửi reviewGlossarySuggestion. Chỉ gửi to/original khi duyệt (từ chối
 * thì server bỏ qua); apply_glossary chỉ true khi có chữ gốc.
 */
export function buildReviewBody(status, { adminNote = '', to = '', original = '', applyGlossary = false } = {}) {
  const body = { status, admin_note: String(adminNote || '').trim() }
  if (status === 'approved') {
    const orig = String(original || '').trim()
    body.to = String(to || '').trim()
    body.original = orig
    body.apply_glossary = Boolean(applyGlossary && orig)
  }
  return body
}

/** Link chương trong góp ý (null nếu không có số chương hợp lệ). */
export function suggestionChapterHref(slug, chapter) {
  const n = Number(chapter)
  if (!slug || chapter === null || chapter === undefined || chapter === '' || !Number.isInteger(n) || n < 0) return null
  return `/novel/${encodeURIComponent(slug)}/read/${n}`
}

/** Thông điệp lỗi từ server (err.response.data.error) hoặc thông điệp mặc định. */
export function serverErrorMessage(err, fallback) {
  const msg = err?.response?.data?.error
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  if (err && !err.response) return 'Không kết nối được máy chủ. Vui lòng thử lại.'
  return fallback
}

// ── Kiểm tra góp ý trước khi gửi (khớp glossarySuggestionCreate của Worker) ──
export const SUGGESTION_TEXT_MAX = 100
export const SUGGESTION_ORIGINAL_MAX = 50
export const SUGGESTION_NOTE_MAX = 300
// Quy tắc công khai được chèn vào markdown chương của MỌI người đọc → server
// từ chối ký tự markdown/HTML. Giữ y hệt SUGGESTION_UNSAFE_RE phía Worker.
export const SUGGESTION_UNSAFE_RE = /[[\]()!<>*_#`|~\\]/
export const SUGGESTION_UNSAFE_CHARS = '[ ] ( ) ! < > * _ # ` | ~ \\'
// Cụm gốc ngắn hơn ngưỡng này → admin được cảnh báo (thay theo chuỗi con).
export const SHORT_FROM_WARN_LEN = 3

/** Chuẩn hoá giống cleanShortText của Worker: bỏ ký tự điều khiển, gộp khoảng trắng. */
function cleanSuggestionText(value) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Kiểm tra góp ý name ở client — CHỈ cho phần "Gửi góp ý cho mọi người"
 * (quy tắc cá nhân không bị giới hạn này). Trả thông báo lỗi dễ hiểu, hoặc
 * null nếu hợp lệ. Server vẫn kiểm tra lại (đây chỉ để báo sớm).
 * @param {{ from?: string, to?: string, original?: string, note?: string }} input
 * @returns {string|null}
 */
export function validateSuggestion({ from = '', to = '', original = '', note = '' } = {}) {
  const f = cleanSuggestionText(from)
  const t = cleanSuggestionText(to)
  if (!f || !t) return 'Cần nhập cả cụm gốc và cụm thay thế.'
  if (f.length > SUGGESTION_TEXT_MAX || t.length > SUGGESTION_TEXT_MAX) {
    return `Cụm gốc và cụm thay thế tối đa ${SUGGESTION_TEXT_MAX} ký tự.`
  }
  if (f === t) return 'Cụm thay thế phải khác cụm gốc.'
  if ([...f].length < 2) return 'Cụm gốc cần ít nhất 2 ký tự để góp ý cho mọi người (1 ký tự sẽ bị thay ở khắp nơi trong chương).'
  if (SUGGESTION_UNSAFE_RE.test(f) || SUGGESTION_UNSAFE_RE.test(t)) {
    return `Góp ý cho mọi người không được chứa các ký tự ${SUGGESTION_UNSAFE_CHARS}. Bạn vẫn có thể bỏ chọn "Gửi góp ý cho mọi người" để chỉ sửa cho riêng mình.`
  }
  if (cleanSuggestionText(original).length > SUGGESTION_ORIGINAL_MAX) return `Chữ gốc tối đa ${SUGGESTION_ORIGINAL_MAX} ký tự.`
  if (cleanSuggestionText(note).length > SUGGESTION_NOTE_MAX) return `Ghi chú tối đa ${SUGGESTION_NOTE_MAX} ký tự.`
  return null
}

/** Cụm `from` ngắn (≤ 3 ký tự) — sẽ thay theo chuỗi con trên toàn chương, dễ thay nhầm. */
export function isShortSuggestionFrom(from) {
  const f = cleanSuggestionText(from)
  return f.length > 0 && [...f].length <= SHORT_FROM_WARN_LEN
}

/**
 * Dòng "Xem trước" cho admin: câu mẫu `…from…` → `…to…`. Trả null nếu thiếu `from`.
 * @returns {{ before: string, after: string } | null}
 */
export function suggestionPreview(from, to) {
  const f = String(from ?? '').trim()
  const t = String(to ?? '').trim()
  if (!f) return null
  return { before: `…${f}…`, after: `…${t}…` }
}

// ── Tra chữ Hán của name (chỉ mục vi → zh từ /api/novels/:slug/names) ────────
/** Khoá so khớp: NFC, gộp khoảng trắng, chữ thường (locale vi). */
export function normalizeNameKey(text) {
  let s = String(text ?? '')
  try { s = s.normalize('NFC') } catch { /* môi trường không có normalize */ }
  s = s.replace(/\s+/g, ' ').trim()
  try { return s.toLocaleLowerCase('vi') } catch { return s.toLowerCase() }
}

// Map dựng 1 lần cho mỗi mảng chỉ mục (WeakMap → tự giải phóng khi đổi truyện).
const NAME_LOOKUP_CACHE = new WeakMap()

/**
 * Tra chữ Hán của cụm tiếng Việt trong chỉ mục names.
 * @param {Array<{vi:string, zh:string[]}>|{names:Array}} namesIndex
 * @param {string} text cụm đang chọn
 * @returns {string[]} danh sách chữ Hán (bản sao, đã bỏ trùng) — không khớp → []
 */
export function lookupNameZh(namesIndex, text) {
  const list = Array.isArray(namesIndex) ? namesIndex : (Array.isArray(namesIndex?.names) ? namesIndex.names : null)
  const key = normalizeNameKey(text)
  if (!list || !list.length || !key) return []
  let map = NAME_LOOKUP_CACHE.get(list)
  if (!map) {
    map = new Map()
    for (const item of list) {
      if (!item || typeof item.vi !== 'string') continue
      const zh = (Array.isArray(item.zh) ? item.zh : [item.zh]).filter(z => typeof z === 'string' && z.trim())
      if (!zh.length) continue
      const k = normalizeNameKey(item.vi)
      if (!k) continue
      // Hai mục khác hoa thường cùng khoá → gộp chữ Hán, giữ thứ tự xuất hiện.
      map.set(k, [...new Set([...(map.get(k) || []), ...zh.map(z => z.trim())])])
    }
    NAME_LOOKUP_CACHE.set(list, map)
  }
  return [...(map.get(key) || [])]
}
