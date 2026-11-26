import PropTypes from 'prop-types'
import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Modal from './ui/Modal'
import { isLoggedIn } from '../userApi'
import { submitGlossarySuggestion, fetchNovelNames } from '../engagementApi'
import { NAME_CASING_STYLES, applyCasing, expandSelection } from '../utils/nameEditor'
import {
  lookupNameZh,
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
  context = null,
}) {
  const [fromText, setFromText] = useState(initialFrom)
  const [toText, setToText] = useState('')
  const [scope, setScope] = useState('all') // 'all' (toàn truyện) | 'chapter' (chỉ chương này)
  // Khớp nguyên từ: quy tắc mới mặc định bật — không thay "An" dính liền trong "Anh".
  // Không chặn được âm tiết nằm trong tên ghép ("Lâm" vẫn khớp trong "Lâm Phong")
  // vì tiếng Việt tách âm tiết bằng dấu cách → nên chọn cả cụm tên khi sửa.
  const [whole, setWhole] = useState(true)
  // Vị trí cụm gốc trong đoạn văn (để mở rộng trái/phải); null = không có ngữ cảnh → ẩn nút.
  const [range, setRange] = useState(null)
  // Chỉ mục name vi → zh của truyện (tải lười khi mở modal lần đầu).
  const [namesIndex, setNamesIndex] = useState({ slug: null, names: [] })
  // Giá trị chữ Hán do MÌNH tự điền gần nhất — người dùng sửa tay thì không ghi đè nữa.
  const autoOriginalRef = useRef('')
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
    setWhole(true)
    setRange(context && typeof context.text === 'string' && Number.isInteger(context.start) && Number.isInteger(context.end)
      ? { start: context.start, end: context.end }
      : null)
    autoOriginalRef.current = ''
    setOriginal('')
    setNote('')
    setNotice(null)
    setSending(false)
    // context đổi cùng lúc với initialFrom (cùng 1 lần chọn) → không cần làm dependency riêng.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFrom, isOpen])

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }, [])

  // Tải lười chỉ mục name (cache Promise theo slug trong engagementApi).
  useEffect(() => {
    if (!isOpen || !slug) return undefined
    let alive = true
    fetchNovelNames(slug).then(names => { if (alive) setNamesIndex({ slug, names }) })
    return () => { alive = false }
  }, [isOpen, slug])

  const zhList = useMemo(
    () => (namesIndex.slug === slug ? lookupNameZh(namesIndex.names, fromText) : []),
    [namesIndex, slug, fromText],
  )
  const zhKey = zhList.join('|')

  // Tự điền "Chữ Hán gốc" khi đang góp ý: chỉ khi ô trống hoặc vẫn là giá trị
  // mình điền lần trước (người dùng đã sửa tay → giữ). Cụm mới không khớp → xoá
  // giá trị tự điền cũ (đã sai cụm).
  useEffect(() => {
    if (!suggest) return
    const next = zhKey ? zhKey.split('|')[0] : ''
    setOriginal(prev => {
      if (prev.trim() !== '' && prev !== autoOriginalRef.current) return prev
      autoOriginalRef.current = next
      return next
    })
  }, [suggest, zhKey])

  // Mở rộng cụm: chỉ khi ô "Cụm gốc" còn khớp đúng đoạn đã chọn (sửa tay → ẩn nút).
  const contextText = context && typeof context.text === 'string' ? context.text : ''
  const rangeInSync = Boolean(range && contextText && contextText.slice(range.start, range.end).trim() === fromText.trim())
  const expandLeft = useMemo(
    () => (rangeInSync ? expandSelection(contextText, range.start, range.end, 'left', TEXT_MAX) : null),
    [rangeInSync, contextText, range],
  )
  const expandRight = useMemo(
    () => (rangeInSync ? expandSelection(contextText, range.start, range.end, 'right', TEXT_MAX) : null),
    [rangeInSync, contextText, range],
  )
  const applyExpand = (next) => {
    if (!next) return
    setRange({ start: next.start, end: next.end })
    setFromText(next.text.trim())
  }

  // Kiểu viết hoa áp lên ô "Thay bằng"; ô còn trống thì lấy cụm gốc làm đầu vào.
  const applyCasingStyle = (style) => {
    const base = toText.trim() ? toText : fromText
    setToText(applyCasing(base, style))
  }

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
    onApply({ from: cleanFrom, to: cleanTo, scope, whole })
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
          <label htmlFor="ig-from" className="block text-sm font-medium mb-1 opacity-80">
            Cụm gốc trong truyện
          </label>
          <div className="flex items-stretch gap-1.5">
            {range && (
              <button
                type="button"
                onClick={() => applyExpand(expandLeft)}
                disabled={!expandLeft}
                title="Mở rộng cụm sang trái 1 từ"
                aria-label="Mở rộng cụm sang trái 1 từ"
                className="px-2 text-sm rounded-md border hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30"
              >
                ◀+
              </button>
            )}
            <input
              id="ig-from"
              type="text"
              className="flex-1 min-w-0 px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-amber-500"
              value={fromText}
              onChange={(e) => setFromText(e.target.value)}
              placeholder="Cụm cần sửa..."
              maxLength={TEXT_MAX}
              required
              autoFocus
            />
            {range && (
              <button
                type="button"
                onClick={() => applyExpand(expandRight)}
                disabled={!expandRight}
                title="Mở rộng cụm sang phải 1 từ"
                aria-label="Mở rộng cụm sang phải 1 từ"
                className="px-2 text-sm rounded-md border hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30"
              >
                +▶
              </button>
            )}
          </div>
          {zhList.length > 0 && (
            <p className="mt-1 text-sm opacity-80" lang="zh">
              <span lang="vi">Chữ Hán: </span>
              <span className="font-medium">{zhList.join(' · ')}</span>
            </p>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="ig-to" className="block text-sm font-medium mb-1 opacity-80">
            Thay bằng
          </label>
          <input
            id="ig-to"
            type="text"
            className="w-full px-3 py-2 border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-amber-500"
            value={toText}
            onChange={(e) => setToText(e.target.value)}
            placeholder="Nghĩa mới chính xác (vd: Lạc Vũ)..."
            maxLength={TEXT_MAX}
            required
          />
          {/* Chọn nhanh kiểu viết hoa (học từ STV) */}
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Kiểu viết hoa">
            {NAME_CASING_STYLES.map(st => (
              <button
                key={st.key}
                type="button"
                onClick={() => applyCasingStyle(st.key)}
                disabled={!toText.trim() && !fromText.trim()}
                title={`vd: ${st.hint}`}
                className="px-2 py-0.5 text-xs rounded border hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
              >
                {st.label}
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-1.5 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={whole}
              onChange={(e) => setWhole(e.target.checked)}
            />
            <span>Chỉ khớp nguyên từ</span>
            <span className="text-xs opacity-60">(không thay khi cụm nằm trong từ khác)</span>
          </label>
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
                  {zhList.length > 1 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="opacity-70">Chọn:</span>
                      {zhList.map(zh => (
                        <button
                          key={zh}
                          type="button"
                          lang="zh"
                          onClick={() => { autoOriginalRef.current = zh; setOriginal(zh) }}
                          className={`px-2 py-0.5 rounded border ${original === zh ? 'border-amber-500 text-amber-700 dark:text-amber-400' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                        >
                          {zh}
                        </button>
                      ))}
                    </div>
                  )}
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
  // Đoạn văn chứa vùng chọn + offset (UTF-16) của vùng chọn trong đoạn — cho nút mở rộng cụm.
  context: PropTypes.shape({
    text: PropTypes.string.isRequired,
    start: PropTypes.number.isRequired,
    end: PropTypes.number.isRequired,
  }),
}
