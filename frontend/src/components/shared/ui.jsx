import React from 'react'

// ── Các component / helper nhỏ dùng chung (tách từ NovelDetail.jsx cũ) ────────

/** Giây → "45s" / "3m 20s" */
export function fmtTime(seconds) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60), s = seconds % 60
  return `${m}m ${s}s`
}

/** Badge trạng thái phiên dịch (running/finished/error/cancelling/cancelled). */
export function StatusBadge({ status }) {
  const cfg = {
    running:    { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.3)',  dot: '#3b82f6', label: 'Đang dịch' },
    finished:   { color: '#6ee7b7', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', dot: '#10b981', label: 'Hoàn thành' },
    error:      { color: '#fca5a5', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  dot: '#ef4444', label: 'Lỗi' },
    cancelling: { color: '#fdba74', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)', dot: '#f59e0b', label: 'Đang dừng...' },
    cancelled:  { color: '#fcd34d', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', dot: '#d97706', label: 'Đã dừng' },
  }[status] || { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border-panel)', dot: '#6b7280', label: status }

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '3px 10px', borderRadius: '99px',
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      fontSize: '0.75rem', fontWeight: 600, color: cfg.color,
    }}>
      {/* Animated dot */}
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: cfg.dot, flexShrink: 0,
        animation: status === 'running' ? 'pulse-dot 1.5s infinite' : 'none',
      }} />
      {cfg.label}
      <style>{`@keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }`}</style>
    </div>
  )
}

/** Spinner xoay nhỏ (14px). */
export function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  )
}

/** Ô thống kê nhỏ (label + số). */
export function StatBadge({ label, value, color }) {
  return (
    <div style={{ padding: '0.4rem 0.85rem', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-panel)', textAlign: 'center', minWidth: '72px' }}>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

/** Dòng thông tin label: value. */
export function InfoRow({ label, value, mono }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

/** Style tiêu đề section trong panel. */
export const sectionTitle = {
  fontSize: '1rem', fontWeight: 600, marginBottom: '1rem',
  display: 'flex', alignItems: 'center', gap: '8px',
}
