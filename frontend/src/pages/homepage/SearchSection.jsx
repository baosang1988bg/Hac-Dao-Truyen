import React from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import { EpubCard } from '../EpubCatalogPage'

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
      <div style={{ marginBottom: '1.75rem' }}>
        <div
          className="glass-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 18px',
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
            placeholder="Tìm kiếm truyện, EPUB theo tên, tác giả (ví dụ: Xích Tâm, Huyền Giám...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-main)',
              fontSize: '0.98rem',
              fontFamily: 'inherit',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
              }}
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
              Không tìm thấy truyện nào phù hợp với từ khóa "<strong>{searchQuery}</strong>".
            </div>
          ) : searchResults ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '14px' }}>
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
