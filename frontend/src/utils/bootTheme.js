/**
 * bootTheme.js — index.html đặt nền theo theme đọc (html.boot-reader +
 * --boot-bg) TRƯỚC khi JS tải để không nháy nền tối khi mở thẳng trang đọc.
 * Reader/EpubReader gọi hàm này lúc mount (lúc đó .reader-root đã tự tô nền)
 * để trả html/body về nền chung của site — rời trang đọc không còn sót màu.
 */
const DEFAULT_THEME_COLOR = '#0f172a'

export function clearBootTheme() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root.classList.contains('boot-reader')) return
  root.classList.remove('boot-reader')
  root.style.removeProperty('--boot-bg')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', DEFAULT_THEME_COLOR)
}
