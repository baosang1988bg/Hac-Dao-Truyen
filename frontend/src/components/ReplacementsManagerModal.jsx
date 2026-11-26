import PropTypes from 'prop-types'
import { useEffect, useRef, useState } from 'react'
import { Trash2, Download, Upload } from 'lucide-react'
import Modal from './ui/Modal'
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
    >
      <div className="replacements-manager">
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', fontWeight: 700 }}>Từ đã sửa thủ công ({replacements.length})</h3>
        {replacements.length === 0 ? (
          <p className="text-sm opacity-60 text-center py-6">
            Chưa có từ nào được sửa thủ công cho truyện này. Bôi đen từ khi đọc để sửa nhanh!
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
            {replacements.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-sm"
              >
                <div className="flex-1 min-w-0 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="line-through opacity-60 truncate max-w-[40%]">
                      {item.from}
                    </span>
                    <span className="opacity-40">➔</span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400 truncate max-w-[45%]">
                      {item.to}
                    </span>
                    {item.whole === true && (
                      <span className="shrink-0 text-[10px] px-1 rounded border opacity-60" title="Chỉ khớp nguyên từ">
                        nguyên từ
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  title="Xoá quy tắc này"
                  className="p-1.5 rounded hover:bg-red-500/10 text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {notice && (
          <div
            role={notice.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`mt-3 px-3 py-2 rounded-md text-sm ${notice.type === 'error' ? 'bg-red-500/10 text-red-600' : 'bg-green-500/10 text-green-700'}`}
          >
            {notice.text}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-4 mt-2 border-t border-opacity-10">
          {slug && onImport ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleExport}
                disabled={replacements.length === 0}
                title="Tải các quy tắc của truyện này về máy (file JSON)"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
              >
                <Download size={14} /> Xuất
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title="Nhập gói name (JSON đã xuất, hoặc văn bản mỗi dòng A=B)"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border hover:bg-black/5 dark:hover:bg-white/5"
              >
                <Upload size={14} /> Nhập
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.txt,application/json,text/plain"
                className="hidden"
                onChange={handleFile}
              />
            </div>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md bg-amber-600 hover:bg-amber-700 text-white transition-colors"
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
