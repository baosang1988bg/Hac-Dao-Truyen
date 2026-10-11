import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom'
import { Layers, Book, AlertCircle, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../../api'
import NovelCover from '../../components/NovelCover'
import { fmtTimeAgo } from '../../utils/format'

const SORT_OPTIONS = [
  { value: 'updated_at',    label: 'Cập nhật mới nhất' },
  { value: 'chapter_count', label: 'Nhiều chương nhất' },
  { value: 'title',         label: 'Tên A-Z' },
]
const STATUS_OPTIONS = [
  { value: '',          label: 'Tất cả' },
  { value: 'ongoing',   label: 'Đang ra' },
  { value: 'completed', label: 'Hoàn thành' },
]
const PAGE_SIZE = 30

/**
 * Danh sách truyện trong khu quản trị.
 * - Tìm/lọc/sắp xếp/phân trang bằng chính query params server-side đã có sẵn
 *   ở GET /api/novels (q/sort/order/status/page/limit) — trước đây trang này
 *   gọi fetchAdminNovels() tải HẾT mọi trang về rồi hiển thị phẳng, không có
 *   cách nào tìm truyện khi danh sách lớn lên.
 * - Poll GET /api/translate/active mỗi 5s → badge "Đang dịch x/y".
 * - Bấm hàng → /admin/novels/:slug
 */
export default function AdminNovels() {
  const [novels, setNovels] = useState(null)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(0)
  const [active, setActive] = useState({})
  const [error, setError] = useState(null)

  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('updated_at')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  // Debounce ô tìm kiếm 350ms trước khi gọi API, tránh spam request theo từng phím gõ
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [qInput])

  useEffect(() => { setPage(1) }, [sort, status])

  useEffect(() => {
    let alive = true
    setNovels(prev => prev === null ? null : prev) // giữ danh sách cũ trong lúc tải trang mới
    api.get('/novels', { params: { q, sort, order: 'desc', status, page, limit: PAGE_SIZE } })
      .then(({ data }) => {
        if (!alive) return
        setNovels(data.novels || [])
        setTotal(data.total || 0)
        setPages(data.pages || 0)
        setError(null)
      })
      .catch(() => { if (alive) { setNovels([]); setError('Không tải được danh sách truyện.') } })
    return () => { alive = false }
  }, [q, sort, status, page])

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
        <p className="page-subtitle" style={{ fontSize: '0.95rem' }}>Quản lý {total} truyện trong hệ thống.</p>
      </div>

      {/* ── Toolbar: tìm kiếm + lọc + sắp xếp ── */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            className="input-field"
            placeholder="Tìm theo tên, tác giả, slug..."
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            style={{ paddingLeft: '32px', height: '38px', fontSize: '0.875rem', width: '100%' }}
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="input-field"
          style={{ height: '38px', fontSize: '0.85rem', flex: '0 0 auto' }}
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="input-field"
          style={{ height: '38px', fontSize: '0.85rem', flex: '0 0 auto' }}
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
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
          {q || status
            ? 'Không tìm thấy truyện phù hợp với bộ lọc hiện tại.'
            : <>Chưa có truyện nào. Tạo truyện mới bằng lệnh <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>python main.py new</code>.</>}
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginTop: '1.25rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0.4rem 0.8rem' }}
          >
            <ChevronLeft size={14} /> Trước
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Trang {page} / {pages}</span>
          <button
            className="btn btn-secondary"
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page >= pages}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0.4rem 0.8rem' }}
          >
            Sau <ChevronRight size={14} />
          </button>
        </div>
      )}

      <style>{`@keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }`}</style>
    </div>
  )
}
