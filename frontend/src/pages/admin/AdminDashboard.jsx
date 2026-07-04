import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen, Layers, Book, Activity, Square, ScrollText, ChevronRight,
} from 'lucide-react'
import api from '../../api'
import { fmtNumber, fmtDuration, fmtDate, fmtTokens } from '../../utils/format'

/**
 * Tổng quan quản trị:
 * - 3 StatCard thật từ /api/novels (Σ truyện / Σ chương dịch / Σ thuật ngữ).
 * - "Đang dịch": poll /api/translate/active mỗi 5s, progress bar + nút dừng.
 * - "Phiên gần nhất": /api/logs?limit=8.
 */
export default function AdminDashboard() {
  const [novels, setNovels] = useState([])
  const [active, setActive] = useState({})
  const [sessions, setSessions] = useState(null)

  useEffect(() => {
    let alive = true
    api.get('/novels')
      .then(res => { if (alive) setNovels(res.data || []) })
      .catch(() => {})
    api.get('/logs?limit=8')
      .then(res => { if (alive) setSessions(res.data || []) })
      .catch(() => { if (alive) setSessions([]) })
    return () => { alive = false }
  }, [])

  // Poll phiên dịch đang chạy mỗi 5s
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

  const handleStop = async (slug) => {
    if (!window.confirm(`Dừng phiên dịch của "${slug}"?`)) return
    try {
      await api.post(`/novels/${slug}/translate/stop`)
    } catch (err) {
      console.error('Stop failed:', err)
    }
  }

  const totalNovels = novels.filter(n => (n.chapter_count || 0) > 0).length
  const totalChapters = novels.reduce((a, n) => a + (n.chapter_count || 0), 0)
  const totalGlossary = novels.reduce((a, n) => a + (n.glossary_count || 0), 0)
  const activeEntries = Object.entries(active)

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.7rem' }}>Tổng quan</h1>
        <p className="page-subtitle" style={{ fontSize: '0.95rem' }}>Tình trạng hệ thống dịch thuật.</p>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.75rem' }}>
        <StatCard icon={<BookOpen size={18} />} label="Truyện có chương" value={fmtNumber(totalNovels)} color="var(--accent)" />
        <StatCard icon={<Layers size={18} />} label="Chương đã dịch" value={fmtNumber(totalChapters)} color="#6ee7b7" />
        <StatCard icon={<Book size={18} />} label="Thuật ngữ" value={fmtNumber(totalGlossary)} color="#a78bfa" />
      </div>

      {/* ── Đang dịch (live) ── */}
      <section style={{ marginBottom: '1.75rem' }}>
        <h2 style={{
          fontSize: '1rem', fontWeight: 700, marginBottom: '0.85rem',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <Activity size={17} style={{ color: 'var(--accent)' }} /> Đang dịch
        </h2>

        {activeEntries.length === 0 ? (
          <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Không có phiên dịch nào đang chạy.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {activeEntries.map(([slug, s]) => {
              const total = s.total || 0
              const current = s.current || 0
              const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0
              const novel = novels.find(n => n.slug === slug)
              return (
                <div key={slug} className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: 'var(--accent)', animation: 'pulse-dot 1.5s infinite', flexShrink: 0,
                    }} />
                    <Link to={`/admin/novels/${slug}`} style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.95rem' }}>
                      {novel?.title || slug}
                    </Link>
                    {s.current_model && (
                      <span style={{
                        fontSize: '0.7rem', padding: '2px 8px', borderRadius: '99px',
                        background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)',
                        border: '1px solid var(--border-panel)',
                      }}>
                        {s.current_model}
                      </span>
                    )}
                    <button
                      onClick={() => handleStop(slug)}
                      className="btn btn-danger"
                      style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '0.78rem', minHeight: '36px' }}
                    >
                      <Square size={12} fill="currentColor" stroke="none" /> Dừng
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    <span style={{
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%',
                    }}>
                      {s.current_chapter || 'Đang xử lý...'}
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{current}/{total} ({pct}%)</span>
                  </div>
                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '99px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: '99px',
                      background: 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)',
                      width: `${pct}%`, transition: 'width 0.5s ease',
                      boxShadow: '0 0 8px rgba(59,130,246,0.4)',
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Phiên gần nhất ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
          <h2 style={{
            fontSize: '1rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: '8px', margin: 0,
          }}>
            <ScrollText size={17} style={{ color: 'var(--accent)' }} /> Phiên gần nhất
          </h2>
          <Link to="/admin/logs" style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            Xem tất cả <ChevronRight size={13} />
          </Link>
        </div>

        {sessions === null ? (
          <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Đang tải...
          </div>
        ) : sessions.length === 0 ? (
          <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Chưa có phiên dịch nào.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {sessions.map(s => (
              <div key={s.filename} className="glass-panel" style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.7rem 1rem', flexWrap: 'wrap',
              }}>
                <span style={{
                  fontWeight: 600, fontSize: '0.85rem', flex: '1 1 140px', minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {s.novel_title || s.novel_slug || '—'}
                </span>
                <SessionStatusPill status={s.status} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {fmtDate(s.started_at)}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {s.chapters_done || 0} chương
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  ⏱ {fmtDuration(s.duration_sec)}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#fbbf24', whiteSpace: 'nowrap' }}>
                  {fmtTokens(s.total_tokens)} tkn
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <style>{`@keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }`}</style>
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

function SessionStatusPill({ status }) {
  const cfg = {
    done:    { color: '#6ee7b7', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.25)', label: '✓ Xong' },
    error:   { color: '#fca5a5', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.25)',  label: '✕ Lỗi' },
    partial: { color: '#fb923c', bg: 'rgba(251,146,60,0.1)', border: 'rgba(251,146,60,0.25)', label: '~ Một phần' },
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
