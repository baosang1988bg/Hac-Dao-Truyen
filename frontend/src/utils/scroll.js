/**
 * Tiện ích hỗ trợ cuộn trang mượt mà và kiểm tra ngưỡng hiển thị nút Scroll-to-Top.
 */

/**
 * Kiểm tra xem vị trí cuộn hiện tại có vượt quá ngưỡng hiển thị nút hay không.
 * @param {number} scrollY - Vị trí cuộn theo phương dọc (window.scrollY).
 * @param {number} [threshold=400] - Ngưỡng cuộn tối thiểu (pixel).
 * @returns {boolean}
 */
export function shouldShowScrollToTop(scrollY, threshold = 400) {
  return typeof scrollY === 'number' && Number.isFinite(scrollY) && scrollY > threshold
}

/**
 * Thực hiện cuộn mượt về đầu trang an toàn trong mọi môi trường.
 * @param {ScrollBehavior} [behavior='smooth']
 */
export function scrollToTop(behavior = 'smooth') {
  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
    window.scrollTo({
      top: 0,
      behavior,
    })
  }
}
