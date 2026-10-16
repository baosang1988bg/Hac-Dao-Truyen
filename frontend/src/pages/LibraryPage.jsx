import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom'
import { BookOpen, Home } from 'lucide-react'
import NovelCover from '../components/NovelCover'
import { getAllHistory, fmtChapterLabel } from '../utils/readingHistory'
import api from '../api'
import { fetchNovelsBySlugsBatch } from '../utils/novelsApi'
import { fmtNovelTitle } from '../utils/format'
import useDocumentTitle from '../hooks/useDocumentTitle'
import '../styles/reading.css'

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
      <div className="container" role="status" aria-label="Đang tải tủ truyện" style={{ paddingTop: '1.5rem' }}>
        <span className="hd-skel" style={{ height: '32px', width: '40%', marginBottom: '1.5rem' }} />
        {[0, 1, 2].map(i => (
          <span key={i} className="hd-skel" style={{ height: '96px', marginBottom: '0.75rem' }} />
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
    .map(h => ({ ...h, displayTitle: fmtNovelTitle(h.novel.title_is_slug ? '' : h.novel.title, h.slug) }))

  return (
    <div className="container animate-fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.6rem' }}>Tủ truyện</h1>
        <p className="page-subtitle" style={{ fontSize: '0.9rem' }}>
          Những truyện bạn đang đọc dở trên thiết bị này.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="glass-panel p-6 text-center library-empty-state">
          <div style={{ fontSize: '2.2rem', marginBottom: '0.75rem' }}>📚</div>
          <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>Tủ truyện đang trống</div>
          <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            Bắt đầu đọc một truyện — tiến trình sẽ tự lưu vào đây.
          </p>
          <Link to="/" className="btn btn-primary" style={{ minHeight: '48px' }}>
            <Home size={16} /> Về Trang chủ
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map(({ slug, chapter, novel, isCurrent, displayTitle }) => (
            <div key={slug} className="glass-panel library-card">
              <Link to={`/novel/${slug}`} className="library-card__cover-link" aria-label={`Xem ${displayTitle}`}>
                <NovelCover novel={{ ...novel, title: displayTitle }} size="sm" />
              </Link>
              <div className="library-card__body">
                {isCurrent && (
                  <span className="library-card__recent">
                    GẦN NHẤT
                  </span>
                )}
                <Link to={`/novel/${slug}`} className="library-card__title-link">
                  <div className="library-card__title">
                    {displayTitle}
                  </div>
                </Link>
                <div className="library-card__progress">
                  Đang đọc: {fmtChapterLabel(chapter)}
                </div>
              </div>
              <Link
                to={`/novel/${slug}/read/${chapter}`}
                className="btn btn-primary library-card__action"
                aria-label={`Đọc tiếp ${displayTitle}`}
              >
                <BookOpen size={15} /> Đọc tiếp
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
