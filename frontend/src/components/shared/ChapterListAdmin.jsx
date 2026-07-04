import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpDown, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'

/**
 * Tab "Chương" + section "Lưu Bút Tác Giả"
 * (tách nguyên trạng từ ChaptersTab / AuthorNotesSection của NovelDetail.jsx cũ).
 */

function AuthorNotesSection({ chapters, slug, getChapNum }) {
  const [expanded, setExpanded] = useState(false)
  const readChapters = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(`read_chapters_${slug}`) || '[]')
    } catch {
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
                  display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px',
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

export default function ChapterListAdmin({ chapters, slug }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortDesc, setSortDesc] = useState(true)

  const readChapters = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(`read_chapters_${slug}`) || '[]')
    } catch {
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
  const displayNotes = authorNotes.filter(chap =>
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
          <div className="chapters-recent-strip" style={{
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
                    e.currentTarget.style.background = isRead ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.16)'
                    e.currentTarget.style.borderColor = isRead ? 'rgba(16,185,129,0.4)' : 'rgba(59,130,246,0.4)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = isRead ? 'rgba(16,185,129,0.04)' : 'rgba(59,130,246,0.08)'
                    e.currentTarget.style.borderColor = isRead ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.2)'
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
                  display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px',
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

          {displayChapters.map((chap) => {
            const num = getChapNum(chap.title)
            const cleanTitle = chap.title
              .replace(/第\d+章\s*/, '')
              .replace(/Chapter\s*\d+[\s:.]*/i, '')
              .trim() || chap.title
            const isRead = readChapters.includes(chap.filename) || (num && readChapters.includes(String(num)))

            return (
              <Link
                key={chap.filename}
                className="chapter-row"
                to={`/novel/${slug}/read/${num ? num : encodeURIComponent(chap.filename)}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '0.55rem 0.75rem', borderRadius: '8px',
                  color: 'var(--text-main)',
                  textDecoration: 'none', transition: 'background 0.12s',
                  opacity: isRead ? 0.65 : 1,
                }}
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
