import { useEffect } from 'react'

export const SITE_NAME = 'Hắc Đạo Truyện'

/** Ghép tiêu đề tab: "<title> – Hắc Đạo Truyện" (title rỗng → chỉ tên site). */
export function formatDocumentTitle(title) {
  const t = String(title || '').trim()
  return t ? `${t} – ${SITE_NAME}` : SITE_NAME
}

/**
 * Đặt document.title theo trang hiện tại; khôi phục tiêu đề trước đó khi unmount
 * (Worker có thể đã chèn <title> SEO lúc SSR — trả lại đúng giá trị đó).
 * Truyền title rỗng/null (vd dữ liệu chưa tải) → giữ nguyên tiêu đề hiện có.
 */
export default function useDocumentTitle(title) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const t = String(title || '').trim()
    if (!t) return undefined
    const previous = document.title
    document.title = formatDocumentTitle(t)
    return () => { document.title = previous }
  }, [title])
}
