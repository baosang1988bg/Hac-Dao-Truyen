import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom'
import { BookOpen, BookHeart, BookMarked, Home, LibraryBig } from 'lucide-react'
import NovelCover from '../components/NovelCover'
import { getAllHistory, fmtChapterLabel } from '../utils/readingHistory'
import api from '../api'
import { fetchNovelsBySlugsBatch } from '../utils/novelsApi'
import { fmtNovelTitle } from '../utils/format'
import useDocumentTitle from '../hooks/useDocumentTitle'
import '../styles/reading.css'
import '../styles/library-epub.css'
import { staggerIndex } from '../utils/motion'

/**
 * Tủ truyện: các truyện đang đọc dở (từ lịch sử cookie/localStorage),
 * ghép với dữ liệu /api/novels để có tên + bìa.
 *
 * B01: lịch sử đọc là danh sách slug cụ thể (không phải "toàn bộ catalog"),
 * nên hỏi đúng các slug đó (GET /api/novels?slugs=..., fallback /novels/:slug)
 * thay vì tải page=1 của /api/novels rồi .find().
 *
 * Mục lịch sử mới đã lưu kèm title/cover_url → hiện ngay, không chờ API; mục
 * cũ (chưa có meta) hiện skeleton đến khi API trả về.
 */
export default function LibraryPage() {
  useDocumentTitle('Tủ truyện')
  const [novelsBySlug, setNovelsBySlug] = useState(null) // null = đang tải
  const [history] = useState(getAllHistory)

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    // Gom 1 request GET /novels?slugs=... (tự fallback gọi lẻ nếu backend cũ).
    fetchNovelsBySlugsBatch(api, history.map(h => h.slug), { signal: controller.signal })
      .then(map => { if (alive) setNovelsBySlug(map) })
      .catch(() => { if (alive) setNovelsBySlug(new Map()) })
    return () => { alive = false; controller.abort() }
  }, [history])

  const allHaveMeta = history.every(h => h.title)
  if (novelsBySlug === null && !allHaveMeta) {
    return (
      <div className="container library-page" role="status" aria-label="Đang tải tủ truyện" style={{ paddingTop: '1.5rem' }}>
        <span className="hd-skel library-skel__title" />
        {[0, 1, 2].map(i => (
          <span key={i} className="hd-skel library-skel__row" />
        ))}
      </div>
    )
  }

  // Khi đã có kết quả API: chỉ giữ mục còn khớp truyện đang tồn tại. Trước đó
  // dùng tạm meta (title/cover_url) lưu trong lịch sử.
  const items = history
    .map(h => {
      const fromApi = novelsBySlug?.get(h.slug)
      const novel = fromApi || (novelsBySlug === null && h.title
        ? { slug: h.slug, title: h.title, cover_url: h.cover_url }
        : null)
      return { ...h, novel }
    })
    .filter(h => h.novel)
    .map(h => ({
      ...h,
      displayTitle: fmtNovelTitle(h.novel.title_is_slug ? '' : h.novel.title, h.slug),
      percent: readPercent(h.chapter, h.novel.chapter_count),
    }))

  return (
    <div className="container animate-fade-in library-page">
      <div className="hd-page-head">
        <h1 className="page-title">
          <LibraryBig size={24} style={{ color: 'var(--accent)' }} aria-hidden="true" /> Tủ truyện
        </h1>
        <p className="page-subtitle">
          {items.length > 0
            ? `${items.length} truyện đang đọc dở trên thiết bị này.`
            : 'Những truyện bạn đang đọc dở trên thiết bị này.'}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="glass-panel hd-empty">
          <div className="hd-empty__icon"><BookHeart size={30} aria-hidden="true" /></div>
          <div className="hd-empty__title">Tủ truyện đang trống</div>
          <p className="hd-empty__text">
            Bắt đầu đọc một truyện — tiến trình sẽ tự lưu vào đây để bạn đọc tiếp bất cứ lúc nào.
          </p>
          <div className="hd-empty__actions">
            <Link to="/" className="btn btn-primary">
              <Home size={16} aria-hidden="true" /> Về Trang chủ
            </Link>
            <Link to="/epub" className="btn btn-secondary">
              <BookMarked size={16} aria-hidden="true" /> Kho EPUB
            </Link>
          </div>
        </div>
      ) : (
        <div className="library-list">
          {items.map(({ slug, chapter, novel, isCurrent, displayTitle, percent }, i) => (
            // .hd-reveal ở lớp bọc để hover/nhấn của thẻ không bị trễ theo delay so le.
            <div key={slug} className="hd-reveal" style={{ '--i': staggerIndex(i) }}>
              <div className={`glass-panel library-card${isCurrent ? ' is-current' : ''}`}>
                <Link to={`/novel/${slug}`} className="library-card__cover-link" aria-label={`Xem ${displayTitle}`}>
                  <NovelCover novel={{ ...novel, title: displayTitle }} size="sm" />
                </Link>
                <div className="library-card__body">
                  {isCurrent && (
                    <span className="library-card__recent">
                      <span className="hd-live-dot" aria-hidden="true" /> GẦN NHẤT
                    </span>
                  )}
                  <Link to={`/novel/${slug}`} className="library-card__title-link">
                    <div className="library-card__title">
                      {displayTitle}
                    </div>
                  </Link>
                  <div className="library-card__progress">
                    Đang đọc: {fmtChapterLabel(chapter)}
                    {percent !== null && ` / ${novel.chapter_count} · ${percent}%`}
                  </div>
                  {percent !== null && (
                    <div
                      className="library-card__bar"
                      role="progressbar"
                      aria-label={`Tiến độ đọc ${displayTitle}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <span className="library-card__bar-fill" style={{ '--p': `${Math.max(percent, 2)}%` }} />
                    </div>
                  )}
                </div>
                <Link
                  to={`/novel/${slug}/read/${chapter}`}
                  className="btn btn-primary library-card__action"
                  aria-label={`Đọc tiếp ${displayTitle}`}
                >
                  <BookOpen size={16} aria-hidden="true" /> Đọc tiếp
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * % tiến độ đọc từ tham số chương (vd "123", "chuong-123", "0123_VI.md") và
 * tổng số chương của truyện. Không xác định được → null (ẩn thanh tiến độ).
 */
function readPercent(chapter, chapterCount) {
  const total = Number(chapterCount)
  if (!Number.isFinite(total) || total <= 0) return null
  const m = String(chapter ?? '').match(/\d+/)
  if (!m) return null
  const n = Number(m[0])
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(100, Math.round((n / total) * 100))
}
