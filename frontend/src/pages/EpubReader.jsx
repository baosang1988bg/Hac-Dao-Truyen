import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Settings, BookOpen, List, X, Sun, Moon, Minus, Plus } from 'lucide-react'
import api from '../api'

const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * EpubReader — Đọc EPUB trực tiếp trên trình duyệt.
 * Sử dụng epub.js (https://github.com/futurepress/epub.js)
 * EPUB được stream từ Cloudflare R2 qua /api/novels/:slug/epub
 */
export default function EpubReader() {
  const { slug } = useParams()
  const viewerRef = useRef(null)
  const bookRef   = useRef(null)
  const renditionRef = useRef(null)

  const [novel, setNovel]         = useState(null)
  const [toc, setToc]             = useState([])
  const [currentHref, setCurrentHref] = useState('')
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [showToc, setShowToc]     = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [progress, setProgress]   = useState(0) // 0-100%
  const touchStartX = useRef(null)

  // Settings
  const [theme, setTheme]       = useState(() => localStorage.getItem('epub_theme') || 'dark')
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('epub_fontSize') || '18'))
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('epub_font') || 'serif')

  // Save settings
  useEffect(() => { localStorage.setItem('epub_theme', theme) }, [theme])
  useEffect(() => { localStorage.setItem('epub_fontSize', fontSize) }, [fontSize])
  useEffect(() => { localStorage.setItem('epub_font', fontFamily) }, [fontFamily])

  const themes = {
    dark:   { body: { background: '#1a1a2e', color: '#e8e8e8' } },
    sepia:  { body: { background: '#f4ecd8', color: '#3b2f2f' } },
    white:  { body: { background: '#ffffff', color: '#1a1a1a' } },
  }

  const applyTheme = useCallback((rendition, t = theme, fs = fontSize, ff = fontFamily) => {
    if (!rendition) return
    rendition.themes.register('custom', {
      ...themes[t],
      'p, li, div': { 'font-size': `${fs}px !important`, 'line-height': '1.8 !important', 'font-family': `${ff} !important` },
      'h1, h2, h3': { 'font-size': `${fs + 4}px !important`, 'font-family': `${ff} !important` },
    })
    rendition.themes.select('custom')
  }, [theme, fontSize, fontFamily])

  // Load novel info + track view
  useEffect(() => {
    api.get(`/novels/${slug}`).then(r => setNovel(r.data)).catch(() => {})
    // Track view (fire and forget)
    api.post(`/novels/${slug}/view`).catch(() => {})
  }, [slug])

  // Init epub.js
  useEffect(() => {
    if (!viewerRef.current) return
    let destroyed = false

    const initEpub = async () => {
      try {
        const ePub = (await import('epubjs')).default

        // Fetch EPUB as ArrayBuffer
        const res = await fetch(`${API_BASE}/api/novels/${slug}/epub`)
        if (!res.ok) throw new Error(`EPUB chưa có trên R2 (${res.status})`)
        const buffer = await res.arrayBuffer()
        if (destroyed) return

        const book = ePub(buffer)
        bookRef.current = book

        const rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'paginated',
        })
        renditionRef.current = rendition
        applyTheme(rendition)

        // Restore last position
        const savedCfi = localStorage.getItem(`epub_cfi_${slug}`)
        await rendition.display(savedCfi || undefined)

        // Track location + progress
        rendition.on('locationChanged', (loc) => {
          if (loc?.start?.cfi) {
            localStorage.setItem(`epub_cfi_${slug}`, loc.start.cfi)
            localStorage.setItem('last_read_novel', slug)
            localStorage.setItem(`last_read_chapter_${slug}`, 'EPUB')
            localStorage.setItem(`last_read_time_${slug}`, String(Date.now()))
            setCurrentHref(loc.start.href || '')
          }
          // Calculate progress
          try {
            const pct = book.locations.percentageFromCfi(loc?.start?.cfi)
            if (pct >= 0) setProgress(Math.round(pct * 100))
          } catch { /* locations not generated yet */ }
        })

        // Build TOC
        await book.loaded.navigation
        const nav = book.navigation.toc
        setToc(nav)
        setLoading(false)

        // Keyboard navigation
        const onKey = (e) => {
          if (e.key === 'ArrowRight' || e.key === ' ') rendition.next()
          if (e.key === 'ArrowLeft') rendition.prev()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      } catch (err) {
        if (!destroyed) {
          setError(err.message || 'Không thể tải EPUB')
          setLoading(false)
        }
      }
    }

    initEpub()
    return () => {
      destroyed = true
      bookRef.current?.destroy()
    }
  }, [slug])

  // Apply theme/font changes live
  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current)
  }, [theme, fontSize, fontFamily, applyTheme])

  const next = () => renditionRef.current?.next()
  const prev = () => renditionRef.current?.prev()
  const goTo = (href) => { renditionRef.current?.display(href); setShowToc(false) }

  const bgColor = theme === 'dark' ? '#1a1a2e' : theme === 'sepia' ? '#f4ecd8' : '#ffffff'
  const textColor = theme === 'dark' ? '#e8e8e8' : theme === 'sepia' ? '#3b2f2f' : '#1a1a1a'
  const panelBg = theme === 'dark' ? 'rgba(26,26,46,0.95)' : theme === 'sepia' ? 'rgba(244,236,216,0.97)' : 'rgba(255,255,255,0.97)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: bgColor, color: textColor, transition: 'background 0.3s, color 0.3s' }}>

      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 16px', borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`,
        background: panelBg, backdropFilter: 'blur(12px)', flexShrink: 0, zIndex: 10,
      }}>
        <Link to={`/novel/${slug}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: textColor, opacity: 0.7, textDecoration: 'none', fontSize: '0.85rem' }}>
          <ArrowLeft size={16} /> Quay lại
        </Link>

        <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {novel?.title || slug}
        </div>

        <button onClick={() => { setShowToc(t => !t); setShowSettings(false) }} style={iconBtnStyle(textColor)}>
          <List size={18} />
        </button>
        <button onClick={() => { setShowSettings(s => !s); setShowToc(false) }} style={iconBtnStyle(textColor)}>
          <Settings size={18} />
        </button>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>

        {/* Prev button */}
        <button onClick={prev} style={navBtnStyle('left', textColor)}>
          <ChevronLeft size={24} />
        </button>

        {/* EPUB Viewer */}
        <div style={{ flex: 1, position: 'relative' }}>
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', opacity: 0.7 }}>
              <div style={{ width: 40, height: 40, border: '3px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: '0.9rem' }}>Đang tải EPUB...</span>
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '2rem', textAlign: 'center' }}>
              <BookOpen size={48} style={{ opacity: 0.4 }} />
              <div style={{ color: '#f87171', fontWeight: 600 }}>Không tải được EPUB</div>
              <div style={{ fontSize: '0.85rem', opacity: 0.6 }}>{error}</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.5, marginTop: '8px' }}>
                Hãy chạy <code>migrate_to_cloudflare.py</code> với cờ <code>--epub</code> để upload EPUB lên R2
              </div>
            </div>
          )}
          <div
            ref={viewerRef}
            style={{ width: '100%', height: '100%', maxWidth: '720px', margin: '0 auto' }}
            onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
            onTouchEnd={e => {
              if (touchStartX.current === null) return
              const dx = e.changedTouches[0].clientX - touchStartX.current
              touchStartX.current = null
              if (Math.abs(dx) < 40) return
              if (dx < 0) next(); else prev()
            }}
          />
        </div>

        {/* Next button */}
        <button onClick={next} style={navBtnStyle('right', textColor)}>
          <ChevronRight size={24} />
        </button>

        {/* ── TOC Panel ── */}
        {showToc && (
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(300px, 85vw)', background: panelBg, backdropFilter: 'blur(16px)', borderLeft: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`, overflowY: 'auto', zIndex: 20, boxShadow: '-8px 0 24px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}` }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Mục lục</span>
              <button onClick={() => setShowToc(false)} style={iconBtnStyle(textColor)}><X size={16} /></button>
            </div>
            {toc.map((item, i) => (
              <TocItem key={i} item={item} currentHref={currentHref} onGoTo={goTo} textColor={textColor} theme={theme} />
            ))}
          </div>
        )}

        {/* ── Settings Panel ── */}
        {showSettings && (
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(280px, 85vw)', background: panelBg, backdropFilter: 'blur(16px)', borderLeft: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`, overflowY: 'auto', zIndex: 20, boxShadow: '-8px 0 24px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}` }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Tùy chỉnh</span>
              <button onClick={() => setShowSettings(false)} style={iconBtnStyle(textColor)}><X size={16} /></button>
            </div>
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

              {/* Theme */}
              <div>
                <div style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nền</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[['dark', '#1a1a2e', '🌙', 'Tối'], ['sepia', '#f4ecd8', '📜', 'Sepia'], ['white', '#fff', '☀️', 'Sáng']].map(([t, bg, icon, label]) => (
                    <button key={t} onClick={() => setTheme(t)} style={{ flex: 1, padding: '10px 4px', background: bg, border: `2px solid ${theme === t ? '#6366f1' : 'transparent'}`, borderRadius: '10px', cursor: 'pointer', fontSize: '0.8rem', color: t === 'dark' ? '#eee' : '#333', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', transition: 'border-color 0.2s' }}>
                      <span>{icon}</span><span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Font size */}
              <div>
                <div style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cỡ chữ: {fontSize}px</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button onClick={() => setFontSize(f => Math.max(12, f - 2))} style={iconBtnStyle(textColor, '38px')}><Minus size={16} /></button>
                  <div style={{ flex: 1, height: '4px', background: theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)', borderRadius: '2px', position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${((fontSize - 12) / 20) * 100}%`, background: '#6366f1', borderRadius: '2px', transition: 'width 0.2s' }} />
                  </div>
                  <button onClick={() => setFontSize(f => Math.min(32, f + 2))} style={iconBtnStyle(textColor, '38px')}><Plus size={16} /></button>
                </div>
              </div>

              {/* Font family */}
              <div>
                <div style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Font chữ</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[['serif', 'Có chân (Serif)'], ['sans-serif', 'Không chân (Sans)'], ['Georgia, serif', 'Georgia']].map(([ff, label]) => (
                    <button key={ff} onClick={() => setFontFamily(ff)} style={{ padding: '10px 14px', background: fontFamily === ff ? 'rgba(99,102,241,0.2)' : (theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'), border: `1px solid ${fontFamily === ff ? '#6366f1' : 'transparent'}`, borderRadius: '8px', cursor: 'pointer', color: textColor, fontFamily: ff, textAlign: 'left', fontSize: '0.9rem', transition: 'all 0.15s' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* ── Progress bar ── */}
      {!loading && !error && (
        <div style={{ flexShrink: 0, padding: '6px 16px 8px', background: panelBg, borderTop: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1, height: '3px', background: theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', borderRadius: '2px', transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ fontSize: '0.72rem', color: textColor, opacity: 0.5, minWidth: '36px', textAlign: 'right' }}>{progress}%</span>
          </div>
        </div>
      )}
    </div>
  )
}

function TocItem({ item, currentHref, onGoTo, textColor, theme, depth = 0 }) {
  const isActive = currentHref && item.href && currentHref.includes(item.href.split('#')[0])
  return (
    <>
      <button
        onClick={() => onGoTo(item.href)}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: `9px ${16 + depth * 16}px`, border: 'none', cursor: 'pointer',
          background: isActive ? 'rgba(99,102,241,0.2)' : 'transparent',
          color: isActive ? '#818cf8' : textColor,
          fontSize: '0.875rem', borderLeft: isActive ? '3px solid #6366f1' : '3px solid transparent',
          transition: 'all 0.15s',
        }}
      >
        {item.label}
      </button>
      {item.subitems?.map((sub, i) => (
        <TocItem key={i} item={sub} currentHref={currentHref} onGoTo={onGoTo} textColor={textColor} theme={theme} depth={depth + 1} />
      ))}
    </>
  )
}

function iconBtnStyle(textColor, size = '34px') {
  return {
    background: 'transparent', border: 'none', cursor: 'pointer', color: textColor,
    opacity: 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: size, height: size, borderRadius: '8px', transition: 'opacity 0.15s, background 0.15s',
    padding: 0,
  }
}

function navBtnStyle(side, textColor) {
  return {
    position: 'absolute', [side]: 0, top: '50%', transform: 'translateY(-50%)',
    zIndex: 5, background: 'transparent', border: 'none', cursor: 'pointer',
    color: textColor, opacity: 0.3, padding: '16px 8px',
    transition: 'opacity 0.2s',
    display: 'flex', alignItems: 'center',
  }
}
