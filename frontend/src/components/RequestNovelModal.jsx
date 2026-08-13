import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Send, Loader2, CheckCircle2, LogIn } from 'lucide-react'
import userApi, { isLoggedIn } from '../userApi'

/**
 * RequestNovelModal — modal "Yêu cầu truyện mới": độc giả đã đăng nhập gửi
 * URL truyện Trung muốn dịch (POST /api/novel-requests). Tự viết bằng div +
 * style inline (không có thư viện modal sẵn trong repo), theo màu sắc
 * --glass-bg/--border/--accent-gradient đã dùng trong EpubCard.jsx.
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

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(8, 10, 20, 0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="glass-panel"
        style={{
          position: 'relative', width: '100%', maxWidth: '440px',
          background: 'var(--glass-bg)', border: '1px solid var(--border)',
          borderRadius: '16px', padding: '1.5rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Đóng"
          style={{
            position: 'absolute', top: '12px', right: '12px',
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', padding: '4px', lineHeight: 0,
          }}
        >
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.9rem' }}>
          <span style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'var(--accent-gradient)', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Send size={17} color="white" />
          </span>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Yêu cầu truyện mới</h2>
        </div>

        {!loggedIn && (
          <div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Vui lòng đăng nhập để gửi yêu cầu truyện muốn dịch.
            </p>
            <Link
              to="/account"
              onClick={onClose}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <LogIn size={16} /> Đăng nhập / Đăng ký
            </Link>
          </div>
        )}

        {loggedIn && done && (
          <div style={{ textAlign: 'center', padding: '0.5rem 0 0.25rem' }}>
            <CheckCircle2 size={36} color="#10b981" style={{ marginBottom: '0.6rem' }} />
            <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Đã gửi yêu cầu!</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.1rem' }}>
              Admin sẽ xem xét và phản hồi sớm nhất có thể.
            </p>
            <button className="btn btn-secondary" onClick={onClose} style={{ width: '100%', justifyContent: 'center' }}>
              Đóng
            </button>
          </div>
        )}

        {loggedIn && !done && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              Dán link truyện Trung bạn muốn được dịch — team sẽ xem xét và duyệt.
            </p>
            <input
              type="url"
              className="input-field"
              placeholder="https://..."
              value={url}
              onChange={e => setUrl(e.target.value)}
              required
              maxLength={500}
              autoFocus
            />
            <textarea
              className="input-field"
              placeholder="Ghi chú thêm (không bắt buộc)"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />

            {error && <div className="auth-error" role="alert">{error}</div>}

            <button type="submit" className="btn btn-primary" disabled={busy} style={{ justifyContent: 'center' }}>
              {busy ? <><Loader2 size={16} className="spin" /> Đang gửi...</> : <><Send size={16} /> Gửi yêu cầu</>}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
