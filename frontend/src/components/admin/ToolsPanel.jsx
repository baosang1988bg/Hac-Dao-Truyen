import React, { useEffect, useState, useRef } from 'react'
import { AlertTriangle, Zap, Sparkles, CheckCircle, GitMerge, RefreshCw } from 'lucide-react'
import { SpinnerIcon } from '../shared/ui'

/**
 * Panel công cụ (tách từ ToolsTab của NovelDetail.jsx cũ).
 * Streaming fetch kèm Bearer + AbortController (abort khi unmount).
 */

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

export default function ToolsPanel({ slug }) {
  const [logs, setLogs]                 = useState('')
  const [runningTool, setRunningTool]   = useState(null)
  const [chapterTitle, setChapterTitle] = useState('')
  const [exitCode, setExitCode]         = useState(null)
  const terminalRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight
  }, [logs])

  // Abort stream đang chạy khi unmount / đổi truyện
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [slug])

  const runTool = async (toolId) => {
    if (runningTool) return
    setExitCode(null)
    setLogs(`❯ Khởi động ${toolId}...\n\n`)
    setRunningTool(toolId)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const params = toolId === 'fix_one' ? `?chapter_title=${encodeURIComponent(chapterTitle)}` : ''
      const token = localStorage.getItem('authToken')
      const response = await fetch(`/api/novels/${slug}/tools/${toolId}${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      })
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
      if (err.name === 'AbortError') return // unmount — không setState nữa
      setLogs(prev => prev + `\n✗ Lỗi hệ thống: ${err.message}\n`)
    } finally {
      if (!controller.signal.aborted) setRunningTool(null)
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
