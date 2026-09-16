import PropTypes from 'prop-types'
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Settings, BookOpen, List, X } from 'lucide-react';
import api from '../api'
import userApi, { isLoggedIn } from '../userApi'
import ReaderSettingsPanel from '../components/ReaderSettingsPanel'
import useReaderSettings, { THEMES } from '../hooks/useReaderSettings'

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
  const lastSyncedCfiRef = useRef(null) // debounce: chỉ sync progress khi CFI thực sự đổi

  const { settings, onChange } = useReaderSettings()
  const { fontSize, fontFamily, contentWidth, lineHeight } = settings
  const theme = THEMES[settings.theme] ? settings.theme : 'sepia'

  const applyTheme = useCallback((rendition) => {
    if (!rendition || !viewerRef.current) return
    // Biến CSS ở trang cha không tự xuyên iframe: lấy màu đã resolve.
    const colors = getComputedStyle(viewerRef.current)
    rendition.themes.register(theme, {
      body: {
        background: `${colors.getPropertyValue('--reader-bg').trim()} !important`,
        color: `${colors.getPropertyValue('--reader-text').trim()} !important`,
      },
      'p, li, div': { 'font-size': `${fontSize}px !important`, 'line-height': `${lineHeight} !important`, 'font-family': `${fontFamily} !important` },
      'h1, h2, h3': { 'font-size': `${fontSize + 4}px !important`, 'font-family': `${fontFamily} !important` },
    })
    rendition.themes.select(theme)
  }, [theme, fontSize, fontFamily, lineHeight])

  const applyThemeRef = useRef(applyTheme)
  useEffect(() => { applyThemeRef.current = applyTheme }, [applyTheme])

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
    let removeKeyboard = () => {}
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lastSyncedCfiRef.current = null

    const initEpub = async () => {
      try {
        const ePub = (await import('epubjs')).default

        // Fetch EPUB as ArrayBuffer
        const res = await fetch(`${API_BASE}/api/novels/${slug}/epub`, { signal: controller.signal })
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
        applyThemeRef.current(rendition)

        // Restore last position — ưu tiên vị trí trên server nếu mới hơn localStorage
        let savedCfi = localStorage.getItem(`epub_cfi_${slug}`)
        if (isLoggedIn()) {
          try {
            const { data } = await userApi.get('/user/progress')
            const remote = data.find(p => p.slug === slug && p.type === 'epub' && p.position)
            if (remote && !destroyed) {
              const timestamp = remote.updated_at.replace(' ', 'T')
              const remoteMs = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? timestamp : timestamp + 'Z')
              const localMs = Number(localStorage.getItem(`last_read_time_${slug}`)) || 0
              if (Number.isFinite(remoteMs) && remoteMs > localMs) {
                savedCfi = remote.position
                lastSyncedCfiRef.current = remote.position
              }
            }
          } catch { /* offline hoặc lỗi mạng — dùng localStorage */ }
        }
        if (destroyed) return
        // Track location + progress
        rendition.on('relocated', (loc) => {
          if (destroyed) return
          if (loc?.start?.cfi) {
            const cfi = loc.start.cfi
            localStorage.setItem(`epub_cfi_${slug}`, cfi)
            localStorage.setItem('last_read_novel', slug)
            localStorage.setItem(`last_read_chapter_${slug}`, 'EPUB')
            localStorage.setItem(`last_read_time_${slug}`, String(Date.now()))
            setCurrentHref(loc.start.href || '')
            if (isLoggedIn() && lastSyncedCfiRef.current !== cfi) {
              lastSyncedCfiRef.current = cfi
              userApi.put(`/user/progress/${slug}`, { type: 'epub', position: cfi }).catch(() => {})
            }
          }
          // Tính % tiến trình — chỉ chính xác SAU KHI book.locations đã generate
          // (xem khối generate/cache bên dưới). Trước đó bỏ qua, không hiện % sai.
          try {
            if (book.locations?.length?.() > 0 && loc?.start?.cfi) {
              const pct = book.locations.percentageFromCfi(loc.start.cfi)
              if (Number.isFinite(pct) && pct >= 0) setProgress(Math.round(pct * 100))
            }
          } catch { /* CFI không khớp locations (vd bản EPUB đã đổi) — bỏ qua, giữ % cũ */ }
        })

        // C06: epub.js cần book.locations.generate() TRƯỚC KHI
        // percentageFromCfi() trả kết quả đúng (nếu chưa generate, hàm này
        // luôn trả giá trị vô nghĩa) — cache kết quả vào localStorage theo
        // slug để không phải generate lại (tốn thời gian) mỗi lần mở lại.
        // Chạy sau khi hiển thị trang đầu, không chặn thời gian tải ban đầu.
        const locKey = `epub_locations_${slug}`
        ;(async () => {
          try {
            const cached = localStorage.getItem(locKey)
            if (cached) {
              await book.locations.load(cached)
            } else {
              await book.locations.generate(1000)
              try { localStorage.setItem(locKey, book.locations.save()) } catch { /* quota đầy — bỏ qua cache */ }
            }
            if (destroyed) return
            // Cập nhật % ngay khi vừa có locations, dùng vị trí hiện tại.
            const currentCfi = renditionRef.current?.currentLocation?.()?.start?.cfi
            if (currentCfi) {
              const pct = book.locations.percentageFromCfi(currentCfi)
              if (Number.isFinite(pct) && pct >= 0 && !destroyed) setProgress(Math.round(pct * 100))
            }
          } catch { /* generate lỗi (epub bất thường) — % không hiển thị, không crash */ }
        })()

        // Đăng ký listener trước display để lưu cả vị trí vừa restore.
        // Fallback (C06): CFI cũ có thể hỏng hoặc không còn khớp nếu EPUB đã
        // được build lại (offset/nội dung đổi) — display() khi đó ném lỗi;
        // dọn CFI hỏng khỏi localStorage và mở lại từ đầu sách thay vì crash
        // cả trang đọc.
        try {
          await rendition.display(savedCfi || undefined)
        } catch (displayErr) {
          console.warn('CFI khôi phục không hợp lệ, mở lại từ đầu sách:', displayErr)
          try { localStorage.removeItem(`epub_cfi_${slug}`) } catch { /* ignore */ }
          lastSyncedCfiRef.current = null
          if (!destroyed) await rendition.display()
        }

        // Build TOC
        await book.loaded.navigation
        if (destroyed) return
        const nav = book.navigation.toc
        setToc(nav)
        setLoading(false)

        // Keyboard navigation
        const onKey = (e) => {
          if (e.key === 'ArrowRight' || e.key === ' ') rendition.next()
          if (e.key === 'ArrowLeft') rendition.prev()
        }
        document.addEventListener('keydown', onKey)
        removeKeyboard = () => document.removeEventListener('keydown', onKey)
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
      controller.abort()
      removeKeyboard()
      bookRef.current?.destroy()
      bookRef.current = null
      renditionRef.current = null
    }
  }, [slug])

  // Apply theme/font changes live
  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current)
  }, [applyTheme])

  useEffect(() => {
    // epub.js chỉ tự nghe window resize; cần dàn trang lại khi đổi độ rộng.
    renditionRef.current?.resize()
  }, [contentWidth])

  const next = () => renditionRef.current?.next()
  const prev = () => renditionRef.current?.prev()
  const goTo = (href) => { renditionRef.current?.display(href); setShowToc(false) }

  const bgColor = 'var(--reader-bg)'
  const textColor = 'var(--reader-text)'
  const panelBg = 'var(--reader-panel)'

  return (
    <div className={`reader-root reader--${theme}`} style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: bgColor, color: textColor, transition: 'background 0.3s, color 0.3s' }}>

      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 16px', borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`,
        background: panelBg, backdropFilter: 'blur(12px)', flexShrink: 0, zIndex: 10,
      }}>
        <Link to={`/novel/${slug}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: 'var(--tap-target-min, 44px)', color: textColor, opacity: 0.7, textDecoration: 'none', fontSize: '0.85rem' }}>
          <ArrowLeft size={16} /> Quay lại
        </Link>

        <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {novel?.title || slug}
        </div>

        <button onClick={() => { setShowToc(t => !t); setShowSettings(false) }} style={iconBtnStyle(textColor)}>
          <List size={18} />
        </button>
        <button aria-label="Cài đặt giao diện" onClick={() => { setShowSettings(s => !s); setShowToc(false) }} style={iconBtnStyle(textColor)}>
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
            style={{ width: '100%', height: '100%', maxWidth: `${contentWidth}px`, margin: '0 auto' }}
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
            <ReaderSettingsPanel settings={settings} onChange={onChange} />
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* ── Progress bar ── */}
      {!loading && !error && (
        <div style={{ flexShrink: 0, padding: '6px 16px 8px', background: panelBg, borderTop: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1, height: '3px', background: theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent-gradient)', borderRadius: '2px', transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ fontSize: 'var(--font-xs, 0.75rem)', color: textColor, opacity: 0.5, minWidth: '36px', textAlign: 'right' }}>{progress}%</span>
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
          minHeight: 'var(--tap-target-min, 44px)', padding: `9px ${16 + depth * 16}px`, border: 'none', cursor: 'pointer',
          background: isActive ? 'rgba(201,147,46,0.2)' : 'transparent',
          color: isActive ? 'var(--accent)' : textColor,
          fontSize: '0.875rem', borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
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
TocItem.propTypes = {
  item: PropTypes.object,
  currentHref: PropTypes.string,
  onGoTo: PropTypes.func,
  textColor: PropTypes.string,
  theme: PropTypes.string,
  depth: PropTypes.number,
};


function iconBtnStyle(textColor, size = '44px') {
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
    minWidth: 'var(--tap-target-min, 44px)', minHeight: 'var(--tap-target-min, 44px)',
    transition: 'opacity 0.2s',
    display: 'flex', alignItems: 'center',
  }
}
