/**
 * updatesFeed.js — xử lý dữ liệu "Nhật ký cập nhật" (GET /api/updates).
 * Hàm thuần, không phụ thuộc React/DOM → test bằng node --test.
 *
 * Mỗi item API: { slug, title, author, cover_url, genre, status, day (YYYY-MM-DD giờ VN),
 *   count, from_chapter, to_chapter, latest_title, last_at (ISO UTC), is_new_novel }
 */

export const UPDATES_URL = '/updates'
export const LAST_SEEN_KEY = 'hd_updates_last_seen'

const VN_OFFSET_MS = 7 * 3600 * 1000
const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']

/** Ngày theo giờ Việt Nam (YYYY-MM-DD) của một thời điểm (ms). */
export function vnDay(ms) {
  const d = new Date(ms + VN_OFFSET_MS)
  return d.toISOString().slice(0, 10)
}

/** Nhãn ngày thân thiện: "Hôm nay" / "Hôm qua" / "Thứ ba, 14/10". */
export function dayLabel(day, nowMs = Date.now()) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return ''
  const today = vnDay(nowMs)
  if (day === today) return 'Hôm nay'
  if (day === vnDay(nowMs - 86400000)) return 'Hôm qua'
  const [y, m, d] = day.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

/** "Chương 1712" hoặc "Chương 1711 – 1715". */
export function chapterRangeLabel(item) {
  const from = Number(item?.from_chapter) || 0
  const to = Number(item?.to_chapter) || 0
  if (!to) return ''
  if (!from || from === to) return `Chương ${to}`
  return `Chương ${from} – ${to}`
}

/** Bỏ tiền tố "Chương N:" khỏi tiêu đề chương để không lặp với chapterRangeLabel. */
export function cleanChapterTitle(title) {
  const t = String(title || '').trim()
  return t.replace(/^(?:chương|chapter|第)\s*\d+\s*(?:章)?\s*[:：.\-–—]?\s*/i, '').trim()
}

/**
 * Lọc item theo bộ lọc giao diện.
 * filter: 'all' | 'new' (truyện mới lên) | 'reading' (truyện có trong lịch sử đọc)
 */
export function filterUpdates(items, { filter = 'all', readingSlugs = [], query = '' } = {}) {
  const list = Array.isArray(items) ? items : []
  const reading = new Set(readingSlugs)
  const q = String(query || '').trim().toLowerCase()
  return list.filter(it => {
    if (filter === 'new' && !it.is_new_novel) return false
    if (filter === 'reading' && !reading.has(it.slug)) return false
    if (q && !`${it.title || ''} ${it.author || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

/** Gom item theo ngày (giữ thứ tự API: mới nhất trước). */
export function groupByDay(items, nowMs = Date.now()) {
  const groups = []
  const byDay = new Map()
  for (const it of Array.isArray(items) ? items : []) {
    const day = it?.day || ''
    let g = byDay.get(day)
    if (!g) {
      g = { day, label: dayLabel(day, nowMs) || 'Không rõ ngày', items: [], chapters: 0 }
      byDay.set(day, g)
      groups.push(g)
    }
    g.items.push(it)
    g.chapters += Number(it.count) || 0
  }
  return groups
}

/** Thời điểm cập nhật mới nhất (ms) trong feed, null nếu rỗng. */
export function latestUpdateMs(items) {
  let best = null
  for (const it of Array.isArray(items) ? items : []) {
    const ms = Date.parse(it?.last_at || '')
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms
  }
  return best
}

/** Có cập nhật mới hơn lần cuối người dùng mở trang feed không. */
export function hasUnseenUpdates(items, lastSeenMs) {
  const latest = latestUpdateMs(items)
  if (latest === null) return false
  const seen = Number(lastSeenMs)
  if (!Number.isFinite(seen) || seen <= 0) return true
  return latest > seen
}

/** Đọc/ghi mốc "đã xem" trong localStorage — luôn an toàn (private mode, SSR). */
export function readLastSeen(storage = globalThis.localStorage) {
  try {
    const v = Number(storage?.getItem(LAST_SEEN_KEY))
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

export function markSeen(ms = Date.now(), storage = globalThis.localStorage) {
  try { storage?.setItem(LAST_SEEN_KEY, String(ms)) } catch { /* bỏ qua */ }
}
