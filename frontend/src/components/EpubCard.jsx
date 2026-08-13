import React from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Eye, Star, BookMarked } from 'lucide-react'
import NovelCover from './NovelCover'
import { fmtNumber, fmtNovelTitle } from '../utils/format'

/**
 * EpubCard — thẻ hiển thị 1 truyện trong lưới (dùng ở EpubCatalogPage và
 * SearchSection trên trang chủ). Tách riêng khỏi EpubCatalogPage.jsx để trang
 * chủ (eager-loaded) không kéo theo toàn bộ code của trang /epub (lazy-loaded).
 */
export function EpubCard({ novel }) {
  const hasChapters = Number(novel.chapter_count) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: '14px', overflow: 'hidden', background: 'var(--glass-bg)', border: '1px solid var(--border)', transition: 'transform 0.18s, box-shadow 0.18s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      {/* Cover */}
      <Link to={`/novel/${novel.slug}`} style={{ position: 'relative', display: 'block', aspectRatio: '2/3', overflow: 'hidden' }}>
        <NovelCover novel={novel} size="lg" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {hasChapters ? (
          <span style={{ position: 'absolute', top: '8px', left: '8px', background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '3px 7px', borderRadius: '6px', letterSpacing: '0.05em' }}>
            TRỰC TIẾP
          </span>
        ) : novel.has_epub ? (
          <span style={{ position: 'absolute', top: '8px', left: '8px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '3px 7px', borderRadius: '6px', letterSpacing: '0.05em' }}>
            EPUB
          </span>
        ) : null}
        {novel.total_chapters > 0 && novel.chapter_count >= novel.total_chapters && (
          <span style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(16,185,129,0.9)', color: '#fff', fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '5px' }}>
            FULL
          </span>
        )}
      </Link>

      {/* Info */}
      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '5px', flex: 1 }}>
        <Link to={`/novel/${novel.slug}`} style={{ color: 'var(--text-main)', textDecoration: 'none' }}>
          <div style={{ fontWeight: 600, fontSize: '0.82rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {fmtNovelTitle(novel.title, novel.slug)}
          </div>
        </Link>

        {novel.genre ? (
          <div style={{ fontSize: '0.68rem', color: '#818cf8', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {novel.genre}
          </div>
        ) : null}

        {/* Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
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
        <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
          {hasChapters ? (
            <Link
              to={`/novel/${novel.slug}`}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                padding: '7px 4px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
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
                padding: '7px 4px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                color: '#fff', borderRadius: '8px', textDecoration: 'none', fontSize: '0.78rem', fontWeight: 600,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <BookMarked size={13} /> Đọc EPUB
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

export default EpubCard
