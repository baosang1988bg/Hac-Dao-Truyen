import React, { useEffect, useState } from 'react'
import { Inbox, Check, X, ExternalLink, AlertCircle } from 'lucide-react'
import api from '../../api'
import { fmtDate } from '../../utils/format'

const TABS = [
  { key: '', label: 'Tất cả' },
  { key: 'pending', label: 'Chờ duyệt' },
  { key: 'approved', label: 'Đã duyệt' },
  { key: 'rejected', label: 'Từ chối' },
]

/**
 * Danh sách "Request Novel" (độc giả gợi ý truyện muốn dịch) — quản trị duyệt/từ chối.
 * GET /api/admin/novel-requests?status=  — POST /api/admin/novel-requests/:id/review
 *
 * LƯU Ý: duyệt CHỈ đổi trạng thái trong DB, KHÔNG tự động chạy scraper/import —
 * sau khi duyệt, admin vẫn phải tự chạy `python main.py import --url ...` thủ công.
 */
export default function AdminNovelRequests() {
  const [tab, setTab] = useState('pending')
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = (status) => {
    setItems(null)
    setError(null)
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    api.get(`/admin/novel-requests${qs}`)
      .then(res => setItems(res.data || []))
      .catch(() => { setItems([]); setError('Không tải được danh sách yêu cầu.') })
  }

  useEffect(() => { load(tab) }, [tab])

  const review = async (id, status) => {
    const label = status === 'approved' ? 'DUYỆT' : 'TỪ CHỐI'
    const adminNote = window.prompt(
      `${label} yêu cầu #${id} — nhập ghi chú cho độc giả (không bắt buộc):`, ''
    )
    if (adminNote === null) return // bấm Cancel
    setBusyId(id)
    try {
      await api.post(`/admin/novel-requests/${id}/review`, { status, admin_note: adminNote })
      load(tab)
    } catch {
      setError(`Không thể ${label.toLowerCase()} yêu cầu #${id}. Vui lòng thử lại.`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.7rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Inbox size={24} /> Yêu cầu truyện
        </h1>
        <p className="page-subtitle" style={{ fontSize: '0.95rem' }}>
          Độc giả gợi ý truyện muốn dịch. Duyệt xong nhớ tự chạy <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>python main.py import --url ...</code> thủ công — hệ thống KHÔNG tự động import.
        </p>
      </div>

      {/* Tabs lọc theo status */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.1rem', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={t.key === tab ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: '0.82rem', padding: '6px 14px', minHeight: '34px' }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="glass-panel p-6" style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#fca5a5', marginBottom: '1rem' }}>
          <AlertCircle size={18} /> {error}
        </div>
      )}

      {items === null && (
        <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Đang tải...
        </div>
      )}

      {items !== null && items.length === 0 && !error && (
        <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Không có yêu cầu nào.
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {items.map(item => (
            <div key={item.id} className="glass-panel" style={{ padding: '0.9rem 1.1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{item.email || `User #${item.user_id}`}</span>
                <StatusPill status={item.status} />
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {fmtDate(item.created_at)}
                </span>
              </div>

              <a
                href={item.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem',
                  color: 'var(--accent)', wordBreak: 'break-all', marginBottom: '0.35rem',
                }}
              >
                {item.url} <ExternalLink size={12} style={{ flexShrink: 0 }} />
              </a>

              {item.note && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  Ghi chú độc giả: {item.note}
                </div>
              )}
              {item.admin_note && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  Ghi chú admin: {item.admin_note}
                  {item.reviewed_at && <> · {fmtDate(item.reviewed_at)}</>}
                </div>
              )}

              {item.status === 'pending' && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '0.78rem', padding: '5px 12px', minHeight: '34px' }}
                    disabled={busyId === item.id}
                    onClick={() => review(item.id, 'approved')}
                  >
                    <Check size={14} /> Duyệt
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ fontSize: '0.78rem', padding: '5px 12px', minHeight: '34px' }}
                    disabled={busyId === item.id}
                    onClick={() => review(item.id, 'rejected')}
                  >
                    <X size={14} /> Từ chối
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }) {
  const cfg = {
    pending:  { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)', label: 'Chờ duyệt' },
    approved: { color: '#6ee7b7', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.25)', label: 'Đã duyệt' },
    rejected: { color: '#fca5a5', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)', label: 'Từ chối' },
  }[status] || { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border-panel)', label: status }

  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px', borderRadius: '99px',
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, flexShrink: 0,
    }}>
      {cfg.label}
    </span>
  )
}
