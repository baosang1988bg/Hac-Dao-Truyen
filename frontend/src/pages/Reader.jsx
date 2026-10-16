import PropTypes from 'prop-types'
import { memo, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Home, ChevronUp, Settings, Download, Volume2, Pause, Square, Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import api from '../api'
import userApi, { isLoggedIn, getIdentityNamespace } from '../userApi'
import ChapterComments from '../components/ChapterComments'
import Modal from '../components/ui/Modal'
import ReaderSettingsPanel from '../components/ReaderSettingsPanel'
import useReaderSettings, { THEMES } from '../hooks/useReaderSettings'
import useTextToSpeech from '../hooks/useTextToSpeech'
import useDocumentTitle from '../hooks/useDocumentTitle'
import { saveReadProgress, updateHistoryMeta, fmtChapterLabel } from '../utils/readingHistory'
import {
  normalizeChapterCatalog, getChapNum, chapterIdentifier, chapterUrl, findChapterIndex, chapterRequestId,
} from '../utils/chapters'
import { fmtChapterDate, fmtNovelTitle } from '../utils/format'
import { cachedGet, peekCache } from '../utils/apiCache'
import { runWhenIdle } from '../utils/idle'
import '../styles/reading.css'

const OFFLINE_BATCH_SIZE = 10
// Nội dung chương gần như bất biến → giữ trong apiCache lâu hơn mặc định
// (chuyển qua lại chương trước/sau không tải lại).
const CHAPTER_TTL = 10 * 60_000
// Vị trí cuộn: chỉ nhớ chương GẦN NHẤT của mỗi truyện (localStorage).
const SCROLL_KEY_PREFIX = 'readerPos_'
// Đánh dấu đã tính lượt xem trong phiên này (sessionStorage).
const VIEW_KEY_PREFIX = 'viewed_'

// Theme áp dụng bằng CSS class `reader--<id>` (biến định nghĩa trong index.css,
// chỉ ảnh hưởng trang đọc) → các màu là hằng CSS var, ổn định giữa các render.
const THEME_VARS = {
  bg: 'var(--reader-bg)',
  text: 'var(--reader-text)',
  border: 'var(--reader-border)',
  panel: 'var(--reader-panel)',
}

function readSavedScroll(slug, chapter) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${SCROLL_KEY_PREFIX}${slug}`) || 'null')
    if (saved && String(saved.chapter) === String(chapter) && Number.isFinite(saved.pct)) return saved.pct
  } catch { /* storage bị chặn / dữ liệu hỏng */ }
  return NaN
}

function writeSavedScroll(slug, chapter, pct) {
  try {
    localStorage.setItem(`${SCROLL_KEY_PREFIX}${slug}`, JSON.stringify({ chapter: String(chapter), pct, ts: Date.now() }))
  } catch { /* storage đầy/bị chặn — bỏ qua */ }
}

/** Gọi POST /novels/:slug/view tối đa 1 lần mỗi phiên cho mỗi truyện (bỏ qua lỗi). */
function trackViewOncePerSession(slug) {
  if (!slug) return
  try {
    const key = `${VIEW_KEY_PREFIX}${slug}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch { /* sessionStorage bị chặn — vẫn gửi 1 lần cho lần mount này */ }
  api.post(`/novels/${slug}/view`).catch(() => { /* fire-and-forget */ })
}

/** Phím tắt không được chiếm khi người dùng đang gõ / dùng tổ hợp phím. */
function shouldIgnoreKey(e) {
  if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return true
  const t = e.target
  if (!t) return false
  if (t.isContentEditable) return true
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

// ── C02: đồng bộ tiến trình đọc lên server ──────────────────────────────────
// Contract Worker `userProgressUpdate`: type 'chapter' → field `chapter` PHẢI
// là integer (KHÔNG được gửi filename/string). Chương không có số thứ tự hợp
// lệ (vd author note) thì KHÔNG có cách biểu diễn hợp lệ theo contract này —
// bỏ qua đồng bộ thay vì gửi sai kiểu.
const PROGRESS_RETRY_LIMIT = 3
const PROGRESS_RETRY_BASE_DELAY_MS = 4000

// C04: namespace hàng đợi offline theo danh tính hiện tại (guest hoặc
// user:<id>) — trước đây key chỉ theo slug, nên 2 tài khoản dùng chung trình
// duyệt (đăng xuất rồi đăng nhập tài khoản khác) có thể khiến hàng đợi của
// người trước bị flush lên bằng token của người sau (gán nhầm tiến độ đọc
// giữa các tài khoản).
const PROGRESS_QUEUE_PREFIX = 'progressQueue_'
function progressQueueKey(slug) { return `${PROGRESS_QUEUE_PREFIX}${getIdentityNamespace()}_${slug}` }

// Hàng đợi offline chỉ giữ BẢN MỚI NHẤT (ghi đè, không append lịch sử cũ).
function writeQueuedProgress(slug, chapterNum) {
  try {
    localStorage.setItem(progressQueueKey(slug), JSON.stringify({ chapter: chapterNum, ts: Date.now() }))
  } catch { /* storage đầy/bị chặn — best effort, không crash */ }
}
function readQueuedProgress(slug) {
  try {
    const raw = localStorage.getItem(progressQueueKey(slug))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && Number.isFinite(parsed.chapter)) return parsed
  } catch { /* ignore */ }
  return null
}
function clearQueuedProgress(slug) {
  try { localStorage.removeItem(progressQueueKey(slug)) } catch { /* ignore */ }
}

// Gửi lại TOÀN BỘ hàng đợi offline CỦA DANH TÍNH HIỆN TẠI (mỗi slug tối đa 1
// bản ghi = bản mới nhất) — chạy khi mount và khi có lại kết nối mạng. CHỈ
// đọc key thuộc namespace hiện tại — hàng đợi của tài khoản khác (đăng xuất
// mà chưa kịp flush) nằm im dưới key khác, không bị người đang đăng nhập vô
// tình flush hộ.
async function flushAllQueuedProgress() {
  if (typeof localStorage === 'undefined') return
  const namespacePrefix = `${PROGRESS_QUEUE_PREFIX}${getIdentityNamespace()}_`
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(namespacePrefix)) keys.push(k)
  }
  for (const key of keys) {
    const slugFromKey = key.slice(namespacePrefix.length)
    const queued = readQueuedProgress(slugFromKey)
    if (!queued) continue
    try {
      await userApi.put(`/user/progress/${slugFromKey}`, { type: 'chapter', chapter: queued.chapter })
      clearQueuedProgress(slugFromKey)
    } catch (err) {
      const status = err.response?.status
      // 401/400 là lỗi vĩnh viễn (cần đăng nhập lại / dữ liệu không hợp lệ)
      // — không giữ mãi trong hàng đợi để retry vô ích.
      if (status === 401 || status === 400) clearQueuedProgress(slugFromKey)
      // Lỗi mạng/5xx: giữ nguyên, thử lại ở lần mount/online kế tiếp.
    }
  }
}

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

const navIconStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: '18px',
  background: THEME_VARS.panel, color: THEME_VARS.text,
  border: `2px solid ${THEME_VARS.border}`, textDecoration: 'none', cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
}

/**
 * Thanh điều hướng chương (trên/dưới). Tách khỏi Reader + memo: trước đây khai
 * báo NavBar BÊN TRONG render nên mỗi lần Reader render (vd mỗi sự kiện cuộn)
 * React coi là component mới → unmount/mount lại toàn bộ thanh.
 */
const ReaderNavBar = memo(function ReaderNavBar({
  position, slug, chaptersLoadError, indexLabel,
  hasPrev, hasNext, onPrev, onNext, onOpenSettings,
  ttsSupported, ttsPlaying, ttsPaused, onToggleTts, onStopTts,
}) {
  const isBottom = position === 'bottom'
  const ttsActive = ttsPlaying && !ttsPaused
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
      <div className={`reader-nav reader-nav--${position}`} style={{
        padding: isBottom ? '2rem 0 calc(4rem + env(safe-area-inset-bottom, 0px))' : '1rem 0',
      }}>
        <Link
          to={`/novel/${slug}`}
          title="Về trang chi tiết"
          aria-label="Về trang chi tiết truyện"
          className="reader-nav__icon-button"
          style={navIconStyle}
        >
          <Home size={24} aria-hidden="true" />
        </Link>

        <div className="reader-nav__primary">
          <button
            type="button"
            className="btn reader-nav__chapter-button reader-nav__chapter-button--prev"
            onClick={onPrev}
            disabled={!hasPrev}
            aria-label="Chương trước"
            style={{
              background: THEME_VARS.panel, color: THEME_VARS.text,
              border: `2px solid ${THEME_VARS.border}`,
              borderRadius: '18px'
            }}
          >
            <ArrowLeft size={22} aria-hidden="true" />
            <span className="hide-mobile" style={{ fontWeight: 700 }}>Trước</span>
          </button>

          <div className="reader-nav__chapter-index" aria-label="Vị trí chương" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: THEME_VARS.panel, color: THEME_VARS.text,
            border: `2px solid ${THEME_VARS.border}`,
            borderRadius: '18px', fontWeight: 800,
            opacity: 0.9
          }}>
            {indexLabel}
          </div>

          <button
            type="button"
            className="btn reader-nav__chapter-button reader-nav__chapter-button--next"
            onClick={onNext}
            disabled={!hasNext}
            aria-label="Chương tiếp"
            style={{
              background: 'var(--accent)', color: 'white',
              border: 'none',
              borderRadius: '18px', boxShadow: '0 8px 25px rgba(201,147,46,0.4)',
              flex: isBottom ? 1 : 'unset', // Nút to hơn ở thanh dưới
            }}
          >
            <span style={{ fontWeight: 800 }}>{isBottom ? 'CHƯƠNG TIẾP' : 'Tiếp'}</span>
            <ArrowRight size={22} aria-hidden="true" />
          </button>
        </div>

        {isBottom && ttsSupported && (
          <button
            type="button"
            onClick={onToggleTts}
            title={ttsActive ? 'Tạm dừng đọc' : 'Nghe chương này'}
            aria-label={ttsActive ? 'Tạm dừng đọc' : 'Nghe chương này'}
            className="reader-nav__icon-button"
            style={navIconStyle}
          >
            {ttsActive ? <Pause size={24} aria-hidden="true" /> : <Volume2 size={24} aria-hidden="true" />}
          </button>
        )}

        {isBottom && ttsPlaying && (
          <button
            type="button"
            onClick={onStopTts}
            title="Dừng đọc"
            aria-label="Dừng đọc"
            className="reader-nav__icon-button"
            style={navIconStyle}
          >
            <Square size={20} aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          title="Cài đặt giao diện"
          aria-label="Cài đặt giao diện đọc"
          className="reader-nav__icon-button"
          style={navIconStyle}
        >
          <Settings size={24} aria-hidden="true" />
        </button>
      </div>
    </>
  )
})
ReaderNavBar.propTypes = {
  position: PropTypes.oneOf(['top', 'bottom']).isRequired,
  slug: PropTypes.string.isRequired,
  chaptersLoadError: PropTypes.bool,
  indexLabel: PropTypes.node,
  hasPrev: PropTypes.bool,
  hasNext: PropTypes.bool,
  onPrev: PropTypes.func.isRequired,
  onNext: PropTypes.func.isRequired,
  onOpenSettings: PropTypes.func.isRequired,
  ttsSupported: PropTypes.bool,
  ttsPlaying: PropTypes.bool,
  ttsPaused: PropTypes.bool,
  onToggleTts: PropTypes.func,
  onStopTts: PropTypes.func,
}

/**
 * Bộ component cho ReactMarkdown — tạo lại CHỈ khi ngày đăng chương đổi, để
 * ReactMarkdown không phải dựng lại cây mỗi lần Reader render.
 */
function makeMarkdownComponents(chapterDate) {
  return {
    h1: ({ node: _node, ...props }) => (
      <div>
        <h1 style={{
          fontSize: '1.6em', fontWeight: 800,
          marginBottom: chapterDate ? '0.5rem' : '2.5rem', color: 'inherit',
          borderBottom: chapterDate ? 'none' : `3px solid ${THEME_VARS.border}`,
          paddingBottom: chapterDate ? '0' : '1.25rem', lineHeight: 1.3,
        }} {...props} />
        {chapterDate && (
          <div style={{
            fontSize: '0.8rem', color: 'var(--text-muted)',
            borderBottom: `3px solid ${THEME_VARS.border}`,
            paddingBottom: '1rem', marginBottom: '2.5rem',
            opacity: 0.8,
          }}>
            Đăng lúc: {chapterDate}
          </div>
        )}
      </div>
    ),
    p: ({ node: _node, ...props }) => (
      <p className="reader-p" style={{
        marginBottom: '1.6em', textIndent: '1.2em',
        wordBreak: 'break-word', overflowWrap: 'break-word'
      }} {...props} />
    ),
    hr: ({ node: _node, ...props }) => (
      <hr style={{
        border: 'none', borderTop: `2px solid ${THEME_VARS.border}`,
        margin: '3.5rem 0',
      }} {...props} />
    ),
  }
}

/** Skeleton nội dung chương (màu theo theme đọc). */
function ChapterSkeleton() {
  const widths = ['100%', '96%', '92%', '100%', '88%', '97%', '60%', '100%', '94%', '90%', '70%']
  return (
    <div className="reader-skeleton" role="status" aria-live="polite" aria-label="Đang tải nội dung chương">
      <span className="hd-skel reader-skeleton__title" />
      {widths.map((w, i) => <span key={i} className="hd-skel reader-skeleton__line" style={{ width: w }} />)}
    </div>
  )
}

export default function Reader() {
  const { slug, chapter } = useParams()
  const navigate = useNavigate()

  // ── Nội dung chương ───────────────────────────────────────────────────────
  // doc giữ kết quả của URL đã tải xong. Nếu URL hiện tại chưa có trong doc
  // nhưng đã nằm trong apiCache (vd đã prefetch) → render NGAY từ cache trong
  // cùng lượt render, không nháy skeleton.
  const contentUrl = `/novels/${slug}/chapters/${chapterRequestId(chapter)}`
  const [doc, setDoc] = useState({ url: null, content: '', error: null })
  const [reloadNonce, setReloadNonce] = useState(0)
  const docMatches = doc.url === contentUrl
  const peeked = docMatches ? undefined : peekCache(contentUrl)
  const content = docMatches ? doc.content : (typeof peeked?.content === 'string' ? peeked.content : '')
  const loadError = docMatches ? doc.error : null
  const ready = docMatches ? !doc.error : typeof peeked?.content === 'string'
  const loading = !ready && !loadError

  // ── Mục lục + chi tiết truyện (apiCache dùng chung với NovelPage) ─────────
  const chaptersUrl = `/novels/${slug}/chapters`
  const [catalog, setCatalog] = useState(() => ({ slug, raw: peekCache(chaptersUrl) }))
  const [chaptersLoadError, setChaptersLoadError] = useState(false)
  const [novel, setNovel] = useState(() => peekCache(`/novels/${slug}`) || null)
  const chapters = useMemo(
    () => (catalog.slug === slug ? normalizeChapterCatalog(catalog.raw) : []),
    [catalog, slug],
  )

  const [showScrollTop, setShowScrollTop] = useState(false)
  const [hideTopNav, setHideTopNav] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null) // null | 'saving' | 'saved' | 'error'

  const progressBarRef = useRef(null)
  const lastScrollRef = useRef(0)
  const saveScrollTimerRef = useRef(null)
  const touchRef = useRef(null)
  const lastAttemptedSyncKeyRef = useRef(null) // debounce: chỉ THỬ sync 1 lần khi đổi chương (không phải "đã synced")
  const contentEpochRef = useRef(0) // C01: chỉ áp dụng response của lần fetch MỚI NHẤT
  const progressEpochRef = useRef(0) // C02: hủy retry cũ khi chuyển chương tiếp trước khi retry xong
  const novelRef = useRef(novel)
  novelRef.current = novel
  // Chỉ lưu vị trí cuộn khi nội dung chương hiện tại đã hiển thị (tránh ghi
  // vị trí của skeleton / chương cũ vào key của chương mới).
  const readyRef = useRef(ready)
  readyRef.current = ready

  // ── Tải trước chương để đọc offline (service worker cache lại) ────────────
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState(null) // { done, total } | null

  // ── Reader Settings (Persistent) ──────────────────────────────────────────
  const { settings, onChange } = useReaderSettings()
  const [showSettings, setShowSettings] = useState(false)

  // ── Text-to-Speech ─────────────────────────────────────────────────────────
  const tts = useTextToSpeech()
  const { stop: ttsStop, play: ttsPlay, pause: ttsPause, resume: ttsResume } = tts

  // ───────────────────────────────────────────────────────────────────────────

  const novelTitle = novel ? fmtNovelTitle(novel.title_is_slug ? '' : novel.title, novel.slug || slug) : ''

  // C02: đồng bộ tiến trình lên server — debounce thực sự (1 lần/chương, không
  // theo scroll), retry hữu hạn CHỈ cho lỗi mạng/5xx, KHÔNG retry 401/400 (lỗi
  // vĩnh viễn cần user can thiệp), và CHỈ coi là "đã lưu" sau response 200 thật
  // (không đánh dấu synced lạc quan trước khi có xác nhận).
  const syncProgress = useCallback((novelSlug, chapterNum) => {
    writeQueuedProgress(novelSlug, chapterNum) // giữ bản mới nhất trong hàng đợi ngay từ đầu
    const myEpoch = ++progressEpochRef.current
    setSyncStatus('saving')

    const attempt = async (retriesLeft) => {
      if (progressEpochRef.current !== myEpoch) return // đã chuyển chương khác — bỏ, request mới lo việc này
      try {
        await userApi.put(`/user/progress/${novelSlug}`, { type: 'chapter', chapter: chapterNum })
        if (progressEpochRef.current !== myEpoch) return
        clearQueuedProgress(novelSlug)
        setSyncStatus('saved')
      } catch (err) {
        if (progressEpochRef.current !== myEpoch) return
        const status = err.response?.status
        if (status === 401 || status === 400 || retriesLeft <= 0) {
          setSyncStatus('error') // lỗi vĩnh viễn hoặc hết lượt retry — giữ trong hàng đợi để thử lại lần sau
          return
        }
        const delay = PROGRESS_RETRY_BASE_DELAY_MS * (PROGRESS_RETRY_LIMIT - retriesLeft + 1)
        setTimeout(() => attempt(retriesLeft - 1), delay)
      }
    }
    attempt(PROGRESS_RETRY_LIMIT)
  }, [])

  // Gửi lại hàng đợi offline (nếu có bản chưa sync từ phiên trước) khi mở lại
  // trang và mỗi khi có lại kết nối mạng.
  useEffect(() => {
    if (!isLoggedIn()) return
    flushAllQueuedProgress()
    window.addEventListener('online', flushAllQueuedProgress)
    return () => window.removeEventListener('online', flushAllQueuedProgress)
  }, [])

  // Lượt xem: 1 lần / phiên / truyện.
  useEffect(() => { trackViewOncePerSession(slug) }, [slug])

  // ── Tải nội dung chương (qua apiCache: chương đã prefetch → tức thì) ──────
  useEffect(() => {
    const myEpoch = ++contentEpochRef.current
    const controller = new AbortController()
    setDlProgress(null) // đổi chương → reset trạng thái tải offline
    ttsStop() // đổi chương khi đang đọc → dừng để không chồng giọng
    cachedGet(contentUrl, { ttl: CHAPTER_TTL, signal: controller.signal, force: reloadNonce > 0 })
      .then(data => {
        // C01: chuyển chương nhanh có thể khiến response chương CŨ về SAU
        // response chương MỚI — so epoch trước khi apply, bỏ qua nếu đã lỗi thời.
        if (contentEpochRef.current !== myEpoch) return
        if (typeof data?.content !== 'string') throw new Error('Chương không có nội dung')
        setDoc({ url: contentUrl, content: data.content, error: null })
        // Lưu tiến trình đọc (local) — kèm tên + bìa để trang chủ hiện ngay.
        const n = novelRef.current
        saveReadProgress(slug, chapter, n ? {
          title: fmtNovelTitle(n.title_is_slug ? '' : n.title, n.slug || slug),
          cover_url: n.cover_url,
        } : undefined)
        // Đồng bộ tiến trình lên server nếu đã đăng nhập — chỉ THỬ 1 lần cho
        // mỗi (slug, chapter) mới, không phụ thuộc sự kiện cuộn.
        const syncKey = `${slug}/${chapter}`
        if (isLoggedIn() && lastAttemptedSyncKeyRef.current !== syncKey) {
          lastAttemptedSyncKeyRef.current = syncKey
          if (/^\d+$/.test(chapter)) {
            syncProgress(slug, Number(chapter))
          } else {
            // Chương không có số thứ tự hợp lệ (vd author note) — contract
            // 'chapter' yêu cầu integer, không có cách biểu diễn hợp lệ nên
            // bỏ qua đồng bộ thay vì gửi sai kiểu (KHÔNG phải lỗi).
            setSyncStatus(null)
          }
        }
      })
      .catch(err => {
        if (controller.signal.aborted || contentEpochRef.current !== myEpoch) return // đã hủy do đổi chương — bỏ qua
        console.error(err)
        setDoc({ url: contentUrl, content: '', error: err })
      })
    return () => { controller.abort() }
  }, [contentUrl, reloadNonce, slug, chapter, ttsStop, syncProgress])

  const retryLoad = useCallback(() => {
    setDoc(d => (d.url === contentUrl ? { url: null, content: '', error: null } : d))
    setReloadNonce(n => n + 1)
  }, [contentUrl])

  // ── Mục lục chương ────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    setChaptersLoadError(false)
    const cached = peekCache(chaptersUrl)
    if (cached !== undefined) setCatalog(c => (c.slug === slug && c.raw === cached ? c : { slug, raw: cached }))
    cachedGet(chaptersUrl)
      .then(raw => { if (alive) setCatalog({ slug, raw }) })
      .catch(() => { if (alive) setChaptersLoadError(true) })
    return () => { alive = false }
  }, [slug, chaptersUrl])

  // ── Chi tiết truyện (tên cho tiêu đề tab + lịch sử đọc) ──────────────────
  useEffect(() => {
    let alive = true
    const cached = peekCache(`/novels/${slug}`)
    setNovel(cached || null)
    cachedGet(`/novels/${slug}`)
      .then(data => {
        if (!alive || !data) return
        setNovel(data)
        updateHistoryMeta(slug, {
          title: fmtNovelTitle(data.title_is_slug ? '' : data.title, data.slug || slug),
          cover_url: data.cover_url,
        })
      })
      .catch(() => { /* không bắt buộc — Reader vẫn đọc được */ })
    return () => { alive = false }
  }, [slug])

  // ── Khôi phục vị trí cuộn (localStorage theo slug, chỉ chương gần nhất) ───
  useEffect(() => {
    if (!ready) return
    const savedPct = readSavedScroll(slug, chapter)
    const raf = requestAnimationFrame(() => {
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
    return () => cancelAnimationFrame(raf)
  }, [ready, contentUrl, slug, chapter])

  // ── Theo dõi cuộn: progress bar (ref + rAF) + FAB + auto-hide nav + lưu vị trí
  useEffect(() => {
    let rafId = 0
    let fromEvent = false // true nếu lượt update này do sự kiện cuộn thật

    const update = () => {
      rafId = 0
      const byUser = fromEvent
      fromEvent = false
      const { top, max } = readScroll()
      const ratio = Math.min(1, Math.max(0, top / max))
      // Cập nhật trực tiếp DOM — không setState mỗi sự kiện cuộn.
      if (progressBarRef.current) progressBarRef.current.style.transform = `scaleX(${ratio})`
      // Boolean → React tự bỏ qua re-render khi giá trị không đổi.
      setShowScrollTop(top > 400)

      // Auto-hide top nav: cuộn xuống thì ẩn, cuộn lên thì hiện
      const last = lastScrollRef.current
      if (top > last + 8 && top > 120) setHideTopNav(true)
      else if (top < last - 8 || top <= 120) setHideTopNav(false)
      lastScrollRef.current = top

      // Lưu vị trí đọc (throttle ~500ms) — chỉ khi do người dùng cuộn
      if (byUser && readyRef.current && !saveScrollTimerRef.current) {
        saveScrollTimerRef.current = setTimeout(() => {
          saveScrollTimerRef.current = null
          if (!readyRef.current) return
          const s = readScroll()
          writeSavedScroll(slug, chapter, s.top / s.max)
        }, 500)
      }
    }

    const handleScroll = () => {
      fromEvent = true
      if (!rafId) rafId = requestAnimationFrame(update)
    }

    const mc = document.querySelector('.main-content')
    window.addEventListener('scroll', handleScroll, { passive: true })
    if (mc) mc.addEventListener('scroll', handleScroll, { passive: true })
    rafId = requestAnimationFrame(update) // đồng bộ thanh tiến độ lần đầu (không lưu vị trí)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (mc) mc.removeEventListener('scroll', handleScroll)
      if (rafId) cancelAnimationFrame(rafId)
      if (saveScrollTimerRef.current) {
        clearTimeout(saveScrollTimerRef.current)
        saveScrollTimerRef.current = null
      }
    }
  }, [slug, chapter])

  const currentChapterIndex = useMemo(() => findChapterIndex(chapters, chapter), [chapters, chapter])
  const currentChapterObj = currentChapterIndex >= 0 ? chapters[currentChapterIndex] : null
  const currentChapterDate = currentChapterObj?.created_at ? fmtChapterDate(currentChapterObj.created_at) : ''

  const isNumberParam = /^\d+$/.test(chapter)
  const isAuthorNote = !isNumberParam && chapters.some(c => c.filename === chapter && !getChapNum(c.title))
  const prevChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null
  const nextChapter = currentChapterIndex !== -1 && currentChapterIndex < chapters.length - 1 ? chapters[currentChapterIndex + 1] : null

  // Tiêu đề tab: "<tên chương> – <tên truyện> – Hắc Đạo Truyện"
  const chapterLabel = currentChapterObj?.title || (isNumberParam ? `Chương ${chapter}` : fmtChapterLabel(chapter))
  useDocumentTitle([chapterLabel, novelTitle].filter(Boolean).join(' – '))

  const goNext = useCallback(() => {
    if (nextChapter) navigate(chapterUrl(slug, nextChapter))
  }, [nextChapter, slug, navigate])

  const goPrev = useCallback(() => {
    if (prevChapter) navigate(chapterUrl(slug, prevChapter))
  }, [prevChapter, slug, navigate])

  useEffect(() => {
    const handleKey = (e) => {
      if (shouldIgnoreKey(e)) return
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goNext, goPrev])

  // ── Prefetch chương kế tiếp khi rảnh → bấm "Tiếp" hiện tức thì ───────────
  useEffect(() => {
    if (!ready || !nextChapter) return undefined
    if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return undefined
    const id = chapterIdentifier(nextChapter)
    if (!id) return undefined
    return runWhenIdle(() => {
      cachedGet(`/novels/${slug}/chapters/${id}`, { ttl: CHAPTER_TTL }).catch(() => { /* bỏ qua */ })
    }, { timeout: 3000, fallbackDelay: 1200 })
  }, [ready, nextChapter, slug])

  const scrollToTop = () => scrollAllTo(0, true)
  const openSettings = useCallback(() => setShowSettings(true), [])

  const toggleTts = useCallback(() => {
    if (tts.isPlaying && !tts.isPaused) ttsPause()
    else if (tts.isPaused) ttsResume()
    else ttsPlay(stripMarkdown(content), { voiceName: settings.ttsVoice, rate: settings.ttsRate })
  }, [tts.isPlaying, tts.isPaused, ttsPause, ttsResume, ttsPlay, content, settings.ttsVoice, settings.ttsRate])

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
      // Dùng CHUNG định danh với link/nút điều hướng (chapterIdentifier) để URL
      // trùng khớp với cache của service worker và apiCache.
      const id = chapterIdentifier(c)
      if (id) {
        try {
          await cachedGet(`/novels/${slug}/chapters/${id}`, { ttl: CHAPTER_TTL })
        } catch { /* chương lỗi — bỏ qua, tải tiếp chương sau */ }
      }
      done += 1
      setDlProgress({ done, total: next.length })
    }
    setDownloading(false)
  }

  const themeId = THEMES[settings.theme] ? settings.theme : 'sepia'
  const readerLineHeight = Math.max(settings.lineHeight, 1.5)

  // ReactMarkdown parse lại toàn bộ chương mỗi lần render → memo theo nội dung
  // + ngày đăng; components ổn định theo ngày đăng.
  const markdownComponents = useMemo(() => makeMarkdownComponents(currentChapterDate), [currentChapterDate])
  const renderedContent = useMemo(
    () => <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>,
    [content, markdownComponents],
  )

  const indexLabel = isAuthorNote
    ? '📝'
    : currentChapterIndex >= 0 ? `${currentChapterIndex + 1}/${chapters.length}` : `–/${chapters.length || '–'}`
  const navProps = {
    slug,
    chaptersLoadError,
    indexLabel,
    hasPrev: Boolean(prevChapter),
    hasNext: Boolean(nextChapter),
    onPrev: goPrev,
    onNext: goNext,
    onOpenSettings: openSettings,
    ttsSupported: Boolean(tts.supported),
    ttsPlaying: Boolean(tts.isPlaying),
    ttsPaused: Boolean(tts.isPaused),
    onToggleTts: toggleTts,
    onStopTts: ttsStop,
  }

  return (
    <div className={`reader-root reader--${themeId}`} style={{
      background: THEME_VARS.bg, color: THEME_VARS.text,
      minHeight: '100vh', transition: 'background 0.3s, color 0.3s'
    }}>
      {/* Thanh tiến độ đọc (3px, trên cùng) — cập nhật qua ref + rAF */}
      <div
        ref={progressBarRef}
        aria-hidden="true"
        style={{
          position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0,
          height: '3px', width: '100%',
          transform: 'scaleX(0)', transformOrigin: '0 50%',
          background: THEME_VARS.text, opacity: 0.85,
          zIndex: 200, pointerEvents: 'none',
          willChange: 'transform',
        }}
      />

      <div className="container reader-container" style={{
        maxWidth: `${settings.contentWidth}px`, width: '100%',
        margin: '0 auto', padding: '0 1.25rem'
      }}>
        {/* Top nav: sticky + tự ẩn khi cuộn xuống, hiện lại khi cuộn lên */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 70,
          background: THEME_VARS.bg,
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3px)',
          transform: hideTopNav ? 'translateY(-115%)' : 'translateY(0)',
          transition: 'transform 0.3s ease, background 0.3s'
        }}>
          <ReaderNavBar position="top" {...navProps} />
        </div>

        <div
          className="reader-content"
          style={{
            padding: '1rem 0 3rem',
            fontSize: `${settings.fontSize}px`,
            fontFamily: settings.fontFamily,
            lineHeight: readerLineHeight,
            transition: 'font-size 0.2s',
            wordBreak: 'normal', overflowWrap: 'break-word'
          }}
        >
          {loadError ? (
            <div className="hd-error-block" role="alert">
              <AlertTriangle size={32} aria-hidden="true" style={{ opacity: 0.7 }} />
              <div className="hd-error-block__title">Không tải được chương</div>
              <div className="hd-error-block__desc">
                {loadError?.response?.status === 404
                  ? 'Chương này chưa sẵn sàng hoặc không tồn tại.'
                  : 'Nội dung chưa sẵn sàng hoặc lỗi kết nối. Vui lòng thử lại.'}
              </div>
              <div className="hd-error-block__actions">
                <button type="button" className="btn btn-primary" onClick={retryLoad}>
                  <RefreshCw size={16} aria-hidden="true" /> Thử lại
                </button>
                <Link to={`/novel/${slug}`} className="btn btn-secondary">Về mục lục</Link>
              </div>
            </div>
          ) : loading ? (
            <ChapterSkeleton />
          ) : (
            renderedContent
          )}
        </div>

        {/* Bình luận theo chương — dưới nội dung, trước thanh điều hướng */}
        {ready && <ChapterComments slug={slug} chapter={chapter} />}

        <ReaderNavBar position="bottom" {...navProps} />
      </div>

      {/* Tap zones (chỉ hiện trên thiết bị cảm ứng): chạm mép = chuyển chương */}
      {!showSettings && ready && (
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
        <Modal
          onClose={() => setShowSettings(false)}
          ariaLabel="Tuỳ chỉnh đọc truyện"
          overlayStyle={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', alignItems: 'flex-end', padding: 0 }}
          panelClassName="reader-settings-sheet"
          panelStyle={{
            width: '100%', background: 'var(--reader-panel)', color: 'var(--reader-text)',
            borderTopLeftRadius: '24px', borderTopRightRadius: '24px',
            maxHeight: '85dvh',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
            animation: 'slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <div className="reader-settings-sheet__handle" aria-hidden="true" />

          <div className="reader-settings-sheet__header">
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Tuỳ chỉnh</h3>
            <button type="button" className="reader-settings-sheet__close" onClick={() => setShowSettings(false)} aria-label="Đóng tuỳ chỉnh">✕</button>
          </div>

          <div className="reader-settings-sheet__body">
            <ReaderSettingsPanel settings={settings} onChange={onChange} ttsVoices={tts.voices} />

            {/* Đọc offline: tải trước N chương kế tiếp để service worker cache */}
            <div style={{ marginTop: 'var(--space-5, 24px)', marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--reader-muted)', marginBottom: '0.8rem', letterSpacing: '0.05em' }}>ĐỌC OFFLINE</div>
              <button
                type="button"
                onClick={downloadNextChapters}
                aria-busy={downloading}
                disabled={downloading || !nextChapter}
                style={{
                  width: '100%', minHeight: '52px', borderRadius: '16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  background: downloading ? 'var(--reader-border)' : 'var(--accent)',
                  color: 'white', border: 'none', fontSize: '1rem', fontWeight: 700,
                  cursor: downloading || !nextChapter ? 'not-allowed' : 'pointer',
                  opacity: !nextChapter ? 0.5 : 1, transition: 'all 0.2s',
                }}
              >
                <Download size={18} aria-hidden="true" />
                {downloading
                  ? `Đang tải... đã tải ${dlProgress?.done ?? 0}/${dlProgress?.total ?? OFFLINE_BATCH_SIZE}`
                  : dlProgress
                    ? `Đã tải ${dlProgress.done}/${dlProgress.total} chương`
                    : `Tải ${OFFLINE_BATCH_SIZE} chương tiếp`}
              </button>
              <div style={{ fontSize: 'var(--font-xs, 0.75rem)', color: 'var(--reader-muted)', marginTop: '0.6rem', lineHeight: 1.5 }}>
                {nextChapter
                  ? 'Chương đã tải sẽ đọc được cả khi mất mạng.'
                  : 'Đây là chương cuối — không còn chương kế tiếp để tải.'}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* FAB cuộn lên đầu — góc dưới TRÁI, nhỏ gọn, không che tap-zone phải.
          (Nút Cài đặt đã có sẵn ở cả 2 thanh điều hướng nên không cần FAB riêng.) */}
      {showScrollTop && (
        <button
          type="button"
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
          <ChevronUp size={20} aria-hidden="true" />
        </button>
      )}

      {/* C02: trạng thái đồng bộ tiến trình đọc — chỉ hiện khi có gì để báo,
          không hiện liên tục gây rối mắt (ẩn ở trạng thái 'saved' sau vài giây). */}
      {syncStatus && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))',
            right: 'calc(1rem + env(safe-area-inset-right, 0px))',
            zIndex: 90,
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '5px 11px', borderRadius: '999px',
            fontSize: 'var(--font-xs, 0.75rem)', fontWeight: 600,
            background: THEME_VARS.panel, color: THEME_VARS.text,
            border: `1px solid ${THEME_VARS.border}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', opacity: 0.9,
          }}
        >
          {syncStatus === 'saving' && (<><Loader2 size={12} className="spin" /> Đang lưu tiến trình...</>)}
          {syncStatus === 'saved' && (<><Check size={12} color="#4ade80" /> Đã lưu tiến trình</>)}
          {syncStatus === 'error' && (<><AlertTriangle size={12} color="#f87171" /> Chưa lưu được, sẽ thử lại</>)}
        </div>
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
        .fab:focus-visible { opacity: 1; }
        .hide-mobile { display: inline; }

        /* Tap zones: mặc định ẩn, chỉ bật trên thiết bị cảm ứng màn hình nhỏ */
        .tap-zone { display: none; }
        @media (hover: none) and (pointer: coarse) and (max-width: 768px) {
          .tap-zone {
            display: block;
            position: fixed; top: 0; bottom: 0; width: 12%;
            z-index: 30; background: transparent;
            -webkit-tap-highlight-color: transparent;
          }
          .tap-zone-left { left: 0; }
          .tap-zone-right { right: 0; }
        }

        @media (max-width: 768px) {
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
