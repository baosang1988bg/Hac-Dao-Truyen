import PropTypes from 'prop-types'
import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Modal from './ui/Modal'
import { isLoggedIn } from '../userApi'
import { submitGlossarySuggestion } from '../engagementApi'
import {
  validateSuggestion,
  SUGGESTION_TEXT_MAX as TEXT_MAX,
  SUGGESTION_ORIGINAL_MAX as ORIGINAL_MAX,
  SUGGESTION_NOTE_MAX as NOTE_MAX,
} from '../utils/engagement'

// Gửi góp ý thành công → tự đóng sau chừng này (đủ để đọc thông báo).
const SUCCESS_CLOSE_MS = 1800

export default function InlineGlossaryModal({
  isOpen,
  onClose,
  initialFrom = '',
  onApply,
  slug,
  chapter,
}) {
  const [fromText, setFromText] = useState(initialFrom)
  const [toText, setToText] = useState('')
  const [scope, setScope] = useState('all') // 'all' (toàn truyện) | 'chapter' (chỉ chương này)
  // Góp ý name cho mọi người (học từ sangtacviet "name chung") — admin duyệt rồi mới áp công khai.
  const [suggest, setSuggest] = useState(false)
  const [original, setOriginal] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState(null) // { type: 'success'|'error', text }
  const closeTimerRef = useRef(null)
  const loggedIn = isOpen ? isLoggedIn() : false

  const clearCloseTimer = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }

  // Người dùng tự đóng (nút Hủy/Đóng, nền, Esc, link đăng nhập) → huỷ hẹn giờ
  // tự đóng của lần gửi trước, kẻo mở lại trong 1,8 giây thì modal mới bị đóng ngang.
  const handleClose = () => {
    clearCloseTimer()
    onClose()
  }

  useEffect(() => {
    // Mở/đóng hoặc đổi từ gốc = phiên modal mới → hẹn giờ của phiên cũ không còn hiệu lực.
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
    setFromText(initialFrom)
    setToText('')
    setOriginal('')
    setNote('')
    setNotice(null)
    setSending(false)
  }, [initialFrom, isOpen])

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }, [])

  const sendSuggestion = async (cleanFrom, cleanTo) => {
    setSending(true)
    setNotice(null)
    try {
      const body = { from: cleanFrom, to: cleanTo }
      const cleanOriginal = original.trim()
      const cleanNote = note.trim()
      if (cleanOriginal) body.original = cleanOriginal
      if (cleanNote) body.note = cleanNote
      if (Number.isInteger(chapter) && chapter >= 0) body.chapter = chapter
      await submitGlossarySuggestion(slug, body)
      setNotice({ type: 'success', text: 'Đã gửi góp ý — cảm ơn bạn! Quản trị viên sẽ xem và áp dụng cho mọi người.' })
      clearCloseTimer()
      closeTimerRef.current = setTimeout(() => { closeTimerRef.current = null; onClose() }, SUCCESS_CLOSE_MS)
    } catch (err) {
      const status = err?.response?.status
      const msg = err?.response?.data?.error
        || (status === 401 ? 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại.' : 'Không gửi được góp ý, vui lòng thử lại.')
      setNotice({ type: 'error', text: msg })
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (sending) return
    const cleanFrom = fromText.trim()
    const cleanTo = toText.trim()
    if (!cleanFrom || !cleanTo) return

    const willSuggest = suggest && loggedIn && slug
    // Góp ý công khai có ràng buộc riêng (server từ chối ký tự markdown/HTML,
    // cụm gốc < 2 ký tự) → báo sớm, chưa áp gì. Quy tắc cá nhân không bị giới hạn.
    if (willSuggest) {
      const problem = validateSuggestion({ from: cleanFrom, to: cleanTo, original, note })
      if (problem) {
        setNotice({ type: 'error', text: problem })
        return
      }
    }

    // Quy tắc cá nhân luôn lưu ngay để người đọc thấy kết quả tức thì.
    onApply({ from: cleanFrom, to: cleanTo, scope })
    if (willSuggest) {
      sendSuggestion(cleanFrom, cleanTo) // modal mở tới khi có kết quả
      return
    }
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Sửa từ / Thêm vào Glossary"
    >
      <form onSubmit={handleSubmit} className="inline-glossary-form">
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 opacity-80">
            Từ gốc trong truyện
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-amber-500"
            value={fromText}
            onChange={(e) => setFromText(e.target.value)}
            placeholder="Từ cần sửa..."
            maxLength={TEXT_MAX}
            required
            autoFocus
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 opacity-80">
            Thay thế bằng
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-amber-500"
            value={toText}
            onChange={(e) => setToText(e.target.value)}
            placeholder="Nghĩa mới chính xác (vd: Lạc Vũ)..."
            maxLength={TEXT_MAX}
            required
          />
        </div>

        <div className="mb-5">
          <label className="block text-sm font-medium mb-2 opacity-80">
            Phạm vi áp dụng
          </label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="all"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
              />
              <span>Toàn bộ truyện này (nhớ lâu dài)</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="chapter"
                checked={scope === 'chapter'}
                onChange={() => setScope('chapter')}
              />
              <span>Chỉ chương này</span>
            </label>
          </div>
        </div>

        {/* Góp ý name cho mọi người — chỉ khi đã đăng nhập */}
        {slug && (loggedIn ? (
          <div className="mb-5 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={suggest}
                onChange={(e) => { setSuggest(e.target.checked); setNotice(null) }}
              />
              <span>Gửi góp ý cho mọi người</span>
            </label>
            {suggest && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm mb-1 opacity-80">Chữ Hán gốc (nếu biết)</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-amber-500"
                    value={original}
                    onChange={(e) => setOriginal(e.target.value)}
                    placeholder="vd: 洛羽"
                    maxLength={ORIGINAL_MAX}
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1 opacity-80">Ghi chú (tuỳ chọn)</label>
                  <textarea
                    className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-amber-500"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Lý do / ngữ cảnh ngắn..."
                    maxLength={NOTE_MAX}
                    rows={2}
                  />
                </div>
                <p className="text-xs opacity-60">
                  Góp ý được quản trị viên xem trước khi áp dụng cho mọi người đọc.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="mb-5 text-xs opacity-70">
            <Link to="/account" onClick={handleClose} className="underline">Đăng nhập</Link> để gửi góp ý sửa name cho mọi người.
          </p>
        ))}

        {notice && (
          <div
            role={notice.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`mb-4 px-3 py-2 rounded-md text-sm ${notice.type === 'error' ? 'bg-red-500/10 text-red-600' : 'bg-green-500/10 text-green-700'}`}
          >
            {notice.text}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-opacity-10">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            {notice ? 'Đóng' : 'Hủy'}
          </button>
          <button
            type="submit"
            disabled={sending || !fromText.trim() || !toText.trim() || notice?.type === 'success'}
            aria-busy={sending}
            className="px-4 py-2 text-sm font-medium rounded-md bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-50"
          >
            {sending
              ? 'Đang gửi...'
              : notice?.type === 'error' && suggest ? 'Gửi lại góp ý' : (suggest && loggedIn ? 'Áp dụng & gửi góp ý' : 'Áp dụng ngay')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

InlineGlossaryModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  initialFrom: PropTypes.string,
  onApply: PropTypes.func.isRequired,
  slug: PropTypes.string,
  chapter: PropTypes.number,
}
