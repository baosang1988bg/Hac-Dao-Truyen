import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Layers, AlertCircle } from 'lucide-react'
import api from '../api'

export default function Dashboard() {
  const [novels, setNovels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  return (
    <div className="container animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Thư viện</h1>
        <p className="page-subtitle">Quản lý và đọc các truyện đã dịch.</p>
      </div>

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

      <div style={{ borderTop: '1px solid var(--border-panel)', paddingTop: '1rem', display: 'flex', gap: '0.75rem' }}>
        <Link to={`/novel/${n.slug}`} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
          <BookOpen size={17} />
          {localStorage.getItem('userRole') === 'admin' ? 'Quản lý' : 'Đọc truyện'}
        </Link>
      </div>
    </div>
  )
}
