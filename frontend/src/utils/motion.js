/**
 * motion.js — tiện ích chuyển động dùng chung (đi kèm styles/motion.css).
 *
 * - prefersReducedMotion(): người dùng có bật "Giảm chuyển động" không.
 * - withViewTransition(update): chạy `update` bên trong View Transitions API
 *   (Chrome/Edge/Safari 18+); trình duyệt không hỗ trợ hoặc giảm chuyển động →
 *   gọi thẳng `update`, không hiệu ứng. Dùng cho đổi trạng thái TRONG trang
 *   (đổi tab, đổi bộ lọc, đảo thứ tự danh sách).
 * - initReveal(): gắn class `hd-motion` lên <html> và theo dõi mọi phần tử
 *   `.hd-reveal` (kể cả phần tử React mount sau) → gắn thuộc tính
 *   `data-revealed` khi cuộn tới. Dùng data-attribute thay vì class vì React
 *   ghi đè cả chuỗi className khi prop đổi (sẽ xoá mất class tự thêm). Gọi một lần lúc khởi động (main.jsx).
 *
 * Mọi hàm an toàn khi chạy ngoài trình duyệt (node --test, SSR).
 */

export function prefersReducedMotion(win = globalThis.window) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}

/**
 * Chạy `update` trong một view transition nếu được.
 * Trả về Promise hoàn tất khi DOM đã cập nhật (không chờ hiệu ứng chạy xong).
 */
export function withViewTransition(update, { doc = globalThis.document, win = globalThis.window } = {}) {
  if (typeof update !== 'function') return Promise.resolve()
  if (!doc || typeof doc.startViewTransition !== 'function' || prefersReducedMotion(win)) {
    update()
    return Promise.resolve()
  }
  try {
    const vt = doc.startViewTransition(update)
    return vt.updateCallbackDone.catch(() => {})
  } catch {
    update()
    return Promise.resolve()
  }
}

/**
 * Chỉ số trễ cho hiệu ứng so le: giới hạn để danh sách dài không phải chờ lâu.
 * Dùng: style={{ '--i': staggerIndex(i) }}
 */
export function staggerIndex(i, max = 8) {
  const n = Number(i)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.floor(n), max)
}

const REVEAL_SELECTOR = '.hd-reveal:not([data-revealed])'
let revealStarted = false

export function initReveal({ doc = globalThis.document, win = globalThis.window } = {}) {
  if (revealStarted || !doc?.documentElement) return () => {}
  const IO = win?.IntersectionObserver
  const MO = win?.MutationObserver
  // Không đủ API hoặc giảm chuyển động → không gắn hd-motion → .hd-reveal hiện sẵn.
  if (typeof IO !== 'function' || typeof MO !== 'function' || prefersReducedMotion(win)) {
    return () => {}
  }
  revealStarted = true
  doc.documentElement.classList.add('hd-motion')

  const io = new IO((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.setAttribute('data-revealed', '')
        io.unobserve(entry.target)
      }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 })

  const scan = (root) => {
    if (!root || root.nodeType !== 1) return
    if (root.matches?.(REVEAL_SELECTOR)) io.observe(root)
    root.querySelectorAll?.(REVEAL_SELECTOR).forEach((el) => io.observe(el))
  }

  // Phần tử bị tháo khỏi DOM trước khi kịp cuộn tới → unobserve để
  // IntersectionObserver không giữ cây DOM đã tách (rò bộ nhớ nhẹ).
  const drop = (root) => {
    if (!root || root.nodeType !== 1 || root.isConnected) return
    if (root.matches?.('.hd-reveal')) io.unobserve(root)
    root.querySelectorAll?.('.hd-reveal').forEach((el) => io.unobserve(el))
  }

  scan(doc.body)
  const mo = new MO((mutations) => {
    // Xử lý gỡ trước, thêm sau: node bị React di chuyển (gỡ + chèn lại) vẫn
    // được theo dõi vì isConnected = true lúc callback chạy.
    for (const m of mutations) m.removedNodes.forEach(drop)
    for (const m of mutations) m.addedNodes.forEach(scan)
  })
  mo.observe(doc.body, { childList: true, subtree: true })

  return () => {
    io.disconnect()
    mo.disconnect()
    doc.documentElement.classList.remove('hd-motion')
    revealStarted = false
  }
}
