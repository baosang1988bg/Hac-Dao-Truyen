import React from 'react'
import { Link } from 'react-router-dom'
import { History, Clock, BookOpen, BookMarked } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import { getAllHistory, fmtChapterLabel } from '../../utils/readingHistory'
import { fmtTimeAgo } from '../../utils/format'

/**
 * RecentlyReadSection – Truyện vừa đọc gần đây từ localStorage (Web + EPUB).
 * Props:
 *   novels – toàn bộ danh sách novel để khớp slug
 */
export default function RecentlyReadSection({ novels }) {
  const history = getAllHistory()
  if (!history || history.length === 0) return null

  const items = history
    .map(h => {
      const novel = novels.find(n => n.slug === h.slug)
      return novel ? { ...h, novel } : null
    })
    .filter(Boolean)

  if (items.length === 0) return null

  return (
    <section className="home-section animate-fade-in" style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h2 className="home-section__title" style={{ margin: 0 }}>
          <History size={18} style={{ color: 'var(--accent)' }} /> Vừa đọc gần đây
        </h2>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Lưu trên thiết bị ({items.length})
        </span>
      </div>

      <div className="section-row-scroll" style={{ paddingBottom: '0.5rem' }}>
        {items.map(item => {
          const isEpub = item.chapter === 'EPUB' || !item.chapter || item.chapter === 'null'
          const readUrl = isEpub
            ? `/novel/${item.slug}/epub-reader`
            : `/novel/${item.slug}/read/${item.chapter}`

          return (
            <div
              key={item.slug}
              className="glass-panel"
              style={{
                minWidth: '240px',
                maxWidth: '280px',
                padding: '12px',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <NovelCover novel={item.novel} size="sm" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Link
                    to={`/novel/${item.slug}`}
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      fontSize: '0.92rem',
                      color: 'var(--text-main)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.3,
                    }}
                    title={item.novel.title}
                  >
                    {item.novel.title}
                  </Link>
                  <div style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, marginTop: '4px' }}>
                    {isEpub ? 'File EPUB' : `Đã đọc: ${fmtChapterLabel(item.chapter)}`}
                  </div>
                  {item.timestamp > 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={12} /> {fmtTimeAgo(Math.floor(item.timestamp / 1000))}
                    </div>
                  )}
                </div>
              </div>

              <Link
                to={readUrl}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '6px 12px',
                  fontSize: '0.82rem',
                  minHeight: '36px',
                  justifyContent: 'center',
                  borderRadius: '8px',
                }}
              >
                {isEpub ? <BookMarked size={14} /> : <BookOpen size={14} />}
                {isEpub ? ' Đọc EPUB' : ' Đọc tiếp →'}
              </Link>
            </div>
          )
        })}
      </div>
    </section>
  )
}
