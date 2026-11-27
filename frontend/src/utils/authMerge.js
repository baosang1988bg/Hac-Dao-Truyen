/**
 * authMerge.js — gộp lịch sử đọc LOCAL lên tài khoản ở lần đầu đăng nhập trên
 * một máy (THUẦN: mọi I/O tiêm qua tham số → test được bằng node --test).
 *
 * Quy tắc (plans/KE_HOACH_TRIEN_KHAI_DANG_NHAP_2026-11-27.md mục 3):
 * - Chỉ chạy 1 lần / user / trình duyệt: cờ localStorage `authMerged:<userId>`.
 * - Lấy GET /user/progress; với tối đa 50 truyện trong lịch sử đọc local:
 *   đẩy khi server CHƯA có tiến độ truyện đó, hoặc bản local MỚI HƠN
 *   (so updated_at của server với timestamp local).
 * - PUT /user/progress/:slug {chapter, paragraph?, client_updated_at} TUẦN TỰ
 *   (mỗi PUT = 1 lượt ghi D1 — không bắn song song), lỗi từng truyện thì bỏ qua.
 * - Tiến độ EPUB trên server (type 'epub') không bị lịch sử chương ghi đè.
 */

export const MERGE_LIMIT = 50
export const MERGE_FLAG_PREFIX = 'authMerged:'

/** Khoá cờ "đã gộp" cho một user. */
export function mergeFlagKey(userId) {
  return `${MERGE_FLAG_PREFIX}${userId}`
}

/**
 * Thời điểm (epoch ms) từ chuỗi thời gian server. D1 trả `datetime('now')` dạng
 * 'YYYY-MM-DD HH:MM:SS' (UTC, không có hậu tố Z); cũng nhận ISO / số epoch.
 * Không đọc được → 0.
 */
export function parseServerTime(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0
  const s = String(value).trim()
  if (/^\d+$/.test(s)) return parseServerTime(Number(s))
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}

/** Số chương nguyên dương từ giá trị lịch sử local ("12", 12) — filename/EPUB → null. */
function chapterNumber(value) {
  const s = String(value ?? '').trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * Chọn các truyện cần đẩy lên server.
 * localHistory: [{ slug, chapter, timestamp, paragraph? }] (mới nhất trước — như getAllHistory)
 * serverProgress: [{ slug, chapter, type, updated_at }] (GET /user/progress)
 * → [{ slug, body: { type:'chapter', chapter, paragraph?, client_updated_at } }]
 */
export function selectProgressToPush(localHistory, serverProgress, { limit = MERGE_LIMIT } = {}) {
  const server = new Map()
  for (const p of Array.isArray(serverProgress) ? serverProgress : []) {
    if (p && typeof p.slug === 'string' && p.slug) server.set(p.slug, p)
  }
  const seen = new Set()
  const out = []
  const list = (Array.isArray(localHistory) ? localHistory : [])
    .filter(h => h && typeof h.slug === 'string' && h.slug)
    .slice()
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))

  for (const h of list) {
    if (out.length >= limit) break
    if (seen.has(h.slug)) continue
    seen.add(h.slug)
    const chapter = chapterNumber(h.chapter)
    if (chapter === null) continue
    const localAt = Number(h.timestamp) || 0
    const remote = server.get(h.slug)
    if (remote) {
      if (remote.type === 'epub') continue // không đè tiến độ EPUB bằng tiến độ chương
      const remoteAt = parseServerTime(remote.updated_at)
      // Local không có mốc thời gian (dữ liệu cookie cũ) → không đủ căn cứ "mới hơn".
      if (!localAt || localAt <= remoteAt) continue
      // Cùng chương, không có đoạn → không có gì mới để ghi (tiết kiệm 1 lượt ghi D1).
      if (Number(remote.chapter) === chapter && !Number.isInteger(h.paragraph)) continue
    }
    const body = { type: 'chapter', chapter }
    if (Number.isInteger(h.paragraph) && h.paragraph >= 0) body.paragraph = h.paragraph
    // client_updated_at = lúc đọc thật trên máy này → server tự bỏ qua nếu máy
    // khác đã ghi tiến độ mới hơn (409), không ghi đè lùi.
    if (localAt > 0) body.client_updated_at = Math.floor(localAt)
    out.push({ slug: h.slug, body })
  }
  return out
}

/**
 * Chạy gộp 1 lần cho user (nối dây ở AuthContext).
 * deps: {
 *   storage: { getItem, setItem },
 *   getLocalHistory: () => [{slug, chapter, timestamp, paragraph?}],
 *   fetchProgress: () => Promise<array>,
 *   putProgress: (slug, body) => Promise,
 * }
 * Trả { skipped: true } nếu đã gộp trước đó, hoặc { pushed, failed }.
 * fetchProgress lỗi → KHÔNG đặt cờ (lần sau thử lại) và ném lỗi ra ngoài.
 */
export async function runAuthMerge(userId, deps) {
  if (userId == null || userId === '') return { skipped: true }
  const key = mergeFlagKey(userId)
  try {
    if (deps.storage.getItem(key)) return { skipped: true }
  } catch { return { skipped: true } } // storage bị chặn → không thể nhớ cờ, đừng đẩy lặp lại
  const serverProgress = await deps.fetchProgress()
  const todo = selectProgressToPush(deps.getLocalHistory() || [], serverProgress || [])
  let pushed = 0
  let failed = 0
  for (const { slug, body } of todo) {
    try {
      await deps.putProgress(slug, body)
      pushed += 1
    } catch {
      failed += 1 // 409 (server có bản mới hơn) / lỗi mạng — bỏ qua truyện này
    }
  }
  try { deps.storage.setItem(key, String(Date.now())) } catch { /* bỏ qua */ }
  return { pushed, failed }
}
