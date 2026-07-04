import React, { useEffect, useState, useRef } from 'react'
import {
  Play, Square, Zap, Clock, TrendingUp, Sparkles,
  CheckCircle, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { StatusBadge, SpinnerIcon } from '../shared/ui'

/**
 * Bảng điều khiển dịch (tách nguyên trạng từ NovelDetail.jsx cũ).
 * 3 view: cấu hình / đang xử lý / kết quả. Nhận toàn bộ state qua props
 * (từ hook useTranslationStatus ở trang cha).
 */
export default function TranslationPanel({ isRunning, translating, translateCount, setTranslateCount, taskStatus, elapsedSec, onStart, onStop }) {
  const logRef = useRef(null)
  const [logsExpanded, setLogsExpanded] = useState(false)
  const [userDismissedSummary, setUserDismissedSummary] = useState(false)

  const isCancelling = taskStatus?.status === 'cancelling'
  const isDone       = taskStatus?.status === 'finished'
  const isError      = taskStatus?.status === 'error'
  const isCancelled  = taskStatus?.status === 'cancelled'

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
