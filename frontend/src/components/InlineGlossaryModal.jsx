import PropTypes from 'prop-types'
import { useState, useEffect } from 'react'
import Modal from './ui/Modal'

export default function InlineGlossaryModal({
  isOpen,
  onClose,
  initialFrom = '',
  onApply,
}) {
  const [fromText, setFromText] = useState(initialFrom)
  const [toText, setToText] = useState('')
  const [scope, setScope] = useState('all') // 'all' (toàn truyện) | 'chapter' (chỉ chương này)

  useEffect(() => {
    setFromText(initialFrom)
    setToText('')
  }, [initialFrom, isOpen])

  const handleSubmit = (e) => {
    e.preventDefault()
    const cleanFrom = fromText.trim()
    const cleanTo = toText.trim()
    if (!cleanFrom || !cleanTo) return

    onApply({ from: cleanFrom, to: cleanTo, scope })
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
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

        <div className="flex justify-end gap-2 pt-2 border-t border-opacity-10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={!fromText.trim() || !toText.trim()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-50"
          >
            Áp dụng ngay
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
}
