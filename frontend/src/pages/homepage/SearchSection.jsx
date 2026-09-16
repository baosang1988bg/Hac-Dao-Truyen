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
 */
export default function SearchSection({
  searchQuery,
  setSearchQuery,
  searchResults,
  searchLoading,
}) {
  return (
    <>
      {/* Thanh tìm kiếm */}
      <div className="hp-search-wrap">
        <div
          className="glass-panel hp-search-bar"
          style={{
            borderRadius: '14px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
          }}
        >
          {searchLoading ? (
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)', flexShrink: 0 }} />
          ) : (
            <Search size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          )}
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            aria-label="Tìm kiếm truyện hoặc EPUB"
            className="hp-search-input"
            placeholder="Tìm kiếm truyện, EPUB theo tên, tác giả (ví dụ: Xích Tâm, Huyền Giám...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
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
        <section className="home-section animate-fade-in" style={{ marginBottom: '2rem' }}>
          <h2 className="home-section__title">
            <Search size={18} style={{ color: 'var(--accent)' }} />
            {' '}Kết quả tìm kiếm ({searchResults ? searchResults.length : '...'})
          </h2>
          {searchLoading && !searchResults ? (
            <div className="glass-panel p-6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Đang tìm kiếm trong toàn bộ cơ sở dữ liệu...
            </div>
          ) : searchResults && searchResults.length === 0 ? (
            <div className="glass-panel p-6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Không tìm thấy truyện nào phù hợp với từ khóa &quot;<strong>{searchQuery}</strong>&quot;.
            </div>
          ) : searchResults ? (
            <div className="hp-search-results-grid">
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
};
