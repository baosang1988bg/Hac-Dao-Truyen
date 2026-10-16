// ── Reading history ──────────────────────────────────────────────────────────
// Gom logic đọc/ghi cookie/localStorage của lịch sử đọc (Reader ghi qua
// saveReadProgress, trang chủ / Tủ truyện / NovelPage đọc).
//
// Khóa lưu trữ:
//   last_read_novel                → slug truyện đọc gần nhất
//   last_read_chapter_<slug>       → chương đọc gần nhất của truyện đó
//   last_read_time_<slug>          → mốc thời gian (ms) lần đọc gần nhất
// (cả cookie lẫn localStorage, localStorage ưu tiên)
//   reading_history_v2             → JSON [{slug, chapter, title, cover_url, timestamp}]
//                                    (dedupe theo slug, tối đa HISTORY_LIMIT mục) — có
//                                    tên + bìa để trang chủ hiển thị không cần gọi API.
//                                    Dữ liệu cũ (chỉ có khóa per-slug) vẫn đọc được.

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
  const merged = {
    slug: entry.slug,
    chapter: entry.chapter != null ? String(entry.chapter) : prev?.chapter ?? null,
    title: entry.title || prev?.title || null,
    cover_url: entry.cover_url || prev?.cover_url || null,
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
  }
  return [merged, ...safe.filter(e => e.slug !== entry.slug)].slice(0, limit)
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
 * meta: { title, cover_url } — tuỳ chọn, để trang chủ hiện ngay tên + bìa.
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
    const next = mergeHistoryEntry(readHistoryList(), {
      slug, chapter: chapId, title: meta?.title, cover_url: meta?.cover_url, timestamp: now,
    })
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch { /* localStorage bị chặn/đầy — bỏ qua */ }
  // 4. Đánh dấu chương đã đọc (helper dùng chung với mục lục NovelPage)
  markChapterRead(slug, chapId)
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
