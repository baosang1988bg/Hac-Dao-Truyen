import PropTypes from 'prop-types'
import { useEffect, useId, useRef } from 'react'
import { X, User } from 'lucide-react'
import Modal from './ui/Modal'
import AuthPanel from './AuthPanel'
import '../styles/library-epub.css'

/**
 * LoginDialog — hộp đăng nhập dùng chung (AuthContext mở qua requireLogin).
 * Tiêu đề theo `reason` (vd "Đăng nhập để bình luận"); nội dung là AuthPanel
 * (Google + email/mật khẩu + đăng ký + link chính sách bảo mật).
 * Mobile: bottom sheet (variant="sheet"); desktop: hộp giữa màn hình.
 *
 * Hộp này có thể mở CHỒNG lên modal khác (vd hộp sửa name, yêu cầu truyện).
 * ui/Modal nghe Escape ở document → cả 2 modal cùng đóng. Ở đây bắt Escape
 * sớm hơn (window, capture) và chặn lan truyền để chỉ hộp đăng nhập đóng —
 * nội dung người dùng đang gõ ở modal bên dưới được giữ nguyên.
 */
export default function LoginDialog({ reason, onClose, onSuccess }) {
  const titleId = useId()
  const requestCloseRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !requestCloseRef.current) return
      e.stopPropagation()
      requestCloseRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const title = reason || 'Đăng nhập Hắc Đạo Truyện'

  return (
    <Modal
      onClose={onClose}
      ariaLabel={title}
      variant="sheet"
      panelClassName="glass-panel request-novel-modal login-dialog"
    >
      {({ requestClose }) => {
        requestCloseRef.current = requestClose
        return (
          <>
            <button
              type="button"
              className="request-novel-modal__close"
              onClick={requestClose}
              aria-label="Đóng"
            >
              <X size={20} aria-hidden="true" />
            </button>

            <div className="request-novel-modal__header">
              <span className="request-novel-modal__badge" aria-hidden="true">
                <User size={17} color="white" />
              </span>
              <h2 id={titleId} className="request-novel-modal__title">{title}</h2>
            </div>
            <p className="request-novel-modal__text">
              Theo dõi truyện, đồng bộ tiến độ đọc giữa các máy và bình luận cùng mọi người.
            </p>

            <AuthPanel onSuccess={onSuccess} onNavigate={requestClose} />
          </>
        )
      }}
    </Modal>
  )
}
LoginDialog.propTypes = {
  reason: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
}
