import React from 'react'
import { Link } from 'react-router-dom'
import { History, Clock, BookOpen, BookMarked } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import SectionHeader from '../../components/ui/SectionHeader'
import { getAllHistory, fmtChapterLabel } from '../../utils/readingHistory'
import { fmtTimeAgo, fmtNovelTitle } from '../../utils/format'

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
    <section className="home-section animate-fade-in" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<History size={16} style={{ color: 'var(--accent)' }} />}
        title="Vừa Đọc Gần Đây"
        count={items.length}
      />

      <div className="section-row-scroll" style={{ paddingBottom: '0.5rem' }}>
        {items.map(item => {
          const isEpub = item.chapter === 'EPUB' || !item.chapter || item.chapter === 'null'
          const readUrl = isEpub
            ? `/novel/${item.slug}/epub-reader`
            : `/novel/${item.slug}/read/${item.chapter}`

          const formattedTitle = fmtNovelTitle(item.novel.title, item.slug)

          return (
            <div
              key={item.slug}
              className="rr-card"
              style={{
                minWidth: '200px',
                maxWidth: '240px',
              }}
            >
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <NovelCover novel={item.novel} size="sm" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Link
                    to={`/novel/${item.slug}`}
                    style={{
                      display: 'block',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      color: 'var(--text-main)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.3,
                    }}
                    title={formattedTitle}
                  >
                    {formattedTitle}
                  </Link>
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600, marginTop: '3px' }}>
                    {isEpub ? 'File EPUB' : `Đã đọc: ${fmtChapterLabel(item.chapter)}`}
                  </div>
                  {item.timestamp > 0 && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={11} /> {fmtTimeAgo(Math.floor(item.timestamp / 1000))}
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
                  fontSize: '0.8rem',
                  minHeight: '34px',
                  justifyContent: 'center',
                  borderRadius: '8px',
                }}
              >
                {isEpub ? <BookMarked size={13} /> : <BookOpen size={13} />}
                {isEpub ? ' Đọc EPUB' : ' Đọc tiếp →'}
              </Link>
            </div>
          )
        })}
      </div>
    </section>
  )
}
