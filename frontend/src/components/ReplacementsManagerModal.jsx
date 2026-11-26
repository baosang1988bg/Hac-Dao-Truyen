import PropTypes from 'prop-types'
import { useEffect, useRef, useState } from 'react'
import { Trash2, Download, Upload } from 'lucide-react'
import Modal from './ui/Modal'
import '../styles/name-editor.css'
import { buildNamePack, namePackFilename, parseNamePack, NAME_PACK_MAX_BYTES } from '../utils/nameEditor'

export default function ReplacementsManagerModal({
  isOpen,
  onClose,
  replacements = [],
  onDelete,
  slug,
  onImport,
}) {
  const fileRef = useRef(null)
  const [notice, setNotice] = useState(null) // { type: 'success'|'error', text }

  // Mỗi lần mở modal là phiên mới → bỏ thông báo nhập lần trước.
  useEffect(() => { if (isOpen) setNotice(null) }, [isOpen])

  // Xuất: tải file name-<slug>.json (Blob + a[download]), không qua server.
  const handleExport = () => {
    if (!slug || replacements.length === 0) return
    const pack = buildNamePack(slug, replacements)
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = namePackFilename(slug)
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Thu hồi sau 1 nhịp — một số trình duyệt (Safari) cần URL còn sống lúc bắt đầu tải.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Nhập: kiểm tra kích thước trước khi đọc, parseNamePack kiểm định dạng/giới hạn,
  // gộp qua onImport (trùng `from` → bản trong file thắng).
  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // cho chọn lại cùng file lần sau
    if (!file || !onImport) return
    if (file.size > NAME_PACK_MAX_BYTES) {
      setNotice({ type: 'error', text: `File quá lớn (tối đa ${Math.round(NAME_PACK_MAX_BYTES / 1024)} KB).` })
      return
    }
    let text
    try {
      text = await file.text()
    } catch {
      setNotice({ type: 'error', text: 'Không đọc được file.' })
      return
    }
    const parsed = parseNamePack(text, slug)
    if (!parsed.ok) {
      setNotice({ type: 'error', text: parsed.error })
      return
    }
    const res = onImport(parsed.rules) || { added: 0, updated: 0, unchanged: 0 }
    const parts = [`Đã nhập ${res.added + res.updated} quy tắc (${res.added} mới, ${res.updated} ghi đè`]
    parts[0] += res.unchanged ? `, ${res.unchanged} trùng y hệt)` : ')'
    if (parsed.skippedHan) parts.push(`bỏ ${parsed.skippedHan} dòng có chữ Hán (quy tắc chỉ thay trên bản tiếng Việt)`)
    if (parsed.skipped) parts.push(`bỏ ${parsed.skipped} dòng/quy tắc không hợp lệ`)
    if (parsed.slugMismatch) parts.push(`lưu ý: file xuất từ truyện "${parsed.fileSlug.slice(0, 60)}"`)
    setNotice({ type: 'success', text: parts.join('; ') + '.' })
  }

  // ui/Modal không có prop isOpen/title → tự ẩn khi đóng (xem InlineGlossaryModal).
  if (!isOpen) return null

  return (
    <Modal
      onClose={onClose}
      ariaLabel={`Từ đã sửa thủ công (${replacements.length})`}
      panelClassName="ne-panel"
    >
      <div className="replacements-manager">
        <h3 className="ne-title">Từ đã sửa thủ công ({replacements.length})</h3>
        {replacements.length === 0 ? (
          <p className="ne-empty">
            Chưa có từ nào được sửa thủ công cho truyện này. Bôi đen từ khi đọc để sửa nhanh!
          </p>
        ) : (
          <ul className="ne-list">
            {replacements.map((item) => (
              <li key={item.id} className="ne-item">
                <div className="ne-item__body">
                  <span className="ne-item__from">{item.from}</span>
                  <span className="ne-item__arrow" aria-hidden="true">➔</span>
                  <span className="ne-item__to">{item.to}</span>
                  {item.whole === true && (
                    <span className="ne-badge" title="Chỉ khớp nguyên từ">
                      nguyên từ
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  title="Xoá quy tắc này"
                  aria-label={`Xoá quy tắc ${item.from} → ${item.to}`}
                  className="ne-btn ne-btn--icon ne-btn--danger"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {notice && (
          <div
            role={notice.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`ne-notice ne-notice--below${notice.type === 'error' ? ' ne-notice--error' : ''}`}
          >
            {notice.text}
          </div>
        )}

        <div className="ne-actions ne-actions--split" style={{ marginTop: '1rem' }}>
          {slug && onImport ? (
            <div className="ne-actions__group">
              <button
                type="button"
                onClick={handleExport}
                disabled={replacements.length === 0}
                title="Tải các quy tắc của truyện này về máy (file JSON)"
                className="ne-btn"
              >
                <Download size={14} aria-hidden="true" /> Xuất
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title="Nhập gói name (JSON đã xuất, hoặc văn bản mỗi dòng A=B)"
                className="ne-btn"
              >
                <Upload size={14} aria-hidden="true" /> Nhập
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.txt,application/json,text/plain"
                hidden
                onChange={handleFile}
              />
            </div>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            className="ne-btn ne-btn--primary"
          >
            Đóng
          </button>
        </div>
      </div>
    </Modal>
  )
}

ReplacementsManagerModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  replacements: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      from: PropTypes.string.isRequired,
      to: PropTypes.string.isRequired,
      whole: PropTypes.bool,
    })
  ),
  onDelete: PropTypes.func.isRequired,
  slug: PropTypes.string,
  // (rules) → { added, updated, unchanged } — gộp quy tắc nhập từ file vào truyện hiện tại.
  onImport: PropTypes.func,
}
