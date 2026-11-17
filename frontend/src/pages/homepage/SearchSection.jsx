import PropTypes from 'prop-types'
import { novelType } from '../../utils/propTypes'

import { Search, X, Loader2 } from 'lucide-react'
import { EpubCard } from '../../components/EpubCard'

/**
 * SearchSection – Thanh tìm kiếm trang chủ + hiển thị kết quả trực tiếp.
 * Props:
 *   searchQuery     – string
 *   setSearchQuery  – setter
 *   searchResults   – array | null
 *   searchLoading   – boolean
 *   inputRef        – ref gắn vào ô input (HomePage dùng để focus khi
 *                     header mobile gửi state.focusSearch)
 *   placeholder     – placeholder tuỳ chỉnh (mobile dùng bản ngắn)
 */
const DEFAULT_PLACEHOLDER = 'Tìm kiếm truyện, EPUB theo tên, tác giả (ví dụ: Xích Tâm, Huyền Giám...)'

export default function SearchSection({
  searchQuery,
  setSearchQuery,
  searchResults,
  searchLoading,
  inputRef,
  placeholder = DEFAULT_PLACEHOLDER,
}) {
  return (
    <>
      {/* Thanh tìm kiếm */}
      <div className="hp-search-wrap">
        {/* Bo góc/viền/bóng chuyển sang home.css (.hp-search-bar) để có
            trạng thái :focus-within và chỉnh riêng cho mobile. */}
        <div className="glass-panel hp-search-bar">
          {searchLoading ? (
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)', flexShrink: 0 }} />
          ) : (
            <Search size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          )}
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            aria-label="Tìm kiếm truyện hoặc EPUB"
            className="hp-search-input"
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="hp-search-clear"
              aria-label="Xóa tìm kiếm"
              title="Xóa tìm kiếm"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Kết quả tìm kiếm */}
      {searchQuery.trim() && (
        <section className="home-section hp-enter" style={{ marginBottom: '2rem' }}>
          <h2 className="home-section__title">
            <Search size={18} style={{ color: 'var(--accent)' }} />
            {' '}Kết quả tìm kiếm ({searchResults ? searchResults.length : '...'})
          </h2>
          {searchLoading && !searchResults ? (
            <div className="glass-panel p-6" role="status" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Đang tìm kiếm trong toàn bộ cơ sở dữ liệu...
            </div>
          ) : searchResults && searchResults.length === 0 ? (
            <div className="glass-panel p-6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Không tìm thấy truyện nào phù hợp với từ khóa &quot;<strong>{searchQuery}</strong>&quot;.
            </div>
          ) : searchResults ? (
            <div className="hp-search-results-grid hp-stagger">
              {searchResults.map(n => (
                <EpubCard key={n.slug} novel={n} />
              ))}
            </div>
          ) : null}
        </section>
      )}
    </>
  )
}
SearchSection.propTypes = {
  searchQuery: PropTypes.string,
  setSearchQuery: PropTypes.func,
  searchResults: PropTypes.arrayOf(novelType),
  searchLoading: PropTypes.bool,
  inputRef: PropTypes.oneOfType([PropTypes.func, PropTypes.shape({ current: PropTypes.any })]),
  placeholder: PropTypes.string,
};
