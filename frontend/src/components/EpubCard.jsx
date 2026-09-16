import { novelType } from '../utils/propTypes'

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Eye, Star, BookMarked, Download, Check } from 'lucide-react'
import NovelCover from './NovelCover'
import Badge from './ui/Badge'
import { fmtNumber, fmtNovelTitle } from '../utils/format'
import { isEpubDownloaded, downloadEpubOffline } from '../utils/epubOffline'

/**
 * EpubCard — thẻ hiển thị 1 truyện trong lưới (dùng ở EpubCatalogPage và
 * SearchSection trên trang chủ). Tách riêng khỏi EpubCatalogPage.jsx để trang
 * chủ (eager-loaded) không kéo theo toàn bộ code của trang /epub (lazy-loaded).
 */
export function EpubCard({ novel }) {
  const hasChapters = Number(novel.chapter_count) > 0;
  const isEpubOnly = !hasChapters && Boolean(novel.has_epub)

  const [downloaded, setDownloaded] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!isEpubOnly) return
    let cancelled = false
    isEpubDownloaded(novel.slug).then(v => { if (!cancelled) setDownloaded(v) })
    return () => { cancelled = true }
  }, [isEpubOnly, novel.slug])

  const handleDownload = async (e) => {
    e.preventDefault()
    if (downloading || downloaded) return
    setDownloading(true)
    try {
      await downloadEpubOffline(novel.slug)
      setDownloaded(true)
    } catch {
      // Lỗi tải (offline/mạng lỗi) — người dùng có thể thử lại, không cần báo ồn ào.
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: '14px', overflow: 'hidden', background: 'var(--glass-bg)', border: '1px solid var(--border)', transition: 'transform 0.18s, box-shadow 0.18s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      {/* Cover */}
      <Link to={`/novel/${novel.slug}`} style={{ position: 'relative', display: 'block', aspectRatio: '2/3', overflow: 'hidden' }}>
        <NovelCover novel={novel} size="lg" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {hasChapters ? (
          <span className="badge-overlay badge-overlay--left"><Badge variant="live">TRỰC TIẾP</Badge></span>
        ) : novel.has_epub ? (
          <span className="badge-overlay badge-overlay--left"><Badge variant="epub">EPUB</Badge></span>
        ) : null}
        {novel.total_chapters > 0 && novel.chapter_count >= novel.total_chapters && (
          <span className="badge-overlay badge-overlay--right"><Badge variant="full">FULL</Badge></span>
        )}
      </Link>

      {/* Info */}
      <div style={{ padding: 'var(--space-3, 12px)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2, 8px)', flex: 1, minWidth: 0 }}>
        <Link to={`/novel/${novel.slug}`} style={{ display: 'flex', minHeight: '24px', color: 'var(--text-main)', textDecoration: 'none' }}>
          <div style={{ fontWeight: 600, fontSize: '0.82rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {fmtNovelTitle(novel.title, novel.slug)}
          </div>
        </Link>

        {novel.genre ? (
          <div style={{ fontSize: '0.8125rem', color: 'var(--accent)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {novel.genre}
          </div>
        ) : null}

        {/* Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2, 8px)', flexWrap: 'wrap', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <BookOpen size={11} /> {fmtNumber(novel.chapter_count || novel.total_chapters || 0)} chương
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
        <div style={{ display: 'flex', gap: 'var(--space-2, 8px)', marginTop: 'auto', minWidth: 0 }}>
          {hasChapters ? (
            <Link
              to={`/novel/${novel.slug}`}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                minWidth: 0, minHeight: 'var(--tap-target-min, 44px)', padding: 'var(--space-2, 8px) var(--space-1, 4px)', background: 'var(--accent-gradient)',
                color: '#fff', borderRadius: '8px', textDecoration: 'none', fontSize: '0.78rem', fontWeight: 600,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <BookOpen size={13} /> Đọc truyện
            </Link>
          ) : (
            <Link
              to={`/novel/${novel.slug}/epub-reader`}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                minWidth: 0, minHeight: 'var(--tap-target-min, 44px)', padding: 'var(--space-2, 8px) var(--space-1, 4px)', background: 'var(--accent-gradient)',
                color: '#fff', borderRadius: '8px', textDecoration: 'none', fontSize: '0.78rem', fontWeight: 600,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <BookMarked size={13} /> Đọc EPUB
            </Link>
          )}
          {isEpubOnly && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || downloaded}
              title={downloaded ? 'Đã tải để đọc offline' : 'Tải để đọc offline'}
              aria-label={downloaded ? 'Đã tải để đọc offline' : 'Tải để đọc offline'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 'var(--tap-target-min, 44px)', minHeight: 'var(--tap-target-min, 44px)', padding: 0, borderRadius: '8px', border: '1px solid var(--border)',
                background: downloaded ? 'rgba(16,185,129,0.15)' : 'transparent',
                color: downloaded ? '#10b981' : 'var(--text-muted)',
                cursor: downloading || downloaded ? 'default' : 'pointer',
              }}
            >
              {downloaded ? <Check size={14} /> : <Download size={14} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
EpubCard.propTypes = {
  novel: novelType,
};


export default EpubCard
