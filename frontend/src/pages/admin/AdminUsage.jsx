import { useEffect, useState } from 'react';
import PropTypes from 'prop-types'
import { Database, HardDrive, AlertTriangle } from 'lucide-react'
import api from '../../api'
import { fmtNumber } from '../../utils/format'

/**
 * Ước lượng ngân sách sync cục bộ (roadmap):
 * - Đọc GET /api/admin/sync-usage → nội dung tools/.cloud_sync_budget.json.
 * - KHÔNG phải số liệu billing Cloudflare thật, chỉ là counter cục bộ do
 *   script sync tự ghi — luôn hiển thị banner cảnh báo (field "note").
 */
export default function AdminUsage() {
  const [state, setState] = useState({ status: 'loading' }) // loading | ok | unavailable | error

  useEffect(() => {
    let alive = true
    api.get('/admin/sync-usage')
      .then(res => {
        if (!alive) return
        const data = res.data || {}
        if (data.available) setState({ status: 'ok', data })
        else setState({ status: 'unavailable', reason: data.reason })
      })
      .catch(err => {
        if (!alive) return
        setState({ status: 'error', message: err.response?.data?.detail || err.message || 'Lỗi không xác định' })
      })
    return () => { alive = false }
  }, [])

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.7rem' }}>Ngân sách sync</h1>
        <p className="page-subtitle" style={{ fontSize: '0.95rem' }}>Ước lượng thao tác R2/D1 cục bộ do script sync ghi lại.</p>
      </div>

      {state.status === 'loading' && (
        <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Đang tải...
        </div>
      )}

      {state.status === 'error' && (
        <div className="glass-panel" style={{
          padding: '1.25rem', color: '#fca5a5', fontSize: '0.88rem',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <AlertTriangle size={18} /> Không tải được dữ liệu: {state.message}
        </div>
      )}

      {state.status === 'unavailable' && (
        <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Chưa có dữ liệu ngân sách, sync script chưa chạy lần nào.
          {state.reason ? <div style={{ marginTop: '4px', fontSize: '0.8rem' }}>{state.reason}</div> : null}
        </div>
      )}

      {state.status === 'ok' && (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem', marginBottom: '1.25rem',
          }}>
            <StatCard
              icon={<HardDrive size={18} />}
              label={`R2 ops${state.data.r2_month ? ` (${state.data.r2_month})` : ''}`}
              value={fmtNumber(state.data.r2_ops)}
              color="#6ee7b7"
            />
            <StatCard
              icon={<Database size={18} />}
              label={`D1 ops${state.data.d1_day ? ` (${state.data.d1_day})` : ''}`}
              value={fmtNumber(state.data.d1_ops)}
              color="#a78bfa"
            />
          </div>

          <div className="glass-panel" style={{
            padding: '1rem 1.25rem', fontSize: '0.85rem', color: '#fbbf24',
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
            display: 'flex', alignItems: 'flex-start', gap: '10px',
          }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{state.data.note}</span>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, color }) {
  return (
    <div className="glass-panel" style={{ padding: '1rem', textAlign: 'center' }}>
      <div style={{ color, marginBottom: '4px', display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1.2, fontFamily: 'Outfit, sans-serif' }}>{value}</div>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '3px' }}>{label}</div>
    </div>
  )
}
StatCard.propTypes = {
  icon: PropTypes.node,
  label: PropTypes.node,
  value: PropTypes.node,
  color: PropTypes.string,
};
