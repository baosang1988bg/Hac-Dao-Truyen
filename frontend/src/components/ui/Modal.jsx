import PropTypes from 'prop-types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../../utils/motion'
import '../../styles/library-epub.css'

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
// Thời gian giữ modal trên DOM để chạy animation đóng (khớp 200ms trong library-epub.css)
const CLOSE_MS = 200

// Khoá cuộn body: đếm số modal đang mở để modal lồng nhau không mở khoá sớm.
let scrollLocks = 0
let savedBodyOverflow = ''
function lockBodyScroll() {
  if (typeof document === 'undefined' || !document.body) return () => {}
  if (scrollLocks === 0) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLocks += 1
  let released = false
  return () => {
    if (released) return
    released = true
    scrollLocks = Math.max(0, scrollLocks - 1)
    if (scrollLocks === 0) document.body.style.overflow = savedBodyOverflow
  }
}

/**
 * Modal – overlay dùng chung cho mọi hộp thoại/drawer trong app (dialog giữa
 * màn hình, bottom sheet trên mobile...). Lo phần hành vi/accessibility
 * (Escape để đóng, focus trap, trả focus lại nơi cũ khi đóng, khoá cuộn nền)
 * và animation vào/ra — hình dạng panel do nơi gọi tự style qua
 * overlayStyle/panelClassName/panelStyle (giữ nguyên API cũ).
 *
 * - variant: 'dialog' (phóng nhẹ giữa màn hình) | 'sheet' (≤768px trượt lên
 *   từ đáy). Không truyền → tự nhận 'sheet' nếu overlayStyle.alignItems là
 *   'flex-end' (tương thích chỗ gọi cũ như sheet cài đặt của Reader).
 * - Đóng bằng Escape / bấm nền: chạy animation ~200ms rồi mới gọi onClose
 *   (bỏ qua nếu người dùng bật "Giảm chuyển động").
 * - children có thể là hàm ({ requestClose }) => node để nút "Đóng" bên
 *   trong cũng đóng có animation.
 */
export default function Modal({ onClose, children, ariaLabel, overlayStyle, panelClassName = 'glass-panel', panelStyle, variant }) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const closingRef = useRef(false)
  const timerRef = useRef(null)
  const [closing, setClosing] = useState(false)
  // Ghi nhận phần tử đang focus NGAY lúc render đầu (trước khi autoFocus bên
  // trong panel chiếm focus) để trả focus đúng nút đã mở modal khi đóng.
  const [openerEl] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null))

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    if (prefersReducedMotion()) {
      onCloseRef.current?.()
      return
    }
    closingRef.current = true
    setClosing(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onCloseRef.current?.()
      // Nơi gọi không unmount (hiếm) → trả modal về trạng thái mở bình thường.
      closingRef.current = false
      setClosing(false)
    }, CLOSE_MS)
  }, [])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  useEffect(() => lockBodyScroll(), [])

  // Focus trap + Escape. Chỉ chạy 1 lần khi mở (onClose đọc qua ref) — trước
  // đây phụ thuộc [onClose] nên nơi truyền arrow function mới mỗi lần render
  // bị kéo focus về phần tử đầu tiên sau mỗi render.
  useEffect(() => {
    const previouslyFocused = openerEl
    const panel = panelRef.current
    // Giữ autoFocus của nơi gọi (vd ô URL trong RequestNovelModal) nếu có.
    if (!panel?.contains(document.activeElement)) {
      panel?.querySelector(FOCUSABLE_SELECTOR)?.focus()
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        requestClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = panelRef.current ? Array.from(panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) : []
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
  }, [requestClose, openerEl])

  const isSheet = variant ? variant === 'sheet' : overlayStyle?.alignItems === 'flex-end'
  const overlayClass = [
    'hd-modal-overlay',
    isSheet && 'hd-modal-overlay--sheet',
    closing && 'is-closing',
  ].filter(Boolean).join(' ')
  const panelClass = [
    panelClassName,
    'hd-modal-panel',
    isSheet && 'hd-modal-panel--sheet',
  ].filter(Boolean).join(' ')

  return (
    <div onClick={requestClose} className={overlayClass} style={overlayStyle}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={e => e.stopPropagation()}
        className={panelClass}
        style={panelStyle}
      >
        {typeof children === 'function' ? children({ requestClose }) : children}
      </div>
    </div>
  )
}
Modal.propTypes = {
  onClose: PropTypes.func,
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
  ariaLabel: PropTypes.string.isRequired,
  overlayStyle: PropTypes.object,
  panelClassName: PropTypes.string,
  panelStyle: PropTypes.object,
  variant: PropTypes.oneOf(['dialog', 'sheet']),
};
