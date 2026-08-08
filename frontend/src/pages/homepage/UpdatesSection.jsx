import React from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Clock } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import SectionHeader from '../../components/ui/SectionHeader'
import Badge from '../../components/ui/Badge'
import { fmtTimeAgo, fmtNovelTitle } from '../../utils/format'

/**
 * UpdatesSection – Session riêng cho các "Truyện Mới Cập Nhật", hiển thị theo hàng cuộn ngang.
 * Props:
 *   novels – array of novel objects (sorted by last_translated_at desc)
 */
export default function UpdatesSection({ novels }) {
  if (!novels || novels.length === 0) return null

  return (
    <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<Sparkles size={16} style={{ color: 'var(--accent)' }} />}
        title="Truyện Mới Cập Nhật"
        count={novels.length}
      />
      <div className="section-row-scroll" style={{ paddingBottom: '8px' }}>
        {novels.map(n => {
          const formattedTitle = fmtNovelTitle(n.title, n.slug)
          return (
            <Link
              key={n.slug}
              to={`/novel/${n.slug}`}
              className="novel-card-v2"
              style={{
                flex: '0 0 135px',
                minWidth: '115px',
                maxWidth: '145px',
                scrollSnapAlign: 'start',
              }}
            >
              <div style={{ position: 'relative' }}>
                <NovelCover novel={n} size="md" />
                <span style={{ position: 'absolute', top: '6px', left: '6px', zIndex: 2 }}>
                  <Badge variant="new">MỚI</Badge>
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 2px' }}>
                <span
                  className="novel-card-v2__title"
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    lineHeight: 1.3,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                  title={formattedTitle}
                >
                  {formattedTitle}
                </span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--accent)',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {n.latest_chapter_title || (n.chapter_count ? `${n.chapter_count} chương` : 'Chương mới')}
                </span>
                {n.last_translated_at && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      marginTop: '1px',
                    }}
                  >
                    <Clock size={10} /> {fmtTimeAgo(n.last_translated_at)}
                  </span>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
