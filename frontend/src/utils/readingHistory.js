// ── Reading history (read-only side) ─────────────────────────────────────────
// Gom logic đọc cookie/localStorage vốn nằm rải rác ở App.jsx / Dashboard.jsx.
// Phía GHI (saveReadProgress) vẫn nằm nguyên trong Reader.jsx — không đổi.
//
// Khóa lưu trữ:
//   last_read_novel                → slug truyện đọc gần nhất
//   last_read_chapter_<slug>       → chương đọc gần nhất của truyện đó
// (cả cookie lẫn localStorage, localStorage ưu tiên)

const CHAPTER_PREFIX = 'last_read_chapter_'
// Khóa cũ do Reader.jsx ghi từ trước — DÙNG LẠI, không tạo khóa mới trùng lặp:
//   read_chapters_<slug> → JSON array các chương (số hoặc filename) đã mở
const READ_SET_PREFIX = 'read_chapters_'

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
 * Toàn bộ lịch sử đọc: [{ slug, chapter, isCurrent }].
 * Truyện đang đọc dở gần nhất được đưa lên đầu danh sách.
 */
export function getAllHistory() {
  const map = new Map()

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
  const list = [...map.entries()].map(([slug, data]) => ({
    slug,
    chapter: data.chapter,
    timestamp: data.timestamp,
    isCurrent: slug === current,
  }))
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
