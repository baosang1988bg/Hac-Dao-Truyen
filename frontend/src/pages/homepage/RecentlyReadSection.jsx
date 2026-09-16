import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, Clock, BookOpen, BookMarked } from 'lucide-react'
import api from '../../api'
import { fetchNovelsBySlugs } from '../../utils/novelsApi'
import NovelCover from '../../components/NovelCover'
import SectionHeader from '../../components/ui/SectionHeader'
import { getAllHistory, fmtChapterLabel } from '../../utils/readingHistory'
import { fmtTimeAgo, fmtNovelTitle } from '../../utils/format'

/**
 * RecentlyReadSection – Truyện vừa đọc gần đây từ localStorage (Web + EPUB).
 * Chỉ gọi API cho đúng vài slug đã đọc (fetchNovelsBySlugs, song song) — không
 * cần cả catalog để "tìm" novel như trước.
 */
export default function RecentlyReadSection() {
  const [items, setItems] = useState(null) // null = đang tải, [] = tải xong nhưng rỗng

  useEffect(() => {
    let alive = true
    const history = getAllHistory()
    if (!history || history.length === 0) {
      setItems([])
      return
    }
    fetchNovelsBySlugs(api, history.map(h => h.slug)).then(novelMap => {
      if (!alive) return
      setItems(history.map(h => {
        const novel = novelMap.get(h.slug)
        return novel ? { ...h, novel } : null
      }).filter(Boolean))
    })
    return () => { alive = false }
  }, [])

  if (items === null) {
    return (
      <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
        <SectionHeader icon={<History size={16} style={{ color: 'var(--accent)' }} />} title="Vừa Đọc Gần Đây" />
        <div className="glass-panel" style={{ height: '140px', borderRadius: '14px' }} />
      </section>
    )
  }
  if (items.length === 0) return null

  return (
    <section className="home-section animate-fade-in" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<History size={16} style={{ color: 'var(--accent)' }} />}
        title="Vừa Đọc Gần Đây"
        count={items.length}
      />

      <div className="section-row-scroll" style={{ paddingBottom: 'var(--space-2, 8px)' }}>
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
            >
              <div style={{ display: 'flex', gap: 'var(--space-2, 8px)', alignItems: 'flex-start' }}>
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
                      minHeight: '24px',
                    }}
                    title={formattedTitle}
                  >
                    {formattedTitle}
                  </Link>
                  <div style={{ fontSize: 'var(--font-xs, 0.75rem)', color: 'var(--accent)', fontWeight: 600, marginTop: 'var(--space-1, 4px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isEpub ? 'File EPUB' : `Đã đọc: ${fmtChapterLabel(item.chapter)}`}
                  </div>
                  {item.timestamp > 0 && (
                    <div style={{ fontSize: 'var(--font-xs, 0.75rem)', color: 'var(--text-muted)', marginTop: 'var(--space-1, 4px)', display: 'flex', alignItems: 'center', gap: 'var(--space-1, 4px)' }}>
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
                  padding: 'var(--space-2, 8px) var(--space-3, 12px)',
                  fontSize: '0.8rem',
                  minHeight: 'var(--tap-target-min, 44px)',
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
