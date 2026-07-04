import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, BookOpen, Zap, Clock, CheckCircle,
  AlertTriangle, TrendingUp, Cpu, ChevronDown, ChevronUp,
  FileText, Filter, Database,
} from 'lucide-react'
import api from '../api'
import { fmtDuration, fmtDate, fmtTokens } from '../utils/format'

// ─────────────────────────────────────────────────────────────────────────────
export default function Logs() {
  const [sessions, setSessions]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState('all')   // all | translate | fix
  const [novelFilter, setNovelFilter] = useState('all')
  const [expanded, setExpanded]       = useState(null)
  const [showOrphan, setShowOrphan]   = useState(true)    // toggle hiện/ẩn orphan stats

  useEffect(() => { fetchLogs() }, [])

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const res = await api.get('/logs?limit=500')
      setSessions(res.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Unique novels for filter
  const novels = ['all', ...new Set(sessions.map(s => s.novel_slug).filter(Boolean))]

  // Filter — không gộp, giữ từng session riêng lẻ
  const filtered = sessions.filter(s => {
    if (filter !== 'all' && s.session_type !== filter) return false
    if (novelFilter !== 'all' && s.novel_slug !== novelFilter) return false
    if (!showOrphan && s.is_orphan_stats) return false
    return true
  })

  // ── Aggregate stats — tính trên toàn bộ filtered (không gộp) ──
  const totalRuns     = filtered.length
  const totalChapters = filtered.reduce((a, s) => a + (s.chapters_done || 0), 0)
  const totalTokens   = filtered.reduce((a, s) => a + (s.total_tokens  || 0), 0)
  const totalCost     = filtered.reduce((a, s) => a + (s.cost_usd      || 0), 0)
  const totalDuration = filtered.reduce((a, s) => a + (s.duration_sec  || 0), 0)

  // Success rate: chỉ tính trên sessions có chapters_done > 0
  const sessionsWithChaps = filtered.filter(s => (s.chapters_done || 0) > 0)
  const avgSuccessRate = sessionsWithChaps.length
    ? (sessionsWithChaps.reduce((a, s) => a + (s.success_rate || 100), 0) / sessionsWithChaps.length).toFixed(1)
    : 100

  // Global model breakdown — aggregate trên toàn bộ filtered
  const globalModelBreakdown = {}
  filtered.forEach(s => {
    // Từ model_breakdown (log-based sessions)
    if (s.model_breakdown && Object.keys(s.model_breakdown).length > 0) {
      Object.entries(s.model_breakdown).forEach(([model, data]) => {
        if (!globalModelBreakdown[model])
          globalModelBreakdown[model] = { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, calls: 0 }
        globalModelBreakdown[model].input_tokens  += data.input_tokens  || 0
        globalModelBreakdown[model].output_tokens += data.output_tokens || 0
        globalModelBreakdown[model].total_tokens  += data.total_tokens  || 0
        globalModelBreakdown[model].cost_usd      += data.cost_usd      || 0
        globalModelBreakdown[model].calls         += data.calls         || 0
      })
    } else if (s.is_orphan_stats && s.total_tokens > 0) {
      // Orphan stats: không có breakdown — aggregate vào từng model trong models_used
      const models = s.models_used || []
      if (models.length > 0) {
        // Phân bổ token đều cho từng model (ước tính)
        const perModel = Math.round(s.total_tokens / models.length)
        const perInput = Math.round((s.input_tokens || 0) / models.length)
        const perOutput= Math.round((s.output_tokens|| 0) / models.length)
        const perCost  = (s.cost_usd || 0) / models.length
        models.forEach(model => {
          if (!globalModelBreakdown[model])
            globalModelBreakdown[model] = { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, calls: 0 }
          globalModelBreakdown[model].input_tokens  += perInput
          globalModelBreakdown[model].output_tokens += perOutput
          globalModelBreakdown[model].total_tokens  += perModel
          globalModelBreakdown[model].cost_usd      += perCost
          // calls = 0 vì không biết chính xác
        })
      }
    }
  })

  const orphanCount = sessions.filter(s => s.is_orphan_stats).length

  return (
    <div className="container animate-fade-in">
      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <Link to="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          <ArrowLeft size={15} /> Tổng quan
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>Lịch sử dịch</h1>
            <p className="page-subtitle">Theo dõi tất cả phiên dịch — tốc độ, chi phí, token</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {orphanCount > 0 && (
              <button
                onClick={() => setShowOrphan(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '7px 12px', borderRadius: '8px', cursor: 'pointer',
                  fontSize: '0.8rem', fontWeight: 500, transition: 'all 0.15s',
                  background: showOrphan ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.05)',
                  color: showOrphan ? '#c4b5fd' : 'var(--text-muted)',
                  border: `1px solid ${showOrphan ? 'rgba(139,92,246,0.35)' : 'var(--border-panel)'}`,
                }}
              >
                <Database size={13} />
                {showOrphan ? `Ẩn stats-only (${orphanCount})` : `Hiện stats-only (${orphanCount})`}
              </button>
            )}
            <button className="btn btn-secondary" onClick={fetchLogs}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RefreshCw size={15} /> Làm mới
            </button>
          </div>
        </div>
      </div>

      {/* Aggregate stats */}
      {!loading && filtered.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <AggrCard icon={<Zap size={18} />}        label="Tổng phiên"   value={totalRuns}                         color="var(--accent)" />
            <AggrCard icon={<BookOpen size={18} />}   label="Tổng chương"  value={totalChapters.toLocaleString()}    color="#6ee7b7" />
            <AggrCard icon={<Clock size={18} />}      label="Thời gian"    value={fmtDuration(totalDuration)}        color="#a78bfa" />
            <AggrCard icon={<TrendingUp size={18} />} label="Thành công"   value={`${avgSuccessRate}%`}              color={parseFloat(avgSuccessRate) >= 90 ? '#6ee7b7' : '#fb923c'} />
            <AggrCard icon={<Cpu size={18} />}        label="Tổng tokens"  value={fmtTokens(totalTokens)}            color="#fbbf24" />
            <AggrCard icon={<FileText size={18} />}   label="Tổng chi phí" value={totalCost > 0.0001 ? `$${totalCost.toFixed(4)}` : totalCost > 0 ? `$${totalCost.toFixed(6)}` : 'free'} color={totalCost > 0 ? '#fb923c' : '#6ee7b7'} />
          </div>

          {/* Global model breakdown */}
          {Object.keys(globalModelBreakdown).length > 0 && (
            <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cpu size={14} /> Tổng hợp token theo model
                {orphanCount > 0 && showOrphan && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '4px' }}>
                    (token của sessions stats-only được ước tính)
                  </span>
                )}
              </div>
              <ModelBreakdownTable breakdown={globalModelBreakdown} />
            </div>
          )}
        </>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        {['all', 'translate', 'fix'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', borderRadius: '99px', fontSize: '0.8rem',
            border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
            background: filter === f ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
            color:      filter === f ? 'white'         : 'var(--text-muted)',
            borderColor: filter === f ? 'var(--accent)' : 'var(--border-panel)',
          }}>
            {f === 'all' ? 'Tất cả' : f === 'translate' ? 'Dịch' : 'Fix'}
          </button>
        ))}
        <span style={{ color: 'var(--border-panel)', margin: '0 4px' }}>|</span>
        <select
          value={novelFilter}
          onChange={e => setNovelFilter(e.target.value)}
          style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-panel)',
            color: 'var(--text-main)', borderRadius: '8px', padding: '4px 10px',
            fontSize: '0.8rem', cursor: 'pointer',
          }}
        >
          {novels.map(n => (
            <option key={n} value={n} style={{ background: '#1e293b' }}>
              {n === 'all' ? 'Tất cả truyện' : n}
            </option>
          ))}
        </select>

        {filtered.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {filtered.length} phiên
            {filtered.filter(s => s.is_orphan_stats).length > 0 && (
              <span style={{ marginLeft: '5px', color: '#a78bfa', fontSize: '0.72rem' }}>
                ({filtered.filter(s => s.is_orphan_stats).length} stats-only)
              </span>
            )}
          </span>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
          <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', display: 'inline' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <div style={{ marginTop: '0.75rem' }}>Đang tải log...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel p-6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          Chưa có phiên nào. Hãy dịch một truyện để bắt đầu.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {filtered.map((s, i) => (
            <SessionRow
              key={s.filename}
              session={s}
              index={filtered.length - i}
              isExpanded={expanded === s.filename}
              onToggle={() => setExpanded(expanded === s.filename ? null : s.filename)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Session Row ───────────────────────────────────────────────────────────────
function SessionRow({ session: s, index, isExpanded, onToggle }) {
  const isError   = s.status === 'error'
  const isDone    = s.status === 'done'
  const isFix     = s.session_type === 'fix'
  const isOrphan  = s.is_orphan_stats === true

  return (
    <div style={{
      borderRadius: '12px',
      border: `1px solid ${isExpanded ? 'rgba(59,130,246,0.35)' : isOrphan ? 'rgba(139,92,246,0.18)' : 'var(--border-panel)'}`,
      background: isExpanded ? 'rgba(59,130,246,0.04)' : 'var(--bg-panel)',
      backdropFilter: 'blur(16px)',
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>
      {/* Main row */}
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '36px 1fr auto',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.85rem 1.1rem',
          cursor: 'pointer',
        }}
      >
        {/* Index badge */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: isFix     ? 'rgba(251,146,60,0.12)'
                      : isOrphan  ? 'rgba(139,92,246,0.12)'
                      : 'rgba(59,130,246,0.12)',
            border: `1px solid ${isFix ? 'rgba(251,146,60,0.25)' : isOrphan ? 'rgba(139,92,246,0.3)' : 'rgba(59,130,246,0.25)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.7rem', fontWeight: 700,
            color: isFix ? '#fb923c' : isOrphan ? '#c4b5fd' : 'var(--accent)',
          }}>
            #{index}
          </div>
        </div>

        {/* Main info */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.novel_title || s.novel_slug || '—'}
            </span>
            <TypeBadge type={s.session_type} />
            <StatusPill status={s.status} />
            {isOrphan && (
              <span style={{
                fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', borderRadius: '99px',
                background: 'rgba(139,92,246,0.12)', color: '#c4b5fd',
                border: '1px solid rgba(139,92,246,0.3)', flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: '3px',
              }}>
                <Database size={9} /> stats only
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <span><Clock size={11} style={{ verticalAlign: 'middle', marginRight: '3px' }} />{fmtDate(s.started_at)}</span>
            {s.chapters_done > 0 && (
              <span><BookOpen size={11} style={{ verticalAlign: 'middle', marginRight: '3px' }} />{s.chapters_done} chương</span>
            )}
            {s.duration_sec > 0 && <span>⏱ {fmtDuration(s.duration_sec)}</span>}
            {s.models_used?.length > 0 && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }}>
                <Cpu size={11} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
                {s.models_used.join(', ')}
              </span>
            )}
          </div>
        </div>

        {/* Right: metrics + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {s.chapters_done > 0 && s.chapters_requested > 0 && (
              <MetricPill value={`${s.chapters_done}/${s.chapters_requested}`} label="chương" color="var(--accent)" />
            )}
            {s.success_rate !== undefined && !isOrphan && (
              <MetricPill
                value={`${s.success_rate}%`} label="thành công"
                color={s.success_rate >= 95 ? '#6ee7b7' : s.success_rate >= 80 ? '#fb923c' : '#fca5a5'}
              />
            )}
            {s.sec_per_chap > 0 && !isOrphan && (
              <MetricPill value={`${s.sec_per_chap}s`} label="/chương" color="#a78bfa" />
            )}
            {s.total_tokens > 0 && (
              <MetricPill value={fmtTokens(s.total_tokens)} label="tokens" color="#fbbf24" />
            )}
            {s.cost_usd > 0 && (
              <MetricPill value={`$${s.cost_usd.toFixed(4)}`} label="chi phí" color="#fb923c" />
            )}
          </div>
          {isExpanded
            ? <ChevronUp  size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            : <ChevronDown size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          }
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--border-panel)', padding: '1rem 1.1rem' }}>

          {/* Orphan stats notice */}
          {isOrphan && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '0.55rem 0.85rem', borderRadius: '8px', marginBottom: '1rem',
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)',
              fontSize: '0.78rem', color: '#c4b5fd',
            }}>
              <Database size={14} />
              Phiên này chỉ có file stats.json (không có file .log). Dữ liệu token &amp; cost chính xác, nhưng không có chi tiết log text.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>

            {/* Session details */}
            <DetailSection title="Chi tiết phiên">
              <DetailRow label="Bắt đầu"    value={s.started_at} />
              {!isOrphan && <DetailRow label="Kết thúc"   value={s.ended_at} />}
              {!isOrphan && <DetailRow label="Thời lượng" value={fmtDuration(s.duration_sec)} />}
              <DetailRow label="Loại"       value={s.session_type} />
              <DetailRow label="File"       value={s.filename} mono />
              {s.novel_slug && <DetailRow label="Novel slug" value={s.novel_slug} mono />}
            </DetailSection>

            {/* Translation stats */}
            <DetailSection title="Thống kê dịch">
              <DetailRow label="Yêu cầu"    value={s.chapters_requested || s.chapters_done || '—'} />
              <DetailRow label="Hoàn thành" value={s.chapters_done} />
              {!isOrphan && <DetailRow label="Thất bại"   value={s.failed_count || 0} />}
              {!isOrphan && <DetailRow label="Thành công" value={`${s.success_rate}%`} />}
              {!isOrphan && s.speed_cpm && <DetailRow label="Tốc độ"     value={`${s.speed_cpm} ch/phút`} />}
              {!isOrphan && s.sec_per_chap && <DetailRow label="TB/chương"  value={`${s.sec_per_chap}s`} />}
              {s.auto_learned > 0 && <DetailRow label="Thuật ngữ học" value={`+${s.auto_learned}`} />}
            </DetailSection>

            {/* AI & Tokens */}
            <DetailSection title="AI & Tokens">
              {(s.input_tokens  || 0) > 0 && <DetailRow label="Input tokens"  value={fmtTokens(s.input_tokens)} />}
              {(s.output_tokens || 0) > 0 && <DetailRow label="Output tokens" value={fmtTokens(s.output_tokens)} />}
              <DetailRow label="Tổng tokens" value={fmtTokens(s.total_tokens) || '—'} />
              <DetailRow
                label="Chi phí"
                value={s.cost_usd > 0 ? `~$${s.cost_usd.toFixed(6)}` : 'free'}
              />
              {s.models_used?.length > 0 && (
                <DetailRow label="Models" value={s.models_used.join(', ')} />
              )}
              {s.has_stats_json && (
                <div style={{ fontSize: '0.68rem', color: '#6ee7b7', marginTop: '4px' }}>
                  ✓ Dữ liệu chính xác từ stats.json
                </div>
              )}
              {s.batch_sizes?.length > 0 && (
                <DetailRow label="Batch sizes" value={`[${[...new Set(s.batch_sizes)].join(', ')}]`} />
              )}
            </DetailSection>

            {/* Per-model breakdown (chỉ có ở log-based sessions) */}
            {s.model_breakdown && Object.keys(s.model_breakdown).length > 0 && (
              <DetailSection title="Breakdown theo model">
                <ModelBreakdownTable breakdown={s.model_breakdown} />
              </DetailSection>
            )}

            {/* Orphan: hiện danh sách models_used với token ước tính */}
            {isOrphan && s.models_used?.length > 0 && s.total_tokens > 0 && (
              <DetailSection title="Models sử dụng (ước tính)">
                {s.models_used.map(model => {
                  const share = s.total_tokens / s.models_used.length
                  const costShare = (s.cost_usd || 0) / s.models_used.length
                  return (
                    <div key={model} style={{
                      padding: '0.5rem 0.7rem', borderRadius: '8px', marginBottom: '4px',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-panel)',
                      fontSize: '0.78rem',
                    }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '2px' }}>{model}</div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        ~{fmtTokens(Math.round(share))} tokens
                        {costShare > 0 && ` · ~$${costShare.toFixed(5)}`}
                      </div>
                    </div>
                  )
                })}
              </DetailSection>
            )}

            {/* Chapters saved */}
            {s.chapters_saved?.length > 0 && (
              <DetailSection title={`Chương đã lưu (${s.chapters_saved.length})`}>
                <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                  {s.chapters_saved.map((ch, i) => (
                    <div key={i} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      ✓ {ch}
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}

            {/* Errors */}
            {s.errors?.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fca5a5', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <AlertTriangle size={13} /> Lỗi ({s.errors.length})
                </div>
                <div style={{
                  background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: '6px', padding: '8px 10px', maxHeight: '100px', overflowY: 'auto',
                  fontFamily: 'monospace', fontSize: '0.7rem', color: '#fca5a5',
                }}>
                  {s.errors.map((e, i) => <div key={i} style={{ marginBottom: '2px' }}>{e}</div>)}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  )
}

// ── Small components ──────────────────────────────────────────────────────────

function AggrCard({ icon, label, value, color }) {
  return (
    <div className="glass-panel p-6" style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
      <div style={{ color, marginBottom: '4px', display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '3px' }}>{label}</div>
    </div>
  )
}

function TypeBadge({ type }) {
  const isFix = type === 'fix'
  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px', borderRadius: '99px',
      background: isFix ? 'rgba(251,146,60,0.12)' : 'rgba(59,130,246,0.12)',
      color: isFix ? '#fb923c' : 'var(--accent)',
      border: `1px solid ${isFix ? 'rgba(251,146,60,0.3)' : 'rgba(59,130,246,0.3)'}`,
      flexShrink: 0,
    }}>
      {isFix ? '🔧 Fix' : '🌐 Dịch'}
    </span>
  )
}

function StatusPill({ status }) {
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

function MetricPill({ value, label, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '3px 8px', borderRadius: '6px',
      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-panel)',
      minWidth: '48px',
    }}>
      <span style={{ fontSize: '0.8rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function DetailSection({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {children}
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.78rem' }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right', color: 'var(--text-main)', fontSize: mono ? '0.7rem' : '0.78rem', wordBreak: 'break-all' }}>
        {String(value)}
      </span>
    </div>
  )
}

// ── Model Breakdown Table ─────────────────────────────────────────────────────
function ModelBreakdownTable({ breakdown }) {
  if (!breakdown || Object.keys(breakdown).length === 0) return null

  const entries   = Object.entries(breakdown).sort((a, b) => b[1].total_tokens - a[1].total_tokens)
  const maxTokens = Math.max(...entries.map(([, d]) => d.total_tokens), 1)

  const modelColor = (name) => {
    const n = name.toLowerCase()
    if (n.includes('gemini'))            return { bar: '#3b82f6', text: '#93c5fd', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.25)' }
    if (n.includes('deepseek'))          return { bar: '#8b5cf6', text: '#c4b5fd', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.25)' }
    if (n.includes('ollama') || n.includes('hunyuan')) return { bar: '#10b981', text: '#6ee7b7', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.25)' }
    return { bar: '#f59e0b', text: '#fcd34d', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {entries.map(([model, data]) => {
        const clr    = modelColor(model)
        const pct    = Math.round((data.total_tokens / maxTokens) * 100)
        const cost   = data.cost_usd || 0
        const costStr= cost > 0.0001 ? `~$${cost.toFixed(4)}` : cost > 0 ? `~$${cost.toFixed(6)}` : 'free'

        return (
          <div key={model} style={{
            padding: '0.65rem 0.85rem', borderRadius: '10px',
            background: clr.bg, border: `1px solid ${clr.border}`,
          }}>
            {/* Model name + cost */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: clr.bar, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '0.82rem', color: clr.text }}>{model}</span>
              </div>
              <span style={{
                fontSize: '0.72rem', fontWeight: 600, padding: '1px 8px', borderRadius: '99px',
                background: cost > 0 ? 'rgba(251,146,60,0.15)' : 'rgba(16,185,129,0.15)',
                color: cost > 0 ? '#fdba74' : '#6ee7b7',
                border: `1px solid ${cost > 0 ? 'rgba(251,146,60,0.3)' : 'rgba(16,185,129,0.3)'}`,
              }}>
                {costStr}
              </span>
            </div>

            {/* Progress bar */}
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '99px', height: '5px', overflow: 'hidden', marginBottom: '0.5rem' }}>
              <div style={{ height: '100%', borderRadius: '99px', background: clr.bar, width: `${pct}%`, transition: 'width 0.6s ease' }} />
            </div>

            {/* Token stats */}
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span><span style={{ color: clr.text, fontWeight: 600 }}>{fmtTokens(data.total_tokens)}</span> tổng</span>
              <span>↑ {fmtTokens(data.input_tokens)} input</span>
              <span>↓ {fmtTokens(data.output_tokens)} output</span>
              {data.calls > 0 && <span>{data.calls} lần gọi</span>}
              {data.calls > 0 && data.total_tokens > 0 && (
                <span>~{fmtTokens(Math.round(data.total_tokens / data.calls))}/lần</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
