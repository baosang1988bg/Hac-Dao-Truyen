import React from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Play, Info, BookMarked, Flame } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import SectionHeader from '../../components/ui/SectionHeader'
import { fmtNumber } from '../../utils/format'

/**
 * HeroSection – Truyện nổi bật, banner hero redesign (Phase 3).
 * Props:
 *   novel – novel object (truyện có nhiều chương nhất)
 */
export default function HeroSection({ novel }) {
  if (!novel) return null
  const hasChapters = (novel.chapter_count || 0) > 0

  return (
    <section style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader icon={<Flame size={15} />} title="Truyện nổi bật" />
      <div className="hp-hero">
        {/* Cover */}
        <Link to={`/novel/${novel.slug}`} className="hp-hero__cover">
          <NovelCover novel={novel} size="lg" />
        </Link>

        {/* Info */}
        <div className="hp-hero__body">
          <span className="hp-hero__eyebrow">
            {hasChapters ? '⚡ Đang cập nhật' : '📚 EPUB Độc Quyền'}
          </span>
          <h2 className="hp-hero__title">{novel.title}</h2>
          {novel.author && (
            <div className="hp-hero__author">✍️ {novel.author}</div>
          )}
          <div className="hp-hero__stats">
            {hasChapters ? `${fmtNumber(novel.chapter_count)} chương đã dịch` : 'Đọc EPUB trực tiếp'}
          </div>
          {novel.latest_chapter_title && (
            <div className="hp-hero__latest">
              Mới nhất: {novel.latest_chapter_title}
            </div>
          )}
          <div className="hp-hero__actions">
            <Link
              to={hasChapters ? `/novel/${novel.slug}/read/1` : `/novel/${novel.slug}/epub-reader`}
              className="btn btn-primary"
              style={{ padding: '10px 20px', fontSize: '0.88rem', minHeight: '44px' }}
            >
              {hasChapters ? <Play size={15} /> : <BookMarked size={15} />}
              {hasChapters ? ' Đọc từ đầu' : ' Đọc EPUB'}
            </Link>
            <Link
              to={`/novel/${novel.slug}`}
              className="btn btn-secondary"
              style={{ padding: '10px 18px', fontSize: '0.88rem', minHeight: '44px' }}
            >
              <Info size={15} /> Chi tiết
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
