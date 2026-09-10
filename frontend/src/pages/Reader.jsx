import PropTypes from 'prop-types'
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Home, ChevronUp, Settings, Download, Volume2, Pause, Square } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import api from '../api'
import userApi, { isLoggedIn } from '../userApi'
import ChapterComments from '../components/ChapterComments'
import ReaderSettingsPanel from '../components/ReaderSettingsPanel'
import useReaderSettings, { THEMES } from '../hooks/useReaderSettings'
import useTextToSpeech from '../hooks/useTextToSpeech'
import { markChapterRead } from '../utils/readingHistory'

const OFFLINE_BATCH_SIZE = 10

// Bỏ cú pháp markdown để giọng đọc không đọc thành tiếng ký tự "#", "*"...
function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~]/g, '')
    .trim()
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

const getChapNum = (title) => {
    const m = title.match(/第(\d+)章|[Cc]hapter\s*(\d+)|Chương\s*(\d+)|(\d+)\./)
    return m ? (m[1] || m[2] || m[3] || m[4]) : null
  }

export default function Reader() {
  const { slug, chapter } = useParams()
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [chapters, setChapters] = useState([])
  const [chaptersLoadError, setChaptersLoadError] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [progress, setProgress] = useState(0)
  const [hideTopNav, setHideTopNav] = useState(false)

  const lastScrollRef = useRef(0)
  const saveScrollTimerRef = useRef(null)
  const touchRef = useRef(null)
  const lastSyncedChapterRef = useRef(null) // debounce: chỉ sync progress khi đổi chương

  // ── Tải trước chương để đọc offline (service worker cache lại) ────────────
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState(null) // { done, total } | null

  // ── Reader Settings (Persistent) ──────────────────────────────────────────
  const { settings, onChange } = useReaderSettings()
  const [showSettings, setShowSettings] = useState(false)

  // ── Text-to-Speech ─────────────────────────────────────────────────────────
  const tts = useTextToSpeech()
  const { stop: ttsStop } = tts

  // ───────────────────────────────────────────────────────────────────────────

  const saveReadProgress = useCallback((novelSlug, chapId) => {
    try {
      // 1. Lưu Cookie
      document.cookie = `last_read_novel=${novelSlug}; path=/; max-age=31536000; SameSite=Lax`;
      document.cookie = `last_read_chapter_${novelSlug}=${encodeURIComponent(chapId)}; path=/; max-age=31536000; SameSite=Lax`;

      // 2. Lưu localStorage
      localStorage.setItem('last_read_novel', novelSlug);
      localStorage.setItem(`last_read_chapter_${novelSlug}`, chapId);
      localStorage.setItem(`last_read_time_${novelSlug}`, String(Date.now()));

      // 3. Đánh dấu chương đã đọc (helper dùng chung với mục lục NovelPage)
      markChapterRead(novelSlug, chapId);
    } catch (err) {
      console.error('Error saving read progress:', err);
    }
  }, []);

  useEffect(() => {
    setLoading(true)
    setDlProgress(null) // đổi chương → reset trạng thái tải offline
    ttsStop() // đổi chương khi đang đọc → dừng để không chồng giọng
    api.get(`/novels/${slug}/chapters/${chapter}`)
      .then(res => {
        setContent(res.data.content)
        setLoading(false)
        // Lưu tiến trình đọc
        saveReadProgress(slug, chapter)
        // Đồng bộ tiến trình lên server nếu đã đăng nhập user
        // (fire-and-forget, chỉ gọi khi chương thực sự đổi)
        const syncKey = `${slug}/${chapter}`
        if (isLoggedIn() && lastSyncedChapterRef.current !== syncKey) {
          lastSyncedChapterRef.current = syncKey
          const chap = /^\d+$/.test(chapter) ? Number(chapter) : chapter
          userApi.put(`/user/progress/${slug}`, { type: 'chapter', chapter: chap }).catch(() => {})
        }
      })
      .catch(err => {
        console.error(err)
        setContent('# Lỗi tải chương\nNội dung chưa sẵn sàng hoặc lỗi kết nối. Vui lòng thử lại sau.')
        setLoading(false)
      })
  }, [slug, chapter, saveReadProgress, ttsStop])

  useEffect(() => {
    setChaptersLoadError(false)
    api.get(`/novels/${slug}/chapters`).then(res => {
      const list = res.data || []
      const seen = new Set()
      const unique = []
      for (const c of list) {
        if (c && c.filename && !seen.has(c.filename)) {
          seen.add(c.filename)
          unique.push(c)
        }
      }
      unique.sort((a, b) => {
        const numA = a.chapter_number != null ? a.chapter_number : (a.number != null ? a.number : 0)
        const numB = b.chapter_number != null ? b.chapter_number : (b.number != null ? b.number : 0)
        if (numA !== numB) return numA - numB
        return (a.filename || '').localeCompare(b.filename || '', undefined, { numeric: true })
      })
      setChapters(unique)
    }).catch(() => { setChaptersLoadError(true) })
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



  const isNumberParam = /^\d+$/.test(chapter)
  const targetNum = isNumberParam ? parseInt(chapter) : null

  const currentChapterIndex = chapters.findIndex(c =>
    c.filename === chapter ||
    decodeURIComponent(chapter) === c.filename ||
    (isNumberParam && (c.chapter_number === targetNum || c.number === targetNum || getChapNum(c.title) === String(targetNum)))
  )

  const isAuthorNote = !isNumberParam && chapters.some(c => c.filename === chapter && !getChapNum(c.title))
  const prevChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null
  const nextChapter = currentChapterIndex !== -1 && currentChapterIndex < chapters.length - 1 ? chapters[currentChapterIndex + 1] : null

  const getChapterUrl = useCallback((c) => {
    if (!c) return '#'
    const num = c.number || c.chapter_number || getChapNum(c.title || '') || getChapNum(c.filename || '')
    return `/novel/${slug}/read/${num || encodeURIComponent(c.filename)}`
  }, [slug])

  const goNext = useCallback(() => {
    if (nextChapter) navigate(getChapterUrl(nextChapter))
  }, [nextChapter, getChapterUrl, navigate])

  const goPrev = useCallback(() => {
    if (prevChapter) navigate(getChapterUrl(prevChapter))
  }, [prevChapter, getChapterUrl, navigate])

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

  // ── Tải N chương kế tiếp: fetch tuần tự để service worker cache lại ───────
  const downloadNextChapters = async () => {
    if (downloading || currentChapterIndex === -1) return
    const next = chapters.slice(
      currentChapterIndex + 1,
      currentChapterIndex + 1 + OFFLINE_BATCH_SIZE
    )
    if (next.length === 0) return
    setDownloading(true)
    setDlProgress({ done: 0, total: next.length })
    let done = 0
    for (const c of next) {
      // Dùng đúng định danh mà Reader sẽ request khi mở chương (số hoặc filename)
      // để URL trùng khớp với cache của service worker
      const id = getChapNum(c.title) || c.filename
      try {
        await api.get(`/novels/${slug}/chapters/${id}`)
      } catch { /* chương lỗi — bỏ qua, tải tiếp chương sau */ }
      done += 1
      setDlProgress({ done, total: next.length })
    }
    setDownloading(false)
  }

  // Theme áp dụng bằng CSS class `reader--<id>` (biến định nghĩa trong index.css,
  // chỉ ảnh hưởng trang đọc). Danh sách theme được dùng chung với EPUB.
  const themeId = THEMES[settings.theme] ? settings.theme : 'sepia'
  const currentTheme = {
    bg: 'var(--reader-bg)',
    text: 'var(--reader-text)',
    border: 'var(--reader-border)',
    panel: 'var(--reader-panel)',
  }

  const NavBar = ({ position }) => {
    const isBottom = position === 'bottom'

    return (
      <>
      {chaptersLoadError && (
        <div style={{
          textAlign: 'center', fontSize: '0.75rem', color: '#f87171',
          padding: isBottom ? '0.5rem 1rem 0' : '0 1rem 0.5rem', opacity: 0.9
        }}>
          Không tải được danh sách chương, nút điều hướng có thể không chính xác
        </div>
      )}
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

        {isBottom && tts.supported && (
          <button
            onClick={() => {
              if (tts.isPlaying && !tts.isPaused) tts.pause()
              else if (tts.isPaused) tts.resume()
              else tts.play(stripMarkdown(content), { voiceName: settings.ttsVoice, rate: settings.ttsRate })
            }}
            title={tts.isPlaying && !tts.isPaused ? 'Tạm dừng đọc' : 'Nghe chương này'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '58px', height: '58px', borderRadius: '18px',
              background: currentTheme.panel, color: currentTheme.text,
              border: `2px solid ${currentTheme.border}`, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          >
            {tts.isPlaying && !tts.isPaused ? <Pause size={24} /> : <Volume2 size={24} />}
          </button>
        )}

        {isBottom && tts.isPlaying && (
          <button
            onClick={tts.stop}
            title="Dừng đọc"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '58px', height: '58px', borderRadius: '18px',
              background: currentTheme.panel, color: currentTheme.text,
              border: `2px solid ${currentTheme.border}`, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          >
            <Square size={20} />
          </button>
        )}

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
      </>
    )
  }

  NavBar.propTypes = { position: PropTypes.string }

  return (
    <div className={`reader-root reader--${themeId}`} style={{
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
                h1: ({ node: _node, ...props }) => (
                  <h1 style={{
                    fontSize: '1.6em', fontWeight: 800,
                    marginBottom: '2.5rem', color: 'inherit',
                    borderBottom: `3px solid ${currentTheme.border}`,
                    paddingBottom: '1.25rem', lineHeight: 1.3,
                  }} {...props} />
                ),
                p: ({ node: _node, ...props }) => (
                  <p className="reader-p" style={{
                    marginBottom: '1.6em', textIndent: '1.2em',
                    wordBreak: 'break-word', overflowWrap: 'break-word'
                  }} {...props} />
                ),
                hr: ({ node: _node, ...props }) => (
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

        {/* Bình luận theo chương — dưới nội dung, trước thanh điều hướng */}
        {!loading && <ChapterComments slug={slug} chapter={chapter} />}

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

            <ReaderSettingsPanel settings={settings} onChange={onChange} />

            {/* Đọc offline: tải trước N chương kế tiếp để service worker cache */}
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', marginBottom: '0.8rem', letterSpacing: '0.05em' }}>ĐỌC OFFLINE</div>
              <button
                onClick={downloadNextChapters}
                disabled={downloading || !nextChapter}
                style={{
                  width: '100%', minHeight: '52px', borderRadius: '16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  background: downloading ? 'rgba(255,255,255,0.1)' : 'var(--accent)',
                  color: 'white', border: 'none', fontSize: '1rem', fontWeight: 700,
                  cursor: downloading || !nextChapter ? 'not-allowed' : 'pointer',
                  opacity: !nextChapter ? 0.4 : 1, transition: 'all 0.2s',
                }}
              >
                <Download size={18} />
                {downloading
                  ? `Đang tải... đã tải ${dlProgress?.done ?? 0}/${dlProgress?.total ?? OFFLINE_BATCH_SIZE}`
                  : dlProgress
                    ? `Đã tải ${dlProgress.done}/${dlProgress.total} chương`
                    : `Tải ${OFFLINE_BATCH_SIZE} chương tiếp`}
              </button>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.6rem', lineHeight: 1.5 }}>
                {nextChapter
                  ? 'Chương đã tải sẽ đọc được cả khi mất mạng.'
                  : 'Đây là chương cuối — không còn chương kế tiếp để tải.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FAB cuộn lên đầu — góc dưới TRÁI, nhỏ gọn, không che tap-zone phải.
          (Nút Cài đặt đã có sẵn ở cả 2 thanh điều hướng nên không cần FAB riêng.) */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fab"
          aria-label="Cuộn lên đầu trang"
          style={{
            position: 'fixed',
            bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))',
            left: 'calc(1rem + env(safe-area-inset-left, 0px))',
            zIndex: 90,
          }}
        >
          <ChevronUp size={20} />
        </button>
      )}

      <style>{`
        @keyframes slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .reader-root { cursor: default; }
        .fab {
          width: 44px; height: 44px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.1);
          background: rgba(30,41,59,0.85); backdrop-filter: blur(12px); color: rgba(255,255,255,0.8);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          opacity: 0.7;
        }
        .fab:active { transform: scale(0.92); opacity: 1; }
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
          .reader-container { max-width: 100% !important; padding: 0 0.85rem !important; }
        }
        @media (max-width: 600px) {
          .hide-mobile { display: none !important; }
          .reader-content { padding: 0.75rem 0 2.5rem !important; }
          .reader-p { text-align: left !important; text-indent: 0.6em !important; }
        }
      `}</style>

    </div>
  )
}
