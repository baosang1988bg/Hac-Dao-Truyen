// GA4 (Google Analytics 4) — chỉ hoạt động khi VITE_GA4_MEASUREMENT_ID được
// cấu hình lúc build (rỗng ở local dev/preview chưa setup → không tải script,
// không gửi gì cả, không cần tắt bằng tay).
const GA4_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID || ''

let initialized = false

/** Tải gtag.js và khởi tạo đúng 1 lần. Gọi ở App mount. */
export function initAnalytics() {
  if (!GA4_ID || initialized || typeof window === 'undefined') return
  initialized = true

  window.dataLayer = window.dataLayer || []
  function gtag() { window.dataLayer.push(arguments) }
  window.gtag = gtag

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`
  document.head.appendChild(script)

  gtag('js', new Date())
  // send_page_view: false — app là SPA, tự bắn page_view theo route qua
  // trackPageView() (xem App.jsx) thay vì để gtag tự bắn 1 lần lúc tải script,
  // nếu không các trang điều hướng bằng client-side routing sẽ không được đếm.
  gtag('config', GA4_ID, { send_page_view: false })
}

// Bỏ qua traffic của chính admin khi quản trị trang (/admin/* và /login) —
// đây là hoạt động vận hành nội bộ, không phải hành vi đọc giả thật, tính
// vào GA4 sẽ làm sai lệch số liệu phân tích người đọc.
function isAdminPath(path) {
  return path === '/login' || path.startsWith('/admin')
}

/** Gửi 1 sự kiện page_view — gọi mỗi khi route (SPA) đổi. */
export function trackPageView(path) {
  if (!GA4_ID || typeof window.gtag !== 'function') return
  if (isAdminPath(path)) return
  window.gtag('event', 'page_view', { page_path: path })
}
