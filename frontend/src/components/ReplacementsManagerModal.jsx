import PropTypes from 'prop-types'
import { Trash2 } from 'lucide-react'
import Modal from './ui/Modal'

export default function ReplacementsManagerModal({
  isOpen,
  onClose,
  replacements = [],
  onDelete,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Từ đã sửa thủ công (${replacements.length})`}
    >
      <div className="replacements-manager">
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

        <div className="flex justify-end pt-4 mt-2 border-t border-opacity-10">
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
    })
  ),
  onDelete: PropTypes.func.isRequired,
}
