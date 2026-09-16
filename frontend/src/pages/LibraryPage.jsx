import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom'
import { BookOpen, Home } from 'lucide-react'
import api from '../api'
import NovelCover from '../components/NovelCover'
import { getAllHistory, fmtChapterLabel } from '../utils/readingHistory'
import { fetchNovelsBySlugs } from '../utils/novelsApi'

/**
 * Tủ truyện: các truyện đang đọc dở (từ lịch sử cookie/localStorage),
 * ghép với dữ liệu /api/novels để có tên + bìa.
 *
 * B01: lịch sử đọc là danh sách slug cụ thể (không phải "toàn bộ catalog"),
 * nên gọi riêng GET /api/novels/:slug cho từng slug thay vì tải page=1 của
 * /api/novels rồi .find() — tránh bỏ sót truyện nằm ở trang sau nếu catalog
 * lớn hơn 1 trang mặc định.
 */
export default function LibraryPage() {
  const [novelsBySlug, setNovelsBySlug] = useState(null) // null = đang tải
  const history = getAllHistory()

  useEffect(() => {
    let alive = true
    fetchNovelsBySlugs(api, history.map(h => h.slug))
      .then(map => { if (alive) setNovelsBySlug(map) })
      .catch(() => { if (alive) setNovelsBySlug(new Map()) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (novelsBySlug === null) {
    return (
      <div className="container" style={{ paddingTop: '3rem', color: 'var(--text-muted)' }}>
        Đang tải tủ truyện...
      </div>
    )
  }

  // Chỉ giữ các mục lịch sử còn khớp với truyện đang tồn tại
  const items = history
    .map(h => ({ ...h, novel: novelsBySlug.get(h.slug) }))
    .filter(h => h.novel)

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
          {items.map(({ slug, chapter, novel, isCurrent }) => (
            <div key={slug} className="glass-panel library-card">
              <Link to={`/novel/${slug}`} className="library-card__cover-link" aria-label={`Xem ${novel.title}`}>
                <NovelCover novel={novel} size="sm" />
              </Link>
              <div className="library-card__body">
                {isCurrent && (
                  <span className="library-card__recent">
                    GẦN NHẤT
                  </span>
                )}
                <Link to={`/novel/${slug}`} className="library-card__title-link">
                  <div className="library-card__title">
                    {novel.title}
                  </div>
                </Link>
                <div className="library-card__progress">
                  Đang đọc: {fmtChapterLabel(chapter)}
                </div>
              </div>
              <Link
                to={`/novel/${slug}/read/${chapter}`}
                className="btn btn-primary library-card__action"
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
