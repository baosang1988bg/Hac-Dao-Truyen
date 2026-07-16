import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare, Send, Loader2 } from 'lucide-react'
import userApi, { isLoggedIn, getUserInfo } from '../userApi'
import { fmtTimeAgo } from '../utils/format'

/**
 * Bình luận cuối trang đọc (theo chương).
 * - GET  /api/novels/{slug}/comments?chapter=N (public)
 * - POST /api/novels/{slug}/comments (Bearer user) — 429 khi spam < 20s.
 * Dùng biến --reader-* (panel/text/border) nên tự khớp theme của Reader.
 */

// created_at từ API là 'YYYY-MM-DD HH:MM:SS' (UTC) → epoch giây cho fmtTimeAgo
function toEpochSeconds(s) {
  if (!s) return 0
  const ms = Date.parse(String(s).replace(' ', 'T') + 'Z')
  return Number.isFinite(ms) ? ms / 1000 : 0
}

export default function ChapterComments({ slug, chapter }) {
  const [comments, setComments] = useState(null) // null = đang tải
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const loggedIn = isLoggedIn()
  const user = getUserInfo()

  useEffect(() => {
    let alive = true
    setComments(null)
    setError(null)
    setText('')
    userApi.get(`/novels/${slug}/comments`, { params: { chapter } })
      .then(res => { if (alive) setComments(res.data || []) })
      .catch(() => { if (alive) setComments([]) })
    return () => { alive = false }
  }, [slug, chapter])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    setError(null)
    try {
      const num = /^\d+$/.test(String(chapter)) ? Number(chapter) : chapter
      await userApi.post(`/novels/${slug}/comments`, { chapter: num, content })
      setText('')
      // Refresh danh sách sau khi gửi thành công
      const res = await userApi.get(`/novels/${slug}/comments`, { params: { chapter } })
      setComments(res.data || [])
    } catch (err) {
      const status = err.response?.status
      if (status === 429) setError('Bạn bình luận quá nhanh, chờ 20 giây rồi gửi lại nhé.')
      else if (status === 401) setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
      else if (status === 400) setError('Nội dung bình luận không hợp lệ.')
      else setError('Gửi bình luận thất bại. Vui lòng thử lại.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="chapter-comments" aria-label="Bình luận chương">
      <div className="chapter-comments__head">
        <MessageSquare size={17} />
        <span>Bình luận{comments && comments.length > 0 ? ` (${comments.length})` : ''}</span>
      </div>

      {/* Form / lời mời đăng nhập */}
      {loggedIn ? (
        <form className="chapter-comments__form" onSubmit={handleSubmit}>
          <textarea
            className="chapter-comments__input"
            placeholder={`Cảm nghĩ của ${user?.name || 'bạn'} về chương này...`}
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            maxLength={2000}
          />
          {error && <div className="chapter-comments__error" role="alert">{error}</div>}
          <button
            type="submit"
            className="btn btn-primary chapter-comments__send"
            disabled={sending || !text.trim()}
          >
            {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            {sending ? 'Đang gửi...' : 'Gửi bình luận'}
          </button>
        </form>
      ) : (
        <div className="chapter-comments__login-hint">
          <Link to="/account">Đăng nhập</Link> để bình luận về chương này.
        </div>
      )}

      {/* Danh sách */}
      {comments === null ? (
        <div className="chapter-comments__empty">Đang tải bình luận...</div>
      ) : comments.length === 0 ? (
        <div className="chapter-comments__empty">
          Chưa có bình luận nào — hãy là người đầu tiên!
        </div>
      ) : (
        <div className="chapter-comments__list">
          {comments.map(c => (
            <div key={c.id} className="comment-item">
              <div className="comment-item__avatar">
                {(c.user_name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="comment-item__body">
                <div className="comment-item__meta">
                  <span className="comment-item__name">{c.user_name || 'Ẩn danh'}</span>
                  <span className="comment-item__time">
                    {fmtTimeAgo(toEpochSeconds(c.created_at))}
                  </span>
                </div>
                <div className="comment-item__content">{c.content}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
