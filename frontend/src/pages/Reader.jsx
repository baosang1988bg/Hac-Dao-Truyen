import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, List, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import api from '../api'

export default function Reader() {
  const { slug, chapter } = useParams()
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [chapters, setChapters] = useState([])
  const [showScrollTop, setShowScrollTop] = useState(false)

  // Fetch chapter list once per slug
  useEffect(() => {
    api.get(`/novels/${slug}/chapters`)
      .then(res => setChapters(res.data))
      .catch(console.error)
  }, [slug])

  // Fetch content + scroll to top whenever chapter changes
  useEffect(() => {
    setLoading(true)
    setContent('')
    window.scrollTo({ top: 0, behavior: 'instant' })

    // Also scroll the main-content div (used in desktop layout)
    const mainContent = document.querySelector('.main-content')
    if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'instant' })

    api.get(`/novels/${slug}/chapters/${chapter}`)
      .then(res => {
        setContent(res.data.content)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setContent('# Lỗi tải chương\nKhông tìm thấy file. Vui lòng kiểm tra lại.')
        setLoading(false)
      })
  }, [slug, chapter])

  // Show/hide scroll-to-top button
  useEffect(() => {
    const el = document.querySelector('.main-content') || window
    const handleScroll = () => {
      const scrollY = el === window ? window.scrollY : el.scrollTop
      setShowScrollTop(scrollY > 400)
    }
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // Helper: detect if a chapter is an author note (no chapter number)
  const getChapNum = (title) => {
    const m = title.match(/第(\d+)章|[Cc]hapter\s*(\d+)|Chương\s*(\d+)|(\d+)\./)
    return m ? (m[1] || m[2] || m[3] || m[4]) : null
  }

  // Separate story chapters (numbered) from author notes
  const storyChapters = chapters.filter(c => getChapNum(c.title))

  // Navigation within story chapters only
  const currentStoryIndex = storyChapters.findIndex(c => c.filename === chapter)
  const isAuthorNote      = currentStoryIndex === -1 && chapters.some(c => c.filename === chapter)

  // If reading a story chapter → navigate within story chapters
  // If reading an author note  → no prev/next (or fallback to all chapters)
  const prevChapter = currentStoryIndex > 0
    ? storyChapters[currentStoryIndex - 1]
    : null
  const nextChapter = currentStoryIndex !== -1 && currentStoryIndex < storyChapters.length - 1
    ? storyChapters[currentStoryIndex + 1]
    : null

  const goNext = useCallback(() => {
    if (nextChapter) navigate(`/novel/${slug}/read/${encodeURIComponent(nextChapter.filename)}`)
  }, [nextChapter, slug, navigate])

  const goPrev = useCallback(() => {
    if (prevChapter) navigate(`/novel/${slug}/read/${encodeURIComponent(prevChapter.filename)}`)
  }, [prevChapter, slug, navigate])

  // Keyboard navigation: ← → arrow keys
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goNext, goPrev])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    const mainContent = document.querySelector('.main-content')
    if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const NavBar = ({ position }) => (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '0.5rem',
      flexWrap: 'wrap',
    }}>
      <Link
        to={`/novel/${slug}`}
        className="btn btn-secondary"
        style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}
      >
        <List size={16} />
        <span>Danh sách</span>
      </Link>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          className="btn btn-secondary"
          onClick={goPrev}
          disabled={!prevChapter}
          title="Chương trước (←)"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} />
          <span>Trước</span>
        </button>

        {chapters.length > 0 && (
          <span style={{
            display: 'flex', alignItems: 'center',
            color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0 8px'
          }}>
            {isAuthorNote
              ? <span style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 600 }}>📝 Lưu bút</span>
              : <>{currentStoryIndex + 1} / {storyChapters.length}</>
            }
          </span>
        )}

        <button
          className="btn btn-primary"
          onClick={goNext}
          disabled={!nextChapter}
          title="Chương tiếp (→)"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <span>Tiếp</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )

  return (
    <div className="container animate-fade-in" style={{ maxWidth: '780px' }}>
      {/* Top nav */}
      <div style={{ marginBottom: '1.25rem' }}>
        <NavBar position="top" />
      </div>

      {/* Content panel */}
      <div
        className="glass-panel reader-panel"
        style={{ padding: '2rem 2.5rem', fontSize: '1.12rem', lineHeight: '1.85', letterSpacing: '0.01em' }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4rem 0' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📖</div>
            Đang tải chương...
          </div>
        ) : (
          <ReactMarkdown
            components={{
              h1: ({ node, ...props }) => (
                <h1 style={{
                  fontSize: '1.6rem', fontWeight: 700,
                  marginBottom: '1.75rem', color: 'var(--accent)',
                  borderBottom: '1px solid var(--border-panel)',
                  paddingBottom: '0.85rem', lineHeight: 1.3,
                }} {...props} />
              ),
              p: ({ node, ...props }) => (
                <p style={{
                  marginBottom: '1.4rem', color: 'var(--text-main)',
                  textIndent: '1.5em',
                }} {...props} />
              ),
              hr: ({ node, ...props }) => (
                <hr style={{
                  border: 'none',
                  borderTop: '1px solid var(--border-panel)',
                  margin: '2rem 0',
                }} {...props} />
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ marginTop: '1.25rem', marginBottom: '3rem' }}>
        <NavBar position="bottom" />
      </div>

      {/* Scroll to top FAB */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          title="Lên đầu trang"
          style={{
            position: 'fixed', bottom: '2rem', right: '1.5rem',
            width: '40px', height: '40px',
            borderRadius: '50%', border: '1px solid var(--border-panel)',
            background: 'rgba(30,41,59,0.85)', backdropFilter: 'blur(8px)',
            color: 'var(--text-muted)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s', zIndex: 50,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-panel)' }}
        >
          <ChevronUp size={18} />
        </button>
      )}
    </div>
  )
}
