import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Home, ChevronUp, Settings, Type, Maximize2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import api from '../api'

// Mặc định cho người dùng mới (người dùng cũ giữ nguyên cài đặt đã lưu)
const DEFAULT_SETTINGS = {
  fontSize: 21,
  fontFamily: 'Times New Roman, serif',
  theme: 'sepia',
  contentWidth: 800,
  lineHeight: 1.7,
}

const THEMES = {
  white: { bg: '#ffffff', text: '#1a1a1a', border: '#e5e7eb', panel: '#f9fafb' },
  sepia: { bg: '#f4ecd8', text: '#5b4636', border: '#dcd1b3', panel: '#efe5cd' },
  green: { bg: '#e8f5e9', text: '#2e4a31', border: '#c8e6c9', panel: '#dceddc' },
  dark:  { bg: '#1a1a1a', text: '#d1d5db', border: '#333333', panel: '#262626' },
  blue:  { bg: '#f0f4f8', text: '#2d3748', border: '#d1d5db', panel: '#e2e8f0' },
}

// Đọc vị trí cuộn hiện tại (window hoặc .main-content, tuỳ layout)
function readScroll() {
  const mc = document.querySelector('.main-content')
  const winTop = window.scrollY || document.documentElement.scrollTop || 0
  const mcTop = mc ? mc.scrollTop : 0
  if (mc && mcTop > winTop) {
    return { top: mcTop, max: Math.max(1, mc.scrollHeight - mc.clientHeight) }
  }
  return { top: winTop, max: Math.max(1, document.documentElement.scrollHeight - window.innerHeight) }
}

function scrollAllTo(top, smooth = false) {
  const opts = smooth ? { top, behavior: 'smooth' } : { top }
  window.scrollTo(opts)
  const mc = document.querySelector('.main-content')
  if (mc) mc.scrollTo(opts)
}

export default function Reader() {
  const { slug, chapter } = useParams()
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [chapters, setChapters] = useState([])
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [progress, setProgress] = useState(0)
  const [hideTopNav, setHideTopNav] = useState(false)

  const lastScrollRef = useRef(0)
  const saveScrollTimerRef = useRef(null)
  const touchRef = useRef(null)

  // ── Reader Settings (Persistent) ──────────────────────────────────────────
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('readerSettings') || 'null')
      // Merge: cài đặt đã lưu của người dùng cũ luôn thắng mặc định mới
      return saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  })
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    localStorage.setItem('readerSettings', JSON.stringify(settings))
  }, [settings])

  const updateSetting = (key, val) => setSettings(prev => ({ ...prev, [key]: val }))

  // ───────────────────────────────────────────────────────────────────────────

  const saveReadProgress = useCallback((novelSlug, chapId) => {
    try {
      // 1. Lưu Cookie
      document.cookie = `last_read_novel=${novelSlug}; path=/; max-age=31536000; SameSite=Lax`;
      document.cookie = `last_read_chapter_${novelSlug}=${encodeURIComponent(chapId)}; path=/; max-age=31536000; SameSite=Lax`;

      // 2. Lưu localStorage
      localStorage.setItem('last_read_novel', novelSlug);
      localStorage.setItem(`last_read_chapter_${novelSlug}`, chapId);

      // 3. Lưu mảng danh sách chương đã đọc
      const readListKey = `read_chapters_${novelSlug}`;
      const readList = JSON.parse(localStorage.getItem(readListKey) || '[]');
      if (!readList.includes(chapId)) {
        readList.push(chapId);
        localStorage.setItem(readListKey, JSON.stringify(readList));
      }
    } catch (err) {
      console.error('Error saving read progress:', err);
    }
  }, []);

  useEffect(() => {
    setLoading(true)
    api.get(`/novels/${slug}/chapters/${chapter}`)
      .then(res => {
        setContent(res.data.content)
        setLoading(false)
        // Lưu tiến trình đọc
        saveReadProgress(slug, chapter)
      })
      .catch(err => {
        console.error(err)
        setContent('# Lỗi tải chương\nNội dung chưa sẵn sàng hoặc lỗi kết nối. Vui lòng thử lại sau.')
        setLoading(false)
      })
  }, [slug, chapter, saveReadProgress])

  useEffect(() => {
    api.get(`/novels/${slug}/chapters`).then(res => setChapters(res.data))
  }, [slug])

  // ── Khôi phục vị trí cuộn (sessionStorage, theo slug + chương) ─────────────
  useEffect(() => {
    if (loading) return
    const key = `readerScroll_${slug}_${chapter}`
    let savedPct = NaN
    try { savedPct = parseFloat(sessionStorage.getItem(key)) } catch { /* ignore */ }
    requestAnimationFrame(() => {
      if (!isNaN(savedPct) && savedPct > 0.005) {
        const { max } = readScroll()
        scrollAllTo(savedPct * max)
        lastScrollRef.current = savedPct * max
      } else {
        scrollAllTo(0)
        lastScrollRef.current = 0
      }
      setHideTopNav(false)
    })
  }, [loading, slug, chapter])

  // ── Theo dõi cuộn: progress bar + FAB + auto-hide nav + lưu vị trí ─────────
  useEffect(() => {
    const scrollKey = `readerScroll_${slug}_${chapter}`

    const handleScroll = () => {
      const { top, max } = readScroll()
      setProgress(Math.min(100, Math.max(0, (top / max) * 100)))
      setShowScrollTop(top > 400)

      // Auto-hide top nav: cuộn xuống thì ẩn, cuộn lên thì hiện
      const last = lastScrollRef.current
      if (top > last + 8 && top > 120) setHideTopNav(true)
      else if (top < last - 8 || top <= 120) setHideTopNav(false)
      lastScrollRef.current = top

      // Lưu vị trí đọc (throttle ~500ms)
      if (!saveScrollTimerRef.current) {
        saveScrollTimerRef.current = setTimeout(() => {
          saveScrollTimerRef.current = null
          const s = readScroll()
          try { sessionStorage.setItem(scrollKey, String(s.top / s.max)) } catch { /* ignore */ }
        }, 500)
      }
    }

    const mc = document.querySelector('.main-content')
    window.addEventListener('scroll', handleScroll, { passive: true })
    if (mc) mc.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (mc) mc.removeEventListener('scroll', handleScroll)
      if (saveScrollTimerRef.current) {
        clearTimeout(saveScrollTimerRef.current)
        saveScrollTimerRef.current = null
      }
    }
  }, [slug, chapter])

  const getChapNum = (title) => {
    const m = title.match(/第(\d+)章|[Cc]hapter\s*(\d+)|Chương\s*(\d+)|(\d+)\./)
    return m ? (m[1] || m[2] || m[3] || m[4]) : null
  }

  const isNumberParam = /^\d+$/.test(chapter)
  const currentChapterIndex = isNumberParam
    ? chapters.findIndex(c => getChapNum(c.title) === chapter)
    : chapters.findIndex(c => c.filename === chapter)

  const isAuthorNote = !isNumberParam && chapters.some(c => c.filename === chapter && !getChapNum(c.title))
  const prevChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null
  const nextChapter = currentChapterIndex !== -1 && currentChapterIndex < chapters.length - 1 ? chapters[currentChapterIndex + 1] : null

  const getChapterUrl = (c) => {
    if (!c) return '#'
    const num = getChapNum(c.title)
    return `/novel/${slug}/read/${num ? num : encodeURIComponent(c.filename)}`
  }

  const goNext = useCallback(() => {
    if (nextChapter) navigate(getChapterUrl(nextChapter))
  }, [nextChapter, slug, navigate])

  const goPrev = useCallback(() => {
    if (prevChapter) navigate(getChapterUrl(prevChapter))
  }, [prevChapter, slug, navigate])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goNext, goPrev])

  const scrollToTop = () => scrollAllTo(0, true)

  // ── Tap zones (mobile): chạm mép trái/phải để chuyển chương ────────────────
  const handleZoneTouchStart = (e) => {
    const t = e.touches[0]
    touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
  }

  const makeZoneTouchEnd = (dir) => (e) => {
    const start = touchRef.current
    touchRef.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = Math.abs(t.clientX - start.x)
    const dy = Math.abs(t.clientY - start.y)
    const dt = Date.now() - start.time
    // Bỏ qua nếu người dùng đang cuộn / giữ lâu (chọn văn bản)
    if (dx > 10 || dy > 10 || dt > 400) return
    if (window.getSelection && String(window.getSelection())) return
    e.preventDefault()
    if (dir === 'prev') goPrev()
    else goNext()
  }

  const currentTheme = THEMES[settings.theme] || THEMES.sepia

  const NavBar = ({ position }) => {
    const isBottom = position === 'bottom'

    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isBottom ? '2rem 0 calc(4rem + env(safe-area-inset-bottom, 0px))' : '1rem 0', gap: '12px',
        flexWrap: 'wrap', position: 'relative', zIndex: 60
      }}>
        <Link
          to={`/novel/${slug}`}
          title="Về trang chi tiết"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '58px', height: '58px', borderRadius: '18px',
            background: currentTheme.panel, color: currentTheme.text,
            border: `2px solid ${currentTheme.border}`, textDecoration: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}
        >
          <Home size={24} />
        </Link>

        <div style={{ display: 'flex', gap: '12px', flex: 1, justifyContent: 'center' }}>
          <button
            className="btn"
            onClick={goPrev}
            disabled={!prevChapter}
            style={{
              background: currentTheme.panel, color: currentTheme.text,
              border: `2px solid ${currentTheme.border}`,
              opacity: prevChapter ? 1 : 0.3, padding: '0 1.5rem', height: '58px',
              borderRadius: '18px', minWidth: '80px'
            }}
          >
            <ArrowLeft size={22} />
            <span className="hide-mobile" style={{ marginLeft: '8px', fontWeight: 700 }}>Trước</span>
          </button>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: currentTheme.panel, color: currentTheme.text,
            border: `2px solid ${currentTheme.border}`,
            borderRadius: '18px', padding: '0 20px', fontSize: '1.1rem', fontWeight: 800,
            opacity: 0.9, minWidth: '90px'
          }}>
            {isAuthorNote ? '📝' : `${currentChapterIndex + 1}/${chapters.length}`}
          </div>

          <button
            className="btn"
            onClick={goNext}
            disabled={!nextChapter}
            style={{
              background: 'var(--accent)', color: 'white',
              border: 'none', opacity: nextChapter ? 1 : 0.3, padding: '0 1.5rem', height: '58px',
              borderRadius: '18px', boxShadow: '0 8px 25px rgba(59,130,246,0.4)',
              flex: isBottom ? 1 : 'unset', // Make it larger at bottom
              minWidth: '100px'
            }}
          >
            <span style={{ marginRight: '8px', fontWeight: 800 }}>{isBottom ? 'CHƯƠNG TIẾP' : 'Tiếp'}</span>
            <ArrowRight size={22} />
          </button>
        </div>

        <button
          onClick={() => setShowSettings(true)}
          title="Cài đặt giao diện"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '58px', height: '58px', borderRadius: '18px',
            background: currentTheme.panel, color: currentTheme.text,
            border: `2px solid ${currentTheme.border}`, cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}
        >
          <Settings size={24} />
        </button>
      </div>
    )
  }

  return (
    <div className="reader-root" style={{
      background: currentTheme.bg, color: currentTheme.text,
      minHeight: '100vh', transition: 'background 0.3s, color 0.3s'
    }}>
      {/* Reading progress bar (3px, trên cùng) */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0,
          height: '3px', width: `${progress}%`,
          background: currentTheme.text, opacity: 0.85,
          zIndex: 200, pointerEvents: 'none',
          borderRadius: '0 2px 2px 0',
          transition: 'width 0.1s linear'
        }}
      />

      <div className="container reader-container" style={{
        maxWidth: `${settings.contentWidth}px`, width: '100%',
        margin: '0 auto', padding: '0 1.25rem'
      }}>
        {/* Top nav: sticky + tự ẩn khi cuộn xuống, hiện lại khi cuộn lên */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 70,
          background: currentTheme.bg,
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3px)',
          transform: hideTopNav ? 'translateY(-115%)' : 'translateY(0)',
          transition: 'transform 0.3s ease, background 0.3s'
        }}>
          <NavBar position="top" />
        </div>

        <div
          className="reader-content"
          style={{
            padding: '1rem 0 3rem',
            fontSize: `${settings.fontSize}px`,
            fontFamily: settings.fontFamily,
            lineHeight: settings.lineHeight,
            transition: 'font-size 0.2s',
            wordBreak: 'normal', overflowWrap: 'break-word'
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', opacity: 0.5, padding: '6rem 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📖</div>
              Đang tải nội dung...
            </div>
          ) : (
            <ReactMarkdown
              components={{
                h1: ({ node, ...props }) => (
                  <h1 style={{
                    fontSize: '1.6em', fontWeight: 800,
                    marginBottom: '2.5rem', color: 'inherit',
                    borderBottom: `3px solid ${currentTheme.border}`,
                    paddingBottom: '1.25rem', lineHeight: 1.3,
                  }} {...props} />
                ),
                p: ({ node, ...props }) => (
                  <p style={{
                    marginBottom: '1.6em', textIndent: '1.2em',
                    textAlign: 'justify'
                  }} {...props} />
                ),
                hr: ({ node, ...props }) => (
                  <hr style={{
                    border: 'none', borderTop: `2px solid ${currentTheme.border}`,
                    margin: '3.5rem 0',
                  }} {...props} />
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          )}
        </div>

        <NavBar position="bottom" />
      </div>

      {/* Tap zones (chỉ hiện trên thiết bị cảm ứng): chạm mép = chuyển chương */}
      {!showSettings && !loading && (
        <>
          {prevChapter && (
            <div
              className="tap-zone tap-zone-left"
              aria-hidden="true"
              onTouchStart={handleZoneTouchStart}
              onTouchEnd={makeZoneTouchEnd('prev')}
            />
          )}
          {nextChapter && (
            <div
              className="tap-zone tap-zone-right"
              aria-hidden="true"
              onTouchStart={handleZoneTouchStart}
              onTouchEnd={makeZoneTouchEnd('next')}
            />
          )}
        </>
      )}

      {/* Settings Panel (Mobile Drawer Style) */}
      {showSettings && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end'
        }} onClick={() => setShowSettings(false)}>
          <div style={{
            width: '100%', background: '#1e293b', color: 'white',
            borderTopLeftRadius: '24px', borderTopRightRadius: '24px',
            padding: '1.5rem',
            paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
            maxHeight: '85dvh', overflowY: 'auto',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
            animation: 'slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ width: '40px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', margin: '0 auto 1.5rem' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Tuỳ chỉnh</h3>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', minWidth: '44px', minHeight: '44px' }}>✕</button>
            </div>

            {/* Live preview */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>XEM TRƯỚC</div>
              <div style={{
                background: currentTheme.bg, color: currentTheme.text,
                border: `1px solid ${currentTheme.border}`, borderRadius: '14px',
                padding: '0.9rem 1.1rem',
                fontFamily: settings.fontFamily,
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
                maxHeight: '110px', overflow: 'hidden',
                transition: 'all 0.2s'
              }}>
                Hắc phong gào thét, trăng lạnh treo cao. Hắn khoác áo bào đen, một mình bước vào màn đêm.
              </div>
            </div>

            {/* Theme Grid */}
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', marginBottom: '1rem', letterSpacing: '0.05em' }}>CHỦ ĐỀ</div>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                {Object.entries(THEMES).map(([id, colors]) => (
                  <button
                    key={id}
                    onClick={() => updateSetting('theme', id)}
                    style={{
                      width: '54px', height: '54px', borderRadius: '16px',
                      background: colors.bg, border: settings.theme === id ? '3px solid var(--accent)' : '2px solid rgba(255,255,255,0.1)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
                    }}
                  >
                    {settings.theme === id && <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--accent)' }} />}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Selector */}
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', marginBottom: '1rem', letterSpacing: '0.05em' }}>FONT CHỮ</div>
              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '8px', scrollbarWidth: 'none' }}>
                {['Times New Roman', 'Arial', 'Georgia', 'Palatino', 'Inter'].map(f => {
                  const isActive = settings.fontFamily.includes(f)
                  return (
                    <button
                      key={f}
                      onClick={() => updateSetting('fontFamily', f === 'Arial' || f === 'Inter' ? `${f}, sans-serif` : `${f}, serif`)}
                      style={{
                        padding: '12px 20px', borderRadius: '14px', fontSize: '1rem', whiteSpace: 'nowrap',
                        background: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                        color: isActive ? 'white' : 'rgba(255,255,255,0.7)',
                        border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                        fontWeight: isActive ? 700 : 500, minHeight: '44px'
                      }}
                    >
                      {f}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Controls Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', marginBottom: '0.8rem' }}>CỠ CHỮ</div>
                <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '16px', padding: '6px' }}>
                  <button className="ctrl-btn" onClick={() => updateSetting('fontSize', Math.max(14, settings.fontSize - 1))}><Type size={18} /></button>
                  <span style={{ flex: 1, textAlign: 'center', fontSize: '1.1rem', fontWeight: 800 }}>{settings.fontSize}</span>
                  <button className="ctrl-btn" onClick={() => updateSetting('fontSize', Math.min(36, settings.fontSize + 1))}><Type size={24} /></button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', marginBottom: '0.8rem' }}>DÀN TRANG</div>
                <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '16px', padding: '6px' }}>
                  <button className="ctrl-btn" onClick={() => updateSetting('contentWidth', Math.max(400, settings.contentWidth - 50))}><Maximize2 size={18} /></button>
                  <span style={{ flex: 1, textAlign: 'center', fontSize: '1.1rem', fontWeight: 800 }}>{settings.contentWidth}</span>
                  <button className="ctrl-btn" onClick={() => updateSetting('contentWidth', Math.min(1200, settings.contentWidth + 50))}><Maximize2 size={24} /></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FABs */}
      <div style={{
        position: 'fixed',
        bottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))',
        right: 'calc(1.5rem + env(safe-area-inset-right, 0px))',
        display: 'flex', flexDirection: 'column', gap: '1rem', zIndex: 90
      }}>
        {showScrollTop && (
          <button onClick={scrollToTop} className="fab"><ChevronUp size={24} /></button>
        )}
        <button onClick={() => setShowSettings(true)} className="fab" style={{ background: 'var(--accent)', color: 'white', border: 'none' }}>
          <Settings size={24} />
        </button>
      </div>

      <style>{`
        @keyframes slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .reader-root { cursor: default; }
        .fab {
          width: 58px; height: 58px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);
          background: rgba(30,41,59,0.85); backdrop-filter: blur(12px); color: rgba(255,255,255,0.8);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .fab:active { transform: scale(0.92); }
        .ctrl-btn {
          width: 48px; height: 48px; border-radius: 12px; border: none;
          background: rgba(255,255,255,0.15); color: white; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .ctrl-btn:active { background: var(--accent); transform: scale(0.95); }
        .hide-mobile { display: inline; }

        /* Tap zones: mặc định ẩn, chỉ bật trên thiết bị cảm ứng màn hình nhỏ */
        .tap-zone { display: none; }
        @media (hover: none) and (pointer: coarse) and (max-width: 768px) {
          .tap-zone {
            display: block;
            position: fixed; top: 0; bottom: 0; width: 18%;
            z-index: 30; background: transparent;
            -webkit-tap-highlight-color: transparent;
          }
          .tap-zone-left { left: 0; }
          .tap-zone-right { right: 0; }
        }

        @media (max-width: 800px) {
          .reader-container { max-width: 100% !important; padding: 0 1rem !important; }
        }
        @media (max-width: 600px) {
          .hide-mobile { display: none; }
          .reader-content { padding: 1rem 0 3rem !important; }
        }
      `}</style>

    </div>
  )
}
