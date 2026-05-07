import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Play, Square, Book, BookOpen, Plus, Trash2, FileText,
  ArrowLeft, AlertTriangle, CheckCircle, RefreshCw, ShieldCheck,
  Zap, Clock, TrendingUp, ChevronDown, ChevronUp, OctagonX,
} from 'lucide-react'
import api from '../api'

const TABS = { CHAPTERS: 'chapters', GLOSSARY: 'glossary', HEALTH: 'health' }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(seconds) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60), s = seconds % 60
  return `${m}m ${s}s`
}

// ─────────────────────────────────────────────────────────────────────────────

export default function NovelDetail() {
  const { slug } = useParams()
  const [novel, setNovel]                   = useState(null)
  const [chapters, setChapters]             = useState([])
  const [translating, setTranslating]       = useState(false)
  const [translateCount, setTranslateCount] = useState(5)
  const [glossary, setGlossary]             = useState([])
  const [newKey, setNewKey]                 = useState('')
  const [newVal, setNewVal]                 = useState('')
  const [taskStatus, setTaskStatus]         = useState(null)
  const [activeTab, setActiveTab]           = useState(TABS.CHAPTERS)
  const [healthData, setHealthData]         = useState(null)
  const [healthLoading, setHealthLoading]   = useState(false)
  const [elapsedSec, setElapsedSec]         = useState(0)
  const startTimeRef                        = useRef(null)
  const timerRef                            = useRef(null)

  useEffect(() => { fetchData(); fetchStatus() }, [slug])

  // Poll khi đang chạy
  useEffect(() => {
    let interval
    if (taskStatus?.status === 'running') {
      interval = setInterval(fetchStatus, 2000)
      // Bắt đầu đếm thời gian nếu chưa có
      if (!startTimeRef.current) startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    } else {
      clearInterval(timerRef.current)
      if (taskStatus?.status !== 'running') startTimeRef.current = null
    }
    return () => { clearInterval(interval); clearInterval(timerRef.current) }
  }, [taskStatus?.status, slug])

  const fetchStatus = async () => {
    try {
      const res = await api.get(`/novels/${slug}/translate/status`)
      setTaskStatus(res.data)
      if (res.data.status === 'finished') { fetchData(); setElapsedSec(0) }
    } catch (err) { console.error(err) }
  }

  const fetchData = async () => {
    try {
      const [nRes, cRes] = await Promise.all([
        api.get(`/novels/${slug}`),
        api.get(`/novels/${slug}/chapters`),
      ])
      setNovel(nRes.data)
      setChapters(cRes.data)
      setGlossary(Object.entries(nRes.data.glossary || {}).map(([k, v]) => ({ key: k, val: v })))
    } catch (err) { console.error(err) }
  }

  const fetchHealth = async () => {
    setHealthLoading(true)
    try {
      const res = await api.get(`/novels/${slug}/health`)
      setHealthData(res.data)
    } catch (err) {
      setHealthData({ error: 'Không thể tải dữ liệu health check.' })
    } finally { setHealthLoading(false) }
  }

  useEffect(() => {
    if (activeTab === TABS.HEALTH && !healthData) fetchHealth()
  }, [activeTab])

  const handleTranslate = async () => {
    if (!translateCount || translateCount < 1) return
    setTranslating(true)
    setElapsedSec(0)
    startTimeRef.current = Date.now()
    try {
      await api.post(`/novels/${slug}/translate`, { chapters: parseInt(translateCount), force: false })
      fetchStatus()
    } catch (err) {
      alert('Không thể bắt đầu dịch. Kiểm tra lại backend.')
    } finally { setTranslating(false) }
  }

  const handleStop = async () => {
    try {
      await api.post(`/novels/${slug}/translate/stop`)
      // Poll nhanh hơn để cập nhật UI
      setTimeout(fetchStatus, 500)
      setTimeout(fetchStatus, 1500)
    } catch (err) {
      console.error('Stop failed:', err)
    }
  }

  const saveGlossary = async (newGlArr) => {
    const glObj = {}
    newGlArr.forEach(item => { if (item.key.trim()) glObj[item.key.trim()] = item.val.trim() })
    try {
      await api.post(`/novels/${slug}/glossary`, { glossary: glObj })
      setGlossary(newGlArr)
    } catch (err) { alert('Không thể lưu glossary.') }
  }

  const addGlossary = () => {
    if (!newKey.trim()) return
    saveGlossary([{ key: newKey, val: newVal }, ...glossary])
    setNewKey(''); setNewVal('')
  }

  const removeGlossary = (idx) => saveGlossary(glossary.filter((_, i) => i !== idx))

  if (!novel) return <div className="container" style={{ paddingTop: '3rem', color: 'var(--text-muted)' }}>Đang tải...</div>

  const isRunning = taskStatus?.status === 'running'

  return (
    <div className="container animate-fade-in">
      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          <ArrowLeft size={15} /> Thư viện
        </Link>
        <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>{novel.title}</h1>
        <p className="page-subtitle">
          {[novel.original_title, novel.author].filter(Boolean).join(' • ')}
          {chapters.length > 0 && <span> — <strong style={{ color: 'var(--accent)' }}>{chapters.length}</strong> chương đã dịch</span>}
        </p>
      </div>

      {/* Main layout */}
      <div className="novel-detail-grid" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem', alignItems: 'start' }}>

        {/* ── Left sidebar ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Translation Panel */}
          <TranslationPanel
            isRunning={isRunning}
            translating={translating}
            translateCount={translateCount}
            setTranslateCount={setTranslateCount}
            taskStatus={taskStatus}
            elapsedSec={elapsedSec}
            onStart={handleTranslate}
            onStop={handleStop}
          />

          {/* Novel info */}
          <div className="glass-panel p-6">
            <h2 style={sectionTitle}><FileText size={18} style={{ color: 'var(--accent)' }} /> Thông tin</h2>
            <InfoRow label="Slug"     value={novel.slug} mono />
            <InfoRow label="Thể loại" value={novel.genre} />
            <InfoRow label="Chương"   value={`${novel.last_chapter_number}${novel.total_chapters ? ' / ' + novel.total_chapters : ''}`} />
            {novel.notes && <InfoRow label="Ghi chú" value={novel.notes} />}
          </div>
        </div>

        {/* ── Right content: tabs ── */}
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-panel)', padding: '0 1.5rem' }}>
            {[
              { id: TABS.CHAPTERS, label: `Chương (${chapters.length})`, icon: <BookOpen size={15} /> },
              { id: TABS.GLOSSARY, label: `Glossary (${glossary.length})`, icon: <Book size={15} /> },
              { id: TABS.HEALTH,   label: 'Kiểm tra', icon: <ShieldCheck size={15} /> },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '0.9rem 1rem', fontSize: '0.88rem', fontWeight: 500,
                background: 'none', border: 'none', cursor: 'pointer',
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: '-1px', transition: 'color 0.2s',
              }}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: '1.5rem' }}>
            {activeTab === TABS.CHAPTERS && <ChaptersTab chapters={chapters} slug={slug} />}
            {activeTab === TABS.GLOSSARY && (
              <GlossaryTab
                glossary={glossary} newKey={newKey} setNewKey={setNewKey}
                newVal={newVal} setNewVal={setNewVal}
                onAdd={addGlossary} onRemove={removeGlossary}
              />
            )}
            {activeTab === TABS.HEALTH && (
              <HealthTab healthData={healthData} loading={healthLoading} onRefresh={fetchHealth} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Translation Panel ─────────────────────────────────────────────────────────

function TranslationPanel({ isRunning, translating, translateCount, setTranslateCount, taskStatus, elapsedSec, onStart, onStop }) {
  const [logsExpanded, setLogsExpanded] = useState(true)
  const logRef = useRef(null)

  const pct          = taskStatus ? Math.min(100, (taskStatus.current / Math.max(taskStatus.total, 1)) * 100) : 0
  const isDone       = taskStatus?.status === 'finished'
  const isError      = taskStatus?.status === 'error'
  const isCancelling = taskStatus?.status === 'cancelling'
  const isCancelled  = taskStatus?.status === 'cancelled'
  const isIdle       = !taskStatus || taskStatus.status === 'idle'

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [taskStatus?.logs])

  // Speed estimate: chapters per minute
  const chapPerMin = elapsedSec > 5 && taskStatus?.current > 0
    ? ((taskStatus.current / elapsedSec) * 60).toFixed(1)
    : null

  // ETA
  const remaining = taskStatus ? taskStatus.total - taskStatus.current : 0
  const eta = chapPerMin && remaining > 0
    ? fmtTime(Math.round((remaining / parseFloat(chapPerMin)) * 60))
    : null

  return (
    <div className="glass-panel" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '1.25rem 1.25rem 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ ...sectionTitle, margin: 0 }}>
            <Zap size={18} style={{ color: 'var(--accent)' }} /> Dịch truyện
          </h2>
          {isRunning && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <Clock size={13} />
              {fmtTime(elapsedSec)}
            </div>
          )}
        </div>

        {/* Input row */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="number" className="input-field"
              value={translateCount}
              onChange={e => setTranslateCount(e.target.value)}
              min="1" max="2500" disabled={isRunning || isCancelling}
              style={{ paddingRight: '2.5rem' }}
            />
            <span style={{
              position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
              fontSize: '0.72rem', color: 'var(--text-muted)', pointerEvents: 'none',
            }}>chương</span>
          </div>

          {/* Start button — ẩn khi đang chạy */}
          {!isRunning && !isCancelling && (
            <button
              className="btn btn-primary"
              onClick={onStart}
              disabled={translating}
              style={{ minWidth: '90px' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Play size={15} fill="currentColor" /> Bắt đầu
              </span>
            </button>
          )}

          {/* Stop button — hiện khi đang chạy */}
          {(isRunning || isCancelling) && (
            <button
              onClick={isCancelling ? undefined : onStop}
              disabled={isCancelling}
              style={{
                minWidth: '90px', padding: '10px 16px', borderRadius: '10px',
                display: 'flex', alignItems: 'center', gap: '6px',
                border: 'none', cursor: isCancelling ? 'not-allowed' : 'pointer',
                background: isCancelling ? 'rgba(251,146,60,0.15)' : 'rgba(239,68,68,0.15)',
                color: isCancelling ? '#fdba74' : '#fca5a5',
                fontWeight: 500, fontSize: '0.9rem', transition: 'all 0.2s',
              }}
              onMouseEnter={e => { if (!isCancelling) e.currentTarget.style.background = 'rgba(239,68,68,0.25)' }}
              onMouseLeave={e => { if (!isCancelling) e.currentTarget.style.background = 'rgba(239,68,68,0.15)' }}
            >
              {isCancelling ? (
                <><SpinnerIcon /> Đang dừng</>
              ) : (
                <><OctagonX size={15} /> Dừng</>
              )}
            </button>
          )}
        </div>

        {/* Stats row khi đang chạy */}
        {isRunning && chapPerMin && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <MiniStat icon={<TrendingUp size={12} />} label="Tốc độ" value={`${chapPerMin} ch/phút`} />
            {eta && <MiniStat icon={<Clock size={12} />} label="Còn lại" value={eta} />}
          </div>
        )}
      </div>

      {/* Progress section */}
      {taskStatus && taskStatus.status !== 'idle' && (
        <div style={{ padding: '0 1.25rem 1.25rem' }}>

          {/* Status badge + counter */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
            <StatusBadge status={taskStatus.status} />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: isDone ? '#6ee7b7' : isError ? '#fca5a5' : 'var(--text-main)' }}>
              {taskStatus.current}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {taskStatus.total}</span>
            </span>
          </div>

          {/* Progress bar */}
          <div style={{
            background: 'rgba(255,255,255,0.08)', borderRadius: '99px',
            height: '8px', overflow: 'hidden', marginBottom: '0.5rem',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)',
          }}>
            <div style={{
              height: '100%', borderRadius: '99px',
              background: isError      ? 'linear-gradient(90deg,#ef4444,#dc2626)'
                : isDone               ? 'linear-gradient(90deg,#10b981,#059669)'
                : isCancelled          ? 'linear-gradient(90deg,#f59e0b,#d97706)'
                : isCancelling         ? 'linear-gradient(90deg,#fb923c,#f59e0b)'
                                       : 'linear-gradient(90deg,#3b82f6,#8b5cf6)',
              width: `${pct}%`,
              transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
              boxShadow: (isError || isCancelled || isCancelling) ? 'none'
                : isDone ? '0 0 8px rgba(16,185,129,0.5)'
                         : '0 0 8px rgba(59,130,246,0.5)',
            }} />
          </div>

          {/* Percent */}
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            {pct.toFixed(0)}%
          </div>

          {/* Success banner */}
          {isDone && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '0.7rem 0.9rem', borderRadius: '8px',
              background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
              color: '#6ee7b7', fontSize: '0.875rem', marginBottom: '0.75rem',
            }}>
              <CheckCircle size={16} />
              Dịch xong {taskStatus.current} chương thành công!
            </div>
          )}

          {/* Cancelled banner */}
          {(isCancelled || isCancelling) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '0.7rem 0.9rem', borderRadius: '8px',
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
              color: '#fcd34d', fontSize: '0.875rem', marginBottom: '0.75rem',
            }}>
              <OctagonX size={16} />
              {isCancelling
                ? 'Đang dừng — chờ batch hiện tại hoàn thành...'
                : `Đã dừng — ${taskStatus.current} chương đã được lưu`}
            </div>
          )}

          {/* Error banner */}
          {isError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '0.7rem 0.9rem', borderRadius: '8px',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
              color: '#fca5a5', fontSize: '0.875rem', marginBottom: '0.75rem',
            }}>
              <AlertTriangle size={16} />
              Có lỗi xảy ra — xem log bên dưới để biết chi tiết
            </div>
          )}

          {/* Log terminal */}
          {(taskStatus.logs || []).length > 0 && (
            <div>
              <button
                onClick={() => setLogsExpanded(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: '0.75rem', padding: '0 0 0.4rem',
                }}
              >
                {logsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                Log ({taskStatus.logs.length})
              </button>

              {logsExpanded && (
                <div
                  ref={logRef}
                  style={{
                    background: 'rgba(0,0,0,0.4)', borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.06)',
                    padding: '0.6rem 0.75rem',
                    maxHeight: '160px', overflowY: 'auto',
                    fontFamily: 'monospace', fontSize: '0.72rem',
                    lineHeight: '1.6',
                  }}
                >
                  {(taskStatus.logs || []).map((log, i) => {
                    const isErr = log.includes('Lỗi') || log.includes('error') || log.includes('Error')
                    const isOk  = log.includes('Đã lưu') || log.includes('thành công') || log.includes('✓')
                    return (
                      <div key={i} style={{
                        color: isErr ? '#fca5a5' : isOk ? '#6ee7b7' : '#9ca3af',
                        paddingBottom: '2px', marginBottom: '2px',
                        borderBottom: i < taskStatus.logs.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                      }}>
                        <span style={{ color: 'rgba(255,255,255,0.2)', marginRight: '6px', userSelect: 'none' }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {log}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Idle hint */}
      {isIdle && (
        <div style={{ padding: '0 1.25rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Nhập số chương và nhấn Bắt đầu để dịch tiếp.
        </div>
      )}
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
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

function MiniStat({ icon, label, value }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', gap: '5px',
      padding: '5px 8px', borderRadius: '6px',
      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-panel)',
      fontSize: '0.72rem', color: 'var(--text-muted)',
    }}>
      <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{icon}</span>
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  )
}

// ── Chapters Tab ──────────────────────────────────────────────────────────────

function ChaptersTab({ chapters, slug }) {
  if (chapters.length === 0) {
    return <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>Chưa có chương nào được dịch.</div>
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem' }}>
      {chapters.map(chap => (
        <Link
          key={chap.filename}
          to={`/novel/${slug}/read/${encodeURIComponent(chap.filename)}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '0.65rem 0.85rem', borderRadius: '8px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border-panel)',
            color: 'var(--text-main)', fontSize: '0.875rem',
            transition: 'background 0.15s, border-color 0.15s',
            overflow: 'hidden', textDecoration: 'none',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.08)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'var(--border-panel)' }}
        >
          <BookOpen size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chap.title}</span>
        </Link>
      ))}
    </div>
  )
}

// ── Glossary Tab ──────────────────────────────────────────────────────────────

function GlossaryTab({ glossary, newKey, setNewKey, newVal, setNewVal, onAdd, onRemove }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Hán tự (tiếng Trung)" className="input-field"
          value={newKey} onChange={e => setNewKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd()} style={{ flex: '1 1 140px' }} />
        <input type="text" placeholder="Tiếng Việt" className="input-field"
          value={newVal} onChange={e => setNewVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd()} style={{ flex: '1 1 140px' }} />
        <button className="btn btn-primary" onClick={onAdd} style={{ padding: '10px 14px' }}>
          <Plus size={18} />
        </button>
      </div>
      {glossary.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>Chưa có entry nào.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
          {glossary.map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.6rem 0.85rem', borderRadius: '8px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-panel)', gap: '0.5rem',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.key}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{item.val}</div>
              </div>
              <button className="btn btn-danger" onClick={() => onRemove(i)} style={{ padding: '5px 8px', flexShrink: 0 }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Health Tab ────────────────────────────────────────────────────────────────

function HealthTab({ healthData, loading, onRefresh }) {
  if (loading) return (
    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
      <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', display: 'inline' }} />
      <span style={{ marginLeft: '8px' }}>Đang kiểm tra...</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
  if (!healthData) return (
    <div style={{ textAlign: 'center', padding: '3rem 0' }}>
      <button className="btn btn-primary" onClick={onRefresh}><ShieldCheck size={18} /> Kiểm tra ngay</button>
    </div>
  )
  if (healthData.error) return (
    <div style={{ color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <AlertTriangle size={18} /> {healthData.error}
    </div>
  )
  const { summary, issues } = healthData
  const hasIssues = issues && issues.length > 0
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <StatBadge label="Raw"      value={summary?.total_raw ?? 0}        color="var(--text-muted)" />
        <StatBadge label="Đã dịch"  value={summary?.total_translated ?? 0} color="var(--success)" />
        <StatBadge label="Còn thiếu" value={summary?.missing ?? 0}         color={summary?.missing > 0 ? '#fb923c' : 'var(--success)'} />
        <StatBadge label="Bị lỗi"   value={summary?.failed ?? 0}           color={summary?.failed > 0 ? '#fca5a5' : 'var(--success)'} />
        <button className="btn btn-secondary" onClick={onRefresh} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 12px' }}>
          <RefreshCw size={14} /> Làm mới
        </button>
      </div>
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
            const isFailed = issue.type === 'failed'
            const bgColor = isFailed ? 'rgba(239,68,68,0.08)' : 'rgba(251,146,60,0.08)'
            const borderColor = isFailed ? 'rgba(239,68,68,0.25)' : 'rgba(251,146,60,0.25)'
            const iconColor = isFailed ? '#fca5a5' : '#fdba74'
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '0.7rem 1rem', borderRadius: '8px', background: bgColor, border: `1px solid ${borderColor}` }}>
                <AlertTriangle size={16} style={{ color: iconColor, flexShrink: 0, marginTop: '2px' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.filename}</div>
                  {issue.detail && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{issue.detail}</div>}
                </div>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: borderColor, color: iconColor, flexShrink: 0, alignSelf: 'center' }}>
                  {isFailed ? 'Lỗi dịch' : 'Chưa dịch'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tiny shared components ────────────────────────────────────────────────────

function StatBadge({ label, value, color }) {
  return (
    <div style={{ padding: '0.4rem 0.85rem', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-panel)', textAlign: 'center', minWidth: '72px' }}>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function InfoRow({ label, value, mono }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

const sectionTitle = {
  fontSize: '1rem', fontWeight: 600, marginBottom: '1rem',
  display: 'flex', alignItems: 'center', gap: '8px',
}
