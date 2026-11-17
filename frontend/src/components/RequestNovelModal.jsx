import PropTypes from 'prop-types'
import { useState } from 'react';
import { Link } from 'react-router-dom'
import { X, Send, Loader2, CheckCircle2, LogIn } from 'lucide-react'
import userApi, { isLoggedIn } from '../userApi'
import Modal from './ui/Modal'
import '../styles/library-epub.css'

/**
 * RequestNovelModal — modal "Yêu cầu truyện mới": độc giả đã đăng nhập gửi
 * URL truyện Trung muốn dịch (POST /api/novel-requests). Dùng chung
 * components/ui/Modal.jsx cho phần overlay/Escape/focus trap, chỉ tự style
 * nội dung theo màu sắc --glass-bg/--border/--accent-gradient.
 *
 * Chưa đăng nhập: hiện lời mời đăng nhập, trỏ tới /account (KHÔNG phải /login
 * — đó là trang đăng nhập ADMIN, xem AccountPage.jsx).
 */
export default function RequestNovelModal({ onClose }) {
  const loggedIn = isLoggedIn()
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const friendlyError = (err) => {
    const status = err.response?.status
    const detail = err.response?.data?.detail
    if (status === 400) return detail || 'URL không hợp lệ. Cần bắt đầu bằng http:// hoặc https://'
    if (status === 429) return detail || 'Bạn đang có quá nhiều yêu cầu đang chờ duyệt.'
    if (status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    if (!err.response) return 'Không kết nối được máy chủ. Vui lòng thử lại sau.'
    return 'Gửi yêu cầu thất bại. Vui lòng thử lại.'
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await userApi.post('/novel-requests', { url: url.trim(), note: note.trim() })
      setDone(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  // Mobile: bottom sheet trượt lên (variant="sheet"); desktop: hộp thoại giữa
  // màn hình. children dạng hàm để nút Đóng cũng chạy animation đóng.
  return (
    <Modal
      onClose={onClose}
      ariaLabel="Yêu cầu truyện mới"
      variant="sheet"
      panelClassName="glass-panel request-novel-modal"
    >
      {({ requestClose }) => (
        <>
          <button
            type="button"
            className="request-novel-modal__close"
            onClick={requestClose}
            aria-label="Đóng"
          >
            <X size={20} />
          </button>

          <div className="request-novel-modal__header">
            <span className="request-novel-modal__badge" aria-hidden="true">
              <Send size={17} color="white" />
            </span>
            <h2 className="request-novel-modal__title">Yêu cầu truyện mới</h2>
          </div>

          {!loggedIn && (
            <div>
              <p className="request-novel-modal__text">
                Vui lòng đăng nhập để gửi yêu cầu truyện muốn dịch.
              </p>
              <Link
                to="/account"
                onClick={onClose}
                className="btn btn-primary request-novel-modal__btn"
              >
                <LogIn size={16} /> Đăng nhập / Đăng ký
              </Link>
            </div>
          )}

          {loggedIn && done && (
            <div className="request-novel-modal__done" role="status">
              <CheckCircle2 size={40} color="#10b981" className="request-novel-modal__done-icon" />
              <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Đã gửi yêu cầu!</p>
              <p className="request-novel-modal__text">
                Admin sẽ xem xét và phản hồi sớm nhất có thể.
              </p>
              <button type="button" className="btn btn-secondary request-novel-modal__btn" onClick={requestClose}>
                Đóng
              </button>
            </div>
          )}

          {loggedIn && !done && (
            <form className="request-novel-form" onSubmit={handleSubmit}>
              <p className="request-novel-modal__text" style={{ margin: 0 }}>
                Dán link truyện Trung bạn muốn được dịch — team sẽ xem xét và duyệt.
              </p>
              <input
                type="url"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                enterKeyHint="next"
                className="input-field"
                placeholder="https://..."
                aria-label="Link truyện"
                value={url}
                onChange={e => setUrl(e.target.value)}
                required
                maxLength={500}
                autoFocus
              />
              <textarea
                className="input-field"
                placeholder="Ghi chú thêm (không bắt buộc)"
                aria-label="Ghi chú thêm"
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={500}
                rows={3}
              />

              {error && <div className="auth-error" role="alert">{error}</div>}

              <button type="submit" className="btn btn-primary request-novel-modal__btn" disabled={busy}>
                {busy ? <><Loader2 size={16} className="spin" /> Đang gửi...</> : <><Send size={16} /> Gửi yêu cầu</>}
              </button>
            </form>
          )}
        </>
      )}
    </Modal>
  )
}
RequestNovelModal.propTypes = {
  onClose: PropTypes.func,
};
