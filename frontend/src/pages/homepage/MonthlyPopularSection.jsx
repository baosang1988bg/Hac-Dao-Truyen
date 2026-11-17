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
        <div className="hd-skel hp-hero-skel" role="status" aria-label="Đang tải" />
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

      {/* Style hero chuyển sang home.css (.hp-hero*) để chỉnh bố cục riêng cho
          mobile (bìa nhỏ bên trái, mô tả + nút xuống dưới) và có hover/press. */}
      <div className="glass-panel hp-hero hp-enter">
        <Link to={`/novel/${novel.slug}`} className="hp-hero__cover" tabIndex={-1} aria-hidden="true">
          <NovelCover novel={novel} size="lg" priority />
        </Link>

        <div className="hp-hero__body">
          <div className="hp-hero__kicker">
            <Flame size={12} aria-hidden="true" /> Hạng 1 · Tổng lượt xem
          </div>
          <h2 className="hp-hero__title">
            <Link to={`/novel/${novel.slug}`}>
              {formattedTitle}
            </Link>
          </h2>

          <div className="hp-hero__meta">
            {author && <span>Tác giả: <strong>{author}</strong></span>}
            {genre && <span className="hp-hero__genre">{genre}</span>}
          </div>
        </div>

        {synopsis && <p className="hp-hero__synopsis">{synopsis}</p>}

        <div className="hp-hero__actions">
          <Link to={`/novel/${novel.slug}`} className="btn btn-primary hp-touch-target hp-hero__cta">
            <Play size={15} aria-hidden="true" /> Đọc Ngay
          </Link>
          <span className="hp-hero__stat">
            <BookOpen size={13} aria-hidden="true" /> {fmtNumber(chapCount)} chương
          </span>
          {(novel.views || 0) > 0 && (
            <span className="hp-hero__stat">
              <Eye size={13} aria-hidden="true" /> {fmtNumber(novel.views)} lượt xem
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
