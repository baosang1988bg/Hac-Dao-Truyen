import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Search, BookMarked, ChevronDown, Star, Eye, BookOpen,
  SlidersHorizontal, X, Filter, TrendingUp, Clock, AlignLeft,
} from 'lucide-react'
import api from '../api'
import NovelCover from '../components/NovelCover'
import { fmtNumber, fmtTimeAgo } from '../utils/format'

const LIMIT = 24

const SORT_OPTIONS = [
  { value: 'updated_at', label: 'Mới cập nhật', icon: Clock },
  { value: 'chapter_count', label: 'Nhiều chương nhất', icon: BookOpen },
  { value: 'views', label: 'Lượt xem nhiều nhất', icon: Eye },
  { value: 'rating', label: 'Đánh giá cao nhất', icon: Star },
  { value: 'title', label: 'A → Z', icon: AlignLeft },
]

/**
 * EpubCatalogPage — Trang khám phá & đọc toàn bộ kho EPUB.
 * URL: /epub
 */
export default function EpubCatalogPage() {
  const [novels, setNovels]       = useState([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [pages, setPages]         = useState(1)
  const [loading, setLoading]     = useState(true)
  const [genres, setGenres]       = useState([])

  // Filter state
  const [q, setQ]               = useState('')
  const [sort, setSort]         = useState('updated_at')
  const [genre, setGenre]       = useState('')
  const [status, setStatus]     = useState('')
  const [hasEpub, setHasEpub]   = useState(false)
  const [showFilter, setShowFilter] = useState(false)

  const debounceRef = useRef(null)

  // Load genres
  useEffect(() => {
    api.get('/novels/genres').then(r => setGenres(r.data || [])).catch(() => {})
  }, [])

  const fetchNovels = useCallback(async (pg = 1, reset = false) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        sort, order: sort === 'title' ? 'asc' : 'desc',
        page: pg, limit: LIMIT,
      })
      if (q) params.set('q', q)
      if (genre) params.set('genre', genre)
      if (status) params.set('status', status)
      if (hasEpub) params.set('has_epub', '1')

      const res = await api.get(`/novels?${params}`)
      const data = res.data
      const list = data.novels || data // backwards compat
      setTotal(data.total ?? list.length)
      setPages(data.pages ?? 1)
      setNovels(prev => (reset || pg === 1) ? list : [...prev, ...list])
      setPage(pg)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [q, sort, genre, status, hasEpub])

  // Fetch khi filter thay đổi
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchNovels(1, true), q ? 300 : 0)
    return () => clearTimeout(debounceRef.current)
  }, [q, sort, genre, status, hasEpub, fetchNovels])

  const loadMore = () => { if (page < pages && !loading) fetchNovels(page + 1) }

  const resetFilters = () => {
    setQ(''); setSort('updated_at'); setGenre(''); setStatus(''); setHasEpub(false)
  }
  const hasActiveFilters = q || genre || status || hasEpub || sort !== 'updated_at'

  return (
    <div className="container animate-fade-in" style={{ paddingBottom: '3rem' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.6rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <BookMarked size={24} style={{ color: 'var(--accent)' }} /> Kho EPUB
        </h1>
        <p className="page-subtitle" style={{ fontSize: '0.9rem' }}>
          {total > 0 ? `${fmtNumber(total)} truyện` : 'Đang tải...'} — đọc trực tiếp trên trình duyệt, không cần tải về.
        </p>
      </div>

      {/* ── Search + Filter bar ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg-main)', paddingTop: '8px', paddingBottom: '12px', marginBottom: '4px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              id="epub-search"
              type="text"
              placeholder="Tìm tên truyện, tác giả..."
              value={q}
              onChange={e => setQ(e.target.value)}
              style={{
                width: '100%', padding: '10px 36px 10px 36px',
                background: 'var(--glass-bg)', border: '1px solid var(--border)',
                borderRadius: '10px', color: 'var(--text-main)', fontSize: '0.9rem',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            {q && (
              <button onClick={() => setQ('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter toggle */}
          <button
            id="epub-filter-toggle"
            onClick={() => setShowFilter(s => !s)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px',
              background: showFilter ? 'rgba(99,102,241,0.2)' : 'var(--glass-bg)',
              border: `1px solid ${showFilter ? '#6366f1' : 'var(--border)'}`,
              borderRadius: '10px', color: 'var(--text-main)', cursor: 'pointer',
              fontSize: '0.85rem', whiteSpace: 'nowrap', transition: 'all 0.15s',
              position: 'relative',
            }}
          >
            <SlidersHorizontal size={15} /> Lọc
            {hasActiveFilters && (
              <span style={{ position: 'absolute', top: '4px', right: '4px', width: '7px', height: '7px', background: '#6366f1', borderRadius: '50%' }} />
            )}
          </button>
        </div>

        {/* Expanded filter panel */}
        {showFilter && (
          <div className="glass-panel" style={{ marginTop: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Sort */}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sắp xếp</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSort(opt.value)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
                      background: sort === opt.value ? 'rgba(99,102,241,0.2)' : 'var(--glass-bg)',
                      border: `1px solid ${sort === opt.value ? '#6366f1' : 'var(--border)'}`,
                      color: sort === opt.value ? '#818cf8' : 'var(--text-main)',
                      fontSize: '0.82rem', transition: 'all 0.15s',
                    }}
                  >
                    <opt.icon size={13} /> {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Genre */}
            {genres.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Thể loại</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <FilterChip label="Tất cả" active={!genre} onClick={() => setGenre('')} />
                  {genres.map(g => (
                    <FilterChip key={g} label={g} active={genre === g} onClick={() => setGenre(g === genre ? '' : g)} />
                  ))}
                </div>
              </div>
            )}

            {/* Status + Has EPUB */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trạng thái</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <FilterChip label="Tất cả" active={!status} onClick={() => setStatus('')} />
                  <FilterChip label="Đang dịch" active={status === 'ongoing'} onClick={() => setStatus(status === 'ongoing' ? '' : 'ongoing')} />
                  <FilterChip label="Hoàn thành" active={status === 'completed'} onClick={() => setStatus(status === 'completed' ? '' : 'completed')} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-main)', marginTop: '12px' }}>
                <input
                  type="checkbox"
                  checked={hasEpub}
                  onChange={e => setHasEpub(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
                />
                Chỉ hiện truyện có EPUB
              </label>
            </div>

            {hasActiveFilters && (
              <button onClick={resetFilters} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>
                <X size={13} /> Xóa bộ lọc
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Quick sort chips (luôn hiện) ── */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
        {SORT_OPTIONS.slice(0, 4).map(opt => (
          <button
            key={opt.value}
            onClick={() => setSort(opt.value)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', whiteSpace: 'nowrap',
              background: sort === opt.value ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'var(--glass-bg)',
              border: `1px solid ${sort === opt.value ? 'transparent' : 'var(--border)'}`,
              color: sort === opt.value ? '#fff' : 'var(--text-muted)',
              fontSize: '0.8rem', transition: 'all 0.2s',
            }}
          >
            <opt.icon size={12} /> {opt.label}
          </button>
        ))}
      </div>

      {/* ── Grid ── */}
      {loading && novels.length === 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '16px' }}>
          {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : novels.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📭</div>
          <div style={{ fontWeight: 600 }}>Không tìm thấy truyện nào</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
          {hasActiveFilters && (
            <button onClick={resetFilters} className="btn btn-secondary" style={{ marginTop: '1rem' }}>
              <X size={14} /> Xóa bộ lọc
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '16px' }}>
            {novels.map(n => <EpubCard key={n.slug} novel={n} />)}
          </div>

          {/* Load more */}
          {page < pages && (
            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <button
                onClick={loadMore}
                disabled={loading}
                className="btn btn-secondary"
                style={{ minWidth: '200px' }}
              >
                {loading ? 'Đang tải...' : `Tải thêm (${fmtNumber(total - novels.length)} còn lại)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── EpubCard ─────────────────────────────────────────────────────────────────

function EpubCard({ novel }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: '14px', overflow: 'hidden', background: 'var(--glass-bg)', border: '1px solid var(--border)', transition: 'transform 0.18s, box-shadow 0.18s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      {/* Cover */}
      <Link to={`/novel/${novel.slug}`} style={{ position: 'relative', display: 'block', aspectRatio: '2/3', overflow: 'hidden' }}>
        <NovelCover novel={novel} size="lg" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {(novel.has_epub || (novel.chapter_count > 0)) ? (
          <span style={{ position: 'absolute', top: '8px', left: '8px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '3px 7px', borderRadius: '6px', letterSpacing: '0.05em' }}>
            EPUB
          </span>
        ) : null}
        {novel.status === 'completed' && (
          <span style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(16,185,129,0.9)', color: '#fff', fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '5px' }}>
            FULL
          </span>
        )}
      </Link>

      {/* Info */}
      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
        <Link to={`/novel/${novel.slug}`} style={{ color: 'var(--text-main)', textDecoration: 'none' }}>
          <div style={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {novel.title}
          </div>
        </Link>

        {/* Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <BookOpen size={11} /> {fmtNumber(novel.chapter_count)}
          </span>
          {novel.views > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Eye size={11} /> {fmtNumber(novel.views)}
            </span>
          )}
          {novel.rating > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#fbbf24' }}>
              <Star size={11} fill="#fbbf24" /> {novel.rating}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
          {(novel.has_epub || (novel.chapter_count > 0)) ? (
            <Link
              to={`/novel/${novel.slug}/epub-reader`}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                padding: '7px 4px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                color: '#fff', borderRadius: '8px', textDecoration: 'none', fontSize: '0.78rem', fontWeight: 600,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <BookMarked size={13} /> Đọc EPUB
            </Link>
          ) : (
            <Link
              to={`/novel/${novel.slug}`}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                padding: '7px 4px', background: 'var(--glass-bg)', border: '1px solid var(--border)',
                color: 'var(--text-muted)', borderRadius: '8px', textDecoration: 'none', fontSize: '0.78rem',
              }}
            >
              <BookOpen size={13} /> Đọc chương
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.8rem',
        background: active ? 'rgba(99,102,241,0.2)' : 'var(--glass-bg)',
        border: `1px solid ${active ? '#6366f1' : 'var(--border)'}`,
        color: active ? '#818cf8' : 'var(--text-muted)',
        transition: 'all 0.15s', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function SkeletonCard() {
  return (
    <div style={{ borderRadius: '14px', overflow: 'hidden', background: 'var(--glass-bg)', border: '1px solid var(--border)' }}>
      <div style={{ aspectRatio: '2/3', background: 'rgba(255,255,255,0.04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ height: '12px', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ height: '10px', width: '60%', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ height: '32px', background: 'rgba(99,102,241,0.1)', borderRadius: '8px', animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>
  )
}
