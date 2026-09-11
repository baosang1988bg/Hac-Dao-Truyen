/**
 * Adapter dùng chung cho GET /api/novels.
 *
 * Cả 2 backend (Worker `src/index.js` getNovels và Python `routers/novels.py`
 * list_novels) đều trả CÙNG shape: {novels: [...], total, page, limit, pages}.
 * Trước đây nhiều trang tự viết `Array.isArray(data) ? data : data.novels`
 * (hoặc tệ hơn, coi response luôn là mảng — AccountPage.jsx) rải rác khắp nơi.
 * File này gom logic đó lại một chỗ, tránh lặp và tránh bug khi contract đổi.
 */

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
