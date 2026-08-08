import React, { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Play, BookOpen, Search, ArrowUpDown,
  ChevronDown, ChevronUp, Shield, Heart, BookMarked,
} from 'lucide-react'
import api from '../api'
import userApi, { isLoggedIn } from '../userApi'
import NovelCover from '../components/NovelCover'
import { getLastReadForSlug, fmtChapterLabel, getReadChapters } from '../utils/readingHistory'
import { fmtTimeAgo, fmtNumber } from '../utils/format'
import SynopsisPanel from '../components/SynopsisPanel'

const PAGE_SIZE = 100

// Lấy số chương từ tiêu đề (giống Reader.jsx)
const getChapNum = (title) => {
  const m = title.match(/第(\d+)章|[Cc]hapter\s*(\d+)|Chương\s*(\d+)|(\d+)\./)
  return m ? (m[1] || m[2] || m[3] || m[4]) : null
}

const chapterUrl = (slug, chap) => {
  return `/novel/${slug}/read/${encodeURIComponent(chap.filename || chap.chapter_number || chap.title)}`
}

const cleanTitle = (title) =>
  title.replace(/第\d+章\s*/, '').replace(/Chapter\s*\d+[\s:.]*/i, '').trim() || title

/**
 * Trang chi tiết truyện dành cho GUEST (public).
 * Hero + thanh hành động + danh sách chương (tìm kiếm, đảo chiều, tải thêm 100).
 */
export default function NovelPage() {
  const { slug } = useParams()
  const [novel, setNovel] = useState(null)
  const [chapters, setChapters] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setNovel(null)
    setChapters([])
    setError(null)
    Promise.all([
      api.get(`/novels/${slug}`),
      api.get(`/novels/${slug}/chapters`),
    ])
      .then(([nRes, cRes]) => {
        if (!alive) return
        setNovel(nRes.data)
        setChapters(cRes.data || [])
      })
      .catch(() => { if (alive) setError('Không tải được thông tin truyện.') })
    return () => { alive = false }
  }, [slug])

  if (error) {
    return (
      <div className="container" style={{ paddingTop: '2rem' }}>
        <div className="glass-panel p-6" style={{ color: '#fca5a5' }}>{error}</div>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '1rem' }}>
          <ArrowLeft size={15} /> Về trang chủ
        </Link>
      </div>
    )
  }

  if (!novel) {
    return (
      <div className="container" style={{ paddingTop: '3rem', color: 'var(--text-muted)' }}>
        Đang tải...
      </div>
    )
  }

  const isAdmin = localStorage.getItem('userRole') === 'admin'
  const lastRead = getLastReadForSlug(slug)
  const firstChapter = chapters[0]

  return (
    <div className="container animate-fade-in">
      <Link to="/" style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem', minHeight: '44px',
      }}>
        <ArrowLeft size={15} /> Trang chủ
      </Link>

      {/* ── Hero ── */}
      <div className="novel-hero">
        <NovelCover novel={novel} size="lg" />
        <div style={{ minWidth: 0 }}>
          <h1 className="novel-hero__title">{novel.title}</h1>
          <div className="novel-hero__sub">
            {[novel.original_title, novel.author].filter(Boolean).join(' • ')}
          </div>
          <div className="novel-hero__badges">
            {novel.genre && <span className="novel-hero__badge">{novel.genre}</span>}
            <span className="novel-hero__badge" style={{
              background: 'rgba(16,185,129,0.1)', color: 'var(--success)', borderColor: 'rgba(16,185,129,0.2)',
            }}>
              {fmtNumber(novel.chapter_count)} chương đã dịch
            </span>
          </div>
          {novel.last_translated_at && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Cập nhật {fmtTimeAgo(novel.last_translated_at)}
            </div>
          )}
          {novel.notes && <CollapsibleNotes notes={novel.notes} />}
        </div>
      </div>

      {/* ── Synopsis / Giới thiệu nhanh ── */}
      {novel.synopsis && (
        <SynopsisPanel
          slug={slug}
          synopsis={novel.synopsis}
          hasMore={novel.has_more_synopsis}
          maxLines={5}
        />
      )}

      {/* ── Thanh hành động ── */}
      <div className="novel-action-bar">
        {firstChapter && (
          <Link to={chapterUrl(slug, firstChapter)} className="btn btn-primary">
            <Play size={16} /> Đọc từ đầu
          </Link>
        )}
        {lastRead && (
          <Link to={`/novel/${slug}/read/${lastRead}`} className="btn btn-secondary">
            <BookOpen size={16} /> Đọc tiếp Ch. {fmtChapterLabel(lastRead)}
          </Link>
        )}
        <Link
          to={`/novel/${slug}/epub-reader`}
          className="btn btn-secondary"
          title="Đọc EPUB trực tiếp trên trình duyệt"
          style={{ gap: '6px' }}
        >
          <BookMarked size={16} /> Đọc EPUB
        </Link>
        <FollowButton slug={slug} />
      </div>

      {/* ── Danh sách chương ── */}
      <ChapterList slug={slug} chapters={chapters} />

      {/* Link nhỏ cho admin */}
      {isAdmin && (
        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <Link to={`/admin/novels/${slug}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            fontSize: '0.8rem', color: 'var(--text-muted)', minHeight: '44px',
          }}>
            <Shield size={13} /> Mở trong Quản trị
          </Link>
        </div>
      )}
    </div>
  )
}

/**
 * Nút Theo dõi / Đang theo dõi (bookmark của user).
 * Chưa đăng nhập → điều hướng /account để đăng nhập/đăng ký.
 */
function FollowButton({ slug }) {
  const navigate = useNavigate()
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setFollowing(false)
    if (!isLoggedIn()) return undefined
    userApi.get('/user/bookmarks')
      .then(res => {
        if (alive) setFollowing((res.data || []).some(b => b.slug === slug))
      })
      .catch(() => { /* phiên hết hạn / lỗi mạng — coi như chưa theo dõi */ })
    return () => { alive = false }
  }, [slug])

  const toggle = async () => {
    if (!isLoggedIn()) {
      navigate('/account')
      return
    }
    if (busy) return
    setBusy(true)
    const next = !following
    setFollowing(next) // optimistic
    try {
      if (next) await userApi.put(`/user/bookmarks/${slug}`)
      else await userApi.delete(`/user/bookmarks/${slug}`)
    } catch (err) {
      setFollowing(!next) // hoàn tác
      if (err.response?.status === 401) navigate('/account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={`btn btn-follow${following ? ' is-following' : ''}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
    >
      <Heart size={16} fill={following ? 'currentColor' : 'none'} />
      {following ? 'Đang theo dõi' : 'Theo dõi'}
    </button>
  )
}

/** Ghi chú truyện — mặc định thu gọn 3 dòng. */
function CollapsibleNotes({ notes }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <p style={{
        fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.6,
        ...(expanded ? {} : {
          display: '-webkit-box', WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }),
      }}>
        {notes}
      </p>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          background: 'none', border: 'none', color: 'var(--accent)',
          fontSize: '0.78rem', cursor: 'pointer', padding: '6px 0', minHeight: '32px',
          display: 'inline-flex', alignItems: 'center', gap: '3px',
        }}
      >
        {expanded ? <>Thu gọn <ChevronUp size={13} /></> : <>Xem thêm <ChevronDown size={13} /></>}
      </button>
    </div>
  )
}

/**
 * Danh sách chương guest: tìm kiếm + đảo chiều mới/cũ + phân trang "Tải thêm 100".
 * Không bao giờ render toàn bộ (xich-tam có 1835 chương).
 */
function ChapterList({ slug, chapters }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortDesc, setSortDesc] = useState(false) // mặc định cũ → mới (đọc từ đầu)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Đổi bộ lọc → reset phân trang
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [searchTerm, sortDesc, slug])

  // Set các chương đã đọc (helper dùng chung với Reader — key read_chapters_<slug>)
  const readChapters = useMemo(() => getReadChapters(slug), [slug])

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase()
    let list = q
      ? chapters.filter(c =>
          c.title.toLowerCase().includes(q) || c.filename.toLowerCase().includes(q))
      : chapters
    if (sortDesc) list = [...list].reverse()
    return list
  }, [chapters, searchTerm, sortDesc])

  if (chapters.length === 0) {
    return (
      <div className="glass-panel p-6 text-center text-muted">
        Chưa có chương nào được dịch.
      </div>
    )
  }

  const shown = filtered.slice(0, visibleCount)
  const remaining = filtered.length - shown.length

  return (
    <div className="glass-panel" style={{ padding: '1rem' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 170px', minWidth: 0 }}>
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
            style={{ paddingLeft: '32px', fontSize: '0.875rem', height: '40px' }}
          />
        </div>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {searchTerm
            ? <>{filtered.length} / {chapters.length}</>
            : <><strong style={{ color: 'var(--text-main)' }}>{chapters.length}</strong> chương</>}
        </span>
        <button
          onClick={() => setSortDesc(v => !v)}
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px',
            padding: '0 12px', height: '40px', minHeight: '40px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-panel)',
            color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: 500,
          }}
        >
          <ArrowUpDown size={13} />
          {sortDesc ? 'Mới → Cũ' : 'Cũ → Mới'}
        </button>
      </div>

      {/* Danh sách */}
      {shown.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
          Không tìm thấy chương phù hợp.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {shown.map(chap => {
            const num = getChapNum(chap.title)
            const isRead = readChapters.has(chap.filename) || (num && readChapters.has(String(num)))
            return (
              <Link
                key={chap.filename}
                className="chapter-list-row"
                to={chapterUrl(slug, chap)}
                style={{ opacity: isRead ? 0.6 : 1 }}
              >
                <span style={{
                  flexShrink: 0, minWidth: '42px', textAlign: 'right',
                  fontSize: '0.72rem', fontWeight: 600,
                  color: num ? 'var(--accent)' : '#fbbf24',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {num ? `#${num}` : '✦'}
                </span>
                <span style={{ width: '1px', height: '14px', background: 'var(--border-panel)', flexShrink: 0 }} />
                <span style={{
                  flex: 1, fontSize: '0.875rem',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {cleanTitle(chap.title)}
                </span>
                {isRead && (
                  <span style={{
                    fontSize: '0.68rem', color: '#10b981', background: 'rgba(16,185,129,0.1)',
                    padding: '1px 6px', borderRadius: '4px', flexShrink: 0, fontWeight: 500,
                  }}>
                    ✓
                  </span>
                )}
                <span style={{ color: 'var(--text-muted)', opacity: 0.4, flexShrink: 0, fontSize: '0.75rem' }}>›</span>
              </Link>
            )
          })}
        </div>
      )}

      {/* Tải thêm */}
      {remaining > 0 && (
        <button
          className="btn btn-secondary"
          onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
          style={{ width: '100%', marginTop: '0.85rem', minHeight: '48px', fontSize: '0.88rem' }}
        >
          Tải thêm {Math.min(PAGE_SIZE, remaining)} chương ({remaining} còn lại)
        </button>
      )}
    </div>
  )
}
