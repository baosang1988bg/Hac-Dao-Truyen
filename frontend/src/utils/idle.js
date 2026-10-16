/**
 * Chạy `fn` khi trình duyệt rảnh (requestIdleCallback, fallback setTimeout).
 * Trả về hàm huỷ. Dùng cho prefetch chunk/chương kế tiếp — không chặn render.
 */
export function runWhenIdle(fn, { timeout = 2000, fallbackDelay = 300 } = {}) {
  if (typeof window === 'undefined') return () => {}
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => fn(), { timeout })
    return () => window.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, fallbackDelay)
  return () => window.clearTimeout(id)
}
