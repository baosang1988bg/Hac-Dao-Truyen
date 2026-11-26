import { useEffect, useRef } from 'react'
import { requestReadToken, reportRealRead } from '../engagementApi'
import { createReadTracker, readViewKey, DEFAULT_MIN_SECONDS } from '../utils/readTracking'

// Đồng hồ kiểm tra điều kiện (rẻ: chỉ đọc 1 getBoundingClientRect mỗi giây).
const TICK_MS = 1000
// /read-start lỗi tạm thời (mạng chập chờn, 5xx, 429) → thử lại ĐÚNG 1 lần sau
// chừng này rồi mới rơi về chế độ không token. Server giới hạn read-start
// 20/phút/IP nên không thử lại nhiều hơn.
const TOKEN_RETRY_DELAY_MS = 5000

function alreadyCounted(key) {
  try { return sessionStorage.getItem(key) === '1' } catch { return false }
}
function markCounted(key) {
  try { sessionStorage.setItem(key, '1') } catch { /* sessionStorage bị chặn — chỉ chống trùng trong lần mount này */ }
}
function isTabVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

/**
 * Lượt đọc thật (thay trackViewOncePerSession cũ):
 *  1. Chương mở (enabled = true) → xin token POST /read-start.
 *  2. Đếm thời gian tab HIỂN THỊ (dừng khi ẩn) + (tuỳ chọn) theo dõi tỉ lệ cuộn.
 *  3. Đủ min_seconds VÀ cuộn đủ → POST /view kèm token, đúng 1 lần cho chương đó.
 * Đổi slug/chapter → huỷ lượt cũ (chưa đủ điều kiện thì không báo), bắt đầu lại.
 * Chống trùng theo "slug:chapter" trong sessionStorage (F5 không cộng thêm lượt).
 *
 * @param {object} p
 * @param {string} p.slug
 * @param {string|number} p.chapterKey   định danh chương cho khoá chống trùng (vd "12", "0001_VI.md")
 * @param {number} p.chapterNumber       số chương gửi server (0 nếu không có số — EPUB, lời tác giả)
 * @param {boolean} p.enabled            chỉ true khi nội dung chương ĐÃ hiển thị (không lỗi, không rỗng)
 * @param {boolean} [p.requireScroll=true]
 * @param {() => number} [p.getScrollRatio] trả tỉ lệ nội dung đã đọc (0..1)
 */
export default function useRealReadTracking({
  slug, chapterKey, chapterNumber = 0, enabled, requireScroll = true, getScrollRatio,
}) {
  // Giữ callback mới nhất mà không phải khởi động lại lượt đếm mỗi lần render.
  const ratioRef = useRef(getScrollRatio)
  useEffect(() => { ratioRef.current = getScrollRatio }, [getScrollRatio])

  useEffect(() => {
    if (!enabled || !slug) return undefined
    const key = readViewKey(slug, chapterKey)
    if (alreadyCounted(key)) return undefined

    let cancelled = false
    let tokenInfo = null // { token, min_seconds } sau khi server trả lời
    const tracker = createReadTracker({ requireScroll, minSeconds: DEFAULT_MIN_SECONDS })

    const check = () => {
      if (cancelled || !tokenInfo || tracker.reported) return
      if (requireScroll) {
        try {
          const ratio = ratioRef.current ? ratioRef.current() : 1
          tracker.setScrollRatio(ratio)
        } catch { /* DOM chưa sẵn sàng — lần tick sau thử lại */ }
      }
      if (!tracker.shouldReport()) return
      tracker.markReported()
      markCounted(key)
      reportRealRead(slug, tokenInfo.token) // fire-and-forget, hàm tự nuốt lỗi
      clearInterval(tickId)
    }

    let retryId = null
    const begin = (res) => {
      if (cancelled) return
      // null = lỗi mạng hoặc server cũ chưa có /read-start → vẫn đợi đủ điều
      // kiện rồi gửi body rỗng như bản cũ (server cũ vẫn đếm được).
      tokenInfo = res && typeof res === 'object' ? res : { token: null, min_seconds: DEFAULT_MIN_SECONDS }
      tracker.setMinSeconds(tokenInfo.min_seconds ?? DEFAULT_MIN_SECONDS)
      tracker.start(isTabVisible())
    }
    requestReadToken(slug, chapterNumber).then((res) => {
      if (cancelled) return
      if (res && typeof res === 'object') { begin(res); return }
      // Lần đầu lỗi → đợi ~5 giây thử lại 1 lần (bắt đầu đếm giờ khi có kết quả,
      // vì server tính thời gian đọc tối thiểu từ lúc cấp token).
      retryId = setTimeout(() => {
        retryId = null
        if (cancelled) return
        requestReadToken(slug, chapterNumber).then(begin)
      }, TOKEN_RETRY_DELAY_MS)
    })

    const onVisibility = () => {
      tracker.setVisible(isTabVisible())
      if (isTabVisible()) check()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const tickId = setInterval(check, TICK_MS)

    return () => {
      cancelled = true
      if (retryId) clearTimeout(retryId)
      clearInterval(tickId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, slug, chapterKey, chapterNumber, requireScroll])
}
