import React, { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search, Play, ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Duyệt mục lục gốc (tách từ CatalogTab của NovelDetail.jsx cũ).
 * @param {boolean} readOnly — true = ẩn nút "Dịch từ đây"
 */
export default function CatalogBrowser({ catalog, chapters, slug, onTranslateFromChapter, readOnly = false }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 40

  const readChapters = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(`read_chapters_${slug}`) || '[]')
    } catch {
      return []
    }
  }, [slug])

  // 1. Helpers for clean match
  const getChapNum = (title) => {
    const m = title.match(/第(\d+)章|[Cc]hapter\s*(\d+)|Chương\s*(\d+)|(\d+)\./)
    return m ? parseInt(m[1] || m[2] || m[3] || m[4]) : null
  }

  const cleanCatalogTitle = (title) => {
    return title.split('').filter(c => /[\p{L}\p{N} \-_]/u.test(c)).join('').trim()
  }

  // 2. Search filter
  const filtered = catalog.filter(item =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 3. Pagination
  const totalPages = Math.ceil(filtered.length / itemsPerPage)
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  if (catalog.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
        Truyện này chưa được nhập mục lục gốc (không có catalog.json).
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar Tìm kiếm & Thống kê */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div style={{ position: 'relative', flex: '1 1 250px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666', display: 'flex', alignItems: 'center' }}>
            <Search size={16} />
          </span>
          <input
            type="text"
            placeholder="Tìm chương mục lục gốc..."
            className="input-field"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '36px', width: '100%', fontSize: '0.875rem', height: '36px' }}
          />
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Tìm thấy: <strong>{filtered.length}</strong> / <strong>{catalog.length}</strong> chương gốc
        </div>
      </div>

      {/* Danh sách catalog */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0',
          background: 'rgba(255,255,255,0.01)', borderRadius: '10px',
          border: '1px dashed var(--border-panel)'
        }}>
          Không tìm thấy chương nào phù hợp trong mục lục.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {paginated.map((item) => {
            // Check if item is already translated
            const cleanTitle = cleanCatalogTitle(item.title)
            const matchedChapter = chapters.find(c =>
              c.title === cleanTitle ||
              (getChapNum(c.title) || getChapNum(c.display_title)) === item.number ||
              (getChapNum(c.title) || getChapNum(c.display_title)) === item.original_chapter_number
            )
            const isTranslated = !!matchedChapter
            const isRead = matchedChapter && (
              readChapters.includes(matchedChapter.filename) ||
              (getChapNum(matchedChapter.title) && readChapters.includes(String(getChapNum(matchedChapter.title))))
            )

            return (
              <div
                key={item.number}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.6rem 0.85rem',
                  borderRadius: '8px',
                  background: isTranslated ? (isRead ? 'rgba(16,185,129,0.01)' : 'rgba(16,185,129,0.02)') : 'rgba(255,255,255,0.01)',
                  border: isTranslated ? (isRead ? '1px solid rgba(16,185,129,0.05)' : '1px solid rgba(16,185,129,0.1)') : '1px solid var(--border-panel)',
                  gap: '1rem',
                  opacity: isRead ? 0.65 : 1,
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                  {/* STT/Number */}
                  <span style={{
                    flexShrink: 0, minWidth: '42px', textAlign: 'right',
                    fontSize: '0.75rem', fontWeight: 700,
                    color: isTranslated ? 'var(--success)' : 'var(--text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    #{item.number}
                  </span>

                  <span style={{ width: '1px', height: '14px', background: 'var(--border-panel)', flexShrink: 0 }} />

                  {/* Title (Chinese) */}
                  <span style={{
                    fontSize: '0.875rem',
                    fontWeight: isTranslated ? (isRead ? 400 : 500) : 400,
                    color: isTranslated ? (isRead ? 'var(--text-muted)' : 'var(--text-main)') : 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flex: 1
                  }}>
                    {item.title}
                  </span>
                </div>

                {/* Badge & Action */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                  {isTranslated ? (
                    <>
                      {isRead && (
                        <span style={{
                          fontSize: '0.72rem', fontWeight: 600,
                          padding: '2px 8px', borderRadius: '4px',
                          background: 'rgba(16,185,129,0.08)', color: '#10b981'
                        }}>
                          ✓ Đã đọc
                        </span>
                      )}
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 600,
                        padding: '2px 8px', borderRadius: '4px',
                        background: 'rgba(16,185,129,0.1)', color: 'var(--success)'
                      }}>
                        Đã dịch
                      </span>
                      <Link
                        to={`/novel/${slug}/read/${matchedChapter.filename.replace('_VI.md', '')}`}
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '0.78rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                      >
                        Đọc chương
                      </Link>
                    </>
                  ) : (
                    <>
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 500,
                        padding: '2px 8px', borderRadius: '4px',
                        background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)'
                      }}>
                        Chưa dịch
                      </span>
                      {!readOnly && (
                        <button
                          className="btn btn-primary"
                          onClick={() => {
                            if (window.confirm(`Bạn muốn dịch bắt đầu từ chương này: "${item.title}"?`)) {
                              onTranslateFromChapter(item.url)
                            }
                          }}
                          style={{
                            padding: '4px 10px', fontSize: '0.78rem',
                            background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)',
                            color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '4px'
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.3)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.2)' }}
                        >
                          <Play size={10} fill="currentColor" /> Dịch từ đây
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Phân trang */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.8rem', marginTop: '1.25rem' }}>
          <button className="btn btn-secondary" onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1} style={{ padding: '6px 10px', opacity: currentPage === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={16} />
          </button>

          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Trang <strong>{currentPage}</strong> / <strong>{totalPages}</strong>
          </span>

          <button className="btn btn-secondary" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages} style={{ padding: '6px 10px', opacity: currentPage === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
