/**
 * engagementApi.js — Hợp đồng gọi API cho đợt "học từ đối thủ" (2026-11):
 * lượt đọc thật, BXH theo kỳ, góp ý name, quy tắc thay thế công khai,
 * đồng bộ cài đặt đọc. Mọi hàm KHÔNG ném lỗi ra ngoài trừ khi ghi rõ.
 *
 * Worker tương ứng: src/index.js (readStart, trackView, getViewRankings,
 * getPublicReplacements, glossarySuggestion*, userPrefs*).
 */
import api, { publicApi } from './api'
import userApi from './userApi'

// ── Lượt đọc thật ────────────────────────────────────────────────────────────
/** Xin token khi mở chương. Trả { token|null, min_seconds } hoặc null nếu lỗi. */
export async function requestReadToken(slug, chapter) {
  try {
    const { data } = await publicApi.post(`/novels/${encodeURIComponent(slug)}/read-start`, {
      chapter: Number.isInteger(chapter) && chapter >= 0 ? chapter : 0,
    })
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

/** Báo đã đọc thật. token null (server chưa cấu hình secret) → gửi body rỗng như bản cũ. */
export async function reportRealRead(slug, token) {
  try {
    const { data } = await publicApi.post(`/novels/${encodeURIComponent(slug)}/view`, token ? { token } : {})
    return data
  } catch {
    return null
  }
}

// ── BXH lượt đọc theo kỳ ─────────────────────────────────────────────────────
/** period: 'day' | 'week' | 'month'. Trả { period, since, items[], unavailable? }. Ném lỗi mạng. */
export async function fetchViewRankings(period = 'week', limit = 20) {
  const { data } = await publicApi.get('/rankings/views', { params: { period, limit } })
  return data
}

// ── Quy tắc sửa name công khai (đã duyệt) ────────────────────────────────────
/** Trả mảng [{from,to,whole}] — lỗi/404 → []. */
export async function fetchPublicReplacements(slug) {
  try {
    const { data } = await publicApi.get(`/novels/${encodeURIComponent(slug)}/replacements`)
    return Array.isArray(data?.rules) ? data.rules : []
  } catch {
    return []
  }
}

// ── Chỉ mục name vi → zh (glossary đảo ngược) ───────────────────────────────
// Nhớ Promise theo slug trong bộ nhớ: mở hộp sửa name nhiều lần / đổi chương
// không tải lại (Worker cũng cache edge 1 giờ). 404 (PUBLIC_NAMES=off, truyện ẩn)
// → [] và nhớ luôn; lỗi khác (mạng, 429, 5xx) → [] nhưng bỏ cache để lần mở sau thử lại.
const namesCache = new Map()

/** Trả mảng [{ vi, zh: string[] }] — lỗi/404 → []. Không ném lỗi. */
export function fetchNovelNames(slug) {
  if (!slug) return Promise.resolve([])
  if (!namesCache.has(slug)) {
    const p = publicApi.get(`/novels/${encodeURIComponent(slug)}/names`)
      .then(({ data }) => (Array.isArray(data?.names) ? data.names : []))
      .catch((err) => {
        if (err?.response?.status !== 404) namesCache.delete(slug) // chỉ nhớ 404; lỗi tạm → cho thử lại
        return []
      })
    namesCache.set(slug, p)
  }
  return namesCache.get(slug)
}

// ── Góp ý name ───────────────────────────────────────────────────────────────
/** Cần đăng nhập. body: { from, to, original?, note?, chapter? }. Ném lỗi axios (đọc err.response.data.error). */
export async function submitGlossarySuggestion(slug, body) {
  const { data } = await userApi.post(`/novels/${encodeURIComponent(slug)}/glossary-suggestions`, body)
  return data
}

export async function fetchMyGlossarySuggestions() {
  const { data } = await userApi.get('/user/glossary-suggestions')
  return Array.isArray(data) ? data : []
}

/** Admin. params: { status?, slug? } */
export async function fetchAdminGlossarySuggestions(params = {}) {
  const { data } = await api.get('/admin/glossary-suggestions', { params })
  return Array.isArray(data) ? data : []
}

/** Admin. body: { status: 'approved'|'rejected', admin_note?, to?, original?, apply_glossary? } */
export async function reviewGlossarySuggestion(id, body) {
  const { data } = await api.post(`/admin/glossary-suggestions/${id}/review`, body)
  return data
}

// ── Cài đặt người dùng ───────────────────────────────────────────────────────
/** Trả { prefs|null, updated_at, client_updated_at } hoặc null nếu lỗi/chưa đăng nhập. */
export async function fetchUserPrefs() {
  try {
    const { data } = await userApi.get('/user/prefs')
    return data
  } catch {
    return null
  }
}

/**
 * prefs: { v, reader?, replacements? }. Lưu được → { ok: true, client_updated_at }
 * (mốc server đã kẹp ≤ giờ server + 5 phút; server cũ không trả thì dùng mốc đã
 * gửi) — vẫn truthy nên nơi gọi kiểu `if (await saveUserPrefs(...))` không đổi.
 * Lỗi (409 = server có bản mới hơn) → false.
 */
export async function saveUserPrefs(prefs, clientUpdatedAt = Date.now()) {
  try {
    const { data } = await userApi.put('/user/prefs', { prefs, client_updated_at: clientUpdatedAt })
    const serverAt = Number(data?.client_updated_at)
    return { ok: true, client_updated_at: Number.isFinite(serverAt) && serverAt > 0 ? serverAt : clientUpdatedAt }
  } catch {
    return false
  }
}
