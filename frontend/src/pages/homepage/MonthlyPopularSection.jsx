import React from 'react'
import { Link } from 'react-router-dom'
import { Flame, Play, Eye, BookOpen } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import SectionHeader from '../../components/ui/SectionHeader'
import { fmtNovelTitle, fmtNumber } from '../../utils/format'

/**
 * MonthlyPopularSection — Section "Nhân Khí Tháng" (Chuẩn Truyentrung.com)
 * Thể hiện truyện hot nhất tháng với card bìa lớn 180px, tóm tắt và nút Đọc Ngay.
 */
export default function MonthlyPopularSection({ novel }) {
  if (!novel) return null

  const formattedTitle = fmtNovelTitle(novel.title, novel.slug)
  const chapCount = novel.chapter_count || novel.total_chapters || 0

  return (
    <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<Flame size={16} style={{ color: '#f59e0b' }} />}
        title="Nhân Khí Tháng"
      />

      <div className="glass-panel" style={{
        padding: '1.25rem',
        borderRadius: '16px',
        display: 'flex',
        gap: '1.25rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        border: '1px solid rgba(245, 158, 11, 0.25)',
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.85) 100%)'
      }}>
        <div style={{ width: '130px', height: '180px', flexShrink: 0, borderRadius: '10px', overflow: 'hidden', boxShadow: '0 8px 20px rgba(0,0,0,0.4)' }}>
          <NovelCover novel={novel} size="lg" />
        </div>

        <div style={{ flex: 1, minWidth: '240px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
            <Flame size={12} /> TOP 1 HOTTEST NOVEL
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', lineHeight: 1.3 }}>
            <Link to={`/novel/${novel.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              {formattedTitle}
            </Link>
          </h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
            {novel.author && <span>Tác giả: <strong style={{ color: 'var(--text-main)' }}>{novel.author}</strong></span>}
            {novel.genre && <span style={{ padding: '2px 8px', borderRadius: '6px', background: 'rgba(59,130,246,0.12)', color: 'var(--accent)' }}>{novel.genre.split(',')[0]}</span>}
          </div>

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
            {novel.synopsis || novel.synopsis_preview || 'Bộ truyện đang thu hút sự chú ý lớn từ đông đảo độc giả trong tháng với cốt truyện lôi cuốn và các tình tiết kịch tính.'}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Link to={`/novel/${novel.slug}`} className="btn btn-primary" style={{ padding: '8px 18px', fontSize: '0.85rem' }}>
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
