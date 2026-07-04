import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Flame, Sparkles, CheckCircle, AlertCircle, Play, Info } from 'lucide-react'
import api from '../api'
import NovelCard from '../components/NovelCard'
import NovelCover from '../components/NovelCover'
import { getLastRead, fmtChapterLabel } from '../utils/readingHistory'
import { fmtTimeAgo, fmtNumber } from '../utils/format'

const THREE_DAYS = 3 * 24 * 3600

/**
 * Trang chủ guest. Mọi section tự ẩn khi rỗng.
 * Truyện chưa có chương dịch (chapter_count === 0) bị loại khỏi mọi section.
 */
export default function HomePage() {
  const [novels, setNovels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    api.get('/novels')
      .then(res => { if (alive) { setNovels(res.data || []); setLoading(false) } })
      .catch(() => { if (alive) { setError('Không thể kết nối máy chủ. Vui lòng thử lại sau.'); setLoading(false) } })
    return () => { alive = false }
  }, [])

  // Chỉ hiển thị truyện đã có chương dịch
  const visible = novels.filter(n => (n.chapter_count || 0) > 0)

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '3rem', color: 'var(--text-muted)' }}>
        Đang tải trang chủ...
      </div>
    )
  }

  if (error) {
    return (
      <div className="container" style={{ paddingTop: '2rem' }}>
        <div className="glass-panel p-6" style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)' }}>
          <AlertCircle size={20} style={{ flexShrink: 0 }} />
          {error}
        </div>
      </div>
    )
  }

  // ── Dữ liệu cho từng section ──
  const featured = visible.reduce(
    (best, n) => (!best || (n.chapter_count || 0) > (best.chapter_count || 0) ? n : best),
    null
  )
  const inProgress = visible.filter(n =>
    n.total_chapters === 0 || n.chapter_count < n.total_chapters
  )
  const recentlyUpdated = visible
    .filter(n => n.last_translated_at)
    .sort((a, b) => b.last_translated_at - a.last_translated_at)
    .slice(0, 5)
  const completed = visible.filter(n =>
    n.total_chapters > 0 && n.chapter_count >= n.total_chapters
  )
  const nowSec = Math.floor(Date.now() / 1000)

  return (
    <div className="container animate-fade-in">
      <ContinueReadingHero novels={visible} />

      {featured && <FeaturedNovel novel={featured} />}

      {inProgress.length > 0 && (
        <section className="home-section">
          <h2 className="home-section__title">
            <Flame size={18} style={{ color: 'var(--accent)' }} /> Đang dịch
          </h2>
          <div className="section-row-scroll">
            {inProgress.map(n => (
              <NovelCard
                key={n.slug}
                novel={n}
                badge={n.last_translated_at && nowSec - n.last_translated_at < THREE_DAYS ? 'MỚI' : undefined}
              />
            ))}
          </div>
        </section>
      )}

      {recentlyUpdated.length > 0 && (
        <section className="home-section">
          <h2 className="home-section__title">
            <Sparkles size={18} style={{ color: 'var(--accent)' }} /> Mới lên chương
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {recentlyUpdated.map(n => (
              <Link key={n.slug} to={`/novel/${n.slug}`} className="update-row">
                <NovelCover novel={n} size="sm" />
                <span className="update-row__body">
                  <span className="update-row__title" style={{ display: 'block' }}>{n.title}</span>
                  <span className="update-row__chapter" style={{ display: 'block' }}>
                    {n.latest_chapter_title || `${n.chapter_count} chương`}
                  </span>
                </span>
                <span className="update-row__ago">{fmtTimeAgo(n.last_translated_at)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="home-section">
          <h2 className="home-section__title">
            <CheckCircle size={18} style={{ color: 'var(--success)' }} /> Hoàn thành
          </h2>
          <div className="section-row-scroll">
            {completed.map(n => (
              <NovelCard key={n.slug} novel={n} badge="FULL" />
            ))}
          </div>
        </section>
      )}

      <StatsStrip novels={visible} />
    </div>
  )
}

/** Panel "Đọc tiếp" — chỉ hiện khi có lịch sử đọc khớp với truyện đang có. */
function ContinueReadingHero({ novels }) {
  const last = getLastRead()
  if (!last) return null
  const novel = novels.find(n => n.slug === last.slug)
  if (!novel) return null

  return (
    <div className="hero-continue animate-fade-in">
      <NovelCover novel={novel} size="sm" />
      <div className="hero-continue__info">
        <span className="hero-continue__eyebrow">ĐỌC TIẾP</span>
        <div className="hero-continue__title">{novel.title}</div>
        <div className="hero-continue__chapter">
          Chương đang đọc: <strong style={{ color: 'var(--text-main)' }}>{fmtChapterLabel(last.chapter)}</strong>
        </div>
      </div>
      <Link
        to={`/novel/${last.slug}/read/${last.chapter}`}
        className="btn btn-primary hero-continue__btn"
      >
        <BookOpen size={17} /> Đọc tiếp &rarr;
      </Link>
    </div>
  )
}

/** Truyện nổi bật: bìa lớn + thông tin + nút Đọc từ đầu / Chi tiết. */
function FeaturedNovel({ novel }) {
  return (
    <section className="home-section">
      <h2 className="home-section__title">
        <BookOpen size={18} style={{ color: 'var(--accent)' }} /> Truyện nổi bật
      </h2>
      <div className="glass-panel featured-novel">
        <Link to={`/novel/${novel.slug}`} style={{ display: 'block' }}>
          <NovelCover novel={novel} size="lg" />
        </Link>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <h3 style={{
            fontFamily: 'Outfit, sans-serif', fontSize: '1.25rem', fontWeight: 800,
            lineHeight: 1.3, marginBottom: '4px',
          }}>
            {novel.title}
          </h3>
          {novel.author && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
              {novel.author}
            </div>
          )}
          <div style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600, marginBottom: '4px' }}>
            {fmtNumber(novel.chapter_count)} chương đã dịch
          </div>
          {novel.latest_chapter_title && (
            <div style={{
              fontSize: '0.8rem', color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              Mới nhất: {novel.latest_chapter_title}
            </div>
          )}
          <div className="featured-novel__actions" style={{ marginTop: 'auto', paddingTop: '0.75rem' }}>
            <Link to={`/novel/${novel.slug}/read/1`} className="btn btn-primary" style={{ padding: '10px 18px', fontSize: '0.88rem', minHeight: '44px' }}>
              <Play size={15} /> Đọc từ đầu
            </Link>
            <Link to={`/novel/${novel.slug}`} className="btn btn-secondary" style={{ padding: '10px 18px', fontSize: '0.88rem', minHeight: '44px' }}>
              <Info size={15} /> Chi tiết
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

/** 3 chỉ số thật từ dữ liệu API — không số ảo, không xếp hạng. */
function StatsStrip({ novels }) {
  if (novels.length === 0) return null
  const totalNovels = novels.length
  const totalChapters = novels.reduce((a, n) => a + (n.chapter_count || 0), 0)
  const totalGlossary = novels.reduce((a, n) => a + (n.glossary_count || 0), 0)

  return (
    <section className="home-section">
      <div className="stats-strip">
        <div className="glass-panel stats-strip__item">
          <div className="stats-strip__value">{fmtNumber(totalNovels)}</div>
          <div className="stats-strip__label">truyện</div>
        </div>
        <div className="glass-panel stats-strip__item">
          <div className="stats-strip__value">{fmtNumber(totalChapters)}</div>
          <div className="stats-strip__label">chương đã dịch</div>
        </div>
        <div className="glass-panel stats-strip__item">
          <div className="stats-strip__value">{fmtNumber(totalGlossary)}</div>
          <div className="stats-strip__label">thuật ngữ</div>
        </div>
      </div>
    </section>
  )
}
