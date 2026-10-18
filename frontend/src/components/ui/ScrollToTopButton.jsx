import PropTypes from 'prop-types'
import { useState, useEffect, useCallback } from 'react'
import { ChevronUp } from 'lucide-react'
import { shouldShowScrollToTop, scrollToTop } from '../../utils/scroll'

/**
 * ScrollToTopButton – Nút nổi (FAB) hỗ trợ cuộn mượt về đầu trang khi người dùng cuộn qua một ngưỡng nhất định.
 * Thiết kế gọn nhẹ, hỗ trợ Accessibility (A11y), responsive và hỗ trợ safe-area trên thiết bị di động.
 */
export default function ScrollToTopButton({
  threshold = 400,
  ariaLabel = 'Cuộn lên đầu trang',
  bottomOffset = 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
  rightOffset = 'calc(1.5rem + env(safe-area-inset-right, 0px))',
  className = '',
  style = {},
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function checkScroll() {
      const currentScrollY = typeof window !== 'undefined' ? window.scrollY : 0
      setVisible(shouldShowScrollToTop(currentScrollY, threshold))
    }

    checkScroll()
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', checkScroll, { passive: true })
      return () => window.removeEventListener('scroll', checkScroll)
    }
  }, [threshold])

  const handleClick = useCallback(() => {
    scrollToTop('smooth')
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`scroll-to-top-btn ${className}`.trim()}
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        bottom: bottomOffset,
        right: rightOffset,
        zIndex: 90,
        width: '44px',
        height: '44px',
        borderRadius: '14px',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        background: 'rgba(30, 41, 59, 0.88)',
        backdropFilter: 'blur(12px)',
        color: 'rgba(255, 255, 255, 0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        transition: 'transform 0.18s ease, background-color 0.18s ease',
        ...style,
      }}
    >
      <ChevronUp size={22} aria-hidden="true" />
    </button>
  )
}

ScrollToTopButton.propTypes = {
  threshold: PropTypes.number,
  ariaLabel: PropTypes.string,
  bottomOffset: PropTypes.string,
  rightOffset: PropTypes.string,
  className: PropTypes.string,
  style: PropTypes.object,
}
