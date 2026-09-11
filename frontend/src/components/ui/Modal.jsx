import PropTypes from 'prop-types'
import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Modal – overlay dùng chung cho mọi hộp thoại/drawer trong app (dialog giữa
 * màn hình, bottom sheet trên mobile...). Chỉ lo phần hành vi/accessibility
 * (Escape để đóng, focus trap, trả focus lại nơi cũ khi đóng) — hình dạng
 * overlay/panel do nơi gọi tự style qua overlayStyle/panelClassName/panelStyle.
 */
export default function Modal({ onClose, children, ariaLabel, overlayStyle, panelClassName = 'glass-panel', panelStyle }) {
  const panelRef = useRef(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    panelRef.current?.querySelector(FOCUSABLE_SELECTOR)?.focus()

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose?.()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      const items = panel ? Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)) : []
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(8, 10, 20, 0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
        ...overlayStyle,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={e => e.stopPropagation()}
        className={panelClassName}
        style={panelStyle}
      >
        {children}
      </div>
    </div>
  )
}
Modal.propTypes = {
  onClose: PropTypes.func,
  children: PropTypes.node,
  ariaLabel: PropTypes.string.isRequired,
  overlayStyle: PropTypes.object,
  panelClassName: PropTypes.string,
  panelStyle: PropTypes.object,
};
