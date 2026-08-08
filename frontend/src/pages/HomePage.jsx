import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Flame, Sparkles, CheckCircle, AlertCircle, Play, Info, Search, X, Clock, History, BookMarked, Loader2 } from 'lucide-react'
import api from '../api'
import NovelCard from '../components/NovelCard'
import NovelCover from '../components/NovelCover'
import { EpubCard } from './EpubCatalogPage'
import { getAllHistory, fmtChapterLabel } from '../utils/readingHistory'
import { fmtTimeAgo, fmtNumber } from '../utils/format'

const THREE_DAYS = 3 * 24 * 3600

/**
 * Trang chủ guest. Mọi section tự ẩn khi rỗng.
 * Thống nhất dữ liệu: Hiển thị & tìm kiếm TOÀN BỘ truyện (gồm Web Chapters & EPUB).
 */
export default function HomePage() {
  const [novels, setNovels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)

  // Nạp danh sách truyện trang chủ (limit=200 để hiển thị phong phú)
  useEffect(() => {
    let alive = true
    api.get('/novels?limit=200')
      .then(res => {
        if (alive) {
          const data = res.data;
          setNovels(Array.isArray(data) ? data : (data.novels || []));
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) {
          setError('Không thể kết nối máy chủ. Vui lòng thử lại sau.');
          setLoading(false)
        }
      })
    return () => { alive = false }
  }, [])

  // Tìm kiếm trực tiếp qua API (tìm kiếm toàn bộ cơ sở dữ liệu D1 & R2)
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults(null)
      setSearchLoading(false)
      return
    }

    setSearchLoading(true)
    const timer = setTimeout(() => {
      api.get(`/novels?q=${encodeURIComponent(q)}&limit=100`)
        .then(res => {
          const data = res.data;
          const list = Array.isArray(data) ? data : (data.novels || []);
          setSearchResults(list);
          setSearchLoading(false);
        })
        .catch(() => {
          setSearchResults([]);
          setSearchLoading(false);
        })
    }, 200)

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Tất cả truyện có trong cơ sở dữ liệu (Web chapters hoặc kho EPUB)
  const visible = novels.filter(n =>
    (n.chapter_count || 0) > 0 || n.has_epub === 1 || n.has_epub === true || (n.total_chapters || 0) > 0
  )

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
    (n.chapter_count || 0) > 0 && (n.total_chapters === 0 || n.chapter_count < n.total_chapters)
  )
  const recentlyUpdated = visible
    .filter(n => n.last_translated_at && (n.chapter_count || 0) > 0)
    .sort((a, b) => b.last_translated_at - a.last_translated_at)
    .slice(0, 5)
  const completed = visible.filter(n =>
    n.total_chapters > 0 && n.chapter_count >= n.total_chapters && (n.chapter_count || 0) > 0
  )
  const nowSec = Math.floor(Date.now() / 1000)

  return (
    <div className="container animate-fade-in" style={{ paddingTop: '1rem' }}>
      {/* 🔍 BAR TÌM KIẾM TRANG CHỦ */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div
          className="glass-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 18px',
            borderRadius: '14px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border-color, rgba(255,255,255,0.12))'
          }}
        >
          {searchLoading ? (
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)', flexShrink: 0 }} />
          ) : (
            <Search size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          )}
          <input
            type="text"
            placeholder="Tìm kiếm truyện, EPUB theo tên, tác giả (ví dụ: Xích Tâm Tuần Thiên, Huyền Giám...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-main)',
              fontSize: '0.98rem',
              fontFamily: 'inherit'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Xóa tìm kiếm"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* 🎯 HIỂN THỊ KẾT QUẢ TÌM KIẾM TRỰC TIẾP TỪ API */}
      {searchQuery.trim() ? (
        <section className="home-section animate-fade-in" style={{ marginBottom: '2rem' }}>
          <h2 className="home-section__title">
            <Search size={18} style={{ color: 'var(--accent)' }} /> Kết quả tìm kiếm ({searchResults ? searchResults.length : '...'})
          </h2>
          {searchLoading && !searchResults ? (
            <div className="glass-panel p-6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Đang tìm kiếm trong toàn bộ cơ sở dữ liệu...
            </div>
          ) : searchResults && searchResults.length === 0 ? (
            <div className="glass-panel p-6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Không tìm thấy truyện nào phù hợp với từ khóa "<strong>{searchQuery}</strong>".
            </div>
          ) : searchResults ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '14px' }}>
              {searchResults.map(n => (
                <EpubCard key={n.slug} novel={n} />
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <>
          {/* 📜 TRUYỆN VỪA ĐỌC GẦN ĐÂY (WEB + EPUB LƯU LOCALSTORAGE) */}
          <RecentlyReadSection novels={visible} />

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
        </>
      )}
    </div>
  )
}

/** Section "Truyện vừa đọc" từ localStorage — hiển thị toàn bộ lịch sử đọc Web & EPUB */
function RecentlyReadSection({ novels }) {
  const history = getAllHistory()
  if (!history || history.length === 0) return null

  // Khớp slug lịch sử với thông tin truyện khả dụng
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
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Lưu trên thiết bị ({items.length})</span>
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
                justify: 'space-between',
                gap: '10px',
                flexShrink: 0
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
                      lineHeight: 1.3
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
                  borderRadius: '8px'
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

/** Truyện nổi bật: bìa lớn + thông tin + nút Đọc từ đầu / Chi tiết. */
function FeaturedNovel({ novel }) {
  const hasChapters = (novel.chapter_count || 0) > 0
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
            {hasChapters ? `${fmtNumber(novel.chapter_count)} chương đã dịch` : 'File EPUB Độc Quyền'}
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
            <Link
              to={hasChapters ? `/novel/${novel.slug}/read/1` : `/novel/${novel.slug}/epub-reader`}
              className="btn btn-primary"
              style={{ padding: '10px 18px', fontSize: '0.88rem', minHeight: '44px' }}
            >
              {hasChapters ? <Play size={15} /> : <BookMarked size={15} />}
              {hasChapters ? ' Đọc từ đầu' : ' Đọc EPUB'}
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

/** Thống kê tổng số truyện & chương */
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
