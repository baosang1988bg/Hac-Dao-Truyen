import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layers, Book, AlertCircle } from 'lucide-react'
import api from '../../api'
import NovelCover from '../../components/NovelCover'
import { fmtTimeAgo } from '../../utils/format'

/**
 * Danh sách truyện trong khu quản trị.
 * - GET /api/novels một lần.
 * - Poll GET /api/translate/active mỗi 5s → badge "Đang dịch x/y".
 * - Bấm hàng → /admin/novels/:slug
 */
export default function AdminNovels() {
  const [novels, setNovels] = useState(null)
  const [active, setActive] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    api.get('/novels')
      .then(res => { if (alive) setNovels(res.data || []) })
      .catch(() => { if (alive) { setNovels([]); setError('Không tải được danh sách truyện.') } })
    return () => { alive = false }
  }, [])

  // Poll phiên dịch đang chạy
  useEffect(() => {
    let alive = true
    const fetchActive = () => {
      api.get('/translate/active')
        .then(res => { if (alive) setActive(res.data || {}) })
        .catch(() => {})
    }
    fetchActive()
    const t = setInterval(fetchActive, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (novels === null) {
    return <div style={{ paddingTop: '2rem', color: 'var(--text-muted)' }}>Đang tải danh sách truyện...</div>
  }

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.7rem' }}>Truyện</h1>
        <p className="page-subtitle" style={{ fontSize: '0.95rem' }}>Quản lý {novels.length} truyện trong hệ thống.</p>
      </div>

      {error && (
        <div className="glass-panel p-6" style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#fca5a5', marginBottom: '1rem' }}>
          <AlertCircle size={18} /> {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {novels.map(n => {
          const running = active[n.slug]
          return (
            <Link key={n.slug} to={`/admin/novels/${n.slug}`} className="admin-novel-row">
              <div style={{ width: '44px', flexShrink: 0 }}>
                <NovelCover novel={n} size="sm" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontWeight: 600, fontSize: '0.92rem',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {n.title}
                  </span>
                  {running && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '99px',
                      background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
                      border: '1px solid rgba(59,130,246,0.3)', flexShrink: 0,
                    }}>
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)',
                        animation: 'pulse-dot 1.5s infinite',
                      }} />
                      Đang dịch {running.current || 0}/{running.total || '?'}
                    </span>
                  )}
                </div>
                <div style={{
                  display: 'flex', gap: '0.9rem', flexWrap: 'wrap',
                  fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '3px',
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Layers size={12} />
                    {n.chapter_count || 0}{n.total_chapters > 0 ? ` / ${n.total_chapters}` : ''} chương
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Book size={12} /> {n.glossary_count || 0} thuật ngữ
                  </span>
                  {n.last_translated_at && <span>Cập nhật {fmtTimeAgo(n.last_translated_at)}</span>}
                </div>
              </div>
              <span style={{ color: 'var(--text-muted)', opacity: 0.4, flexShrink: 0 }}>›</span>
            </Link>
          )
        })}
      </div>

      {novels.length === 0 && !error && (
        <div className="glass-panel p-6 text-center text-muted">
          Chưa có truyện nào. Tạo truyện mới bằng lệnh <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>python main.py new</code>.
        </div>
      )}

      <style>{`@keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }`}</style>
    </div>
  )
}
