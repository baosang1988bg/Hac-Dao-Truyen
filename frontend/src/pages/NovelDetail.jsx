import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Play, Square, Book, BookOpen, Plus, Trash2, FileText,
  ArrowLeft, AlertTriangle, CheckCircle, RefreshCw, ShieldCheck,
  Zap, Clock, TrendingUp, ChevronDown, ChevronUp, OctagonX,
  Search, ArrowUpDown, Sparkles
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
  const [logsExpanded, setLogsExpanded] = useState(false)
  const logRef = useRef(null)

  const pct          = taskStatus ? Math.min(100, (taskStatus.current / Math.max(taskStatus.total, 1)) * 100) : 0
  const scrapedPct   = taskStatus ? Math.min(100, ((taskStatus.scraped_count || 0) / Math.max(taskStatus.total, 1)) * 100) : 0
  const isDone       = taskStatus?.status === 'finished'
  const isError      = taskStatus?.status === 'error'
  const isCancelling = taskStatus?.status === 'cancelling'
  const isCancelled  = taskStatus?.status === 'cancelled'
  const isIdle       = !taskStatus || taskStatus.status === 'idle'
  const activeBatches = taskStatus?.active_batches || 0
  const scrapedCount  = taskStatus?.scraped_count  || 0

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
              <Clock size={13} /> {fmtTime(elapsedSec)}
            </div>
          )}
        </div>

        {/* Input + buttons */}
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

          {!isRunning && !isCancelling && (
            <button className="btn btn-primary" onClick={onStart} disabled={translating} style={{ minWidth: '90px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Play size={15} fill="currentColor" /> Bắt đầu
              </span>
            </button>
          )}
          {(isRunning || isCancelling) && (
            <button
              onClick={isCancelling ? undefined : onStop} disabled={isCancelling}
              style={{
                minWidth: '90px', padding: '10px 16px', borderRadius: '10px',
                display: 'flex', alignItems: 'center', gap: '6px', border: 'none',
                cursor: isCancelling ? 'not-allowed' : 'pointer',
                background: isCancelling ? 'rgba(251,146,60,0.15)' : 'rgba(239,68,68,0.15)',
                color: isCancelling ? '#fdba74' : '#fca5a5',
                fontWeight: 500, fontSize: '0.9rem', transition: 'all 0.2s',
              }}
              onMouseEnter={e => { if (!isCancelling) e.currentTarget.style.background = 'rgba(239,68,68,0.25)' }}
              onMouseLeave={e => { if (!isCancelling) e.currentTarget.style.background = 'rgba(239,68,68,0.15)' }}
            >
              {isCancelling ? <><SpinnerIcon /> Đang dừng</> : <><OctagonX size={15} /> Dừng</>}
            </button>
          )}
        </div>

        {/* Speed stats */}
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

          {/* Status + counter */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <StatusBadge status={taskStatus.status} />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: isDone ? '#6ee7b7' : isError ? '#fca5a5' : 'var(--text-main)' }}>
              {taskStatus.current}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {taskStatus.total}</span>
            </span>
          </div>

          {/* ── Parallel pipeline visualization ── */}
          {isRunning && (
            <div style={{ marginBottom: '1rem' }}>
              {/* Pipeline stages */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 8px 1fr 8px 1fr', alignItems: 'center', gap: '4px', marginBottom: '0.65rem' }}>
                {/* Stage: Crawl */}
                <PipelineStage
                  label="Cào nội dung"
                  value={scrapedCount}
                  total={taskStatus.total}
                  active={isRunning && scrapedCount < taskStatus.total}
                  color="#10b981"
                  icon="🌐"
                />
                {/* Arrow */}
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '10px' }}>›</div>
                {/* Stage: Translating (parallel batches) */}
                <PipelineStage
                  label={activeBatches > 1 ? `Dịch song song ×${activeBatches}` : 'Dịch'}
                  value={taskStatus.current}
                  total={scrapedCount || taskStatus.total}
                  active={activeBatches > 0}
                  color={activeBatches > 1 ? '#8b5cf6' : '#3b82f6'}
                  icon={activeBatches > 1 ? '⚡' : '🔤'}
                  highlight={activeBatches > 1}
                />
                {/* Arrow */}
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '10px' }}>›</div>
                {/* Stage: Saved */}
                <PipelineStage
                  label="Đã lưu"
                  value={taskStatus.current}
                  total={taskStatus.total}
                  active={false}
                  color="#6ee7b7"
                  icon="✓"
                />
              </div>

              {/* Parallel batch indicators */}
              {activeBatches > 0 && (
                <div style={{ marginBottom: '0.6rem' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Luồng đang chạy:
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {Array.from({ length: activeBatches }).map((_, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: '4px',
                        padding: '3px 8px', borderRadius: '6px', fontSize: '0.7rem',
                        background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)',
                        color: '#c4b5fd',
                      }}>
                        <span style={{
                          width: '6px', height: '6px', borderRadius: '50%',
                          background: '#8b5cf6', display: 'inline-block', flexShrink: 0,
                          animation: 'pulse-dot 1.2s infinite',
                          animationDelay: `${i * 0.3}s`,
                        }} />
                        Batch {i + 1}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Main progress bar (translated) */}
          <div style={{ marginBottom: '0.4rem' }}>
            {/* Dual-layer bar: scraped (bg) + translated (fg) */}
            <div style={{
              position: 'relative', background: 'rgba(255,255,255,0.06)',
              borderRadius: '99px', height: '8px', overflow: 'hidden',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)',
            }}>
              {/* Scraped layer (lighter, behind) */}
              {isRunning && scrapedPct > pct && (
                <div style={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  borderRadius: '99px', background: 'rgba(16,185,129,0.2)',
                  width: `${scrapedPct}%`, transition: 'width 0.4s ease',
                }} />
              )}
              {/* Translated layer (solid, front) */}
              <div style={{
                position: 'absolute', left: 0, top: 0, height: '100%',
                borderRadius: '99px',
                background: isError     ? 'linear-gradient(90deg,#ef4444,#dc2626)'
                  : isDone              ? 'linear-gradient(90deg,#10b981,#059669)'
                  : isCancelled         ? 'linear-gradient(90deg,#f59e0b,#d97706)'
                  : isCancelling        ? 'linear-gradient(90deg,#fb923c,#f59e0b)'
                  : activeBatches > 1   ? 'linear-gradient(90deg,#8b5cf6,#3b82f6)'
                                        : 'linear-gradient(90deg,#3b82f6,#8b5cf6)',
                width: `${pct}%`,
                transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
                boxShadow: isDone ? '0 0 8px rgba(16,185,129,0.5)'
                  : activeBatches > 1 ? '0 0 10px rgba(139,92,246,0.6)'
                  : '0 0 8px rgba(59,130,246,0.5)',
              }} />
            </div>
          </div>

          {/* Percent + scraped label */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            <span style={{ color: isRunning && scrapedCount > taskStatus.current ? '#10b981' : 'transparent', fontSize: '0.68rem' }}>
              {isRunning && scrapedCount > taskStatus.current ? `Đã cào: ${scrapedCount}` : ''}
            </span>
            <span>{pct.toFixed(0)}%</span>
          </div>

          {/* Banners */}
          {isDone && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '0.7rem 0.9rem',
              borderRadius: '8px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
              color: '#6ee7b7', fontSize: '0.875rem', marginBottom: '0.75rem',
            }}>
              <CheckCircle size={16} />
              Dịch xong {taskStatus.current} chương thành công!
            </div>
          )}
          {(isCancelled || isCancelling) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '0.7rem 0.9rem',
              borderRadius: '8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
              color: '#fcd34d', fontSize: '0.875rem', marginBottom: '0.75rem',
            }}>
              <OctagonX size={16} />
              {isCancelling ? 'Đang dừng — chờ batch hiện tại hoàn thành...' : `Đã dừng — ${taskStatus.current} chương đã được lưu`}
            </div>
          )}
          {isError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '0.7rem 0.9rem',
              borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
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
                <div ref={logRef} style={{
                  background: 'rgba(0,0,0,0.4)', borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.06)',
                  padding: '0.6rem 0.75rem', maxHeight: '160px', overflowY: 'auto',
                  fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: '1.6',
                }}>
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

// ── Pipeline Stage component ───────────────────────────────────────────────────
function PipelineStage({ label, value, total, active, color, icon, highlight }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div style={{
      padding: '7px 10px', borderRadius: '8px',
      background: highlight
        ? 'rgba(139,92,246,0.1)' : active
        ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${highlight ? 'rgba(139,92,246,0.3)' : 'var(--border-panel)'}`,
      transition: 'all 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
        <span style={{ fontSize: '0.68rem', color: active ? color : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>
          {icon} {label}
        </span>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {value}/{total}
        </span>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '99px', height: '3px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: '99px',
          background: color, width: `${pct}%`,
          transition: 'width 0.5s ease',
          boxShadow: active ? `0 0 6px ${color}80` : 'none',
        }} />
      </div>
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
  const [searchTerm, setSearchTerm] = useState('')
  const [sortDesc, setSortDesc] = useState(true)

  if (chapters.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
        Chưa có chương nào được dịch.
      </div>
    )
  }

  // Top 7 newest chapters (horizontal scroll strip)
  const newestChapters = [...chapters].reverse().slice(0, 7)

  // Filter & Sort
  let displayChapters = chapters.filter(chap =>
    chap.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    chap.filename.toLowerCase().includes(searchTerm.toLowerCase())
  )
  if (sortDesc) displayChapters = [...displayChapters].reverse()

  // Extract chapter number from title for display
  const getChapNum = (title) => {
    const m = title.match(/第(\d+)章|[Cc]hapter\s*(\d+)|Chương\s*(\d+)|(\d+)\./)
    return m ? (m[1] || m[2] || m[3] || m[4]) : null
  }

  return (
    <div>
      {/* ── Recently Updated Strip ── */}
      {!searchTerm && newestChapters.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            marginBottom: '0.75rem',
            fontSize: '0.78rem', fontWeight: 600,
            color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            <Sparkles size={13} style={{ color: 'var(--accent)' }} />
            Mới cập nhật
          </div>
          {/* Horizontal scroll strip */}
          <div style={{
            display: 'flex', gap: '0.5rem',
            overflowX: 'auto', paddingBottom: '6px',
            scrollbarWidth: 'none', msOverflowStyle: 'none',
          }}>
            {newestChapters.map((chap) => {
              const num = getChapNum(chap.title)
              return (
                <Link
                  key={`new-${chap.filename}`}
                  to={`/novel/${slug}/read/${encodeURIComponent(chap.filename)}`}
                  style={{
                    flexShrink: 0,
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '10px', minWidth: '120px', maxWidth: '160px',
                    background: 'rgba(59,130,246,0.08)',
                    border: '1px solid rgba(59,130,246,0.2)',
                    color: 'var(--text-main)',
                    textDecoration: 'none',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.16)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.4)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.08)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.2)' }}
                >
                  {num && (
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.04em' }}>
                      CH. {num}
                    </span>
                  )}
                  <span style={{
                    fontSize: '0.8rem', lineHeight: '1.3',
                    display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {chap.title.replace(/第\d+章\s*/, '').replace(/Chapter\s*\d+[\s:.]*/i, '').trim() || chap.title}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Toolbar: Search + Stats + Sort ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        marginBottom: '1rem', flexWrap: 'wrap',
      }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: '0' }}>
          <Search size={14} style={{
            position: 'absolute', left: '10px', top: '50%',
            transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none',
          }} />
          <input
            type="text"
            className="input-field"
            placeholder="Tìm chương..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '32px', fontSize: '0.875rem', height: '36px' }}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} style={{
              position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '2px', lineHeight: 1,
            }}>✕</button>
          )}
        </div>

        {/* Chapter count */}
        <span style={{
          fontSize: '0.78rem', color: 'var(--text-muted)',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {searchTerm
            ? <>{displayChapters.length} <span style={{ opacity: 0.6 }}>/ {chapters.length}</span></>
            : <><strong style={{ color: 'var(--text-main)' }}>{chapters.length}</strong> chương</>
          }
        </span>

        {/* Sort toggle */}
        <button
          onClick={() => setSortDesc(!sortDesc)}
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px',
            padding: '0 10px', height: '36px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-panel)',
            color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: 500, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--text-main)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <ArrowUpDown size={13} />
          {sortDesc ? 'Mới → Cũ' : 'Cũ → Mới'}
        </button>
      </div>

      {/* ── Chapter List ── */}
      {displayChapters.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem 0' }}>
          Không tìm thấy chương phù hợp.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {displayChapters.map((chap, idx) => {
            const num = getChapNum(chap.title)
            const cleanTitle = chap.title
              .replace(/第\d+章\s*/, '')
              .replace(/Chapter\s*\d+[\s:.]*/i, '')
              .trim() || chap.title

            return (
              <Link
                key={chap.filename}
                to={`/novel/${slug}/read/${encodeURIComponent(chap.filename)}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '0.55rem 0.75rem', borderRadius: '8px',
                  color: 'var(--text-main)',
                  textDecoration: 'none', transition: 'background 0.12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {/* Chapter number badge */}
                <span style={{
                  flexShrink: 0, minWidth: '42px', textAlign: 'right',
                  fontSize: '0.72rem', fontWeight: 600,
                  color: num ? 'var(--accent)' : 'var(--text-muted)',
                  opacity: num ? 0.85 : 0.5,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {num ? `#${num}` : `—`}
                </span>

                {/* Divider */}
                <span style={{ width: '1px', height: '14px', background: 'var(--border-panel)', flexShrink: 0 }} />

                {/* Title */}
                <span style={{
                  flex: 1, fontSize: '0.875rem',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {cleanTitle}
                </span>

                {/* Arrow */}
                <span style={{ color: 'var(--text-muted)', opacity: 0.4, flexShrink: 0, fontSize: '0.75rem' }}>›</span>
              </Link>
            )
          })}
        </div>
      )}
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
