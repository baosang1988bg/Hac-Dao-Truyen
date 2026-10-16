/**
 * Adapter dùng chung cho GET /api/novels.
 *
 * Cả 2 backend (Worker `src/index.js` getNovels và Python `routers/novels.py`
 * list_novels) đều trả CÙNG shape: {novels: [...], total, page, limit, pages}.
 * Trước đây nhiều trang tự viết `Array.isArray(data) ? data : data.novels`
 * (hoặc tệ hơn, coi response luôn là mảng — AccountPage.jsx) rải rác khắp nơi.
 * File này gom logic đó lại một chỗ, tránh lặp và tránh bug khi contract đổi.
 */

// ── Bộ tham số dùng chung giữa các section trang chủ ─────────────────────────
// Các section khác nhau cùng gọi cachedGet('/novels', { params: X }) với ĐÚNG
// object này → apiCache gộp thành 1 request mạng (cacheKey so theo nội dung).
// - TOP_VIEWS_PARAMS: MonthlyPopularSection (lấy [0]) + TruyenTrungRankings
//   (tab "Tổng Hợp" tính lại trên 30 truyện, tab "Lượt Đọc" lấy 10 đầu).
// - LATEST_UPDATED_PARAMS: UpdatesSection (15 đầu) + AllNovelsSection
//   (tab "Tất cả", không lọc thể loại, trang 1).
export const TOP_VIEWS_PARAMS = Object.freeze({ sort: 'views', order: 'desc', limit: 30 })
export const LATEST_UPDATED_PARAMS = Object.freeze({ sort: 'updated_at', order: 'desc', limit: 30, page: 1 })

// Chuẩn hóa 1 response /api/novels thành mảng truyện, dù backend trả object
// {novels:[...]} (contract hiện tại) hay mảng thẳng (fallback phòng hờ).
export function extractNovels(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.novels)) return data.novels
  return []
}

/**
 * Lấy nhiều truyện theo slug cụ thể (vd danh sách bookmark/lịch sử đọc của 1
 * user) bằng cách gọi song song GET /api/novels/:slug, thay vì tải cả catalog
 * rồi `.find()` — cách cũ vừa tốn băng thông vừa có thể bỏ sót truyện nằm ở
 * trang sau nếu catalog dùng phân trang thật.
 *
 * Trả về Map slug -> novel (không có key nếu 404/lỗi mạng cho slug đó).
 */
export async function fetchNovelsBySlugs(apiInstance, slugs, { signal } = {}) {
  const uniq = [...new Set(slugs)].filter(Boolean)
  const map = new Map()
  await Promise.all(uniq.map(async slug => {
    try {
      const res = await apiInstance.get(`/novels/${encodeURIComponent(slug)}`, { signal })
      if (res?.data) map.set(slug, res.data)
    } catch {
      // Bỏ qua slug lỗi/404 — không chặn các slug khác load thành công.
    }
  }))
  return map
}

// Worker giới hạn tối đa 24 slug cho mỗi lần gọi GET /api/novels?slugs=...
export const SLUGS_BATCH_MAX = 24

/**
 * Như fetchNovelsBySlugs nhưng gom thành MỘT request mỗi 24 slug:
 * GET /api/novels?slugs=a,b,c (cùng shape {novels, ...}).
 *
 * Chịu được backend cũ chưa hỗ trợ `slugs`: backend cũ bỏ qua tham số lạ và
 * trả trang catalog mặc định — nên chỉ nhận truyện có slug NẰM TRONG danh sách
 * yêu cầu. Nếu một lô không khớp được slug nào (backend cũ, hoặc response
 * không có `novels`) → fallback gọi lẻ /novels/:slug cho lô đó.
 *
 * Trả về Map slug -> novel (thiếu key nếu không tìm thấy).
 */
export async function fetchNovelsBySlugsBatch(apiInstance, slugs, { signal } = {}) {
  const uniq = [...new Set((slugs || []).map(s => String(s ?? '').trim()))].filter(Boolean)
  const map = new Map()
  if (!uniq.length) return map
  const chunks = []
  for (let i = 0; i < uniq.length; i += SLUGS_BATCH_MAX) chunks.push(uniq.slice(i, i + SLUGS_BATCH_MAX))

  await Promise.all(chunks.map(async chunk => {
    const wanted = new Set(chunk)
    let matched = 0
    let batchOk = false
    try {
      const res = await apiInstance.get('/novels', {
        params: { slugs: chunk.join(','), limit: chunk.length },
        signal,
      })
      const data = res?.data
      if (data && !Array.isArray(data) && Array.isArray(data.novels)) {
        for (const novel of data.novels) {
          if (novel?.slug && wanted.has(novel.slug)) {
            map.set(novel.slug, novel)
            matched += 1
          }
        }
        batchOk = matched > 0
      }
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return
      // Lỗi mạng/400 từ backend cũ → rơi xuống fallback bên dưới.
    }
    if (batchOk) return
    const single = await fetchNovelsBySlugs(apiInstance, chunk, { signal })
    for (const [slug, novel] of single) map.set(slug, novel)
  }))
  return map
}
