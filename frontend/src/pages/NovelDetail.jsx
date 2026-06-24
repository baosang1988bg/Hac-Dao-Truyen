import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Play, Square, Book, BookOpen, Plus, Trash2, FileText,
  ArrowLeft, AlertTriangle, CheckCircle, RefreshCw, ShieldCheck,
  Zap, Clock, TrendingUp, ChevronDown, ChevronUp, OctagonX,
  Search, ArrowUpDown, Sparkles, GitMerge, Edit2, Check, X,
  ChevronLeft, ChevronRight
} from 'lucide-react'
import api from '../api'

const TABS = { CATALOG: 'catalog', CHAPTERS: 'chapters', GLOSSARY: 'glossary', HEALTH: 'health', TOOLS: 'tools' }

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
  const [catalog, setCatalog]               = useState([])
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
      const [nRes, cRes, catRes] = await Promise.all([
        api.get(`/novels/${slug}`),
        api.get(`/novels/${slug}/chapters`),
        api.get(`/novels/${slug}/catalog`).catch(() => ({ data: [] })),
      ])
      setNovel(nRes.data)
      setChapters(cRes.data)
      setCatalog(catRes.data || [])
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
    if (translateCount !== 0 && (!translateCount || translateCount < 1)) return
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

  const role = localStorage.getItem('userRole')
  const isAdmin = role === 'admin'

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
      <div className="novel-detail-grid" style={{ 
        display: 'grid', 
        gridTemplateColumns: isAdmin ? '300px 1fr' : '1fr', 
        gap: '1.5rem', 
        alignItems: 'start' 
      }}>

        {/* ── Left sidebar (Admin only) ── */}
        {isAdmin && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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

            <div className="glass-panel p-6">
              <h2 style={sectionTitle}><FileText size={18} style={{ color: 'var(--accent)' }} /> Thông tin</h2>
              <InfoRow label="Slug"     value={novel.slug} mono />
              <InfoRow label="Thể loại" value={novel.genre} />
              <InfoRow label="Chương"   value={`${novel.last_chapter_number}${novel.total_chapters ? ' / ' + novel.total_chapters : ''}`} />
              {novel.notes && <InfoRow label="Ghi chú" value={novel.notes} />}
            </div>
          </div>
        )}

        {/* ── Right content: tabs ── */}
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-panel)', padding: '0 1.5rem' }}>
            {[
              { id: TABS.CHAPTERS, label: `Chương (${chapters.length})`, icon: <BookOpen size={15} /> },
              ...(catalog.length > 0 ? [
                { id: TABS.CATALOG, label: `Mục lục gốc (${catalog.length})`, icon: <Sparkles size={15} /> }
              ] : []),
              ...(isAdmin ? [
                { id: TABS.GLOSSARY, label: `Glossary (${glossary.length})`, icon: <Book size={15} /> },
                { id: TABS.HEALTH,   label: 'Kiểm tra', icon: <ShieldCheck size={15} /> },
                { id: TABS.TOOLS,    label: 'Tính năng', icon: <Zap size={15} /> },
              ] : [])
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
            {activeTab === TABS.CATALOG && (
              <CatalogTab
                catalog={catalog}
                chapters={chapters}
                slug={slug}
                onTranslateFromChapter={async (startUrl) => {
                  try {
                    await api.post(`/novels/${slug}/translate`, { chapters: parseInt(translateCount), url: startUrl, force: false })
                    fetchStatus()
                  } catch (err) {
                    console.error(err)
                    alert('Lỗi khi kích hoạt dịch: ' + (err.response?.data?.detail || err.message))
                  }
                }}
              />
            )}
            {isAdmin && (
              <>
                {activeTab === TABS.GLOSSARY && (
                  <GlossaryTab
                    glossary={glossary}
                    saveGlossary={saveGlossary}
                  />
                )}
                {activeTab === TABS.HEALTH && (
                  <HealthTab healthData={healthData} loading={healthLoading} onRefresh={fetchHealth} slug={slug} />
                )}
                {activeTab === TABS.TOOLS && <ToolsTab slug={slug} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


// ── Translation Panel ─────────────────────────────────────────────────────────

function TranslationPanel({ isRunning, translating, translateCount, setTranslateCount, taskStatus, elapsedSec, onStart, onStop }) {
  const logRef = useRef(null)
  const [logsExpanded, setLogsExpanded] = useState(false)
  const [userDismissedSummary, setUserDismissedSummary] = useState(false)

  const isCancelling = taskStatus?.status === 'cancelling'
  const isDone       = taskStatus?.status === 'finished'
  const isError      = taskStatus?.status === 'error'
  const isCancelled  = taskStatus?.status === 'cancelled'
  const isIdle       = !taskStatus || taskStatus.status === 'idle'

  useEffect(() => {
    if (isRunning) {
      setUserDismissedSummary(false)
    }
  }, [isRunning])

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [taskStatus?.logs, logsExpanded])

  const total        = taskStatus?.total || 0
  const current      = taskStatus?.current || 0
  const scrapedCount = taskStatus?.scraped_count || 0
  const chaptersOk   = taskStatus?.chapters_ok || []
  const chaptersFail = taskStatus?.chapters_fail || []
  const tokensUsed   = taskStatus?.tokens_used || 0
  const costSoFar    = taskStatus?.cost_so_far || 0
  const currentModel = taskStatus?.current_model || ''

  const pct          = total > 0 ? Math.min(100, (current / total) * 100) : 0
  const scrapedPct   = total > 0 ? Math.min(100, (scrapedCount / total) * 100) : 0

  const fmtTime = (sec) => {
    if (!sec) return '00:00'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`
  }

  // Speed & ETA
  const chapPerMin = elapsedSec > 5 && current > 0
    ? ((current / elapsedSec) * 60).toFixed(1) : null
  const remaining = total - current
  const eta = chapPerMin && remaining > 0
    ? fmtTime(Math.round((remaining / parseFloat(chapPerMin)) * 60)) : 'Tính toán...'

  const totalProcessed = chaptersOk.length + chaptersFail.length
  const successRate = totalProcessed > 0 ? Math.round((chaptersOk.length / totalProcessed) * 100) : 100

  // Model color helper
  const modelColor = (m = '') => {
    const n = m.toLowerCase()
    if (n.includes('gemini'))   return { text: '#93c5fd', bg: 'rgba(59,130,246,0.15)',  dot: '#3b82f6' }
    if (n.includes('deepseek')) return { text: '#c4b5fd', bg: 'rgba(139,92,246,0.15)', dot: '#8b5cf6' }
    if (n.includes('ollama') || n.includes('hunyuan')) return { text: '#6ee7b7', bg: 'rgba(16,185,129,0.15)', dot: '#10b981' }
    return { text: 'var(--text-muted)', bg: 'rgba(255,255,255,0.06)', dot: '#6b7280' }
  }
  const mc = modelColor(currentModel)

  const SpinnerIcon = () => (
    <span style={{
      display: 'inline-block', width: '14px', height: '14px',
      border: '2px solid currentColor', borderTopColor: 'transparent',
      borderRadius: '50%', animation: 'spin 0.8s linear infinite'
    }} />
  )

  const statCardStyle = {
    background: 'rgba(0, 0, 0, 0.2)',
    border: '1px solid var(--border-panel)',
    borderRadius: '12px',
    padding: '0.65rem 0.8rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  }

  const statHeaderStyle = {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  }

  const statValueStyle = {
    fontSize: '1.1rem',
    fontWeight: 800,
    color: 'white',
    fontVariantNumeric: 'tabular-nums',
  }

  const statSubStyle = {
    fontSize: '0.68rem',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }

  const billRowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.82rem',
    borderBottom: '1px dashed rgba(255,255,255,0.06)',
    paddingBottom: '6px',
    color: 'var(--text-main)'
  }

  const isAllChapters = translateCount === 0 || translateCount === '0'

  const handleToggleAll = (e) => {
    const checked = e.target.checked
    if (checked) {
      setTranslateCount(0)
    } else {
      setTranslateCount(5)
    }
  }

  const showProcessing = isRunning || isCancelling
  const showSummary    = !showProcessing && (isDone || isError || isCancelled) && !userDismissedSummary
  const showConfig     = !showProcessing && !showSummary

  // 1. CONFIGURATION VIEW
  if (showConfig) {
    return (
      <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ background: 'var(--accent-gradient)', padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)' }}>
            <Zap size={20} color="white" />
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'white', fontFamily: 'Outfit, sans-serif' }}>Bảng Điều Khiển</h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>Cấu hình và bắt đầu dịch truyện</p>
          </div>
        </div>

        {/* Input Số chương & Checkbox */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(0,0,0,0.12)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-panel)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Số chương cần dịch</span>
              {isAllChapters && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Dịch toàn bộ</span>}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                className="input-field"
                value={isAllChapters ? '' : translateCount}
                onChange={e => setTranslateCount(e.target.value)}
                min="1" max="2500"
                disabled={translating || isAllChapters}
                placeholder="Ví dụ: 5, 10, 20..."
                style={{ paddingRight: '4rem', height: '42px', fontSize: '0.95rem', background: isAllChapters ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.25)', borderColor: isAllChapters ? 'rgba(255,255,255,0.03)' : 'var(--border-panel)' }}
              />
              <span style={{
                position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                fontSize: '0.75rem', fontWeight: 700, color: isAllChapters ? 'var(--accent)' : 'var(--text-muted)', pointerEvents: 'none',
                textTransform: 'uppercase'
              }}>{isAllChapters ? 'VÔ HẠN' : 'CHƯƠNG'}</span>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none', padding: '4px 0' }}>
            <input
              type="checkbox"
              checked={isAllChapters}
              onChange={handleToggleAll}
              disabled={translating}
              style={{
                width: '16px', height: '16px', borderRadius: '4px',
                accentColor: 'var(--accent)', cursor: 'pointer'
              }}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-main)' }}>
              Dịch toàn bộ chương còn lại
            </span>
          </label>
        </div>

        {/* Start Button */}
        <button
          className="btn btn-primary"
          onClick={onStart}
          disabled={translating || (!isAllChapters && (!translateCount || translateCount < 1))}
          style={{
            width: '100%',
            height: '46px',
            fontSize: '0.95rem',
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            boxShadow: '0 4px 15px rgba(59, 130, 246, 0.4)',
            transition: 'all 0.25s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          {translating ? (
            <>
              <SpinnerIcon /> Đang khởi động...
            </>
          ) : (
            <>
              <Play size={16} fill="white" /> Bắt đầu dịch
            </>
          )}
        </button>
      </div>
    )
  }

  // 2. PROCESSING VIEW
  if (showProcessing) {
    return (
      <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', animation: 'pulse-dot 1.5s infinite' }} />
            <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'white', fontFamily: 'Outfit, sans-serif' }}>Đang xử lý</h2>
          </div>
          <StatusBadge status={taskStatus?.status} />
        </div>

        {/* Dual Progress Bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(0,0,0,0.15)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-panel)' }}>
          {/* Cào Progress */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Tiến trình cào truyện</span>
              <span style={{ fontWeight: 700, color: '#a78bfa' }}>{Math.round(scrapedPct)}%</span>
            </div>
            <div style={{ height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '99px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '99px',
                background: 'linear-gradient(90deg, #a78bfa 0%, #8b5cf6 100%)',
                width: `${scrapedPct}%`,
                transition: 'width 0.4s ease',
                boxShadow: '0 0 8px rgba(139, 92, 246, 0.4)'
              }} />
            </div>
          </div>

          {/* Dịch Progress */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Tiến trình dịch thuật</span>
              <span style={{ fontWeight: 700, color: 'var(--success)' }}>{Math.round(pct)}%</span>
            </div>
            <div style={{ height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '99px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '99px',
                background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)',
                width: `${pct}%`,
                transition: 'width 0.4s ease',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)'
              }} />
            </div>
          </div>
        </div>

        {/* Grid Stats 2x2 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          {/* Card 1: Thời gian */}
          <div style={statCardStyle}>
            <div style={statHeaderStyle}><Clock size={11} /> Thời gian</div>
            <div style={statValueStyle}>{fmtTime(elapsedSec)}</div>
            <div style={statSubStyle}>ETA: {eta}</div>
          </div>

          {/* Card 2: Tiến trình */}
          <div style={statCardStyle}>
            <div style={statHeaderStyle}><TrendingUp size={11} /> Chương</div>
            <div style={statValueStyle}>{current}/{total}</div>
            <div style={statSubStyle}>Đã cào: {scrapedCount}/{total}</div>
          </div>

          {/* Card 3: Tài nguyên */}
          <div style={statCardStyle}>
            <div style={statHeaderStyle}><Sparkles size={11} /> Tài nguyên</div>
            <div style={statValueStyle}>{tokensUsed.toLocaleString()} tkn</div>
            <div style={statSubStyle}>Chi phí: ${costSoFar.toFixed(4)}</div>
          </div>

          {/* Card 4: Độ thành công */}
          <div style={statCardStyle}>
            <div style={statHeaderStyle}>
              <CheckCircle size={11} style={{ color: successRate === 100 ? 'var(--success)' : 'var(--danger)' }} /> Thành công
            </div>
            <div style={{ ...statValueStyle, color: successRate === 100 ? 'var(--success)' : successRate >= 80 ? '#fbbf24' : 'var(--danger)' }}>
              {successRate}%
            </div>
            <div style={statSubStyle}>Lỗi: {chaptersFail.length} chương</div>
          </div>
        </div>

        {/* Model Badge */}
        {currentModel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: mc.bg, border: '1px solid rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: '8px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: mc.dot }} />
            <span style={{ fontSize: '0.75rem', color: mc.text, fontWeight: 600 }}>Model: {currentModel}</span>
          </div>
        )}

        {/* Console logs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Nhật ký dịch thuật (Live)</span>
            <button
              onClick={() => setLogsExpanded(!logsExpanded)}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.72rem', cursor: 'pointer', padding: 0 }}
            >
              {logsExpanded ? 'Thu nhỏ' : 'Mở rộng'}
            </button>
          </div>
          <div
            ref={logRef}
            style={{
              height: logsExpanded ? '220px' : '100px',
              background: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid var(--border-panel)',
              borderRadius: '8px',
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              color: '#34d399',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              transition: 'height 0.2s ease',
              lineHeight: '1.4'
            }}
          >
            {taskStatus?.logs?.join('\n') || 'Đang chờ nhật ký...'}
          </div>
        </div>

        {/* Stop Button */}
        <button
          className="btn btn-danger"
          onClick={onStop}
          disabled={isCancelling}
          style={{
            width: '100%',
            height: '40px',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderColor: 'rgba(239, 68, 68, 0.2)'
          }}
        >
          {isCancelling ? (
            <>
              <SpinnerIcon /> Đang dừng...
            </>
          ) : (
            <>
              <Square size={14} fill="var(--danger)" stroke="none" /> Dừng dịch khẩn cấp
            </>
          )}
        </button>
      </div>
    )
  }

  // 3. SUMMARY VIEW
  if (showSummary) {
    const isErrorState = isError
    const isCancelledState = isCancelled
    
    // Status color configs
    let statusLabel = 'Hoàn thành'
    let statusBg = 'rgba(16, 185, 129, 0.12)'
    let statusBorder = 'rgba(16, 185, 129, 0.3)'
    let statusColor = 'var(--success)'
    
    if (isErrorState) {
      statusLabel = 'Bị lỗi'
      statusBg = 'rgba(239, 68, 68, 0.12)'
      statusBorder = 'rgba(239, 68, 68, 0.3)'
      statusColor = 'var(--danger)'
    } else if (isCancelledState) {
      statusLabel = 'Đã dừng'
      statusBg = 'rgba(245, 158, 11, 0.12)'
      statusBorder = 'rgba(245, 158, 11, 0.3)'
      statusColor = '#fbbf24'
    }

    return (
      <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ background: statusBg, border: `1px solid ${statusBorder}`, padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: statusColor }}>{statusLabel.toUpperCase()}</span>
          </div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'white', fontFamily: 'Outfit, sans-serif' }}>Kết Quả Dịch</h2>
        </div>

        {/* Detailed Bill/Receipt */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', background: 'rgba(0,0,0,0.18)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-panel)', fontFamily: 'system-ui, sans-serif' }}>
          <div style={billRowStyle}>
            <span style={{ color: 'var(--text-muted)' }}>Thời gian thực hiện</span>
            <span style={{ fontWeight: 600 }}>{fmtTime(elapsedSec || taskStatus?.elapsed_seconds || 0)}</span>
          </div>
          <div style={billRowStyle}>
            <span style={{ color: 'var(--text-muted)' }}>Số chương xử lý</span>
            <span style={{ fontWeight: 600 }}>{chaptersOk.length} / {total} chương OK</span>
          </div>
          {chaptersFail.length > 0 && (
            <div style={billRowStyle}>
              <span style={{ color: 'var(--danger)' }}>Số chương thất bại</span>
              <span style={{ fontWeight: 600, color: 'var(--danger)' }}>{chaptersFail.length} chương</span>
            </div>
          )}
          <div style={billRowStyle}>
            <span style={{ color: 'var(--text-muted)' }}>Tổng tokens tiêu thụ</span>
            <span style={{ fontWeight: 600 }}>{tokensUsed.toLocaleString()} tkn</span>
          </div>
          <div style={{ ...billRowStyle, borderBottom: 'none', paddingBottom: 0 }}>
            <span style={{ color: 'var(--text-muted)' }}>Chi phí ước tính</span>
            <span style={{ fontWeight: 700, color: 'var(--success)' }}>${costSoFar.toFixed(4)}</span>
          </div>
        </div>

        {/* Mini progress bar success rate */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Tỷ lệ thành công</span>
            <span style={{ fontWeight: 700, color: successRate === 100 ? 'var(--success)' : '#fbbf24' }}>{successRate}%</span>
          </div>
          <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '99px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '99px',
              background: successRate === 100 ? 'var(--success)' : successRate >= 80 ? '#fbbf24' : 'var(--danger)',
              width: `${successRate}%`,
              transition: 'width 0.5s ease'
            }} />
          </div>
        </div>

        {/* Failed Chapters List if any */}
        {chaptersFail.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertTriangle size={12} /> Danh sách chương lỗi ({chaptersFail.length})
            </span>
            <div style={{
              maxHeight: '80px',
              overflowY: 'auto',
              background: 'rgba(239, 68, 68, 0.05)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '0.72rem',
              color: '#fca5a5',
              fontFamily: 'monospace'
            }}>
              {chaptersFail.map((chap, idx) => (
                <div key={idx} style={{ padding: '2px 0' }}>• {chap}</div>
              ))}
            </div>
          </div>
        )}

        {/* Reset / Dismiss button */}
        <button
          className="btn btn-secondary"
          onClick={() => setUserDismissedSummary(true)}
          style={{
            width: '100%',
            height: '40px',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <RefreshCw size={14} /> Cấu hình dịch mới
        </button>
      </div>
    )
  }

  return null
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
  const readChapters = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(`read_chapters_${slug}`) || '[]')
    } catch (e) {
      return []
    }
  }, [slug])

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
            const num = getChapNum(chap.title)
            const cleanTitle = chap.title
              .replace(/第\d+章\s*/, '')
              .replace(/Chapter\s*\d+[\s:.]*/i, '')
              .trim() || chap.title

            const isRead = readChapters.includes(chap.filename) || (num && readChapters.includes(String(num)))
            return (
              <Link
                key={chap.filename}
                to={`/novel/${slug}/read/${num ? num : encodeURIComponent(chap.filename)}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '0.5rem 0.85rem', margin: '0 4px', borderRadius: '7px',
                  color: 'var(--text-main)',
                  textDecoration: 'none', transition: 'background 0.12s',
                  opacity: isRead ? 0.6 : 1,
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
                {isRead && (
                  <span style={{
                    fontSize: '0.68rem', color: '#10b981', background: 'rgba(16,185,129,0.1)',
                    padding: '1px 6px', borderRadius: '4px', flexShrink: 0, fontWeight: 500
                  }}>
                    ✓ Đã đọc
                  </span>
                )}
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

  const readChapters = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(`read_chapters_${slug}`) || '[]')
    } catch (e) {
      return []
    }
  }, [slug])

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
              const isRead = readChapters.includes(chap.filename) || (num && readChapters.includes(String(num)))
              return (
                <Link
                  key={`new-${chap.filename}`}
                  to={`/novel/${slug}/read/${num ? num : encodeURIComponent(chap.filename)}`}
                  style={{
                    flexShrink: 0,
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '10px', minWidth: '120px', maxWidth: '160px',
                    background: isRead ? 'rgba(16,185,129,0.04)' : 'rgba(59,130,246,0.08)',
                    border: isRead ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(59,130,246,0.2)',
                    color: 'var(--text-main)',
                    textDecoration: 'none',
                    opacity: isRead ? 0.75 : 1,
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = isRead ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.16)';
                    e.currentTarget.style.borderColor = isRead ? 'rgba(16,185,129,0.4)' : 'rgba(59,130,246,0.4)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = isRead ? 'rgba(16,185,129,0.04)' : 'rgba(59,130,246,0.08)';
                    e.currentTarget.style.borderColor = isRead ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.2)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {num && (
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: isRead ? 'var(--success)' : 'var(--accent)', letterSpacing: '0.04em' }}>
                        CH. {num}
                      </span>
                    )}
                    {isRead && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--success)', fontWeight: 600 }}>✓</span>
                    )}
                  </div>
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
            const num = getChapNum(chap.title)
            const isRead = readChapters.includes(chap.filename) || (num && readChapters.includes(String(num)))
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
                  opacity: isRead ? 0.65 : 1,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,0.09)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(251,191,36,0.04)'}
              >
                <span style={{ fontSize: '0.7rem', flexShrink: 0, color: '#fbbf24', opacity: 0.7 }}>✦</span>
                <span style={{ flex: 1, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cleanTitle}
                </span>
                {isRead && (
                  <span style={{
                    fontSize: '0.68rem', color: '#10b981', background: 'rgba(16,185,129,0.1)',
                    padding: '1px 6px', borderRadius: '4px', flexShrink: 0, fontWeight: 500
                  }}>
                    ✓ Đã đọc
                  </span>
                )}
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
            const isRead = readChapters.includes(chap.filename) || (num && readChapters.includes(String(num)))

            return (
              <Link
                key={chap.filename}
                to={`/novel/${slug}/read/${num ? num : encodeURIComponent(chap.filename)}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '0.55rem 0.75rem', borderRadius: '8px',
                  color: 'var(--text-main)',
                  textDecoration: 'none', transition: 'background 0.12s',
                  opacity: isRead ? 0.65 : 1,
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

// ── Catalog Tab ──────────────────────────────────────────────────────────────

function CatalogTab({ catalog, chapters, slug, onTranslateFromChapter }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 40

  const readChapters = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(`read_chapters_${slug}`) || '[]')
    } catch (e) {
      return []
    }
  }, [slug])

  // 1. Helpers for clean match
  const getChapNum = (title) => {
    const m = title.match(/第(\d+)章|[Cc]hapter\s*(\d+)|Chương\s*(\d+)|(\d+)\./)
    return m ? parseInt(m[1] || m[2] || m[3] || m[4]) : null
  }

  const cleanCatalogTitle = (title) => {
    return title.split('').filter(c => /[\p{L}\p{N} \-_]/u.test(c)).join('').trim()
  }

  // 2. Pre-process translated list to index for fast O(1) matching
  const translatedTitlesSet = new Set(chapters.map(c => c.title))
  const translatedNumbersSet = new Set(
    chapters.map(c => getChapNum(c.title) || getChapNum(c.display_title)).filter(Boolean)
  )

  // 3. Search filter
  const filtered = catalog.filter(item =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 4. Pagination
  const totalPages = Math.ceil(filtered.length / itemsPerPage)
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  if (catalog.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
        Truyện này chưa được nhập mục lục gốc (không có catalog.json).
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar Tìm kiếm & Thống kê */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div style={{ position: 'relative', flex: '1 1 250px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666', display: 'flex', alignItems: 'center' }}>
            <Search size={16} />
          </span>
          <input
            type="text"
            placeholder="Tìm chương mục lục gốc..."
            className="input-field"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '36px', width: '100%', fontSize: '0.875rem', height: '36px' }}
          />
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Tìm thấy: <strong>{filtered.length}</strong> / <strong>{catalog.length}</strong> chương gốc
        </div>
      </div>

      {/* Danh sách catalog */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0',
          background: 'rgba(255,255,255,0.01)', borderRadius: '10px',
          border: '1px dashed var(--border-panel)'
        }}>
          Không tìm thấy chương nào phù hợp trong mục lục.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {paginated.map((item) => {
            // Check if item is already translated
            const cleanTitle = cleanCatalogTitle(item.title)
            const matchedChapter = chapters.find(c =>
              c.title === cleanTitle ||
              (getChapNum(c.title) || getChapNum(c.display_title)) === item.number ||
              (getChapNum(c.title) || getChapNum(c.display_title)) === item.original_chapter_number
            )
            const isTranslated = !!matchedChapter
            const isRead = matchedChapter && (
              readChapters.includes(matchedChapter.filename) ||
              (getChapNum(matchedChapter.title) && readChapters.includes(String(getChapNum(matchedChapter.title))))
            )

            return (
              <div
                key={item.number}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.6rem 0.85rem',
                  borderRadius: '8px',
                  background: isTranslated ? (isRead ? 'rgba(16,185,129,0.01)' : 'rgba(16,185,129,0.02)') : 'rgba(255,255,255,0.01)',
                  border: isTranslated ? (isRead ? '1px solid rgba(16,185,129,0.05)' : '1px solid rgba(16,185,129,0.1)') : '1px solid var(--border-panel)',
                  gap: '1rem',
                  opacity: isRead ? 0.65 : 1,
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                  {/* STT/Number */}
                  <span style={{
                    flexShrink: 0, minWidth: '42px', textAlign: 'right',
                    fontSize: '0.75rem', fontWeight: 700,
                    color: isTranslated ? 'var(--success)' : 'var(--text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    #{item.number}
                  </span>

                  <span style={{ width: '1px', height: '14px', background: 'var(--border-panel)', flexShrink: 0 }} />

                  {/* Title (Chinese) */}
                  <span style={{
                    fontSize: '0.875rem',
                    fontWeight: isTranslated ? (isRead ? 400 : 500) : 400,
                    color: isTranslated ? (isRead ? 'var(--text-muted)' : 'var(--text-main)') : 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flex: 1
                  }}>
                    {item.title}
                  </span>
                </div>

                {/* Badge & Action */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                  {isTranslated ? (
                    <>
                      {isRead && (
                        <span style={{
                          fontSize: '0.72rem', fontWeight: 600,
                          padding: '2px 8px', borderRadius: '4px',
                          background: 'rgba(16,185,129,0.08)', color: '#10b981'
                        }}>
                          ✓ Đã đọc
                        </span>
                      )}
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 600,
                        padding: '2px 8px', borderRadius: '4px',
                        background: 'rgba(16,185,129,0.1)', color: 'var(--success)'
                      }}>
                        Đã dịch
                      </span>
                      <Link
                        to={`/novel/${slug}/read/${matchedChapter.filename.replace('_VI.md', '')}`}
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '0.78rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                      >
                        Đọc chương
                      </Link>
                    </>
                  ) : (
                    <>
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 500,
                        padding: '2px 8px', borderRadius: '4px',
                        background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)'
                      }}>
                        Chưa dịch
                      </span>
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          if (window.confirm(`Bạn muốn dịch bắt đầu từ chương này: "${item.title}"?`)) {
                            onTranslateFromChapter(item.url)
                          }
                        }}
                        style={{
                          padding: '4px 10px', fontSize: '0.78rem',
                          background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)',
                          color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '4px'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.3)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.2)' }}
                      >
                        <Play size={10} fill="currentColor" /> Dịch từ đây
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Phân trang */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.8rem', marginTop: '1.25rem' }}>
          <button className="btn btn-secondary" onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1} style={{ padding: '6px 10px', opacity: currentPage === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={16} />
          </button>

          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Trang <strong>{currentPage}</strong> / <strong>{totalPages}</strong>
          </span>

          <button className="btn btn-secondary" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages} style={{ padding: '6px 10px', opacity: currentPage === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}


// ── Glossary Tab ──────────────────────────────────────────────────────────────

function GlossaryTab({ glossary, saveGlossary }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const [editingKey, setEditingKey] = useState(null)
  const [editKey, setEditKey] = useState('')
  const [editVal, setEditVal] = useState('')
  const itemsPerPage = 20

  // Lọc danh sách theo từ khóa tìm kiếm (tìm cả key lẫn val)
  const filtered = glossary.filter(item => 
    item.key.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.val.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Phân trang
  const totalPages = Math.ceil(filtered.length / itemsPerPage)
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  // Reset trang về 1 khi bắt đầu tìm kiếm
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  // Xử lý thêm mới từ điển
  const handleAdd = () => {
    const k = newKey.trim()
    const v = newVal.trim()
    if (!k) return

    // Validation trùng lặp từ gốc
    const existing = glossary.find(item => item.key.toLowerCase() === k.toLowerCase())
    if (existing) {
      if (!window.confirm(`Hán tự "${k}" đã tồn tại với nghĩa "${existing.val}". Bạn có muốn ghi đè bằng nghĩa mới "${v}" không?`)) {
        return
      }
      const updated = [{ key: k, val: v }, ...glossary.filter(item => item.key.toLowerCase() !== k.toLowerCase())]
      saveGlossary(updated)
    } else {
      saveGlossary([{ key: k, val: v }, ...glossary])
    }
    setNewKey('')
    setNewVal('')
  }

  // Xử lý xóa từ điển
  const handleRemove = (keyToRemove) => {
    if (window.confirm(`Bạn có chắc chắn muốn xóa từ khóa "${keyToRemove}" khỏi từ điển?`)) {
      const updated = glossary.filter(item => item.key !== keyToRemove)
      saveGlossary(updated)
    }
  }

  // Bắt đầu sửa trực tiếp (Inline Edit)
  const startEdit = (item) => {
    setEditingKey(item.key)
    setEditKey(item.key)
    setEditVal(item.val)
  }

  // Lưu sửa đổi
  const handleSaveEdit = (originalKey) => {
    const k = editKey.trim()
    const v = editVal.trim()
    if (!k) return

    // Nếu đổi sang key khác và key đó trùng với từ khác
    if (k.toLowerCase() !== originalKey.toLowerCase()) {
      const existing = glossary.find(item => item.key.toLowerCase() === k.toLowerCase())
      if (existing) {
        alert(`Từ khóa Hán tự "${k}" đã tồn tại trong từ điển! Vui lòng chọn từ khóa khác.`);
        return
      }
    }

    const updated = glossary.map(item => 
      item.key === originalKey ? { key: k, val: v } : item
    )
    saveGlossary(updated)
    setEditingKey(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Panel Thêm Mới */}
      <div style={{
        background: 'rgba(255,255,255,0.02)', padding: '1rem',
        borderRadius: '10px', border: '1px solid var(--border-panel)'
      }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          ✨ Thêm Từ Điển Mới
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input type="text" placeholder="Hán tự (Ví dụ: 乔桑)" className="input-field"
            value={newKey} onChange={e => setNewKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: '1 1 150px' }} />
          <input type="text" placeholder="Tiếng Việt (Ví dụ: Kiều Tang)" className="input-field"
            value={newVal} onChange={e => setNewVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: '1 1 150px' }} />
          <button className="btn btn-primary" onClick={handleAdd} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '10px 16px' }}>
            <Plus size={16} /> Thêm
          </button>
        </div>
      </div>

      {/* Toolbar Tìm kiếm & Thống kê */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        <div style={{ position: 'relative', flex: '1 1 250px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666', display: 'flex', alignItems: 'center' }}>
            <Search size={16} />
          </span>
          <input type="text" placeholder="Tìm kiếm theo từ gốc hoặc nghĩa dịch..." className="input-field"
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '36px', width: '100%' }} />
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Tìm thấy: <strong>{filtered.length}</strong> / <strong>{glossary.length}</strong> từ
        </div>
      </div>

      {/* Danh sách entries */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0',
          background: 'rgba(255,255,255,0.01)', borderRadius: '10px',
          border: '1px dashed var(--border-panel)'
        }}>
          Không tìm thấy từ khóa nào phù hợp.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {paginated.map((item) => {
            const isEditing = editingKey === item.key
            return (
              <div key={item.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.65rem 1rem', borderRadius: '8px',
                background: isEditing ? 'rgba(233,69,96,0.04)' : 'rgba(255,255,255,0.03)',
                border: isEditing ? '1px solid rgba(233,69,96,0.3)' : '1px solid var(--border-panel)',
                gap: '1rem', transition: 'all 0.2s'
              }}>
                {isEditing ? (
                  /* Form sửa trực tiếp inline */
                  <div style={{ display: 'flex', gap: '0.5rem', flex: 1, flexWrap: 'wrap' }}>
                    <input type="text" className="input-field" value={editKey}
                      onChange={e => setEditKey(e.target.value)} style={{ flex: '1 1 120px', padding: '6px 10px', fontSize: '0.85rem' }} />
                    <input type="text" className="input-field" value={editVal}
                      onChange={e => setEditVal(e.target.value)} style={{ flex: '1 1 120px', padding: '6px 10px', fontSize: '0.85rem' }} />
                  </div>
                ) : (
                  /* Hiển thị bình thường */
                  <div style={{ display: 'flex', flex: 1, minWidth: 0, alignItems: 'center', gap: '1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f3f4f6', flex: '1 1 120px', wordBreak: 'break-all' }}>
                      {item.key}
                    </div>
                    <div style={{ color: '#9ca3af', fontSize: '0.85rem', flex: '1 1 120px', wordBreak: 'break-all' }}>
                      {item.val}
                    </div>
                  </div>
                )}

                {/* Các nút hành động */}
                <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                  {isEditing ? (
                    <>
                      <button className="btn btn-primary" onClick={() => handleSaveEdit(item.key)} style={{ padding: '6px 8px', background: '#10b981' }} title="Lưu">
                        <Check size={14} />
                      </button>
                      <button className="btn btn-secondary" onClick={() => setEditingKey(null)} style={{ padding: '6px 8px' }} title="Hủy">
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-secondary" onClick={() => startEdit(item)} style={{ padding: '6px 8px' }} title="Sửa">
                        <Edit2 size={14} />
                      </button>
                      <button className="btn btn-danger" onClick={() => handleRemove(item.key)} style={{ padding: '6px 8px' }} title="Xóa">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Phân trang */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.8rem', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1} style={{ padding: '6px 10px', opacity: currentPage === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={16} />
          </button>
          
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Trang <strong>{currentPage}</strong> / <strong>{totalPages}</strong>
          </span>

          <button className="btn btn-secondary" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages} style={{ padding: '6px 10px', opacity: currentPage === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronRight size={16} />
          </button>
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
      const res = await fetch(`/api/novels/${slug}/cleanup-split-parts`, { method: 'POST' })
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
  {
    id: 'merge_split_parts',
    label: 'Merge chương split',
    desc: 'Gộp các file -1, -2, ... _VI.md thành 1 file chương hoàn chỉnh. Chạy sau khi dịch xong các phần.',
    Icon: GitMerge,
    iconColor: '#a78bfa',
    iconBg: 'rgba(139,92,246,0.12)',
    border: 'rgba(139,92,246,0.28)',
    btnLabel: 'Chạy merge',
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
      const response = await fetch(`/api/novels/${slug}/tools/${toolId}${params}`)
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
