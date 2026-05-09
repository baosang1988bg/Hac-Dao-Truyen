import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Play, Square, Book, BookOpen, Plus, Trash2, FileText,
  ArrowLeft, AlertTriangle, CheckCircle, RefreshCw, ShieldCheck,
  Zap, Clock, TrendingUp, ChevronDown, ChevronUp, OctagonX,
  Search, ArrowUpDown, Sparkles
} from 'lucide-react'
import api from '../api'

const TABS = { CHAPTERS: 'chapters', GLOSSARY: 'glossary', HEALTH: 'health', TOOLS: 'tools' }

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
              { id: TABS.TOOLS,    label: 'Tính năng', icon: <Zap size={15} /> },
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
              <HealthTab healthData={healthData} loading={healthLoading} onRefresh={fetchHealth} slug={slug} />
            )}
            {activeTab === TABS.TOOLS && <ToolsTab slug={slug} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Translation Panel ─────────────────────────────────────────────────────────

function TranslationPanel({ isRunning, translating, translateCount, setTranslateCount, taskStatus, elapsedSec, onStart, onStop }) {
  const [logsExpanded, setLogsExpanded] = useState(false)
  const logRef     = useRef(null)
  const feedRef    = useRef(null)

  const pct          = taskStatus ? Math.min(100, (taskStatus.current / Math.max(taskStatus.total, 1)) * 100) : 0
  const scrapedPct   = taskStatus ? Math.min(100, ((taskStatus.scraped_count || 0) / Math.max(taskStatus.total, 1)) * 100) : 0
  const isDone       = taskStatus?.status === 'finished'
  const isError      = taskStatus?.status === 'error'
  const isCancelling = taskStatus?.status === 'cancelling'
  const isCancelled  = taskStatus?.status === 'cancelled'
  const isIdle       = !taskStatus || taskStatus.status === 'idle'
  const activeBatches  = taskStatus?.active_batches  || 0
  const scrapedCount   = taskStatus?.scraped_count   || 0
  const chaptersOk     = taskStatus?.chapters_ok     || []
  const chaptersFail   = taskStatus?.chapters_fail   || []
  const batchDetails   = taskStatus?.batch_details   || []
  const tokensUsed     = taskStatus?.tokens_used     || 0
  const costSoFar      = taskStatus?.cost_so_far     || 0
  const currentModel   = taskStatus?.current_model   || ''
  const currentChapter = taskStatus?.current_chapter || ''
  const crawlingChap   = taskStatus?.crawling_chapter|| ''

  // Auto-scroll
  useEffect(() => {
    if (logRef.current)  logRef.current.scrollTop  = logRef.current.scrollHeight
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [taskStatus?.logs, chaptersOk.length, chaptersFail.length])

  // Speed & ETA
  const chapPerMin = elapsedSec > 5 && taskStatus?.current > 0
    ? ((taskStatus.current / elapsedSec) * 60).toFixed(1) : null
  const remaining = taskStatus ? taskStatus.total - taskStatus.current : 0
  const eta = chapPerMin && remaining > 0
    ? fmtTime(Math.round((remaining / parseFloat(chapPerMin)) * 60)) : null

  // Model color helper
  const modelColor = (m = '') => {
    const n = m.toLowerCase()
    if (n.includes('gemini'))   return { text: '#93c5fd', bg: 'rgba(59,130,246,0.15)',  dot: '#3b82f6' }
    if (n.includes('deepseek')) return { text: '#c4b5fd', bg: 'rgba(139,92,246,0.15)', dot: '#8b5cf6' }
    if (n.includes('ollama') || n.includes('hunyuan')) return { text: '#6ee7b7', bg: 'rgba(16,185,129,0.15)', dot: '#10b981' }
    return { text: 'var(--text-muted)', bg: 'rgba(255,255,255,0.06)', dot: '#6b7280' }
  }
  const mc = modelColor(currentModel)

  return (
    <div className="glass-panel" style={{ overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '1.1rem 1.1rem 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.9rem' }}>
          <h2 style={{ ...sectionTitle, margin: 0, fontSize: '0.95rem' }}>
            <Zap size={16} style={{ color: 'var(--accent)' }} /> Dịch truyện
          </h2>
          {isRunning && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Live model badge */}
              {currentModel && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: '99px',
                  background: mc.bg, color: mc.text,
                  border: `1px solid ${mc.dot}44`,
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: mc.dot, animation: 'pulse-dot 1.5s infinite', display: 'inline-block' }} />
                  {currentModel.length > 22 ? currentModel.slice(0, 22) + '…' : currentModel}
                </span>
              )}
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={11} /> {fmtTime(elapsedSec)}
              </span>
            </div>
          )}
        </div>

        {/* Input + buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.7rem' }}>
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
            <button className="btn btn-primary" onClick={onStart} disabled={translating} style={{ minWidth: '86px' }}>
              <Play size={14} fill="currentColor" /> Bắt đầu
            </button>
          )}
          {(isRunning || isCancelling) && (
            <button
              onClick={isCancelling ? undefined : onStop} disabled={isCancelling}
              style={{
                minWidth: '86px', padding: '10px 14px', borderRadius: '10px',
                display: 'flex', alignItems: 'center', gap: '6px', border: 'none',
                cursor: isCancelling ? 'not-allowed' : 'pointer',
                background: isCancelling ? 'rgba(251,146,60,0.15)' : 'rgba(239,68,68,0.15)',
                color: isCancelling ? '#fdba74' : '#fca5a5',
                fontWeight: 500, fontSize: '0.88rem', transition: 'all 0.2s',
              }}
              onMouseEnter={e => { if (!isCancelling) e.currentTarget.style.background = 'rgba(239,68,68,0.25)' }}
              onMouseLeave={e => { if (!isCancelling) e.currentTarget.style.background = 'rgba(239,68,68,0.15)' }}
            >
              {isCancelling ? <><SpinnerIcon /> Đang dừng</> : <><OctagonX size={14} /> Dừng</>}
            </button>
          )}
        </div>

        {/* ── Speed row ── */}
        {isRunning && (
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
            {chapPerMin && <MiniStat icon={<TrendingUp size={11} />} label="Tốc độ" value={`${chapPerMin} ch/phút`} />}
            {eta         && <MiniStat icon={<Clock size={11} />}      label="Còn lại" value={eta} />}
            {tokensUsed > 0 && <MiniStat icon={<span style={{fontSize:'0.7rem'}}>⚡</span>} label="Tokens" value={tokensUsed >= 1000 ? `${(tokensUsed/1000).toFixed(1)}K` : tokensUsed} />}
            {costSoFar  > 0 && <MiniStat icon={<span style={{fontSize:'0.7rem'}}>💰</span>} label="Chi phí" value={`$${costSoFar.toFixed(4)}`} color="#fb923c" />}
          </div>
        )}
      </div>

      {/* ── Active section ── */}
      {taskStatus && taskStatus.status !== 'idle' && (
        <div style={{ padding: '0 1.1rem 1.1rem' }}>

          {/* Status row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.7rem' }}>
            <StatusBadge status={taskStatus.status} />
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isDone ? '#6ee7b7' : isError ? '#fca5a5' : 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
              {taskStatus.current}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {taskStatus.total}</span>
            </span>
          </div>

          {/* ── Progress bar (dual-layer) ── */}
          <div style={{ marginBottom: '0.35rem' }}>
            <div style={{
              position: 'relative', background: 'rgba(255,255,255,0.06)',
              borderRadius: '99px', height: '7px', overflow: 'hidden',
            }}>
              {isRunning && scrapedPct > pct && (
                <div style={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  background: 'rgba(16,185,129,0.18)', width: `${scrapedPct}%`,
                  borderRadius: '99px', transition: 'width 0.4s ease',
                }} />
              )}
              <div style={{
                position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: '99px',
                background: isError   ? 'linear-gradient(90deg,#ef4444,#dc2626)'
                  : isDone            ? 'linear-gradient(90deg,#10b981,#059669)'
                  : isCancelled       ? 'linear-gradient(90deg,#f59e0b,#d97706)'
                  : isCancelling      ? 'linear-gradient(90deg,#fb923c,#f59e0b)'
                  : activeBatches > 1 ? 'linear-gradient(90deg,#8b5cf6,#3b82f6)'
                                      : 'linear-gradient(90deg,#3b82f6,#8b5cf6)',
                width: `${pct}%`,
                transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
                boxShadow: isDone ? '0 0 8px rgba(16,185,129,0.4)'
                  : activeBatches > 1 ? '0 0 8px rgba(139,92,246,0.5)'
                  : '0 0 6px rgba(59,130,246,0.4)',
              }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
            <span style={{ color: isRunning && scrapedCount > taskStatus.current ? '#10b981' : 'transparent' }}>
              Đã cào: {scrapedCount}
            </span>
            <span style={{ fontWeight: 600 }}>{pct.toFixed(0)}%</span>
          </div>

          {/* ── ADMIN LIVE DASHBOARD (chỉ hiển thị khi đang chạy) ── */}
          {isRunning && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.9rem' }}>

              {/* Crawl + Chapter đang xử lý */}
              <div style={{
                padding: '0.6rem 0.8rem', borderRadius: '9px',
                background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.18)',
              }}>
                <div style={{ fontSize: '0.63rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                  🌐 Đang crawl
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {crawlingChap || <span style={{ color: 'var(--text-muted)' }}>Chờ...</span>}
                </div>
              </div>

              {/* Active batches với detail */}
              {batchDetails.length > 0 && (
                <div style={{
                  padding: '0.6rem 0.8rem', borderRadius: '9px',
                  background: activeBatches > 1 ? 'rgba(139,92,246,0.07)' : 'rgba(59,130,246,0.07)',
                  border: `1px solid ${activeBatches > 1 ? 'rgba(139,92,246,0.2)' : 'rgba(59,130,246,0.18)'}`,
                }}>
                  <div style={{ fontSize: '0.63rem', fontWeight: 700, color: activeBatches > 1 ? '#c4b5fd' : '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                    ⚡ Đang dịch {activeBatches > 1 ? `(${activeBatches} luồng song song)` : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {batchDetails.slice(-activeBatches || -3).map((bd, i) => {
                      const bmc = modelColor(bd.model)
                      return (
                        <div key={bd.id || i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem' }}>
                          {/* Pulsing dot */}
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                            background: bmc.dot, display: 'inline-block',
                            animation: 'pulse-dot 1.2s infinite', animationDelay: `${i * 0.25}s`,
                          }} />
                          {/* Chapters in batch */}
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-main)' }}>
                            {(bd.chapters || []).join(' · ')}
                          </span>
                          {/* Model */}
                          {bd.model && bd.model !== '...' && (
                            <span style={{ color: bmc.text, fontSize: '0.65rem', fontWeight: 600, flexShrink: 0 }}>
                              {bd.model.length > 18 ? bd.model.slice(0, 18) + '…' : bd.model}
                            </span>
                          )}
                          {/* Tokens */}
                          {bd.tokens > 0 && (
                            <span style={{ color: '#fbbf24', fontSize: '0.65rem', flexShrink: 0 }}>
                              {bd.tokens >= 1000 ? `${(bd.tokens/1000).toFixed(1)}K` : bd.tokens}tok
                            </span>
                          )}
                          {/* Cost */}
                          {bd.cost > 0 && (
                            <span style={{ color: '#fb923c', fontSize: '0.65rem', flexShrink: 0 }}>
                              ${bd.cost.toFixed(4)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Chapter result feed */}
              {(chaptersOk.length > 0 || chaptersFail.length > 0) && (
                <div style={{
                  padding: '0.6rem 0.8rem', borderRadius: '9px',
                  background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border-panel)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <div style={{ fontSize: '0.63rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      📄 Kết quả chương
                    </div>
                    <div style={{ display: 'flex', gap: '8px', fontSize: '0.68rem' }}>
                      <span style={{ color: '#6ee7b7', fontWeight: 700 }}>✓ {chaptersOk.length}</span>
                      {chaptersFail.length > 0 && <span style={{ color: '#fca5a5', fontWeight: 700 }}>✗ {chaptersFail.length}</span>}
                    </div>
                  </div>
                  <div ref={feedRef} style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {/* Hiện 8 chương mới nhất */}
                    {[...chaptersOk.map(c => ({c, ok: true})), ...chaptersFail.map(c => ({c, ok: false}))]
                      .sort((a,b) => 0) // giữ thứ tự gốc
                      .slice(-8)
                      .map(({c, ok}, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: '5px',
                        fontSize: '0.7rem', padding: '1px 0',
                      }}>
                        <span style={{ color: ok ? '#6ee7b7' : '#fca5a5', flexShrink: 0, fontSize: '0.65rem' }}>
                          {ok ? '✓' : '✗'}
                        </span>
                        <span style={{
                          color: ok ? 'var(--text-main)' : '#fca5a5',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                        }}>
                          {c}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Banners ── */}
          {isDone && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '0.65rem 0.85rem',
              borderRadius: '8px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
              color: '#6ee7b7', fontSize: '0.83rem', marginBottom: '0.7rem',
            }}>
              <CheckCircle size={15} />
              <div>
                <div style={{ fontWeight: 600 }}>Dịch xong {taskStatus.current} chương!</div>
                {(chaptersFail.length > 0) && (
                  <div style={{ fontSize: '0.72rem', color: '#fca5a5', marginTop: '2px' }}>
                    {chaptersFail.length} chương thất bại — chạy fix_chapters để sửa
                  </div>
                )}
                {costSoFar > 0 && (
                  <div style={{ fontSize: '0.72rem', color: '#fbbf24', marginTop: '2px' }}>
                    Tổng chi phí: ${costSoFar.toFixed(5)}
                  </div>
                )}
              </div>
            </div>
          )}
          {(isCancelled || isCancelling) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '0.65rem 0.85rem',
              borderRadius: '8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
              color: '#fcd34d', fontSize: '0.83rem', marginBottom: '0.7rem',
            }}>
              <OctagonX size={15} />
              {isCancelling ? 'Đang dừng — chờ batch hiện tại...' : `Đã dừng — ${taskStatus.current} chương đã lưu`}
            </div>
          )}
          {isError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '0.65rem 0.85rem',
              borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
              color: '#fca5a5', fontSize: '0.83rem', marginBottom: '0.7rem',
            }}>
              <AlertTriangle size={15} />
              Có lỗi xảy ra — xem log bên dưới
            </div>
          )}

          {/* ── Log (collapsible) ── */}
          {(taskStatus.logs || []).length > 0 && (
            <div>
              <button
                onClick={() => setLogsExpanded(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: '0.72rem', padding: '0 0 0.35rem',
                }}
              >
                {logsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                Log ({taskStatus.logs.length})
              </button>
              {logsExpanded && (
                <div ref={logRef} style={{
                  background: 'rgba(0,0,0,0.4)', borderRadius: '7px',
                  border: '1px solid rgba(255,255,255,0.06)',
                  padding: '0.55rem 0.7rem', maxHeight: '140px', overflowY: 'auto',
                  fontFamily: 'monospace', fontSize: '0.69rem', lineHeight: '1.65',
                }}>
                  {(taskStatus.logs || []).map((log, i) => {
                    const isErr = /lỗi|error|❌|✗/i.test(log)
                    const isOk  = /đã lưu|thành công|✓/i.test(log)
                    const isCrawl = /đã lấy|crawl|fetch/i.test(log)
                    return (
                      <div key={i} style={{
                        color: isErr ? '#fca5a5' : isOk ? '#6ee7b7' : isCrawl ? '#10b981' : '#9ca3af',
                        paddingBottom: '1px',
                      }}>
                        <span style={{ color: 'rgba(255,255,255,0.18)', marginRight: '5px', userSelect: 'none' }}>
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
        <div style={{ padding: '0 1.1rem 0.9rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Nhập số chương và nhấn Bắt đầu để dịch tiếp.
        </div>
      )}

      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.35;transform:scale(0.65)} }
      `}</style>
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

function AuthorNotesSection({ chapters, slug, getChapNum }) {
  const [expanded, setExpanded] = useState(false)
  if (chapters.length === 0) return null

  return (
    <div style={{
      marginBottom: '0.75rem',
      borderRadius: '10px',
      border: '1px solid rgba(251,191,36,0.2)',
      background: 'rgba(251,191,36,0.04)',
      overflow: 'hidden',
    }}>
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.65rem 0.85rem', background: 'none', border: 'none', cursor: 'pointer',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ fontSize: '0.95rem' }}>📝</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fbbf24', letterSpacing: '0.02em' }}>
            Lưu Bút Tác Giả
          </span>
          <span style={{
            fontSize: '0.68rem', fontWeight: 700,
            padding: '1px 7px', borderRadius: '99px',
            background: 'rgba(251,191,36,0.15)', color: '#fbbf24',
            border: '1px solid rgba(251,191,36,0.3)',
          }}>
            {chapters.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {expanded ? 'Thu gọn' : 'Xem'}
          </span>
          {expanded ? <ChevronUp size={14} style={{ color: '#fbbf24', opacity: 0.7 }} /> : <ChevronDown size={14} style={{ color: '#fbbf24', opacity: 0.7 }} />}
        </div>
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div style={{
          borderTop: '1px solid rgba(251,191,36,0.12)',
          display: 'flex', flexDirection: 'column', gap: '1px',
          padding: '4px 0',
        }}>
          {chapters.map((chap) => {
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
                  padding: '0.5rem 0.85rem', margin: '0 4px', borderRadius: '7px',
                  color: 'var(--text-main)',
                  textDecoration: 'none', transition: 'background 0.12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{
                  fontSize: '0.7rem', flexShrink: 0,
                  color: '#fbbf24', opacity: 0.6,
                }}>✦</span>
                <span style={{
                  flex: 1, fontSize: '0.85rem',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: 'var(--text-main)',
                }}>
                  {cleanTitle}
                </span>
                <span style={{ color: 'var(--text-muted)', opacity: 0.35, flexShrink: 0, fontSize: '0.75rem' }}>›</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

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

  // Extract chapter number from title for display
  const getChapNum = (title) => {
    const m = title.match(/第(\d+)章|[Cc]hapter\s*(\d+)|Chương\s*(\d+)|(\d+)\./)
    return m ? (m[1] || m[2] || m[3] || m[4]) : null
  }

  // Separate numbered (story) chapters and author-note chapters
  const storyChapters = chapters.filter(c => getChapNum(c.title))
  const authorNotes   = chapters.filter(c => !getChapNum(c.title))

  // Top 7 newest story chapters (horizontal scroll strip)
  const newestChapters = [...storyChapters].reverse().slice(0, 7)

  // Filter & Sort (only story chapters)
  let displayChapters = storyChapters.filter(chap =>
    chap.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    chap.filename.toLowerCase().includes(searchTerm.toLowerCase())
  )
  // Also include author notes in search results
  let displayNotes = authorNotes.filter(chap =>
    chap.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    chap.filename.toLowerCase().includes(searchTerm.toLowerCase())
  )
  if (sortDesc) displayChapters = [...displayChapters].reverse()

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
            ? <>{displayChapters.length + displayNotes.length} <span style={{ opacity: 0.6 }}>/ {chapters.length}</span></>
            : <><strong style={{ color: 'var(--text-main)' }}>{storyChapters.length}</strong> chương</>
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

      {/* ── Author Notes (collapsible) — shown above chapter list when not searching ── */}
      {!searchTerm && (
        <AuthorNotesSection chapters={authorNotes} slug={slug} getChapNum={getChapNum} />
      )}

      {/* ── Chapter List ── */}
      {displayChapters.length === 0 && displayNotes.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem 0' }}>
          Không tìm thấy chương phù hợp.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {/* When searching, show matching author notes inline with a small tag */}
          {searchTerm && displayNotes.map((chap) => {
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
                  background: 'rgba(251,191,36,0.04)',
                  border: '1px solid rgba(251,191,36,0.12)',
                  marginBottom: '2px',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,0.09)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(251,191,36,0.04)'}
              >
                <span style={{ fontSize: '0.7rem', flexShrink: 0, color: '#fbbf24', opacity: 0.7 }}>✦</span>
                <span style={{ flex: 1, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cleanTitle}
                </span>
                <span style={{ fontSize: '0.65rem', color: '#fbbf24', opacity: 0.7, flexShrink: 0, fontWeight: 600 }}>lưu bút</span>
                <span style={{ color: 'var(--text-muted)', opacity: 0.4, flexShrink: 0, fontSize: '0.75rem' }}>›</span>
              </Link>
            )
          })}

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
                  color: 'var(--accent)',
                  opacity: 0.85,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  #{num}
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

function HealthTab({ healthData, loading, onRefresh, slug }) {
  const [cleaning, setCleaning] = useState(false)
  const [cleanResult, setCleanResult] = useState(null)

  const handleCleanup = async () => {
    if (!window.confirm('Xóa tất cả file phần split đã merge? Hành động này không thể hoàn tác.')) return
    setCleaning(true)
    setCleanResult(null)
    try {
      const res = await fetch(`http://localhost:4444/api/novels/${slug}/cleanup-split-parts`, { method: 'POST' })
      const data = await res.json()
      setCleanResult(data)
      onRefresh()  // refresh health sau cleanup
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
      <button className="btn btn-primary" onClick={onRefresh}><ShieldCheck size={18} /> Kiểm tra ngay</button>
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
  const splitPending  = summary?.split_pending  ?? 0

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
        <button className="btn btn-secondary" onClick={onRefresh}
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

// ── Tools Tab ─────────────────────────────────────────────────────────────────

// Khai báo ngoài component để tránh re-create mỗi render
const TOOL_DEFS = [
  {
    id: 'fix_chapters',
    label: 'Sửa lỗi (Missing / Failed)',
    desc: 'Dịch lại các chương bị thiếu file hoặc gặp lỗi [Translation failed].',
    Icon: AlertTriangle,
    iconColor: '#f59e0b',
    iconBg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.28)',
    btnLabel: 'Chạy fix_chapters',
  },
  {
    id: 'fix_truncated',
    label: 'Sửa đứt đoạn (Truncated)',
    desc: 'Fix các chương bị cắt ngang do chạm giới hạn output của Gemini.',
    Icon: Zap,
    iconColor: '#60a5fa',
    iconBg: 'rgba(59,130,246,0.12)',
    border: 'rgba(59,130,246,0.28)',
    btnLabel: 'Chạy fix_truncated',
  },
  {
    id: 'fix_titles_v2',
    label: 'Chuẩn hóa tiêu đề',
    desc: 'Định dạng lại tiêu đề tất cả chương về dạng "# Chương N: Tên chương".',
    Icon: Sparkles,
    iconColor: '#a78bfa',
    iconBg: 'rgba(139,92,246,0.12)',
    border: 'rgba(139,92,246,0.28)',
    btnLabel: 'Chạy fix_titles_v2',
  },
  {
    id: 'check_keys',
    label: 'Kiểm tra API Keys',
    desc: 'Hiển thị trạng thái các Gemini API key đang có trong hệ thống.',
    Icon: CheckCircle,
    iconColor: '#34d399',
    iconBg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.28)',
    btnLabel: 'Chạy check_keys',
  },
]

function ToolsTab({ slug }) {
  const [logs, setLogs]                 = useState('')
  const [runningTool, setRunningTool]   = useState(null)
  const [chapterTitle, setChapterTitle] = useState('')
  const [exitCode, setExitCode]         = useState(null)
  const terminalRef = useRef(null)

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight
  }, [logs])

  const runTool = async (toolId) => {
    if (runningTool) return
    setExitCode(null)
    setLogs(`❯ Khởi động ${toolId}...\n\n`)
    setRunningTool(toolId)
    try {
      const params = toolId === 'fix_one' ? `?chapter_title=${encodeURIComponent(chapterTitle)}` : ''
      const response = await fetch(`http://localhost:4444/api/novels/${slug}/tools/${toolId}${params}`)
      if (!response.ok) {
        setLogs(prev => prev + `\n✗ Lỗi HTTP ${response.status}\n`)
        setRunningTool(null)
        return
      }
      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const m = chunk.match(/\[Process exited with code (\d+)\]/)
        if (m) setExitCode(parseInt(m[1]))
        setLogs(prev => prev + chunk)
      }
    } catch (err) {
      setLogs(prev => prev + `\n✗ Lỗi hệ thống: ${err.message}\n`)
    } finally {
      setRunningTool(null)
    }
  }

  const isRunning = !!runningTool
  const isDone    = !isRunning && logs.length > 30
  const isSuccess = exitCode === 0
  const isError   = exitCode !== null && exitCode !== 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* ── Tool cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0.8rem' }}>

        {/* Standard tool cards */}
        {TOOL_DEFS.map(({ id, label, desc, Icon, iconColor, iconBg, border, btnLabel }) => {
          const active = runningTool === id
          return (
            <div key={id} style={{
              display: 'flex', flexDirection: 'column', gap: '0.85rem',
              padding: '1rem 1.1rem', borderRadius: '12px',
              background: active ? iconBg : 'rgba(255,255,255,0.025)',
              border: `1px solid ${active ? border : 'var(--border-panel)'}`,
              transition: 'background 0.2s, border-color 0.2s',
            }}>
              {/* Icon + title + desc */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <div style={{
                  flexShrink: 0, width: 36, height: 36, borderRadius: '9px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: iconBg, border: `1px solid ${border}`,
                }}>
                  <Icon size={16} style={{ color: iconColor }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.87rem', fontWeight: 600, marginBottom: '0.2rem', lineHeight: 1.35 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {desc}
                  </div>
                </div>
              </div>

              {/* Action button */}
              <button
                onClick={() => runTool(id)}
                disabled={isRunning}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  padding: '7px 12px', borderRadius: '8px',
                  fontSize: '0.81rem', fontWeight: 600,
                  cursor: isRunning ? 'not-allowed' : 'pointer',
                  opacity: isRunning && !active ? 0.35 : 1,
                  background: active ? iconBg : `${iconColor}18`,
                  color: iconColor,
                  border: `1px solid ${border}`,
                  transition: 'opacity 0.2s, background 0.15s',
                }}
                onMouseEnter={e => { if (!isRunning) e.currentTarget.style.background = iconBg }}
                onMouseLeave={e => { if (!isRunning) e.currentTarget.style.background = `${iconColor}18` }}
              >
                {active ? <><SpinnerIcon /> Đang chạy...</> : btnLabel}
              </button>
            </div>
          )
        })}

        {/* Special card: Dịch lại 1 chương (has input) */}
        {(() => {
          const active = runningTool === 'fix_one'
          return (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '0.85rem',
              padding: '1rem 1.1rem', borderRadius: '12px',
              background: active ? 'rgba(14,165,233,0.1)' : 'rgba(255,255,255,0.025)',
              border: `1px solid ${active ? 'rgba(14,165,233,0.35)' : 'var(--border-panel)'}`,
              transition: 'background 0.2s, border-color 0.2s',
            }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <div style={{
                  flexShrink: 0, width: 36, height: 36, borderRadius: '9px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.3)',
                }}>
                  <RefreshCw size={16} style={{ color: '#38bdf8' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.87rem', fontWeight: 600, marginBottom: '0.2rem', lineHeight: 1.35 }}>
                    Dịch lại 1 chương
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Dịch đơn lẻ 1 chương cụ thể, bỏ qua auto-batch.
                  </div>
                </div>
              </div>

              {/* Input + run */}
              <div style={{ display: 'flex', gap: '0.45rem' }}>
                <input
                  type="text"
                  className="input-field"
                  placeholder="VD: 第127章 我心如月钩折"
                  value={chapterTitle}
                  onChange={e => setChapterTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && chapterTitle.trim() && !isRunning && runTool('fix_one')}
                  disabled={isRunning}
                  style={{ flex: 1, fontSize: '0.79rem', height: '33px' }}
                />
                <button
                  onClick={() => runTool('fix_one')}
                  disabled={isRunning || !chapterTitle.trim()}
                  style={{
                    flexShrink: 0, padding: '0 13px', height: '33px',
                    borderRadius: '7px', border: '1px solid rgba(14,165,233,0.32)',
                    background: 'rgba(14,165,233,0.12)', color: '#38bdf8',
                    fontSize: '0.81rem', fontWeight: 600,
                    cursor: (isRunning || !chapterTitle.trim()) ? 'not-allowed' : 'pointer',
                    opacity: (isRunning || !chapterTitle.trim()) ? 0.38 : 1,
                    display: 'flex', alignItems: 'center', gap: '5px',
                    transition: 'opacity 0.2s, background 0.15s',
                  }}
                  onMouseEnter={e => { if (!isRunning && chapterTitle.trim()) e.currentTarget.style.background = 'rgba(14,165,233,0.22)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(14,165,233,0.12)' }}
                >
                  {active ? <SpinnerIcon /> : null}
                  {active ? 'Đang chạy' : 'Chạy'}
                </button>
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Terminal ── */}
      <div style={{
        borderRadius: '12px', overflow: 'hidden',
        border: `1px solid ${isSuccess ? 'rgba(16,185,129,0.3)' : isError ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.07)'}`,
        transition: 'border-color 0.3s',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}>
        {/* Title bar */}
        <div style={{
          padding: '0.5rem 1rem',
          background: 'rgba(0,0,0,0.4)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', gap: '0.6rem',
        }}>
          {/* Traffic lights */}
          <div style={{ display: 'flex', gap: '5px', marginRight: '2px' }}>
            {['#ff5f56','#ffbd2e','#27c93f'].map(c => (
              <div key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.75 }} />
            ))}
          </div>

          <span style={{ fontSize: '0.77rem', color: 'var(--text-muted)', fontFamily: 'monospace', flex: 1 }}>
            Terminal
            {runningTool && (
              <span style={{ marginLeft: '8px', color: '#60a5fa', opacity: 0.8 }}>
                — {runningTool}
              </span>
            )}
          </span>

          {/* Status badge */}
          {isDone && exitCode !== null && (
            <span style={{
              fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '99px',
              background: isSuccess ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: isSuccess ? '#6ee7b7' : '#fca5a5',
              border: `1px solid ${isSuccess ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.25)'}`,
            }}>
              {isSuccess ? '✓ Thành công' : `✗ Lỗi (code ${exitCode})`}
            </span>
          )}
          {isRunning && (
            <span style={{ fontSize: '0.72rem', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <SpinnerIcon /> Đang chạy...
            </span>
          )}

          {/* Clear */}
          {logs && !isRunning && (
            <button
              onClick={() => { setLogs(''); setExitCode(null) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: '0.72rem',
                padding: '1px 6px', borderRadius: '4px', opacity: 0.55,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0.55'}
            >
              Xóa
            </button>
          )}
        </div>

        {/* Log output */}
        <pre
          ref={terminalRef}
          style={{
            margin: 0, padding: '0.9rem 1.1rem',
            background: '#090d19',
            color: '#c9d1d9',
            fontFamily: '"JetBrains Mono","Fira Code","Cascadia Code",monospace',
            fontSize: '0.79rem', lineHeight: '1.7',
            minHeight: '200px', maxHeight: '360px',
            overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}
        >
          {logs
            ? logs.split('\n').map((line, i) => {
                const isCmd  = line.startsWith('❯')
                const isErr  = /error|lỗi|failed|✗/i.test(line) && !isCmd
                const isOk   = /saved|thành công|fixed|done|✓|success/i.test(line) && !isCmd
                const isDim  = /Process exited/.test(line)
                return (
                  <span key={i} style={{
                    display: 'block',
                    color: isCmd  ? '#93c5fd'
                         : isErr  ? '#fca5a5'
                         : isOk   ? '#6ee7b7'
                         : isDim  ? '#374151'
                         : '#c9d1d9',
                    fontWeight: isCmd ? 600 : 400,
                  }}>
                    {line}
                  </span>
                )
              })
            : <span style={{ color: '#374151' }}>Sẵn sàng nhận lệnh...</span>
          }
        </pre>
      </div>
    </div>
  )
}
