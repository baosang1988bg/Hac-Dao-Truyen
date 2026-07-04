// ── Reading history (read-only side) ─────────────────────────────────────────
// Gom logic đọc cookie/localStorage vốn nằm rải rác ở App.jsx / Dashboard.jsx.
// Phía GHI (saveReadProgress) vẫn nằm nguyên trong Reader.jsx — không đổi.
//
// Khóa lưu trữ:
//   last_read_novel                → slug truyện đọc gần nhất
//   last_read_chapter_<slug>       → chương đọc gần nhất của truyện đó
// (cả cookie lẫn localStorage, localStorage ưu tiên)

const CHAPTER_PREFIX = 'last_read_chapter_'

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
        if (slug && chapter) map.set(slug, chapter)
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
          map.set(slug, decodeURIComponent(part.slice(eq + 1)))
        } catch { /* giá trị cookie hỏng — bỏ qua */ }
      }
    }
  })

  const current = getLastRead()?.slug || null
  const list = [...map.entries()].map(([slug, chapter]) => ({
    slug,
    chapter,
    isCurrent: slug === current,
  }))
  list.sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0))
  return list
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
