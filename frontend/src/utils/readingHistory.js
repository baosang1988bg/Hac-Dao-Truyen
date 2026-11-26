// ── Reading history ──────────────────────────────────────────────────────────
// Gom logic đọc/ghi cookie/localStorage của lịch sử đọc (Reader ghi qua
// saveReadProgress, trang chủ / Tủ truyện / NovelPage đọc).
//
// Khóa lưu trữ:
//   last_read_novel                → slug truyện đọc gần nhất
//   last_read_chapter_<slug>       → chương đọc gần nhất của truyện đó
//   last_read_time_<slug>          → mốc thời gian (ms) lần đọc gần nhất
// (cả cookie lẫn localStorage, localStorage ưu tiên)
//   reading_history_v2             → JSON [{slug, chapter, paragraph?, title, cover_url, timestamp}]
//                                    (dedupe theo slug, tối đa HISTORY_LIMIT mục) — có
//                                    tên + bìa để trang chủ hiển thị không cần gọi API.
//                                    Dữ liệu cũ (chỉ có khóa per-slug) vẫn đọc được.
//                                    paragraph (số nguyên ≥ 0, có thể thiếu ở dữ liệu cũ)
//                                    = index đoạn văn đầu tiên đang hiển thị của `chapter`.
//                                    ban (mã bản dịch phụ, thiếu/null = bản mặc định — dữ
//                                    liệu cũ không có field này) → link "Đọc tiếp" mang ?ban=.
//   hd:ban:<slug>                  → bản dịch đang chọn của truyện (NovelPage đọc/ghi,
//                                    Reader ghi khi mở link có ?ban=).

import { normalizeEditionCode } from './chapters.js'

const CHAPTER_PREFIX = 'last_read_chapter_'
// Khóa cũ do Reader.jsx ghi từ trước — DÙNG LẠI, không tạo khóa mới trùng lặp:
//   read_chapters_<slug> → JSON array các chương (số hoặc filename) đã mở
const READ_SET_PREFIX = 'read_chapters_'
const HISTORY_KEY = 'reading_history_v2'
export const HISTORY_LIMIT = 50

/**
 * Hàm thuần: chèn/cập nhật một mục lịch sử lên đầu danh sách, dedupe theo slug,
 * giữ tối đa `limit` mục. Giữ lại title/cover_url cũ nếu mục mới không có.
 */
export function mergeHistoryEntry(list, entry, limit = HISTORY_LIMIT) {
  const safe = Array.isArray(list) ? list.filter(e => e && typeof e.slug === 'string' && e.slug) : []
  if (!entry || !entry.slug) return safe.slice(0, limit)
  const prev = safe.find(e => e.slug === entry.slug)
  const chapter = entry.chapter != null ? String(entry.chapter) : prev?.chapter ?? null
  // paragraph chỉ có nghĩa với ĐÚNG chương đó: mục mới không kèm paragraph mà
  // vẫn là chương cũ → giữ đoạn đã lưu; đổi chương → bỏ.
  let paragraph = null
  if (isValidParagraph(entry.paragraph)) paragraph = entry.paragraph
  else if (prev && prev.chapter != null && String(prev.chapter) === chapter && isValidParagraph(prev.paragraph)) {
    paragraph = prev.paragraph
  }
  const merged = {
    slug: entry.slug,
    chapter,
    title: entry.title || prev?.title || null,
    cover_url: entry.cover_url || prev?.cover_url || null,
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
  }
  if (paragraph !== null) merged.paragraph = paragraph
  // ban: mục mới có khoá `ban` (Reader luôn gửi, null = mặc định) → dùng nó;
  // không có khoá (caller cũ) → giữ bản dịch đã lưu. Mặc định thì KHÔNG ghi
  // field (giữ đúng dạng dữ liệu cũ).
  const ban = Object.prototype.hasOwnProperty.call(entry, 'ban')
    ? normalizeEditionCode(entry.ban)
    : normalizeEditionCode(prev?.ban)
  if (ban) merged.ban = ban
  return [merged, ...safe.filter(e => e.slug !== entry.slug)].slice(0, limit)
}

function isValidParagraph(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100_000
}

/**
 * Hàm thuần: ghi index đoạn văn cho mục lịch sử của slug — CHỈ khi mục đó đang
 * ở đúng `chapter` (không tạo mục mới, không đè chương khác). Trả list mới, hoặc
 * chính `list` nếu không có gì thay đổi.
 */
export function setHistoryParagraph(list, slug, chapter, paragraph) {
  if (!Array.isArray(list) || !slug || !isValidParagraph(paragraph)) return list
  const idx = list.findIndex(e => e && e.slug === slug)
  if (idx === -1) return list
  const cur = list[idx]
  if (cur.chapter == null || String(cur.chapter) !== String(chapter)) return list
  if (cur.paragraph === paragraph) return list
  const next = [...list]
  next[idx] = { ...cur, paragraph }
  return next
}

/** Hàm thuần: mã bản dịch phụ đã lưu của slug trong list (null = bản mặc định / dữ liệu cũ). */
export function findHistoryEdition(list, slug) {
  if (!Array.isArray(list) || !slug) return null
  const e = list.find(x => x && x.slug === slug)
  return e ? normalizeEditionCode(e.ban) : null
}

/** Hàm thuần: đoạn văn đã lưu cho (slug, chapter) trong list, hoặc null. */
export function findHistoryParagraph(list, slug, chapter) {
  if (!Array.isArray(list) || !slug) return null
  const e = list.find(x => x && x.slug === slug)
  if (!e || e.chapter == null || String(e.chapter) !== String(chapter)) return null
  return isValidParagraph(e.paragraph) ? e.paragraph : null
}

function readHistoryList() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/**
 * Ghi tiến trình đọc (Reader gọi mỗi khi mở chương thành công).
 * meta: { title, cover_url, ban } — tuỳ chọn: tên + bìa để trang chủ hiện ngay;
 * ban = mã bản dịch đang đọc (null = mặc định). Không truyền ban → giữ bản cũ.
 */
export function saveReadProgress(slug, chapId, meta = {}) {
  if (!slug || chapId === null || chapId === undefined) return
  try {
    // 1. Cookie (tương thích dữ liệu cũ / trình duyệt chặn localStorage)
    document.cookie = `last_read_novel=${slug}; path=/; max-age=31536000; SameSite=Lax`
    document.cookie = `${CHAPTER_PREFIX}${slug}=${encodeURIComponent(chapId)}; path=/; max-age=31536000; SameSite=Lax`
  } catch { /* bỏ qua */ }
  try {
    // 2. localStorage — khóa per-slug cũ (giữ nguyên để các bản cũ vẫn đọc được)
    const now = Date.now()
    localStorage.setItem('last_read_novel', slug)
    localStorage.setItem(`${CHAPTER_PREFIX}${slug}`, String(chapId))
    localStorage.setItem(`last_read_time_${slug}`, String(now))
    // 3. Danh sách có meta (tên + bìa)
    const entry = { slug, chapter: chapId, title: meta?.title, cover_url: meta?.cover_url, timestamp: now }
    if (meta && Object.prototype.hasOwnProperty.call(meta, 'ban')) entry.ban = meta.ban
    const next = mergeHistoryEntry(readHistoryList(), entry)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch { /* localStorage bị chặn/đầy — bỏ qua */ }
  // 4. Đánh dấu chương đã đọc (helper dùng chung với mục lục NovelPage)
  markChapterRead(slug, chapId)
}

/**
 * Lưu đoạn văn đang đọc (Reader gọi khi người đọc cuộn, throttle ~1 giây).
 * Chỉ cập nhật khi lịch sử của truyện đang trỏ đúng chương này.
 */
export function saveReadParagraph(slug, chapId, paragraph) {
  if (!slug || chapId === null || chapId === undefined) return
  try {
    const list = readHistoryList()
    const next = setHistoryParagraph(list, slug, chapId, paragraph)
    if (next !== list) localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch { /* localStorage bị chặn/đầy — bỏ qua */ }
}

/** Đoạn văn đã lưu khi đọc dở đúng chương này (số nguyên) hoặc null. */
export function getReadParagraph(slug, chapId) {
  return findHistoryParagraph(readHistoryList(), slug, chapId)
}

/**
 * Bổ sung meta (tên/bìa) cho mục lịch sử đã có — vd Reader tải xong chi tiết
 * truyện SAU khi đã lưu chương. Không tạo mục mới nếu slug chưa có trong lịch sử.
 */
export function updateHistoryMeta(slug, meta = {}) {
  if (!slug || (!meta.title && !meta.cover_url)) return
  try {
    const list = readHistoryList()
    const idx = list.findIndex(e => e && e.slug === slug)
    if (idx === -1) return
    const cur = list[idx]
    if (cur.title === (meta.title || cur.title) && cur.cover_url === (meta.cover_url || cur.cover_url)) return
    list[idx] = { ...cur, title: meta.title || cur.title || null, cover_url: meta.cover_url || cur.cover_url || null }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch { /* bỏ qua */ }
}

/** Bản dịch phụ đang đọc của truyện theo lịch sử (null = mặc định). */
export function getHistoryEdition(slug) {
  return findHistoryEdition(readHistoryList(), slug)
}

// ── Bản dịch đang chọn theo truyện (localStorage 'hd:ban:<slug>') ────────────
const EDITION_KEY_PREFIX = 'hd:ban:'

/** Bản dịch phụ đã chọn cho truyện (null = mặc định / không đọc được storage). */
export function getStoredEdition(slug) {
  if (!slug) return null
  try { return normalizeEditionCode(localStorage.getItem(EDITION_KEY_PREFIX + slug)) } catch { return null }
}

/** Ghi bản dịch đã chọn; code rỗng/mặc định → xoá khoá. */
export function setStoredEdition(slug, code) {
  if (!slug) return
  try {
    const norm = normalizeEditionCode(code)
    if (norm) localStorage.setItem(EDITION_KEY_PREFIX + slug, norm)
    else localStorage.removeItem(EDITION_KEY_PREFIX + slug)
  } catch { /* chế độ riêng tư / chặn storage — chỉ không nhớ được lựa chọn */ }
}

function getCookie(name) {
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift())
  return null
}

/** Chương đọc gần nhất của một truyện cụ thể (hoặc null). */
export function getLastReadForSlug(slug) {
  if (!slug) return null
  try {
    return localStorage.getItem(`${CHAPTER_PREFIX}${slug}`) || getCookie(`${CHAPTER_PREFIX}${slug}`)
  } catch {
    return getCookie(`${CHAPTER_PREFIX}${slug}`)
  }
}

/** Truyện + chương đọc gần nhất toàn cục: { slug, chapter } hoặc null. */
export function getLastRead() {
  let slug = null
  try {
    slug = localStorage.getItem('last_read_novel') || getCookie('last_read_novel')
  } catch {
    slug = getCookie('last_read_novel')
  }
  if (!slug) return null
  const chapter = getLastReadForSlug(slug)
  if (!chapter) return null
  return { slug, chapter }
}

/**
 * Toàn bộ lịch sử đọc: [{ slug, chapter, timestamp, isCurrent, title?, cover_url? }].
 * Sắp xếp mới nhất trước. title/cover_url chỉ có với mục ghi từ bản mới
 * (reading_history_v2) — mục cũ thì nơi hiển thị tự gọi API bổ sung.
 */
export function getAllHistory() {
  const map = new Map()
  const metaBySlug = new Map()
  for (const e of readHistoryList()) {
    if (e && e.slug && !metaBySlug.has(e.slug)) metaBySlug.set(e.slug, e)
  }

  // 1. localStorage
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(CHAPTER_PREFIX)) {
        const slug = key.slice(CHAPTER_PREFIX.length)
        const chapter = localStorage.getItem(key)
        const timestamp = parseInt(localStorage.getItem(`last_read_time_${slug}`) || '0', 10)
        if (slug && chapter) map.set(slug, { chapter, timestamp })
      }
    }
  } catch { /* localStorage bị chặn — bỏ qua */ }

  // 2. cookies (bổ sung những slug chưa có)
  document.cookie.split(';').forEach(part => {
    const eq = part.indexOf('=')
    if (eq === -1) return
    const key = part.slice(0, eq).trim()
    if (key.startsWith(CHAPTER_PREFIX)) {
      const slug = key.slice(CHAPTER_PREFIX.length)
      if (slug && !map.has(slug)) {
        try {
          map.set(slug, { chapter: decodeURIComponent(part.slice(eq + 1)), timestamp: 0 })
        } catch { /* giá trị cookie hỏng — bỏ qua */ }
      }
    }
  })

  const current = getLastRead()?.slug || null
  // 3. Mục chỉ có trong reading_history_v2 (hiếm — vd khóa per-slug bị xoá)
  for (const [slug, e] of metaBySlug) {
    if (!map.has(slug) && e.chapter) map.set(slug, { chapter: String(e.chapter), timestamp: Number(e.timestamp) || 0 })
  }

  const list = [...map.entries()].map(([slug, data]) => {
    const meta = metaBySlug.get(slug)
    return {
      slug,
      chapter: data.chapter,
      timestamp: data.timestamp,
      isCurrent: slug === current,
      ...(meta?.title ? { title: meta.title } : {}),
      ...(meta?.cover_url ? { cover_url: meta.cover_url } : {}),
      // Bản dịch chỉ đúng khi mục v2 cùng chương với khoá per-slug (khoá per-slug
      // có thể mới hơn nếu một bản cũ của site ghi mà không cập nhật v2).
      ban: meta && String(meta.chapter) === String(data.chapter) ? normalizeEditionCode(meta.ban) : null,
    }
  })
  list.sort((a, b) => b.timestamp - a.timestamp)
  return list
}

// ── Đánh dấu chương đã đọc ────────────────────────────────────────────────────

/**
 * Ghi nhận một chương đã đọc (Reader gọi mỗi khi mở chương).
 * chapterId: số chương (string/number) hoặc filename — giữ nguyên định dạng
 * tham số URL của Reader để mục lục so khớp được cả hai.
 */
export function markChapterRead(slug, chapterId) {
  if (!slug || chapterId === null || chapterId === undefined) return
  try {
    const key = `${READ_SET_PREFIX}${slug}`
    const list = JSON.parse(localStorage.getItem(key) || '[]')
    const id = String(chapterId)
    if (Array.isArray(list) && !list.includes(id)) {
      list.push(id)
      localStorage.setItem(key, JSON.stringify(list))
    }
  } catch { /* localStorage bị chặn / dữ liệu hỏng — bỏ qua */ }
}

/** Tập các chương đã đọc của một truyện → Set<string> (rỗng nếu chưa có). */
export function getReadChapters(slug) {
  if (!slug) return new Set()
  try {
    const list = JSON.parse(localStorage.getItem(`${READ_SET_PREFIX}${slug}`) || '[]')
    return new Set(Array.isArray(list) ? list.map(String) : [])
  } catch {
    return new Set()
  }
}

/** Nhãn hiển thị đẹp cho tham số chương (bỏ .md / _VI, decode URI). */
export function fmtChapterLabel(chapter) {
  if (!chapter) return ''
  try {
    return decodeURIComponent(chapter).replace('.md', '').replace('_VI', '')
  } catch {
    return String(chapter).replace('.md', '').replace('_VI', '')
  }
}
