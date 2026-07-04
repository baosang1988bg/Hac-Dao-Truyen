import React, { useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck, AlertTriangle, CheckCircle, Trash2 } from 'lucide-react'
import api from '../../api'
import { StatBadge, SpinnerIcon } from '../shared/ui'

/**
 * Panel kiểm tra sức khỏe truyện (tách từ HealthTab của NovelDetail.jsx cũ).
 * - Tự fetch /health khi mount.
 * - "Dọn file phần" gọi raw fetch kèm Bearer, tự xử lý 401.
 */
export default function HealthPanel({ slug }) {
  const [healthData, setHealthData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [cleanResult, setCleanResult] = useState(null)

  const fetchHealth = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/novels/${slug}/health`)
      setHealthData(res.data)
    } catch {
      setHealthData({ error: 'Không thể tải dữ liệu health check.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const handleCleanup = async () => {
    if (!window.confirm('Xóa tất cả file phần split đã merge? Hành động này không thể hoàn tác.')) return
    setCleaning(true)
    setCleanResult(null)
    try {
      const token = localStorage.getItem('authToken')
      const res = await fetch(`/api/novels/${slug}/cleanup-split-parts`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.status === 401) {
        // Raw fetch không đi qua interceptor axios → xử lý 401 thủ công
        setCleanResult({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' })
        return
      }
      const data = await res.json()
      setCleanResult(data)
      fetchHealth() // refresh health sau cleanup
    } catch (e) {
      setCleanResult({ error: e.message })
    } finally {
      setCleaning(false)
    }
  }

  if (loading) return (
    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
      <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', display: 'inline' }} />
      <span style={{ marginLeft: '8px' }}>Đang kiểm tra...</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
  if (!healthData) return (
    <div style={{ textAlign: 'center', padding: '3rem 0' }}>
      <button className="btn btn-primary" onClick={fetchHealth}><ShieldCheck size={18} /> Kiểm tra ngay</button>
    </div>
  )
  if (healthData.error) return (
    <div style={{ color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <AlertTriangle size={18} /> {healthData.error}
    </div>
  )

  const { summary, issues } = healthData
  const hasIssues     = issues && issues.length > 0
  const splitPartsOk  = summary?.split_parts_ok ?? 0

  // Phân loại issues
  const typeConfig = {
    failed:        { color: '#fca5a5', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)',  label: 'Lỗi dịch' },
    missing:       { color: '#fdba74', bg: 'rgba(251,146,60,0.08)', border: 'rgba(251,146,60,0.25)', label: 'Chưa dịch' },
    suspicious:    { color: '#fcd34d', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)', label: 'Nghi vấn' },
    split_pending: { color: '#a78bfa', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.25)', label: 'Chờ merge' },
  }

  return (
    <div>
      {/* Stats badges */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <StatBadge label="Raw"       value={summary?.total_raw ?? 0}        color="var(--text-muted)" />
        <StatBadge label="Đã dịch"   value={summary?.total_translated ?? 0} color="var(--success)" />
        <StatBadge label="Còn thiếu" value={summary?.missing ?? 0}          color={summary?.missing > 0 ? '#fb923c' : 'var(--success)'} />
        <StatBadge label="Bị lỗi"    value={summary?.failed ?? 0}           color={summary?.failed > 0 ? '#fca5a5' : 'var(--success)'} />
        {splitPartsOk > 0 && (
          <StatBadge label="Parts OK" value={splitPartsOk} color="#a78bfa" />
        )}
        <button className="btn btn-secondary" onClick={fetchHealth}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 12px' }}>
          <RefreshCw size={14} /> Làm mới
        </button>
      </div>

      {/* Info: file phần split */}
      {splitPartsOk > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.65rem 0.9rem', borderRadius: '8px', marginBottom: '0.85rem',
          background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)',
          gap: '0.75rem', flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: '0.82rem', color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle size={14} />
            <span>
              <strong>{splitPartsOk}</strong> file phần split đã có bản merge hoàn chỉnh
              {summary?.total_raw_all && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '6px' }}>
                  (tổng raw: {summary.total_raw_all}, hiển thị {summary.total_raw} chương thực)
                </span>
              )}
            </span>
          </div>
          <button
            onClick={handleCleanup}
            disabled={cleaning}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(139,92,246,0.4)',
              background: 'rgba(139,92,246,0.15)', color: '#c4b5fd',
              fontSize: '0.78rem', fontWeight: 600, cursor: cleaning ? 'not-allowed' : 'pointer',
              opacity: cleaning ? 0.6 : 1, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!cleaning) e.currentTarget.style.background = 'rgba(139,92,246,0.28)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.15)' }}
          >
            {cleaning ? <><SpinnerIcon /> Đang xóa...</> : <><Trash2 size={13} /> Dọn file phần</>}
          </button>
        </div>
      )}

      {/* Cleanup result */}
      {cleanResult && (
        <div style={{
          padding: '0.65rem 0.9rem', borderRadius: '8px', marginBottom: '0.85rem',
          background: cleanResult.error ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
          border: `1px solid ${cleanResult.error ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
          fontSize: '0.8rem',
          color: cleanResult.error ? '#fca5a5' : '#6ee7b7',
        }}>
          {cleanResult.error ? `Lỗi: ${cleanResult.error}` : cleanResult.summary}
        </div>
      )}

      {/* Issues */}
      {!hasIssues ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '1rem 1.25rem', borderRadius: '10px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: '#6ee7b7' }}>
          <CheckCircle size={20} /> Tất cả chương đều ổn — không có vấn đề gì!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Phát hiện <strong style={{ color: 'var(--text-main)' }}>{issues.length}</strong> vấn đề:
          </p>
          {issues.map((issue, i) => {
            const cfg = typeConfig[issue.type] || typeConfig.missing
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '0.7rem 1rem', borderRadius: '8px', background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                <AlertTriangle size={16} style={{ color: cfg.color, flexShrink: 0, marginTop: '2px' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.filename}</div>
                  {issue.detail && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{issue.detail}</div>}
                </div>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: cfg.border, color: cfg.color, flexShrink: 0, alignSelf: 'center' }}>
                  {cfg.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
