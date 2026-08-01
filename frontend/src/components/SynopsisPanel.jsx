import React, { useState, useCallback, useRef, useEffect } from 'react'
import api from '../api'

/**
 * SynopsisPanel — Hiển thị phần giới thiệu truyện (synopsis).
 *
 * Props:
 *   slug           string   — slug truyện để lazy load
 *   synopsis       string   — text tóm tắt (từ API /novels/:slug)
 *   hasMore        bool     — có nhiều hơn không (từ novel.has_more_synopsis)
 *   maxLines       number   — số dòng hiển thị mặc định (default 5)
 */
export default function SynopsisPanel({ slug, synopsis, hasMore = false, maxLines = 5 }) {
  const [expanded, setExpanded] = useState(false)
  const [fullText, setFullText] = useState(synopsis || '')
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(!hasMore)
  const textRef = useRef(null)
  const [clamped, setClamped] = useState(false)

  // Kiểm tra xem text có thực sự bị clamp không (overflow)
  useEffect(() => {
    if (!textRef.current) return
    const el = textRef.current
    setClamped(el.scrollHeight > el.clientHeight + 4) // +4px buffer
  }, [fullText, expanded])

  const handleExpandClick = useCallback(async () => {
    if (expanded) {
      setExpanded(false)
      return
    }

    // Đã fetch đầy đủ rồi
    if (fetched) {
      setExpanded(true)
      return
    }

    // Lazy load full synopsis
    setLoading(true)
    try {
      const res = await api.get(`/novels/${slug}/synopsis`)
      const text = res.data?.synopsis || fullText
      setFullText(text)
      setFetched(true)
      setExpanded(true)
    } catch {
      setExpanded(true)
    } finally {
      setLoading(false)
    }
  }, [expanded, fetched, slug, fullText])

  if (!fullText && !synopsis) return null

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>📖 Giới Thiệu</span>
      </div>

      <div style={{ position: 'relative' }}>
        <p
          ref={textRef}
          style={{
            ...styles.text,
            ...(expanded ? {} : {
              display: '-webkit-box',
              WebkitLineClamp: maxLines,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }),
          }}
        >
          {fullText}
        </p>

        {/* Gradient fade ở cuối khi chưa mở rộng */}
        {!expanded && (clamped || hasMore) && (
          <div style={styles.fadeGradient} />
        )}
      </div>

      {/* Nút xem thêm / thu gọn */}
      {(clamped || hasMore || expanded) && (
        <button
          onClick={handleExpandClick}
          disabled={loading}
          style={styles.toggleBtn}
          aria-expanded={expanded}
        >
          {loading ? (
            <span style={styles.loadingDot}>Đang tải...</span>
          ) : expanded ? (
            <>Thu gọn <span style={styles.chevron}>▲</span></>
          ) : (
            <>Xem thêm <span style={styles.chevron}>▼</span></>
          )}
        </button>
      )}
    </div>
  )
}

const styles = {
  container: {
    background: 'var(--glass-bg, rgba(255,255,255,0.04))',
    border: '1px solid var(--border, rgba(255,255,255,0.08))',
    borderRadius: '12px',
    padding: '16px 20px',
    marginBottom: '16px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '10px',
  },
  title: {
    fontWeight: 700,
    fontSize: '0.9rem',
    color: 'var(--text-muted, rgba(255,255,255,0.6))',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  text: {
    margin: 0,
    lineHeight: 1.75,
    fontSize: '0.92rem',
    color: 'var(--text, #e2e8f0)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    transition: 'all 0.3s ease',
  },
  fadeGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '48px',
    background: 'linear-gradient(to bottom, transparent, var(--bg, #0f172a))',
    pointerEvents: 'none',
  },
  toggleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginTop: '10px',
    padding: '5px 12px',
    background: 'transparent',
    border: '1px solid var(--border, rgba(255,255,255,0.12))',
    borderRadius: '6px',
    color: 'var(--accent, #818cf8)',
    fontSize: '0.82rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
    letterSpacing: '0.02em',
  },
  chevron: {
    fontSize: '0.7em',
    opacity: 0.8,
  },
  loadingDot: {
    opacity: 0.6,
    fontStyle: 'italic',
  },
}
