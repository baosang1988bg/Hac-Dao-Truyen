import PropTypes from 'prop-types'
import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Modal from './ui/Modal'
import { isLoggedIn } from '../userApi'
import { submitGlossarySuggestion, fetchNovelNames } from '../engagementApi'
import { NAME_CASING_STYLES, applyCasing, expandSelection } from '../utils/nameEditor'
import {
  loadHanViet, hanVietReadings, hanVietChars, hanVietSuggestion, cycleHanVietPick, isHanText,
} from '../utils/hanviet'
import '../styles/name-editor.css'
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
  // Nhớ kiểu vừa chọn để nút "Dùng" của gợi ý Hán Việt điền đúng kiểu đó.
  const [casing, setCasing] = useState('title')
  const applyCasingStyle = (style) => {
    setCasing(style)
    const base = toText.trim() ? toText : fromText
    setToText(applyCasing(base, style))
  }

  // ── Gợi ý âm Hán Việt ──────────────────────────────────────────────────
  // Nguồn chữ Hán: ô "Chữ Hán gốc" (người dùng tự nhập / tự điền) > cụm gốc
  // nếu chính nó là chữ Hán > kết quả tra /names đầu tiên.
  const hvZh = useMemo(() => {
    const own = original.trim()
    if (suggest && isHanText(own)) return own
    if (isHanText(fromText)) return fromText.trim()
    return zhList[0] || ''
  }, [suggest, original, fromText, zhList])
  // Bảng ~80 KB tải lười (chunk riêng) — chỉ khi modal mở VÀ có chữ Hán để phiên âm.
  const [hvTable, setHvTable] = useState(null)
  const [hvFailed, setHvFailed] = useState(false)
  const needHanViet = isOpen && Boolean(hvZh)
  useEffect(() => {
    if (!needHanViet || hvTable) return undefined
    let alive = true
    loadHanViet()
      .then(table => { if (alive) { setHvTable(table); setHvFailed(false) } })
      .catch(() => { if (alive) setHvFailed(true) })
    return () => { alive = false }
  }, [needHanViet, hvTable])
  // Âm đã chọn cho từng chữ nhiều âm; gắn với chuỗi chữ Hán → đổi chữ là tự về mặc định.
  const [hvPickState, setHvPickState] = useState({ zh: '', picks: [] })
  const hvPicks = hvPickState.zh === hvZh ? hvPickState.picks : []
  const hvReadings = useMemo(() => (hvTable && hvZh ? hanVietReadings(hvZh, hvTable) : []), [hvTable, hvZh])
  const hvChars = useMemo(() => hanVietChars(hvZh), [hvZh])
  const hvText = hvTable && hvZh ? hanVietSuggestion(hvZh, hvTable, hvPicks) : ''
  const hvCased = hvText ? applyCasing(hvText, casing) : ''
  const hvTokens = hvCased ? hvCased.split(' ') : []
  const hvAllMissing = hvReadings.length > 0 && hvReadings.every(list => list[0] === '?')
  const hvSomeMissing = hvReadings.some(list => list[0] === '?')
  const cycleReading = (index, count) => {
    setHvPickState({ zh: hvZh, picks: cycleHanVietPick(hvPicks, index, count) })
  }
  const applyHanViet = () => {
    if (hvCased && !hvAllMissing) setToText(hvCased)
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

  // ui/Modal không có prop isOpen/title (luôn hiển thị khi được render) → tự ẩn ở đây,
  // nếu không Reader luôn phủ một lớp modal chặn mọi thao tác (lỗi bắt được qua E2E).
  if (!isOpen) return null

  return (
    <Modal
      onClose={handleClose}
      ariaLabel="Sửa từ / Thêm vào Glossary"
      panelClassName="ne-panel"
    >
      <form onSubmit={handleSubmit} className="inline-glossary-form">
        <h3 className="ne-title">Sửa từ / Thêm vào Glossary</h3>
        <div className="ne-field">
          <label htmlFor="ig-from" className="ne-label">
            Cụm gốc trong truyện
          </label>
          <div className="ne-row">
            {range && (
              <button
                type="button"
                onClick={() => applyExpand(expandLeft)}
                disabled={!expandLeft}
                title="Mở rộng cụm sang trái 1 từ"
                aria-label="Mở rộng cụm sang trái 1 từ"
                className="ne-btn ne-btn--icon"
              >
                ◀+
              </button>
            )}
            <input
              id="ig-from"
              type="text"
              className="ne-input"
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
                className="ne-btn ne-btn--icon"
              >
                +▶
              </button>
            )}
          </div>
          {zhList.length > 0 && (
            <p className="ne-zh" lang="zh">
              <span lang="vi">Chữ Hán: </span>
              <strong>{zhList.join(' · ')}</strong>
            </p>
          )}
        </div>

        <div className="ne-field">
          <label htmlFor="ig-to" className="ne-label">
            Thay bằng
          </label>
          <input
            id="ig-to"
            type="text"
            className="ne-input"
            value={toText}
            onChange={(e) => setToText(e.target.value)}
            placeholder="Nghĩa mới chính xác (vd: Lạc Vũ)..."
            maxLength={TEXT_MAX}
            required
          />
          {/* Chọn nhanh kiểu viết hoa (học từ STV); kiểu đang chọn cũng dùng cho gợi ý Hán Việt */}
          <div className="ne-chips" role="group" aria-label="Kiểu viết hoa">
            {NAME_CASING_STYLES.map(st => (
              <button
                key={st.key}
                type="button"
                onClick={() => applyCasingStyle(st.key)}
                disabled={!toText.trim() && !fromText.trim()}
                title={`vd: ${st.hint}`}
                aria-pressed={casing === st.key}
                className="ne-chip"
              >
                {st.label}
              </button>
            ))}
          </div>
          {/* Gợi ý âm Hán Việt — chỉ hiện khi có chữ Hán (tra /names hoặc tự nhập) */}
          {hvZh && (
            <div className="ne-hanviet" aria-live="polite">
              <span className="ne-hanviet__label">Hán Việt:</span>
              {hvFailed ? (
                <span className="ne-hint" style={{ margin: 0 }}>không tải được bảng âm</span>
              ) : !hvTable ? (
                <span className="ne-hint" style={{ margin: 0 }}>đang tải…</span>
              ) : (
                <>
                  <span className="ne-hanviet__syls">
                    {hvReadings.map((list, i) => {
                      const shown = hvTokens[i] ?? list[0]
                      const ch = hvChars[i] || ''
                      if (list.length > 1) {
                        return (
                          <button
                            key={`${i}-${ch}`}
                            type="button"
                            className="ne-chip ne-hanviet__syl--multi"
                            onClick={() => cycleReading(i, list.length)}
                            title={`Đổi âm chữ ${ch}: ${list.join(' / ')}`}
                            aria-label={`Đổi âm chữ ${ch}, đang là ${shown}, có ${list.length} âm: ${list.join(', ')}`}
                          >
                            {shown}
                          </button>
                        )
                      }
                      return (
                        <span
                          key={`${i}-${ch}`}
                          className={`ne-hanviet__syl${list[0] === '?' ? ' ne-hanviet__syl--missing' : ''}`}
                          title={list[0] === '?' ? `Chưa có âm cho chữ ${ch}` : ch}
                        >
                          {shown}
                        </span>
                      )
                    })}
                  </span>
                  <button
                    type="button"
                    className="ne-btn ne-btn--primary ne-hanviet__use"
                    onClick={applyHanViet}
                    disabled={hvAllMissing}
                    title={`Điền "${hvCased}" vào ô Thay bằng`}
                  >
                    Dùng
                  </button>
                  {hvSomeMissing && !hvAllMissing && (
                    <span className="ne-hint" style={{ margin: 0, flexBasis: '100%' }}>Chữ có dấu ? chưa có âm — sửa tay sau khi bấm Dùng.</span>
                  )}
                </>
              )}
            </div>
          )}
          <label className="ne-check" style={{ marginTop: '0.6rem' }}>
            <input
              type="checkbox"
              checked={whole}
              onChange={(e) => setWhole(e.target.checked)}
            />
            <span>Chỉ khớp nguyên từ</span>
            <span className="ne-check__note">(không thay khi cụm nằm trong từ khác)</span>
          </label>
        </div>

        <div className="ne-field ne-field--loose">
          <span className="ne-label" id="ig-scope-label">
            Phạm vi áp dụng
          </span>
          <div className="ne-radios" role="radiogroup" aria-labelledby="ig-scope-label">
            <label className="ne-check">
              <input
                type="radio"
                name="scope"
                value="all"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
              />
              <span>Toàn bộ truyện này (nhớ lâu dài)</span>
            </label>
            <label className="ne-check">
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
          <div className="ne-field ne-field--loose">
            <label className="ne-check ne-check--strong">
              <input
                type="checkbox"
                checked={suggest}
                onChange={(e) => { setSuggest(e.target.checked); setNotice(null) }}
              />
              <span>Gửi góp ý cho mọi người</span>
            </label>
            {suggest && (
              <div className="ne-suggest">
                <div>
                  <label htmlFor="ig-original" className="ne-label">Chữ Hán gốc (nếu biết)</label>
                  <input
                    id="ig-original"
                    type="text"
                    lang="zh"
                    className="ne-input"
                    value={original}
                    onChange={(e) => setOriginal(e.target.value)}
                    placeholder="vd: 洛羽"
                    maxLength={ORIGINAL_MAX}
                  />
                  {zhList.length > 1 && (
                    <div className="ne-chips">
                      <span className="ne-check__note">Chọn:</span>
                      {zhList.map(zh => (
                        <button
                          key={zh}
                          type="button"
                          lang="zh"
                          onClick={() => { autoOriginalRef.current = zh; setOriginal(zh) }}
                          aria-pressed={original === zh}
                          className="ne-chip"
                        >
                          {zh}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label htmlFor="ig-note" className="ne-label">Ghi chú (tuỳ chọn)</label>
                  <textarea
                    id="ig-note"
                    className="ne-input"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Lý do / ngữ cảnh ngắn..."
                    maxLength={NOTE_MAX}
                    rows={2}
                  />
                </div>
                <p className="ne-hint" style={{ margin: 0 }}>
                  Góp ý được quản trị viên xem trước khi áp dụng cho mọi người đọc.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="ne-login">
            <Link to="/account" onClick={handleClose}>Đăng nhập</Link> để gửi góp ý sửa name cho mọi người.
          </p>
        ))}

        {notice && (
          <div
            role={notice.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`ne-notice${notice.type === 'error' ? ' ne-notice--error' : ''}`}
          >
            {notice.text}
          </div>
        )}

        <div className="ne-actions">
          <button
            type="button"
            onClick={handleClose}
            className="ne-btn ne-btn--ghost"
          >
            {notice ? 'Đóng' : 'Hủy'}
          </button>
          <button
            type="submit"
            disabled={sending || !fromText.trim() || !toText.trim() || notice?.type === 'success'}
            aria-busy={sending}
            className="ne-btn ne-btn--primary"
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
