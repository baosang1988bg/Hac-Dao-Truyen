import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Layers, AlertCircle } from 'lucide-react'
import api from '../api'

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
  return null;
}

export default function Dashboard() {
  const [novels, setNovels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastNovelInfo, setLastNovelInfo] = useState(null)

  useEffect(() => {
    api.get('/novels')
      .then(res => {
        setNovels(res.data)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setError('Không thể kết nối backend. Hãy chắc chắn server đang chạy.')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (novels.length === 0) return
    const lastNovel = localStorage.getItem('last_read_novel') || getCookie('last_read_novel')
    if (lastNovel) {
      const lastChapter = localStorage.getItem(`last_read_chapter_${lastNovel}`) || getCookie(`last_read_chapter_${lastNovel}`)
      if (lastChapter) {
        const found = novels.find(n => n.slug === lastNovel)
        if (found) {
          setLastNovelInfo({
            slug: lastNovel,
            chapter: lastChapter,
            title: found.title
          })
        }
      }
    }
  }, [novels])

  return (
    <div className="container animate-fade-in">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <h1 className="page-title">Thư viện</h1>
        <p className="page-subtitle">Quản lý và đọc các truyện đã dịch.</p>
      </div>

      {lastNovelInfo && (
        <div className="glass-panel animate-fade-in" style={{
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          borderRadius: '16px',
          padding: '1.5rem',
          marginBottom: '2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.25)',
          backdropFilter: 'blur(12px)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{
                fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: '#60a5fa', background: 'rgba(59, 130, 246, 0.18)', padding: '3px 8px', borderRadius: '4px'
              }}>
                📖 Đang đọc dở
              </span>
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'white', marginBottom: '2px' }}>{lastNovelInfo.title}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Chương đang đọc: <strong style={{ color: 'var(--text-main)' }}>{decodeURIComponent(lastNovelInfo.chapter).replace('.md', '').replace('_VI', '')}</strong>
            </p>
          </div>
          <Link
            to={`/novel/${lastNovelInfo.slug}/read/${lastNovelInfo.chapter}`}
            className="btn btn-primary"
            style={{ padding: '10px 20px', borderRadius: '12px', fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            Đọc tiếp &rarr;
          </Link>
        </div>
      )}

      {loading && (
        <div className="text-muted" style={{ padding: '2rem 0' }}>Đang tải danh sách truyện...</div>
      )}

      {error && (
        <div className="glass-panel p-6" style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)' }}>
          <AlertCircle size={20} style={{ flexShrink: 0 }} />
          {error}
        </div>
      )}

      {!loading && !error && novels.length === 0 && (
        <div className="glass-panel p-6 text-center text-muted">
          Chưa có truyện nào. Hãy tạo truyện mới bằng lệnh <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>python main.py new</code>.
        </div>
      )}

      {!loading && !error && novels.length > 0 && (
        <div className="grid md:grid-cols-2">
          {novels.map(n => (
            <NovelCard key={n.slug} novel={n} />
          ))}
        </div>
      )}
    </div>
  )
}

function NovelCard({ novel: n }) {
  return (
    <div
      className="glass-panel p-6 flex flex-col gap-4 novel-card"
      style={{ cursor: 'pointer' }}
    >
      <div className="flex justify-between items-start gap-3">
        <div style={{ minWidth: 0 }}>
          <h2 style={{
            fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.25rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {n.title}
          </h2>
          <div className="text-sm text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[n.original_title, n.author].filter(Boolean).join(' • ') || 'Chưa có thông tin'}
          </div>
        </div>
        {n.genre && (
          <div style={{
            background: 'rgba(59,130,246,0.12)', color: 'var(--accent)',
            padding: '3px 10px', borderRadius: '20px',
            fontSize: '0.8rem', fontWeight: 500, flexShrink: 0,
            border: '1px solid rgba(59,130,246,0.2)',
          }}>
            {n.genre}
          </div>
        )}
      </div>

      {n.notes && (
        <p className="text-sm text-muted" style={{
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
          lineHeight: 1.6,
        }}>
          {n.notes}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        <Layers size={15} />
        <span>{n.last_chapter_number || 0} chương đã dịch</span>
        {n.total_chapters > 0 && (
          <span style={{ opacity: 0.5 }}>/ {n.total_chapters}</span>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border-panel)', paddingTop: '1.25rem', display: 'flex', gap: '0.75rem', marginTop: 'auto' }}>
        <Link to={`/novel/${n.slug}`} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', borderRadius: '12px', padding: '10px' }}>
          <BookOpen size={16} />
          {localStorage.getItem('userRole') === 'admin' ? 'Quản lý' : 'Đọc truyện'}
        </Link>
      </div>
    </div>
  )
}
