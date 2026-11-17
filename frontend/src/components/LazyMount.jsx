import PropTypes from 'prop-types'
import { useEffect, useRef, useState } from 'react'

/**
 * LazyMount — chỉ mount `children` khi vùng giữ chỗ cuộn tới gần màn hình.
 *
 * Dùng cho các khối nằm dưới màn hình đầu mà khi mount sẽ gọi API (trang chủ):
 * khách không cuộn tới thì không phát sinh request nào. Đã mount thì giữ
 * nguyên (không gỡ khi cuộn đi) để không gọi lại và không mất trạng thái.
 *
 * - `rootMargin`: mount sớm trước khi lộ ra để người cuộn không thấy khung trống.
 * - `minHeight`: chiều cao giữ chỗ (px) — tránh cả trang dồn lên rồi giật xuống.
 * - Trình duyệt không có IntersectionObserver → mount ngay (hành vi cũ).
 */
export default function LazyMount({ children, rootMargin = '400px 0px', minHeight = 120 }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (visible) return undefined
    const el = ref.current
    if (!el) return undefined
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setVisible(true)
        io.disconnect()
      }
    }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [visible, rootMargin])

  if (visible) return children
  return <div ref={ref} style={{ minHeight }} aria-hidden="true" />
}
LazyMount.propTypes = {
  children: PropTypes.node,
  rootMargin: PropTypes.string,
  minHeight: PropTypes.number,
}
