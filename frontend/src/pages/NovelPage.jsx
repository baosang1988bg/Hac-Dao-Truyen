import PropTypes from 'prop-types'
import { chapterType } from '../utils/propTypes'
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Play, BookOpen, Search, ArrowUpDown,
  ChevronDown, ChevronUp, Shield, Heart, BookMarked, RefreshCw,
} from 'lucide-react'
import userApi from '../userApi'
import NovelCover from '../components/NovelCover'
import {
  getLastReadForSlug, fmtChapterLabel, getReadChapters, getStoredEdition, setStoredEdition,
} from '../utils/readingHistory'
import { fmtTimeAgo, fmtNumber, fmtChapterDate, isRecentChapter, fmtNovelTitle, cleanAuthor } from '../utils/format'
import { splitGenres } from '../utils/genreLabels'
import SynopsisPanel from '../components/SynopsisPanel'
import NovelRating from '../components/NovelRating'
import {
  normalizeChapterCatalog, getChapNum, chapterUrl,
  normalizeEditionCode, chapterListPath, withEditionQuery, DEFAULT_EDITION_CODE,
} from '../utils/chapters'
import { fetchEditions } from '../engagementApi'
import { useCachedGet } from '../utils/apiCache'
import { runWhenIdle } from '../utils/idle'
import useDocumentTitle from '../hooks/useDocumentTitle'
import ScrollToTopButton from '../components/ui/ScrollToTopButton'
import { withViewTransition } from '../utils/motion'
import { trackEvent } from '../utils/analytics'
import { useAuth } from '../context/useAuth'
import '../styles/reading.css'
import '../styles/novel-reader.css'

const PAGE_SIZE = 100

const cleanTitle = (title) =>
  title.replace(/第\d+章\s*/, '').replace(/Chapter\s*\d+[\s:.]*/i, '').trim() || title

/** Tên truyện hiển thị: title_is_slug (Worker chưa có tên thật) → làm đẹp slug. */
function displayNovelTitle(novel, slug) {
  if (!novel) return ''
  return fmtNovelTitle(novel.title_is_slug ? '' : novel.title, novel.slug || slug, novel.original_title)
}

/** Truyện chỉ có EPUB (chưa có chương dịch online). */
function isEpubOnly(novel) {
  return Boolean(novel?.has_epub) && !(Number(novel?.chapter_count) > 0)
}

/** Nhãn số chương ở hero — truyện chỉ có EPUB không hiện "0 chương đã dịch". */
function chapterCountLabel(novel) {
  if (isEpubOnly(novel)) {
    const total = Number(novel.total_chapters)
    return total > 0 ? `${fmtNumber(total)} chương (EPUB)` : 'Bản EPUB'
  }
  return `${fmtNumber(novel.chapter_count || 0)} chương đã dịch`
}

// ── Bản dịch đã chọn (nhớ theo truyện, khoá 'hd:ban:<slug>' ở utils/readingHistory) ──
const EDITION_KIND_LABELS = { ai: 'Dịch AI', human: 'Dịch giả', convert: 'Convert' }

/**
 * Trang chi tiết truyện dành cho GUEST (public).
 * Hero + thanh hành động + danh sách chương (tìm kiếm, đảo chiều, tải thêm 100).
 * `key={slug}` → đổi truyện thì state reset sạch (không hiện tạm dữ liệu truyện cũ).
 */
export default function NovelPage() {
  const { slug } = useParams()
  return <NovelPageContent key={slug} slug={slug} />
}

/**
 * Render tiến dần: chi tiết truyện và mục lục tải ĐỘC LẬP qua apiCache (dùng
 * chung với Reader) → hero hiện ngay khi có chi tiết (hoặc tức thì nếu đã cache),
 * danh sách chương có skeleton riêng.
 */
function NovelPageContent({ slug }) {
  const novelReq = useCachedGet(`/novels/${slug}`)
  // Nhiều bản dịch: chỉ tải /editions khi Worker báo có bản phụ (edition_count > 0)
  // → truyện thường không tốn thêm request. Lựa chọn chỉ có hiệu lực khi mã đã
  // lưu nằm trong danh sách bản published; còn lại dùng bản mặc định.
  const editionCount = Number(novelReq.data?.edition_count) || 0
  const [editions, setEditions] = useState(null)
  const [storedBan, setStoredBan] = useState(() => getStoredEdition(slug))
  useEffect(() => {
    if (editionCount <= 0) return undefined
    let alive = true
    fetchEditions(slug).then(list => { if (alive) setEditions(list) })
    return () => { alive = false }
  }, [slug, editionCount])
  const ban = editionCount > 0 && storedBan && editions?.some(e => e.code === storedBan) ? storedBan : null
  const chooseEdition = (code) => {
    const next = normalizeEditionCode(code)
    setStoredBan(next)
    setStoredEdition(slug, next)
    trackEvent('select_content', { content_type: 'edition', item_id: next || DEFAULT_EDITION_CODE, novel_slug: slug })
  }
  const chaptersReq = useCachedGet(chapterListPath(slug, ban))
  const novel = novelReq.data
  const chapters = useMemo(() => normalizeChapterCatalog(chaptersReq.data), [chaptersReq.data])
  const title = displayNovelTitle(novel, slug)
  useDocumentTitle(title)

  // Người đọc thường bấm "Đọc" ngay sau đó → tải sẵn chunk Reader khi rảnh.
  useEffect(() => runWhenIdle(() => { import('./Reader').catch(() => {}) }, { timeout: 3000 }), [])

  // Thanh CTA dính đáy (mobile): hiện khi thanh hành động đã cuộn KHUẤT phía
  // trên (không hiện khi thanh hành động vẫn đang nằm dưới màn hình).
  const actionBarRef = useRef(null)
  const [actionBarPassed, setActionBarPassed] = useState(false)
  const hasNovel = Boolean(novel)
  useEffect(() => {
    const el = actionBarRef.current
    if (!hasNovel || !el || typeof IntersectionObserver !== 'function') return undefined
    const io = new IntersectionObserver(([entry]) => {
      setActionBarPassed(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNovel])

  if (!novel && novelReq.error) {
    const notFound = novelReq.error?.response?.status === 404
    return (
      <div className="container" style={{ paddingTop: '2rem' }}>
        <div className="glass-panel hd-error-block" role="alert">
          <div className="hd-error-block__title" style={{ color: '#fca5a5' }}>
            {notFound ? 'Không tìm thấy truyện.' : 'Không tải được thông tin truyện.'}
          </div>
          {!notFound && (
            <div className="hd-error-block__desc">Kiểm tra kết nối mạng rồi thử lại.</div>
          )}
          <div className="hd-error-block__actions">
            {!notFound && (
              <button type="button" className="btn btn-primary" onClick={() => { novelReq.reload(); chaptersReq.reload() }}>
                <RefreshCw size={15} /> Thử lại
              </button>
            )}
            <Link to="/" className="btn btn-secondary">
              <ArrowLeft size={15} /> Về trang chủ
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!novel) {
    return <NovelPageSkeleton />
  }

  const isAdmin = localStorage.getItem('userRole') === 'admin'
  const lastRead = getLastReadForSlug(slug)
  const firstChapter = chapters[0]
  const epubOnly = isEpubOnly(novel)
  // Nút chính: có lịch sử → "Đọc tiếp", chưa có → "Đọc từ đầu".
  const mainCta = lastRead
    ? { to: withEditionQuery(`/novel/${slug}/read/${lastRead}`, ban), label: `Đọc tiếp Ch. ${fmtChapterLabel(lastRead)}`, icon: BookOpen }
    : firstChapter
      ? { to: chapterUrl(slug, firstChapter, ban), label: 'Đọc từ đầu', icon: Play }
      : null
  const showStickyCta = Boolean(mainCta) && actionBarPassed
  const MainIcon = mainCta?.icon

  return (
    // hd-page-enter: chỉ opacity (trang chứa nút nổi position:fixed)
    <div className={`container hd-page-enter novel-page${showStickyCta ? ' has-sticky-cta' : ''}`}>
      <Link to="/" style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem', minHeight: '44px',
      }}>
        <ArrowLeft size={15} /> Trang chủ
      </Link>

      {/* ── Hero ── */}
      <div className="novel-hero">
        <NovelCover novel={{ ...novel, title }} size="lg" />
        <div className="novel-hero__info">
          <h1 className="novel-hero__title">{title}</h1>
          <div className="novel-hero__sub">
            {[novel.original_title !== title ? novel.original_title : '', cleanAuthor(novel.author)].filter(Boolean).join(' • ')}
          </div>
          <div className="novel-hero__badges">
            {/* Thể loại: tách chuỗi gộp + Việt hoá mã thô (cultivation → Tu Tiên), tối đa 4 badge */}
            {splitGenres(novel.genre).slice(0, 4).map(g => (
              <span key={g} className="novel-hero__badge">{g}</span>
            ))}
            <span className="novel-hero__badge" style={{
              background: 'rgba(16,185,129,0.1)', color: 'var(--success)', borderColor: 'rgba(16,185,129,0.2)',
            }}>
              {chapterCountLabel(novel)}
            </span>
          </div>
          {novel.last_translated_at && (
            <div className="novel-hero__meta">
              Cập nhật {fmtTimeAgo(novel.last_translated_at)}
            </div>
          )}
          {novel.notes && <CollapsibleNotes notes={novel.notes} />}
          {/* Chấm sao — điểm TB chỉ hiện khi API trả số thật (chi tiết truyện
              cho khách hiện chưa kèm rating → hiện sau khi chấm). */}
          <NovelRating
            slug={slug}
            initialRating={typeof novel.rating === 'number' ? novel.rating : undefined}
            initialCount={typeof novel.rating_count === 'number' ? novel.rating_count : undefined}
          />
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

      {/* ── Thanh hành động ──
          Mobile: nút chính full-width, các nút phụ chia đều 1 hàng (novel-reader.css). */}
      <div className="novel-action-bar hd-reveal" ref={actionBarRef} style={{ '--i': 2 }} data-track-section="novel_action_bar">
        {mainCta && (
          <Link
            to={mainCta.to}
            className="btn btn-primary hd-press novel-action-bar__main"
            data-track-action={lastRead ? 'continue_reading' : 'start_reading'}
          >
            <MainIcon size={18} aria-hidden="true" /> <span>{mainCta.label}</span>
          </Link>
        )}
        <div className="novel-action-bar__secondary">
          {lastRead && firstChapter && (
            <Link to={chapterUrl(slug, firstChapter, ban)} className="btn btn-secondary hd-press">
              <Play size={16} aria-hidden="true" /> <span>Đọc từ đầu</span>
            </Link>
          )}
          <Link
            to={`/novel/${slug}/epub-reader`}
            className={`btn hd-press ${epubOnly && !firstChapter ? 'btn-primary' : 'btn-secondary'}`}
            title="Đọc EPUB trực tiếp trên trình duyệt"
          >
            <BookMarked size={16} aria-hidden="true" /> <span>Đọc EPUB</span>
          </Link>
          <FollowButton slug={slug} />
        </div>
      </div>

      {/* ── Bộ chọn bản dịch: chỉ khi truyện có bản dịch phụ đang published ── */}
      {editionCount > 0 && Array.isArray(editions) && editions.length > 1 && (
        <EditionPicker editions={editions} value={ban || DEFAULT_EDITION_CODE} onChange={chooseEdition} />
      )}

      {/* ── Danh sách chương (skeleton/lỗi riêng, không chặn hero) ── */}
      {chaptersReq.data === undefined ? (
        chaptersReq.error ? (
          <div className="glass-panel hd-error-block" role="alert" style={{ padding: '2rem 1rem' }}>
            <div className="hd-error-block__desc">Không tải được danh sách chương.</div>
            <button type="button" className="btn btn-secondary" onClick={chaptersReq.reload}>
              <RefreshCw size={15} /> Thử lại
            </button>
          </div>
        ) : (
          <ChapterListSkeleton />
        )
      ) : (
        <ChapterList slug={slug} chapters={chapters} epubOnly={epubOnly && !ban} ban={ban} />
      )}

      {/* Thanh "Đọc tiếp" dính đáy — chỉ hiện trên mobile (CSS) khi thanh hành
          động đã cuộn khuất; nằm ngay trên bottom tab bar. */}
      {mainCta && (
        <div className={`novel-sticky-cta${showStickyCta ? ' is-visible' : ''}`} aria-hidden={!showStickyCta} data-track-section="novel_sticky_cta">
          <Link to={mainCta.to} className="btn btn-primary hd-press" tabIndex={showStickyCta ? undefined : -1}>
            <MainIcon size={18} aria-hidden="true" /> <span>{mainCta.label}</span>
          </Link>
        </div>
      )}

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

      {/* Nút cuộn lên đầu trang — mobile: đẩy lên trên thanh CTA dính đáy (--novel-cta-h) */}
      <ScrollToTopButton bottomOffset="calc(var(--hd-fab-bottom, 1.5rem) + var(--novel-cta-h, 0px) + env(safe-area-inset-bottom, 0px))" />
    </div>
  )
}
NovelPageContent.propTypes = {
  slug: PropTypes.string.isRequired,
}

/** Skeleton cả trang khi chưa có chi tiết truyện. */
function NovelPageSkeleton() {
  return (
    <div className="container hd-page-skeleton" role="status" aria-live="polite" aria-label="Đang tải thông tin truyện">
      <div className="hd-page-skeleton__hero">
        <span className="hd-skel hd-page-skeleton__cover" />
        <div className="hd-page-skeleton__lines">
          <span className="hd-skel hd-page-skeleton__line hd-page-skeleton__line--title" />
          <span className="hd-skel hd-page-skeleton__line" style={{ width: '45%' }} />
          <span className="hd-skel hd-page-skeleton__line" style={{ width: '30%' }} />
        </div>
      </div>
      <ChapterListSkeleton />
    </div>
  )
}

/** Skeleton riêng cho mục lục (hero đã hiện). */
function ChapterListSkeleton() {
  return (
    <div className="glass-panel chapter-list-panel" role="status" aria-label="Đang tải danh sách chương">
      <div className="hd-chapter-skeleton">
        <span className="hd-skel hd-chapter-skeleton__row" style={{ height: '44px', marginBottom: '6px' }} />
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="hd-skel hd-chapter-skeleton__row" />
        ))}
      </div>
    </div>
  )
}

/**
 * Nút Theo dõi / Đang theo dõi (bookmark của user).
 * Chưa đăng nhập → mở hộp đăng nhập dùng chung (requireLogin); đăng nhập xong
 * theo dõi luôn truyện này (PUT idempotent), không phải rời trang.
 */
function FollowButton({ slug }) {
  const { user, requireLogin } = useAuth()
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)
  // Đang ghi / vừa ghi bookmark → bỏ qua kết quả GET /user/bookmarks gửi đi
  // TRƯỚC khi ghi xong (vừa đăng nhập: GET chạy song song với PUT, có thể chưa
  // thấy truyện vừa theo dõi).
  const writingRef = useRef(false)
  const lastWriteAtRef = useRef(0)
  const userId = user?.id ?? null

  useEffect(() => {
    let alive = true
    setFollowing(false)
    if (userId == null) return undefined
    const startedAt = Date.now()
    userApi.get('/user/bookmarks')
      .then(res => {
        if (!alive || writingRef.current || startedAt < lastWriteAtRef.current) return
        setFollowing((res.data || []).some(b => b.slug === slug))
      })
      .catch(() => { /* phiên hết hạn / lỗi mạng — coi như chưa theo dõi */ })
    return () => { alive = false }
  }, [slug, userId])

  const toggle = async () => {
    if (busy) return
    const wasLoggedIn = Boolean(user)
    if (!wasLoggedIn) {
      // Phễu "muốn theo dõi nhưng chưa có tài khoản" → đo tỉ lệ chuyển sang đăng ký.
      trackEvent('login_prompt', { feature: 'follow', novel_slug: slug })
    }
    try {
      await requireLogin('Đăng nhập để theo dõi truyện')
    } catch {
      return // đóng hộp đăng nhập
    }
    setBusy(true)
    writingRef.current = true
    // Vừa đăng nhập: chưa biết trạng thái trên server → luôn "theo dõi".
    const next = wasLoggedIn ? !following : true
    const prev = following
    setFollowing(next) // optimistic
    try {
      if (next) await userApi.put(`/user/bookmarks/${slug}`)
      else await userApi.delete(`/user/bookmarks/${slug}`)
      trackEvent(next ? 'novel_follow' : 'novel_unfollow', { novel_slug: slug, source: 'novel_page' })
    } catch (err) {
      setFollowing(prev) // hoàn tác
      // Phiên hết hạn (interceptor đã xoá) → mời đăng nhập lại ngay tại chỗ.
      if (err.response?.status === 401) requireLogin('Phiên đã hết hạn — đăng nhập lại để theo dõi').catch(() => {})
    } finally {
      writingRef.current = false
      lastWriteAtRef.current = Date.now()
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={`btn btn-follow hd-press${following ? ' is-following' : ''}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
    >
      <Heart size={16} fill={following ? 'currentColor' : 'none'} aria-hidden="true" />
      <span>{following ? 'Đang theo dõi' : 'Theo dõi'}</span>
    </button>
  )
}
FollowButton.propTypes = {
  slug: PropTypes.string,
};


/** Ghi chú truyện — mặc định thu gọn 3 dòng. */
function CollapsibleNotes({ notes }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <p className={`novel-notes__text${expanded ? '' : ' is-clamped'}`}>
        {notes}
      </p>
      <button
        type="button"
        className="novel-notes-toggle"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        {expanded
          ? <>Thu gọn <ChevronUp size={16} aria-hidden="true" /></>
          : <>Xem thêm <ChevronDown size={16} aria-hidden="true" /></>}
      </button>
    </div>
  )
}
CollapsibleNotes.propTypes = {
  notes: PropTypes.string,
};


/**
 * Danh sách chương guest: tìm kiếm + đảo chiều mới/cũ + phân trang "Tải thêm 100".
 * Không bao giờ render toàn bộ (xich-tam có 1835 chương).
 */
function ChapterList({ slug, chapters, epubOnly, ban = null }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortDesc, setSortDesc] = useState(false) // mặc định cũ → mới (đọc từ đầu)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Đổi bộ lọc / đổi bản dịch → reset phân trang
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [searchTerm, sortDesc, slug, ban])

  // Set các chương đã đọc (helper dùng chung với Reader — key read_chapters_<slug>)
  const readChapters = useMemo(() => getReadChapters(slug), [slug])
  const currentChapter = getLastReadForSlug(slug)

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
        {epubOnly
          ? <>Truyện này hiện có bản EPUB — bấm <Link to={`/novel/${slug}/epub-reader`}>Đọc EPUB</Link> để đọc.</>
          : 'Chưa có chương nào được dịch.'}
      </div>
    )
  }

  // Đảo thứ tự qua View Transitions (crossfade danh sách). flushSync để DOM
  // cập nhật NGAY trong callback — trình duyệt chụp ảnh "sau" đúng trạng thái mới.
  const toggleSort = () => {
    withViewTransition(() => { flushSync(() => setSortDesc(v => !v)) })
  }

  const shown = filtered.slice(0, visibleCount)
  const remaining = filtered.length - shown.length

  return (
    <div className="glass-panel chapter-list-panel hd-reveal" style={{ '--i': 3 }} data-track-section="novel_chapter_list">
      {/* Toolbar */}
      <div className="chapter-list-toolbar">
        <div className="chapter-list-search">
          <Search size={16} aria-hidden="true" style={{
            position: 'absolute', left: '10px', top: '50%',
            transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none',
          }} />
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            className="input-field"
            placeholder="Tìm chương..."
            aria-label="Tìm chương theo tên hoặc số"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '34px', fontSize: '1rem' }}
          />
        </div>
        <span className="chapter-list-count">
          {searchTerm
            ? <>{filtered.length} / {chapters.length}</>
            : <><strong style={{ color: 'var(--text-main)' }}>{chapters.length}</strong> chương</>}
        </span>
        <button
          type="button"
          className={`chapter-sort-button${sortDesc ? ' is-desc' : ''}`}
          onClick={toggleSort}
          aria-label={sortDesc ? 'Đang xếp mới đến cũ — đổi thành cũ đến mới' : 'Đang xếp cũ đến mới — đổi thành mới đến cũ'}
        >
          <ArrowUpDown size={18} aria-hidden="true" />
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
            const currentCandidates = [chap.number, chap.chapter_number, num, chap.filename]
              .filter(value => value !== null && value !== undefined)
              .map(String)
            const isCurrent = currentChapter != null && currentCandidates.includes(String(currentChapter))
            const isNew = isRecentChapter(chap.created_at)
            const dateLabel = fmtChapterDate(chap.created_at)
            return (
              <Link
                key={chap.filename}
                className={`chapter-list-row${isRead ? ' is-read' : ''}${isCurrent ? ' is-current' : ''}`}
                to={chapterUrl(slug, chap, ban)}
                aria-current={isCurrent ? 'page' : undefined}
              >
                <span className={`chapter-list-row__num${num ? '' : ' is-special'}`}>
                  {num ? `#${num}` : '✦'}
                </span>
                <span className="chapter-list-row__sep" aria-hidden="true" />
                <span className="chapter-list-row__title">
                  {cleanTitle(chap.title)}
                </span>
                {isNew && (
                  <span className="chapter-list-row__badge-new">Mới</span>
                )}
                {dateLabel && (
                  <span className="chapter-list-row__date">{dateLabel}</span>
                )}
                {(isRead || isCurrent) && (
                  <span className="chapter-list-row__state">
                    {isCurrent ? 'Đang đọc' : '✓'}
                  </span>
                )}
                <span className="chapter-list-row__chevron" aria-hidden="true">›</span>
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
ChapterList.propTypes = {
  slug: PropTypes.string,
  chapters: PropTypes.arrayOf(chapterType),
  epubOnly: PropTypes.bool,
  ban: PropTypes.string,
};

/** Bộ chọn "Bản dịch" (truyentrung: một truyện nhiều bản dịch) + thông tin bản đang chọn. */
function EditionPicker({ editions, value, onChange }) {
  const current = editions.find(e => e.code === value) || editions[0]
  const meta = [
    EDITION_KIND_LABELS[current?.kind] || '',
    current?.translator ? `Người dịch: ${current.translator}` : '',
    Number(current?.chapter_count) > 0 ? `${fmtNumber(current.chapter_count)} chương` : '',
  ].filter(Boolean).join(' • ')
  return (
    <div className="glass-panel novel-edition-picker" data-track-section="novel_edition_picker"
      style={{ padding: '0.75rem 1rem', marginBottom: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Bản dịch</span>
        <select
          className="input-field"
          value={current?.code || DEFAULT_EDITION_CODE}
          onChange={e => onChange(e.target.value)}
          style={{ flex: '1 1 14rem', minHeight: '44px', fontSize: '1rem' }}
        >
          {editions.map(e => (
            <option key={e.code} value={e.code}>{e.name}{e.default ? ' (mặc định)' : ''}</option>
          ))}
        </select>
      </label>
      {meta && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{meta}</div>}
      {current?.license_note && !current.default && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Nguồn/giấy phép: {current.license_note}</div>
      )}
    </div>
  )
}
EditionPicker.propTypes = {
  editions: PropTypes.arrayOf(PropTypes.shape({
    code: PropTypes.string.isRequired,
    name: PropTypes.string,
    kind: PropTypes.string,
    translator: PropTypes.string,
    license_note: PropTypes.string,
    chapter_count: PropTypes.number,
    default: PropTypes.bool,
  })).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};
