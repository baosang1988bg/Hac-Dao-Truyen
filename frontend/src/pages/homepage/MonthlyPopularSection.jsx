import { Link } from 'react-router-dom'
import { Flame, Play, Eye, BookOpen } from 'lucide-react'
import { extractNovels, TOP_VIEWS_PARAMS } from '../../utils/novelsApi'
import { useCachedGet } from '../../utils/apiCache'
import NovelCover from '../../components/NovelCover'
import SectionHeader from '../../components/ui/SectionHeader'
import { novelDisplayTitle, fmtNumber, cleanAuthor } from '../../utils/format'
import { primaryGenre } from '../../utils/genreLabels'

const SECTION_TITLE = 'Xem Nhiều Nhất'

/**
 * MonthlyPopularSection — Hero "Xem Nhiều Nhất": truyện có TỔNG lượt xem cao
 * nhất (sort=views). Không gọi là "tháng" vì backend không có lượt xem theo
 * tháng — chỉ có cột views tích luỹ.
 *
 * Dùng chung response với TruyenTrungRankings (tab Tổng Hợp/Lượt Đọc) qua
 * apiCache + TOP_VIEWS_PARAMS → trang chủ chỉ bắn 1 request sort=views.
 * Mô tả lấy từ synopsis_short (API mới) / synopsis_preview / synopsis; không
 * có thì ẩn — KHÔNG điền câu mô tả bịa.
 */
export default function MonthlyPopularSection() {
  const { data, loading } = useCachedGet('/novels', { params: TOP_VIEWS_PARAMS })
  const novel = extractNovels(data)[0] || null

  if (loading && !novel) {
    return (
      <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
        <SectionHeader icon={<Flame size={16} style={{ color: '#f59e0b' }} />} title={SECTION_TITLE} />
        <div className="glass-panel" style={{ height: '212px', borderRadius: '16px' }} role="status" aria-label="Đang tải" />
      </section>
    )
  }
  if (!novel) return null

  const formattedTitle = novelDisplayTitle(novel)
  const chapCount = novel.chapter_count || novel.total_chapters || 0
  const author = cleanAuthor(novel.author)
  const genre = primaryGenre(novel.genre)
  const synopsis = String(novel.synopsis_short || novel.synopsis_preview || novel.synopsis || '').trim()

  return (
    <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<Flame size={16} style={{ color: '#f59e0b' }} />}
        title={SECTION_TITLE}
      />

      <div className="glass-panel" style={{
        padding: 'var(--space-4, 16px)',
        borderRadius: '16px',
        display: 'flex',
        gap: 'var(--space-4, 16px)',
        alignItems: 'center',
        flexWrap: 'wrap',
        border: '1px solid rgba(245, 158, 11, 0.25)',
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.85) 100%)'
      }}>
        <div style={{ width: '120px', aspectRatio: '2 / 3', flexShrink: 0, borderRadius: '10px', overflow: 'hidden', boxShadow: '0 8px 20px rgba(0,0,0,0.4)' }}>
          <NovelCover novel={novel} size="lg" priority />
        </div>

        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1, 4px)', fontSize: 'var(--font-xs, 0.75rem)', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 'var(--space-1, 4px)' }}>
            <Flame size={12} aria-hidden="true" /> Hạng 1 · Tổng lượt xem
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 'var(--space-2, 8px)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            <Link to={`/novel/${novel.slug}`} style={{ color: 'inherit', textDecoration: 'none', overflowWrap: 'anywhere' }}>
              {formattedTitle}
            </Link>
          </h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3, 12px)', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 'var(--space-3, 12px)' }}>
            {author && <span>Tác giả: <strong style={{ color: 'var(--text-main)' }}>{author}</strong></span>}
            {genre && <span style={{ padding: '2px 8px', borderRadius: '6px', background: 'rgba(201,147,46,0.15)', color: 'var(--accent)' }}>{genre}</span>}
          </div>

          {synopsis && (
          <p style={{
            fontSize: '0.84rem',
            color: 'var(--text-muted)',
            lineHeight: 1.5,
            marginBottom: '1rem',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}>
            {synopsis}
          </p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2, 8px)', flexWrap: 'wrap' }}>
            <Link to={`/novel/${novel.slug}`} className="btn btn-primary hp-touch-target" style={{ padding: 'var(--space-2, 8px) var(--space-4, 16px)', fontSize: '0.85rem' }}>
              <Play size={15} /> Đọc Ngay
            </Link>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <BookOpen size={13} /> {fmtNumber(chapCount)} chương
            </span>
            {(novel.views || 0) > 0 && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Eye size={13} /> {fmtNumber(novel.views)} lượt xem
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
