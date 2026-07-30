import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Home } from 'lucide-react'
import api from '../api'
import NovelCover from '../components/NovelCover'
import { getAllHistory, fmtChapterLabel } from '../utils/readingHistory'

/**
 * Tủ truyện: các truyện đang đọc dở (từ lịch sử cookie/localStorage),
 * ghép với dữ liệu /api/novels để có tên + bìa.
 */
export default function LibraryPage() {
  const [novels, setNovels] = useState(null) // null = đang tải
  const history = getAllHistory()

  useEffect(() => {
    let alive = true
    api.get('/novels')
      .then(res => { if (alive) { const data = res.data; setNovels(Array.isArray(data) ? data : (data.novels || [])) } })
      .catch(() => { if (alive) setNovels([]) })
    return () => { alive = false }
  }, [])

  if (novels === null) {
    return (
      <div className="container" style={{ paddingTop: '3rem', color: 'var(--text-muted)' }}>
        Đang tải tủ truyện...
      </div>
    )
  }

  // Chỉ giữ các mục lịch sử còn khớp với truyện đang tồn tại
  const items = history
    .map(h => ({ ...h, novel: novels.find(n => n.slug === h.slug) }))
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
        <div className="glass-panel p-6 text-center" style={{ padding: '3rem 1.5rem' }}>
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
              <Link to={`/novel/${slug}`} style={{ flexShrink: 0 }}>
                <NovelCover novel={novel} size="sm" />
              </Link>
              <div className="library-card__body">
                {isCurrent && (
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em',
                    color: '#60a5fa', background: 'rgba(59,130,246,0.18)',
                    padding: '2px 7px', borderRadius: '4px', display: 'inline-block', marginBottom: '4px',
                  }}>
                    GẦN NHẤT
                  </span>
                )}
                <Link to={`/novel/${slug}`} style={{ display: 'block', color: 'var(--text-main)' }}>
                  <div style={{
                    fontWeight: 600, fontSize: '0.95rem',
                    display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {novel.title}
                  </div>
                </Link>
                <div style={{
                  fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '3px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  Đang đọc: {fmtChapterLabel(chapter)}
                </div>
              </div>
              <Link
                to={`/novel/${slug}/read/${chapter}`}
                className="btn btn-primary"
                style={{ padding: '10px 16px', fontSize: '0.85rem', minHeight: '44px', flexShrink: 0 }}
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
