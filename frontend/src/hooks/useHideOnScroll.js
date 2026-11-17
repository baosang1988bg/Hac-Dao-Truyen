import { useEffect, useState } from 'react'

/**
 * Quyết định ẩn/hiện thanh điều hướng theo hướng cuộn (pure — dễ test).
 * - Gần đầu trang (< topOffset) → luôn hiện.
 * - Cuộn xuống quá `delta` px → ẩn; cuộn lên quá `delta` px → hiện.
 * - Dao động nhỏ hơn `delta` → giữ nguyên (tránh giật khi kéo nhẹ / bounce iOS).
 */
export function nextHiddenState(prevHidden, prevY, y, { delta = 8, topOffset = 64 } = {}) {
  if (!Number.isFinite(y) || y <= topOffset) return false
  if (!Number.isFinite(prevY)) return prevHidden
  const diff = y - prevY
  if (Math.abs(diff) < delta) return prevHidden
  return diff > 0
}

/**
 * Hook: trả về true khi nên ẩn thanh (người dùng đang cuộn xuống đọc nội dung).
 * Dùng requestAnimationFrame để gom sự kiện scroll — tối đa 1 lần/khung hình.
 */
export default function useHideOnScroll({ enabled = true, delta = 8, topOffset = 64 } = {}) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined
    let lastY = window.scrollY
    let ticking = false
    let current = false

    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(() => {
        const y = window.scrollY
        const next = nextHiddenState(current, lastY, y, { delta, topOffset })
        if (Math.abs(y - lastY) >= delta || y <= topOffset) lastY = y
        if (next !== current) {
          current = next
          setHidden(next)
        }
        ticking = false
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [enabled, delta, topOffset])

  return enabled ? hidden : false
}
