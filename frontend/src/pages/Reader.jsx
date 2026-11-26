import PropTypes from 'prop-types'
import { memo, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Home, ChevronUp, Settings, Download, Volume2, Pause, Play, Square, SkipBack, SkipForward, Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import userApi, { isLoggedIn, getIdentityNamespace } from '../userApi'
import ChapterComments from '../components/ChapterComments'
import Modal from '../components/ui/Modal'
import ReaderSettingsPanel from '../components/ReaderSettingsPanel'
import InlineGlossaryModal from '../components/InlineGlossaryModal'
import ReplacementsManagerModal from '../components/ReplacementsManagerModal'
import { getReplacements, saveReplacement, removeReplacement, applyReplacements, mergeReplacementRules, mergeImportedRules, writeReplacements } from '../utils/readerReplacements'
import useReaderSettings, { THEMES } from '../hooks/useReaderSettings'
import useRealReadTracking from '../hooks/useRealReadTracking'
import { clearBootTheme } from '../utils/bootTheme'
import { contentScrollRatio } from '../utils/readTracking'
import { fetchPublicReplacements } from '../engagementApi'
import { schedulePrefsPush, subscribePrefsSync } from '../utils/prefsSyncClient'
import useTextToSpeech from '../hooks/useTextToSpeech'
import {
  TTS_CONTINUE_KEY, makeTtsContinue, isTtsContinueValid, readTtsContinueChain, ttsAutoNextDecision,
} from '../utils/ttsQueue'
import useDocumentTitle from '../hooks/useDocumentTitle'
import {
  saveReadProgress, updateHistoryMeta, fmtChapterLabel, saveReadParagraph, getReadParagraph,
} from '../utils/readingHistory'
import {
  normalizeChapterCatalog, getChapNum, chapterIdentifier, chapterUrl, findChapterIndex, chapterRequestId,
  normalizeEditionCode, chapterListPath, chapterContentPath,
} from '../utils/chapters'
import { fmtChapterDate, fmtNovelTitle } from '../utils/format'
import { cachedGet, peekCache } from '../utils/apiCache'
import { runWhenIdle } from '../utils/idle'
import { trackEvent, trackEventDebounced, createChapterTracker, bumpCompletedCount } from '../utils/analytics'
import '../styles/reading.css'
import '../styles/novel-reader.css'

const OFFLINE_BATCH_SIZE = 10
// Nội dung chương gần như bất biến → giữ trong apiCache lâu hơn mặc định
// (chuyển qua lại chương trước/sau không tải lại).
const CHAPTER_TTL = 10 * 60_000
// Vị trí cuộn: chỉ nhớ chương GẦN NHẤT của mỗi truyện (localStorage).
const SCROLL_KEY_PREFIX = 'readerPos_'
// Tiến độ tới từng đoạn văn: ghi local tối đa 1 lần/giây khi cuộn. Mỗi PUT
// /user/progress = 1 lượt ghi D1 (gói Free 100k/ngày dùng chung) nên CHỈ gửi
// server khi: tab bị ẩn / pagehide, rời truyện (unmount, đổi truyện), hoặc định
// kỳ — cách lần gửi trước ≥ 60 giây VÀ lệch ≥ 10 đoạn. Bản mới nhất luôn nằm
// trong hàng đợi offline nên không gửi kịp cũng không mất.
const PARAGRAPH_LOCAL_THROTTLE_MS = 1000
const PARAGRAPH_SERVER_MIN_INTERVAL_MS = 60_000
const PARAGRAPH_SERVER_MIN_DELTA = 10
// Khoảng chừa phía trên khi cuộn tới đoạn đã lưu (thanh điều hướng trên cùng).
const PARAGRAPH_RESTORE_OFFSET_PX = 72
// Vùng chạm lật chương (mobile cảm ứng): mép trái/phải, tối đa 12% bề rộng
// nhưng không quá 56px để không lấn vào phần chữ trên máy màn rộng.
const TAP_ZONE_MEDIA = '(hover: none) and (pointer: coarse) and (max-width: 768px)'
const TAP_ZONE_RATIO = 0.12
const TAP_ZONE_MAX_PX = 56
const TAP_SCROLL_GUARD_MS = 300
const TAP_IGNORE_SELECTOR = [
  'a', 'button', 'input', 'textarea', 'select', 'label', 'summary',
  '[role="button"]', '[role="dialog"]', '[contenteditable="true"]',
  '.reader-topbar', '.reader-nav', '.chapter-comments', '.reader-fab',
].join(',')

// Theme áp dụng bằng CSS class `reader--<id>` (biến định nghĩa trong index.css,
// chỉ ảnh hưởng trang đọc). Màu/viền các khối của Reader dùng thẳng
// var(--reader-*) trong styles/novel-reader.css (không còn style inline).

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

// Quy tắc sửa name công khai (admin đã duyệt) — nhớ trong bộ nhớ theo slug,
// đổi chương không tải lại. Lưu Promise để các lần mount trùng nhau dùng chung.
const publicRulesCache = new Map()
function loadPublicRules(slug) {
  if (!publicRulesCache.has(slug)) publicRulesCache.set(slug, fetchPublicReplacements(slug))
  return publicRulesCache.get(slug)
}

/**
 * Ngữ cảnh của vùng chọn cho nút "mở rộng cụm" trong hộp sửa name: toàn văn
 * đoạn `.reader-p` chứa vùng chọn + offset (UTF-16) của cụm ĐÃ TRIM trong đoạn.
 * Vùng chọn trải qua nhiều đoạn / không nằm trong đoạn văn → null (modal ẩn nút).
 */
function selectionParagraphContext(range, trimmedText) {
  try {
    const elOf = (node) => (node && node.nodeType === 1 ? node : node?.parentElement)
    const p = elOf(range.startContainer)?.closest?.('.reader-p')
    if (!p || p !== elOf(range.endContainer)?.closest?.('.reader-p')) return null
    const pre = document.createRange()
    pre.selectNodeContents(p)
    pre.setEnd(range.startContainer, range.startOffset)
    const raw = range.toString()
    const lead = raw.length - raw.trimStart().length
    const start = pre.toString().length + lead
    const end = start + trimmedText.length
    const text = p.textContent || ''
    // Range.toString và textContent đều nối text node theo thứ tự → phải khớp; lệch thì bỏ.
    return text.slice(start, end) === trimmedText ? { text, start, end } : null
  } catch {
    return null
  }
}

/** Các đoạn văn của chương theo thứ tự hiển thị (index = vị trí trong danh sách). */
function chapterParagraphs(root) {
  return root ? root.querySelectorAll('.reader-p') : []
}

/** Index đoạn văn ĐẦU TIÊN còn thấy trên màn hình (tìm nhị phân), -1 nếu chưa có. */
function firstVisibleParagraph(root) {
  const nodes = chapterParagraphs(root)
  if (!nodes.length) return -1
  let lo = 0
  let hi = nodes.length - 1
  let ans = nodes.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (nodes[mid].getBoundingClientRect().bottom > 8) { ans = mid; hi = mid - 1 } else lo = mid + 1
  }
  return ans
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
// paragraph (tuỳ chọn): index đoạn văn đang đọc → server lưu position "12#p34".
function writeQueuedProgress(slug, chapterNum, paragraph) {
  try {
    const entry = { chapter: chapterNum, ts: Date.now() }
    if (Number.isInteger(paragraph) && paragraph >= 0) entry.paragraph = paragraph
    localStorage.setItem(progressQueueKey(slug), JSON.stringify(entry))
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

/** Body PUT /user/progress — chỉ thêm `paragraph` khi là số nguyên hợp lệ. */
function progressBody(chapterNum, paragraph) {
  const body = { type: 'chapter', chapter: chapterNum }
  if (Number.isInteger(paragraph) && paragraph >= 0) body.paragraph = paragraph
  return body
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
      await userApi.put(`/user/progress/${slugFromKey}`, progressBody(queued.chapter, queued.paragraph))
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
        <div className={`reader-nav__error${isBottom ? ' reader-nav__error--bottom' : ''}`}>
          Không tải được danh sách chương, nút điều hướng có thể không chính xác
        </div>
      )}
      <div className={`reader-nav reader-nav--${position}`}>
        <Link
          to={`/novel/${slug}`}
          title="Về trang chi tiết"
          aria-label="Về trang chi tiết truyện"
          className="reader-nav__icon-button"
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
          >
            <ArrowLeft size={22} aria-hidden="true" />
            <span className="hide-mobile">Trước</span>
          </button>

          <div className="reader-nav__chapter-index" aria-label="Vị trí chương">
            {indexLabel}
          </div>

          <button
            type="button"
            className="btn reader-nav__chapter-button reader-nav__chapter-button--next"
            onClick={onNext}
            disabled={!hasNext}
            aria-label="Chương tiếp"
          >
            <span>{isBottom ? 'CHƯƠNG TIẾP' : 'Tiếp'}</span>
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
    // Style ở novel-reader.css (.reader-h1 / .reader-p / .reader-hr).
    h1: ({ node: _node, ...props }) => (
      <div>
        <h1 className={`reader-h1${chapterDate ? ' has-date' : ''}`} {...props} />
        {chapterDate && (
          <div className="reader-chapter-date">
            Đăng lúc: {chapterDate}
          </div>
        )}
      </div>
    ),
    p: ({ node: _node, ...props }) => <p className="reader-p" {...props} />,
    hr: ({ node: _node, ...props }) => <hr className="reader-hr" {...props} />,
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
  // Nhiều bản dịch: ?ban=<code> (khác 'he-thong') → đọc bản dịch phụ qua route
  // /editions/:code/...; null = bản AI mặc định, URL/route cũ giữ nguyên.
  const [searchParams] = useSearchParams()
  const ban = normalizeEditionCode(searchParams.get('ban'))
  const banRef = useRef(ban)
  banRef.current = ban

  // ── Nội dung chương ───────────────────────────────────────────────────────
  // doc giữ kết quả của URL đã tải xong. Nếu URL hiện tại chưa có trong doc
  // nhưng đã nằm trong apiCache (vd đã prefetch) → render NGAY từ cache trong
  // cùng lượt render, không nháy skeleton.
  const contentUrl = chapterContentPath(slug, chapterRequestId(chapter), ban)
  const [doc, setDoc] = useState({ url: null, content: '', error: null })
  const [replacements, setReplacements] = useState(() => getReplacements(slug))
  const [selectionCoords, setSelectionCoords] = useState(null)
  const [selectedText, setSelectedText] = useState('')
  const [selectedContext, setSelectedContext] = useState(null) // { text, start, end } | null
  const [isInlineGlossaryOpen, setIsInlineGlossaryOpen] = useState(false)
  const [isReplacementsManagerOpen, setIsReplacementsManagerOpen] = useState(false)
  const [publicRules, setPublicRules] = useState({ slug: null, rules: [] })

  useEffect(() => {
    setReplacements(getReplacements(slug))
  }, [slug])

  // Nền tạm theo theme đọc do index.html đặt (chống nháy) — Reader đã tự tô nền.
  useEffect(() => { clearBootTheme() }, [])

  // Quy tắc sửa name công khai: tải nền 1 lần / truyện (cache trong bộ nhớ).
  useEffect(() => {
    let alive = true
    loadPublicRules(slug).then(rules => {
      if (alive) setPublicRules({ slug, rules: Array.isArray(rules) ? rules : [] })
    })
    return () => { alive = false }
  }, [slug])

  // Đồng bộ cài đặt: server có quy tắc mới hơn cho truyện này → nạp lại.
  useEffect(() => subscribePrefsSync((evt) => {
    if (evt?.type === 'replacements' && Array.isArray(evt.slugs) && evt.slugs.includes(slug)) {
      setReplacements(getReplacements(slug))
    }
  }), [slug])
  const [reloadNonce, setReloadNonce] = useState(0)
  const docMatches = doc.url === contentUrl
  const peeked = docMatches ? undefined : peekCache(contentUrl)
  const content = docMatches ? doc.content : (typeof peeked?.content === 'string' ? peeked.content : '')
  const loadError = docMatches ? doc.error : null
  const ready = docMatches ? !doc.error : typeof peeked?.content === 'string'
  const loading = !ready && !loadError

  // ── Mục lục + chi tiết truyện (apiCache dùng chung với NovelPage) ─────────
  const chaptersUrl = chapterListPath(slug, ban)
  // Mục lục gắn với URL (không chỉ slug): đổi bản dịch cùng truyện không được
  // dùng nhầm mục lục của bản trước.
  const [catalog, setCatalog] = useState(() => ({ slug, url: chaptersUrl, raw: peekCache(chaptersUrl) }))
  const [chaptersLoadError, setChaptersLoadError] = useState(false)
  const [novel, setNovel] = useState(() => peekCache(`/novels/${slug}`) || null)
  const chapters = useMemo(
    () => (catalog.slug === slug && catalog.url === chaptersUrl ? normalizeChapterCatalog(catalog.raw) : []),
    [catalog, slug, chaptersUrl],
  )

  const [showScrollTop, setShowScrollTop] = useState(false)
  const [hideTopNav, setHideTopNav] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null) // null | 'saving' | 'saved' | 'error'

  const progressBarRef = useRef(null)
  const contentRef = useRef(null) // khối .reader-content (đo đoạn văn + tỉ lệ đã đọc)
  const lastParagraphRef = useRef(-1) // đoạn văn đã ghi gần nhất của chương hiện tại
  const paragraphTimerRef = useRef(null) // throttle ghi local
  // Gửi server đoạn văn: pending = bản chưa gửi; lastSentAt/lastSentParagraph =
  // mốc lần gửi gần nhất của chương hiện tại (để giãn nhịp gửi định kỳ).
  const paragraphSyncRef = useRef({ pending: null, lastSentAt: 0, lastSentParagraph: 0 })
  const lastScrollRef = useRef(0)
  const saveScrollTimerRef = useRef(null)
  const touchRef = useRef(null)
  const lastScrollTimeRef = useRef(0) // mốc cuộn gần nhất — chặn "chạm dừng quán tính" bị hiểu là lật chương
  const lastAttemptedSyncKeyRef = useRef(null) // debounce: chỉ THỬ sync 1 lần khi đổi chương (không phải "đã synced")
  const contentEpochRef = useRef(0) // C01: chỉ áp dụng response của lần fetch MỚI NHẤT
  const progressEpochRef = useRef(0) // C02: hủy retry cũ khi chuyển chương tiếp trước khi retry xong
  const novelRef = useRef(novel)
  novelRef.current = novel
  // Chỉ lưu vị trí cuộn khi nội dung chương hiện tại đã hiển thị (tránh ghi
  // vị trí của skeleton / chương cũ vào key của chương mới).
  const readyRef = useRef(ready)
  readyRef.current = ready
  // GA4: bộ đo của lượt đọc chương hiện tại (null khi chưa hiển thị nội dung).
  const readTrackerRef = useRef(null)

  // ── Tải trước chương để đọc offline (service worker cache lại) ────────────
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState(null) // { done, total } | null

  // ── Reader Settings (Persistent) ──────────────────────────────────────────
  const { settings, onChange: applySetting } = useReaderSettings()
  // GA4: theme/font/cỡ chữ người đọc chọn nhiều nhất → chọn mặc định tốt hơn.
  // Debounce theo từng khoá: kéo slider chỉ gửi giá trị cuối.
  const onChange = useCallback((key, value) => {
    applySetting(key, value)
    if (key !== 'ttsVoice') { // tên giọng đọc có thể lộ thông tin thiết bị — bỏ
      trackEventDebounced(`reader_setting:${key}`, 'reader_setting_change', { setting: key, setting_value: String(value) })
    }
  }, [applySetting])
  const [showSettings, setShowSettings] = useState(false)

  // ── Text-to-Speech ─────────────────────────────────────────────────────────
  // Callback cho hook đọc qua ref (gán ở khối "TTS: tô sáng/tự cuộn/tự sang
  // chương" phía dưới — cần nextChapter/goNext khai báo sau).
  const ttsHandlersRef = useRef({})
  // `.reader-p` đang tô sáng (null = không nghe). Khi đang nghe, tiến độ đoạn đi
  // theo giọng đọc → bộ lưu-theo-cuộn bên dưới bỏ qua (tự cuộn của TTS đặt đoạn
  // ở 25% màn hình, "đoạn đầu tiên thấy" sẽ lệch lùi 1–2 đoạn).
  const ttsActiveNodeRef = useRef(null)
  const tts = useTextToSpeech({
    onParagraph: (p) => ttsHandlersRef.current.onParagraph?.(p),
    onEnd: () => ttsHandlersRef.current.onEnd?.(),
    onStateChange: (status) => ttsHandlersRef.current.onStateChange?.(status),
    media: {
      onNextTrack: () => ttsHandlersRef.current.onChapter?.(1),
      onPrevTrack: () => ttsHandlersRef.current.onChapter?.(-1),
    },
  })
  const { stop: ttsStop, play: ttsPlay, pause: ttsPause, resume: ttsResume } = tts
  // Chống tự lật chương liên tục: lúc bắt đầu đọc chương hiện tại + số chương
  // đã TỰ sang liên tiếp không có thao tác người dùng (xem ttsAutoNextDecision).
  const ttsChapterStartRef = useRef(0)
  const ttsAutoChainRef = useRef(0)
  // true khi chính TTS điều hướng sang chương (tự sang/nút media) → lần dừng
  // do đổi chương giữ audio im lặng (pause, không giải phóng).
  const ttsNavigatingRef = useRef(false)
  const [ttsNotice, setTtsNotice] = useState('')

  // ───────────────────────────────────────────────────────────────────────────

  const novelTitle = novel ? fmtNovelTitle(novel.title_is_slug ? '' : novel.title, novel.slug || slug) : ''

  // C02: đồng bộ tiến trình lên server — debounce thực sự (1 lần/chương, không
  // theo scroll), retry hữu hạn CHỈ cho lỗi mạng/5xx, KHÔNG retry 401/400 (lỗi
  // vĩnh viễn cần user can thiệp), và CHỈ coi là "đã lưu" sau response 200 thật
  // (không đánh dấu synced lạc quan trước khi có xác nhận).
  // quiet = cập nhật đoạn văn khi đang đọc: không bật dòng "Đang lưu tiến
  // trình..." mỗi lần gửi định kỳ; chỉ chốt trạng thái nếu dòng đó đang hiện dở.
  const syncProgress = useCallback((novelSlug, chapterNum, paragraph, { quiet = false } = {}) => {
    writeQueuedProgress(novelSlug, chapterNum, paragraph) // giữ bản mới nhất trong hàng đợi ngay từ đầu
    const myEpoch = ++progressEpochRef.current
    if (!quiet) setSyncStatus('saving')

    const attempt = async (retriesLeft) => {
      if (progressEpochRef.current !== myEpoch) return // đã chuyển chương khác — bỏ, request mới lo việc này
      try {
        await userApi.put(`/user/progress/${novelSlug}`, progressBody(chapterNum, paragraph))
        if (progressEpochRef.current !== myEpoch) return
        clearQueuedProgress(novelSlug)
        if (quiet) setSyncStatus(s => (s === 'saving' || s === 'error' ? 'saved' : s))
        else setSyncStatus('saved')
      } catch (err) {
        if (progressEpochRef.current !== myEpoch) return
        const status = err.response?.status
        if (status === 401 || status === 400 || retriesLeft <= 0) {
          // lỗi vĩnh viễn hoặc hết lượt retry — giữ trong hàng đợi để thử lại lần sau
          if (quiet) setSyncStatus(s => (s === 'saving' ? 'error' : s))
          else setSyncStatus('error')
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

  // Gửi server phần đoạn văn đang chờ (nếu có) — dùng khi tab bị ẩn/pagehide,
  // rời truyện, hoặc đến nhịp gửi định kỳ. Không có gì chờ → không gửi (0 lượt ghi).
  const flushParagraphSync = useCallback(() => {
    const st = paragraphSyncRef.current
    const p = st.pending
    st.pending = null
    // Bản dịch phụ: chỉ đồng bộ SỐ CHƯƠNG (chung mọi bản), không gửi đoạn văn —
    // chỉ số đoạn của bản này không khớp với bản mặc định.
    if (!p || !isLoggedIn() || banRef.current) return
    st.lastSentAt = Date.now()
    st.lastSentParagraph = p.paragraph
    syncProgress(p.slug, p.chapter, p.paragraph, { quiet: true })
  }, [syncProgress])

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushParagraphSync() }
    // pagehide: đóng tab/điều hướng ra ngoài (iOS Safari đôi khi không bắn
    // visibilitychange). Đã gửi ở visibilitychange thì pending rỗng → no-op.
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flushParagraphSync)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flushParagraphSync)
    }
  }, [flushParagraphSync])

  // Rời truyện (unmount Reader / đổi sang truyện khác): gửi nốt đoạn văn đang
  // chờ. Effect này PHẢI khai báo trước effect reset theo [slug, chapter] bên
  // dưới — React chạy cleanup theo thứ tự khai báo, nên gửi xong mới bị xoá.
  useEffect(() => () => flushParagraphSync(), [slug, flushParagraphSync])

  // Đổi chương trong cùng truyện: bỏ bản đoạn văn đang chờ của chương cũ — chương
  // mới luôn tự đồng bộ khi mở (syncProgress không quiet) và ghi đè tiến độ, nên
  // gửi thêm bản cũ chỉ tốn 1 lượt ghi D1 và có thể đến server SAU bản mới
  // (lùi tiến độ). Bản mới nhất vẫn nằm trong hàng đợi offline nếu chưa gửi.
  useEffect(() => {
    lastParagraphRef.current = -1
    const st = paragraphSyncRef.current
    // Lần mở chương đã gửi server (kèm đoạn đã lưu nếu có) → tính nhịp từ đây.
    st.lastSentAt = Date.now()
    st.lastSentParagraph = getReadParagraph(slug, chapter) ?? 0
    return () => {
      st.pending = null
    }
  }, [slug, chapter])

  // ── Tải nội dung chương (qua apiCache: chương đã prefetch → tức thì) ──────
  useEffect(() => {
    const myEpoch = ++contentEpochRef.current
    const controller = new AbortController()
    setDlProgress(null) // đổi chương → reset trạng thái tải offline
    // Đổi chương khi đang đọc → dừng để không chồng giọng. Nếu do TTS tự sang
    // chương thì giữ audio im lặng cho Media Session Android liền mạch.
    ttsStop({ keepAudio: ttsNavigatingRef.current })
    ttsNavigatingRef.current = false
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
            // Mở lại chương đang đọc dở → gửi kèm đoạn văn đã lưu (nếu có);
            // bản dịch phụ chỉ gửi số chương.
            const savedParagraph = banRef.current ? null : getReadParagraph(slug, chapter)
            syncProgress(slug, Number(chapter), savedParagraph ?? undefined)
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
        trackEvent('reader_error', { novel_slug: slug, status: err?.response?.status || 0 })
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
    if (cached !== undefined) {
      setCatalog(c => (c.slug === slug && c.url === chaptersUrl && c.raw === cached ? c : { slug, url: chaptersUrl, raw: cached }))
    }
    cachedGet(chaptersUrl)
      .then(raw => { if (alive) setCatalog({ slug, url: chaptersUrl, raw }) })
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
  // Ưu tiên đoạn văn đã lưu (lịch sử đọc); không có → vị trí cuộn % như cũ.
  useEffect(() => {
    if (!ready) return
    // Bản dịch phụ: chỉ số đoạn đã lưu thuộc bản mặc định → không dùng, về đầu chương.
    const savedParagraph = banRef.current ? null : getReadParagraph(slug, chapter)
    const savedPct = banRef.current ? NaN : readSavedScroll(slug, chapter)
    const raf = requestAnimationFrame(() => {
      const target = savedParagraph !== null && savedParagraph > 0
        ? chapterParagraphs(contentRef.current)[savedParagraph]
        : null
      if (target) {
        const top = Math.max(0, target.getBoundingClientRect().top + readScroll().top - PARAGRAPH_RESTORE_OFFSET_PX)
        scrollAllTo(top)
        lastScrollRef.current = top
        lastParagraphRef.current = savedParagraph
      } else if (!isNaN(savedPct) && savedPct > 0.005) {
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
      // GA4: độ sâu đọc (chỉ do người dùng cuộn — không tính lần khôi phục vị trí).
      if (byUser) readTrackerRef.current?.progress(ratio)

      // Auto-hide top nav: cuộn xuống thì ẩn, cuộn lên thì hiện
      const last = lastScrollRef.current
      if (top > last + 8 && top > 120) setHideTopNav(true)
      else if (top < last - 8 || top <= 120) setHideTopNav(false)
      lastScrollRef.current = top

      // Lưu vị trí đọc (throttle ~500ms) — chỉ khi do người dùng cuộn; bản dịch
      // phụ không lưu vị trí/đoạn (tiến độ chỉ giữ số chương chung).
      if (byUser && readyRef.current && !banRef.current && !saveScrollTimerRef.current) {
        saveScrollTimerRef.current = setTimeout(() => {
          saveScrollTimerRef.current = null
          if (!readyRef.current) return
          const s = readScroll()
          writeSavedScroll(slug, chapter, s.top / s.max)
        }, 500)
      }

      // Lưu đoạn văn đang đọc: local throttle ~1 giây; server chỉ gửi định kỳ
      // (≥ 60 giây VÀ lệch ≥ 10 đoạn) — còn lại để visibilitychange/pagehide/unmount gửi.
      if (byUser && readyRef.current && !banRef.current && !paragraphTimerRef.current) {
        paragraphTimerRef.current = setTimeout(() => {
          paragraphTimerRef.current = null
          if (!readyRef.current || ttsActiveNodeRef.current) return // đang nghe: tiến độ theo giọng đọc
          const idx = firstVisibleParagraph(contentRef.current)
          if (idx < 0 || idx === lastParagraphRef.current) return
          lastParagraphRef.current = idx
          saveReadParagraph(slug, chapter, idx)
          if (isLoggedIn() && /^\d+$/.test(chapter)) {
            const st = paragraphSyncRef.current
            st.pending = { slug, chapter: Number(chapter), paragraph: idx }
            writeQueuedProgress(slug, Number(chapter), idx) // offline/đóng tab vẫn còn bản mới nhất
            if (Date.now() - st.lastSentAt >= PARAGRAPH_SERVER_MIN_INTERVAL_MS &&
                Math.abs(idx - st.lastSentParagraph) >= PARAGRAPH_SERVER_MIN_DELTA) {
              flushParagraphSync()
            }
          }
        }, PARAGRAPH_LOCAL_THROTTLE_MS)
      }
    }

    const handleScroll = () => {
      fromEvent = true
      lastScrollTimeRef.current = Date.now()
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
      if (paragraphTimerRef.current) {
        clearTimeout(paragraphTimerRef.current)
        paragraphTimerRef.current = null
      }
    }
  }, [slug, chapter, flushParagraphSync])

  const currentChapterIndex = useMemo(() => findChapterIndex(chapters, chapter), [chapters, chapter])
  const currentChapterObj = currentChapterIndex >= 0 ? chapters[currentChapterIndex] : null
  const currentChapterDate = currentChapterObj?.created_at ? fmtChapterDate(currentChapterObj.created_at) : ''

  const isNumberParam = /^\d+$/.test(chapter)
  const isAuthorNote = !isNumberParam && chapters.some(c => c.filename === chapter && !getChapNum(c.title))
  const prevChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null
  const nextChapter = currentChapterIndex !== -1 && currentChapterIndex < chapters.length - 1 ? chapters[currentChapterIndex + 1] : null

  // ── Lượt đọc thật: ≥ min_seconds tab hiển thị + cuộn ≥ 80% nội dung chương ──
  const getContentRatio = useCallback(() => {
    const el = contentRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return contentScrollRatio(r.top, r.height, window.innerHeight)
  }, [])
  useRealReadTracking({
    slug,
    chapterKey: chapter,
    chapterNumber: isNumberParam ? Number(chapter) : 0,
    enabled: ready && content.trim().length > 0,
    getScrollRatio: getContentRatio,
  })

  // Tiêu đề tab: "<tên chương> – <tên truyện> – Hắc Đạo Truyện"
  const chapterLabel = currentChapterObj?.title || (isNumberParam ? `Chương ${chapter}` : fmtChapterLabel(chapter))
  useDocumentTitle([chapterLabel, novelTitle].filter(Boolean).join(' – '))

  // method: 'button' | 'key' | 'tap' — biết người đọc lật chương bằng cách nào
  // (onClick truyền event object → coi là 'button').
  const goNext = useCallback((method) => {
    if (!nextChapter) return
    trackEvent('chapter_navigate', { novel_slug: slug, direction: 'next', method: typeof method === 'string' ? method : 'button' })
    navigate(chapterUrl(slug, nextChapter, ban)) // giữ ?ban khi chuyển chương
  }, [nextChapter, slug, ban, navigate])

  const goPrev = useCallback((method) => {
    if (!prevChapter) return
    trackEvent('chapter_navigate', { novel_slug: slug, direction: 'prev', method: typeof method === 'string' ? method : 'button' })
    navigate(chapterUrl(slug, prevChapter, ban))
  }, [prevChapter, slug, ban, navigate])

  // ── GA4: vòng đời 1 lượt đọc chương ───────────────────────────────────────
  // chapter_start khi nội dung hiển thị; chapter_progress 25/50/75; chapter_complete
  // khi cuộn ≥ 90% và đọc thực ≥ 15s (chỉ tính lúc tab hiển thị). Mốc tổng số
  // chương đã đọc xong → reading_milestone; đọc xong chương MỚI NHẤT → novel_caught_up.
  const hasNextRef = useRef(false)
  hasNextRef.current = Boolean(nextChapter)
  useEffect(() => {
    if (!ready) return undefined
    const n = novelRef.current
    const base = {
      novel_slug: slug,
      novel_title: n ? fmtNovelTitle(n.title_is_slug ? '' : n.title, n.slug || slug) : undefined,
      chapter_number: /^\d+$/.test(chapter) ? Number(chapter) : undefined,
      content_type: /^\d+$/.test(chapter) ? 'chapter' : 'note',
    }
    const tracker = createChapterTracker({
      base,
      onComplete: () => {
        const { count, milestone } = bumpCompletedCount()
        if (milestone) trackEvent('reading_milestone', { chapters_completed: count })
        if (!hasNextRef.current) trackEvent('novel_caught_up', { novel_slug: slug, chapter_number: base.chapter_number })
      },
    })
    readTrackerRef.current = tracker
    tracker.start()
    if (document.visibilityState === 'hidden') tracker.setVisible(false)
    const onVisibility = () => tracker.setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    // Chương ngắn (vừa 1 màn hình) không có sự kiện cuộn → kiểm tra định kỳ.
    const { max } = readScroll()
    if (max <= 1) tracker.progress(1)
    const tickId = setInterval(() => tracker.tick(), 5000)
    return () => {
      clearInterval(tickId)
      document.removeEventListener('visibilitychange', onVisibility)
      tracker.end()
      if (readTrackerRef.current === tracker) readTrackerRef.current = null
    }
  }, [ready, slug, chapter])

  useEffect(() => {
    const handleKey = (e) => {
      if (shouldIgnoreKey(e)) return
      if (e.key === 'ArrowRight') goNext('key')
      if (e.key === 'ArrowLeft') goPrev('key')
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
      cachedGet(chapterContentPath(slug, id, ban), { ttl: CHAPTER_TTL }).catch(() => { /* bỏ qua */ })
    }, { timeout: 3000, fallbackDelay: 1200 })
  }, [ready, nextChapter, slug, ban])

  const scrollToTop = () => scrollAllTo(0, true)
  const openSettings = useCallback(() => setShowSettings(true), [])

  // ── TTS: tô sáng/tự cuộn/tiến độ theo đoạn + tự sang chương ───────────────
  const { playParagraphs: ttsPlayParagraphs, setVoiceOptions: ttsSetVoiceOptions } = tts

  // Đổi giọng/tốc độ khi đang nghe → áp từ khúc kế tiếp (không phải bấm lại).
  useEffect(() => {
    ttsSetVoiceOptions({ voiceName: settings.ttsVoice, rate: settings.ttsRate })
  }, [ttsSetVoiceOptions, settings.ttsVoice, settings.ttsRate])

  const clearTtsHighlight = useCallback(() => {
    ttsActiveNodeRef.current?.classList.remove('reader-tts-active')
    ttsActiveNodeRef.current = null
  }, [])

  // Lưu tiến độ đoạn theo giọng đọc — cùng quy tắc với lưu khi cuộn: local
  // ngay, server chỉ khi ≥ 60 giây VÀ lệch ≥ 10 đoạn (còn lại để pagehide/unmount gửi).
  const recordTtsParagraph = useCallback((idx) => {
    // Bản dịch phụ (?ban=) không lưu tiến độ đoạn (chỉ số đoạn khác bản mặc định).
    if (!readyRef.current || banRef.current || idx < 0 || idx === lastParagraphRef.current) return
    lastParagraphRef.current = idx
    saveReadParagraph(slug, chapter, idx)
    if (isLoggedIn() && /^\d+$/.test(chapter)) {
      const st = paragraphSyncRef.current
      st.pending = { slug, chapter: Number(chapter), paragraph: idx }
      writeQueuedProgress(slug, Number(chapter), idx)
      if (Date.now() - st.lastSentAt >= PARAGRAPH_SERVER_MIN_INTERVAL_MS &&
          Math.abs(idx - st.lastSentParagraph) >= PARAGRAPH_SERVER_MIN_DELTA) {
        flushParagraphSync()
      }
    }
  }, [slug, chapter, flushParagraphSync])

  const onTtsParagraph = useCallback((idx) => {
    clearTtsHighlight()
    const node = chapterParagraphs(contentRef.current)[idx]
    if (!node) return
    node.classList.add('reader-tts-active')
    ttsActiveNodeRef.current = node
    if (settings.ttsAutoScroll !== false) {
      // Chỉ cuộn khi đoạn ra ngoài vùng dễ nhìn (chừa thanh trên + thanh TTS dưới).
      const r = node.getBoundingClientRect()
      const vh = window.innerHeight || 0
      if (r.top < PARAGRAPH_RESTORE_OFFSET_PX || r.bottom > vh - 140) {
        scrollAllTo(Math.max(0, r.top + readScroll().top - vh * 0.25), true)
      }
    }
    recordTtsParagraph(idx)
  }, [clearTtsHighlight, recordTtsParagraph, settings.ttsAutoScroll])

  /** Bắt đầu nghe từ đoạn startParagraph (mặc định: đoạn đang thấy trên màn hình). */
  const startTts = useCallback((startParagraph) => {
    trackEvent('tts_start', { novel_slug: slug, tts_rate: settings.ttsRate, has_custom_voice: Boolean(settings.ttsVoice) })
    const opts = { voiceName: settings.ttsVoice, rate: settings.ttsRate }
    const texts = Array.from(chapterParagraphs(contentRef.current), n => n.textContent || '')
    if (!texts.length) {
      ttsChapterStartRef.current = Date.now()
      ttsPlay(stripMarkdown(content), opts) // không có `.reader-p` (định dạng lạ) → đọc thô như trước
      return
    }
    const start = Number.isInteger(startParagraph) ? startParagraph : Math.max(0, firstVisibleParagraph(contentRef.current))
    ttsChapterStartRef.current = Date.now()
    ttsPlayParagraphs(texts, { ...opts, startParagraph: start })
  }, [slug, settings.ttsVoice, settings.ttsRate, ttsPlay, ttsPlayParagraphs, content])
  const startTtsRef = useRef(startTts)
  startTtsRef.current = startTts

  /** Chuyển chương mà vẫn nghe tiếp: ghi cờ sessionStorage (TTL 30 giây) rồi điều hướng. */
  const ttsGoChapter = useCallback((dir, { auto = false } = {}) => {
    const target = dir > 0 ? nextChapter : prevChapter
    const id = chapterIdentifier(target)
    if (!id) return false
    // Tự sang (hết chương) → chain + 1; nút media (người dùng bấm) → về 0.
    const chain = auto ? ttsAutoChainRef.current + 1 : 0
    ttsAutoChainRef.current = chain
    try { sessionStorage.setItem(TTS_CONTINUE_KEY, makeTtsContinue(slug, id, Date.now(), chain)) } catch { /* storage bị chặn */ }
    ttsNavigatingRef.current = true
    if (dir > 0) goNext('tts')
    else goPrev('tts')
    return true
  }, [nextChapter, prevChapter, slug, goNext, goPrev])

  ttsHandlersRef.current = {
    onParagraph: onTtsParagraph,
    onStateChange: (status) => { if (status === 'idle') clearTtsHighlight() },
    onEnd: () => {
      if (settings.ttsAutoNext === false) return
      const d = ttsAutoNextDecision({ startedAt: ttsChapterStartRef.current, chain: ttsAutoChainRef.current })
      if (d.ok) { ttsGoChapter(1, { auto: true }); return }
      // Chương "xong" < 3 giây (engine hỏng) hoặc đã tự lật 50 chương liền mà
      // không ai chạm → KHÔNG sang chương (tránh ghi đè tiến độ tới hết truyện).
      ttsStop()
      setTtsNotice(d.reason === 'too-fast'
        ? 'Giọng đọc dừng bất thường nên không tự sang chương. Hãy kiểm tra giọng đọc trong Cài đặt.'
        : 'Đã tự nghe nhiều chương liên tiếp — tạm dừng. Bấm nghe để tiếp tục.')
    },
    onChapter: ttsGoChapter,
  }

  // Chương mới tải xong + có cờ "đọc tiếp" hợp lệ cho đúng chương này → tự đọc
  // từ đầu. Trình duyệt có thể chặn speak() không do thao tác người dùng → hook
  // báo `blocked`, thanh TTS hiện nút "Tiếp tục nghe".
  useEffect(() => {
    if (!ready || !tts.supported) return undefined
    let raw = null
    try { raw = sessionStorage.getItem(TTS_CONTINUE_KEY) } catch { return undefined }
    if (!raw) return undefined
    // Đợi khôi phục vị trí cuộn + DOM đoạn văn xong. Xoá cờ TRONG timer để
    // StrictMode (chạy effect 2 lần) không làm mất cờ.
    const id = setTimeout(() => {
      try { sessionStorage.removeItem(TTS_CONTINUE_KEY) } catch { /* bỏ qua */ }
      if (isTtsContinueValid(raw, slug, chapter)) {
        ttsAutoChainRef.current = readTtsContinueChain(raw)
        startTtsRef.current(0)
      }
    }, 350)
    return () => clearTimeout(id)
  }, [ready, contentUrl, slug, chapter, tts.supported])

  // Media Session: tên chương + tên truyện trên màn hình khoá / thông báo media
  // (nút điều khiển do hook gắn: play/pause/stop, next/prev = chuyển chương,
  // seek = chuyển đoạn).
  const ttsCover = novel?.cover_url || ''
  useEffect(() => {
    if (!tts.isPlaying || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (typeof window.MediaMetadata !== 'function') return
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: chapterLabel,
        artist: novelTitle,
        album: 'Hắc Đạo Truyện',
        artwork: ttsCover ? [{ src: ttsCover }] : [],
      })
    } catch { /* bỏ qua */ }
  }, [tts.isPlaying, chapterLabel, novelTitle, ttsCover])

  // Người dùng chạm/gõ phím trong Reader = có tương tác → reset đếm tự lật.
  useEffect(() => {
    const reset = () => { ttsAutoChainRef.current = 0 }
    document.addEventListener('pointerdown', reset, { passive: true })
    document.addEventListener('keydown', reset)
    return () => {
      document.removeEventListener('pointerdown', reset)
      document.removeEventListener('keydown', reset)
    }
  }, [])

  // Thông báo "không tự sang chương" tự ẩn sau 8 giây.
  useEffect(() => {
    if (!ttsNotice) return undefined
    const id = setTimeout(() => setTtsNotice(''), 8000)
    return () => clearTimeout(id)
  }, [ttsNotice])

  // Rời Reader: xoá metadata + action handler Media Session (không để thông
  // báo media "ma" trỏ về chương đã đóng).
  useEffect(() => () => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    try { ms.metadata = null } catch { /* bỏ qua */ }
    try { ms.playbackState = 'none' } catch { /* bỏ qua */ }
    for (const action of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekforward', 'seekbackward']) {
      try { ms.setActionHandler(action, null) } catch { /* action không hỗ trợ */ }
    }
  }, [])

  const toggleTts = useCallback(() => {
    ttsAutoChainRef.current = 0
    setTtsNotice('')
    if (tts.isPlaying && !tts.isPaused) ttsPause()
    else if (tts.isPaused) ttsResume()
    else startTts()
  }, [tts.isPlaying, tts.isPaused, ttsPause, ttsResume, startTts])

  // ── Tap zones (mobile): chạm mép trái/phải để chuyển chương ────────────────
  // Trước đây là 2 div position:fixed (12% bề rộng, z-index 30) phủ LÊN nội
  // dung → nuốt thao tác bôi đen chữ sát mép, chạm nhầm ô bình luận cũng lật
  // chương. Nay lắng nghe chạm ở cấp document (passive, không chặn cuộn/chọn
  // chữ) và CHỈ coi là "lật chương" khi: chạm ngắn, gần như không di chuyển,
  // 1 ngón, không có vùng chọn, không trúng phần tử tương tác, và không phải
  // cú chạm để dừng quán tính cuộn.
  const goPrevRef = useRef(goPrev)
  const goNextRef = useRef(goNext)
  goPrevRef.current = goPrev
  goNextRef.current = goNext
  const tapEnabled = ready && !showSettings && Boolean(prevChapter || nextChapter)

  useEffect(() => {
    if (!tapEnabled || typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(TAP_ZONE_MEDIA)
    const hasSelection = () => Boolean(window.getSelection && String(window.getSelection()))

    const onStart = (e) => {
      touchRef.current = null
      if (!mq.matches || e.touches.length !== 1) return
      if (Date.now() - lastScrollTimeRef.current < TAP_SCROLL_GUARD_MS) return // chạm để dừng cuộn quán tính
      if (hasSelection()) return // chạm để bỏ vùng chọn
      if (e.target?.closest?.(TAP_IGNORE_SELECTOR)) return
      const t = e.touches[0]
      const zoneW = Math.min(window.innerWidth * TAP_ZONE_RATIO, TAP_ZONE_MAX_PX)
      const dir = t.clientX <= zoneW ? 'prev' : t.clientX >= window.innerWidth - zoneW ? 'next' : null
      if (!dir) return
      touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now(), dir }
    }

    const onEnd = (e) => {
      const start = touchRef.current
      touchRef.current = null
      if (!start) return
      const t = e.changedTouches[0]
      if (!t) return
      const dx = Math.abs(t.clientX - start.x)
      const dy = Math.abs(t.clientY - start.y)
      const dt = Date.now() - start.time
      // Bỏ qua nếu người dùng đang cuộn / giữ lâu (chọn văn bản)
      if (dx > 10 || dy > 10 || dt > 350) return
      if (hasSelection()) return
      if (start.dir === 'prev') goPrevRef.current('tap')
      else goNextRef.current('tap')
    }

    const onCancel = () => { touchRef.current = null }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onCancel)
      touchRef.current = null
    }
  }, [tapEnabled])

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
          await cachedGet(chapterContentPath(slug, id, ban), { ttl: CHAPTER_TTL })
        } catch { /* chương lỗi — bỏ qua, tải tiếp chương sau */ }
      }
      done += 1
      setDlProgress({ done, total: next.length })
    }
    setDownloading(false)
    trackEvent('offline_download', { novel_slug: slug, download_type: 'chapters', chapter_count: next.length })
  }

  const themeId = THEMES[settings.theme] ? settings.theme : 'sepia'
  const readerLineHeight = Math.max(settings.lineHeight, 1.5)

  // ReactMarkdown parse lại toàn bộ chương mỗi lần render → memo theo nội dung
  // + ngày đăng; components ổn định theo ngày đăng.
  const markdownComponents = useMemo(() => makeMarkdownComponents(currentChapterDate), [currentChapterDate])
  const handleSelection = useCallback(() => {
    if (typeof window === 'undefined') return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setSelectionCoords(null)
      return
    }
    const t = sel.toString().trim()
    if (t.length >= 1 && t.length <= 80) {
      try {
        const range = sel.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (rect && rect.width > 0 && rect.height > 0) {
          setSelectedText(t)
          setSelectedContext(selectionParagraphContext(range, t))
          setSelectionCoords({
            x: Math.max(40, Math.min(window.innerWidth - 40, rect.left + rect.width / 2)),
            y: Math.max(60, rect.top - 12),
          })
          return
        }
      } catch { /* ignore */ }
    }
    setSelectionCoords(null)
  }, [])

  const handleApplyReplacement = useCallback(({ from, to, scope, whole }) => {
    if (scope === 'all') {
      const updated = saveReplacement(slug, { from, to, whole })
      setReplacements(updated)
      schedulePrefsPush() // đồng bộ quy tắc lên tài khoản (đã đăng nhập)
    } else {
      setDoc(prev => ({ ...prev, content: applyReplacements(prev.content || content, [{ from, to, whole: whole === true }]) }))
    }
    if (window.getSelection) {
      window.getSelection().removeAllRanges()
    }
  }, [slug, content])

  // Nhập gói name: file mới thắng khi trùng `from` (xem mergeImportedRules).
  const handleImportReplacements = useCallback((rules) => {
    const res = mergeImportedRules(getReplacements(slug), rules)
    if (res.added || res.updated) {
      writeReplacements(slug, res.list)
      setReplacements(res.list)
      schedulePrefsPush()
    }
    return res
  }, [slug])

  const handleDeleteReplacement = useCallback((id) => {
    const updated = removeReplacement(slug, id)
    setReplacements(updated)
    schedulePrefsPush()
  }, [slug])

  // Quy tắc công khai áp TRƯỚC, quy tắc cá nhân SAU (trùng `from` → cá nhân thắng).
  // Quy tắc công khai được duyệt cho bản AI mặc định → không áp lên bản dịch phụ.
  const effectiveRules = useMemo(
    () => mergeReplacementRules(publicRules.slug === slug && !ban ? publicRules.rules : [], replacements),
    [publicRules, slug, ban, replacements],
  )
  const displayContent = useMemo(
    () => applyReplacements(content, effectiveRules),
    [content, effectiveRules],
  )

  const renderedContent = useMemo(
    () => <ReactMarkdown components={markdownComponents}>{displayContent}</ReactMarkdown>,
    [displayContent, markdownComponents],
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
    <div
      className={`reader-root reader--${themeId}`}
      style={{ '--reader-max-w': `${settings.contentWidth}px` }}
    >
      {/* Thanh tiến độ đọc (3px, trên cùng) — cập nhật qua ref + rAF */}
      <div ref={progressBarRef} className="reader-progress" aria-hidden="true" />

      <div className="container reader-container">
        {/* Top nav: sticky + tự ẩn khi cuộn xuống, hiện lại khi cuộn lên */}
        <div className={`reader-topbar${hideTopNav ? ' is-hidden' : ''}`}>
          <ReaderNavBar position="top" {...navProps} />
        </div>

        <div
          ref={contentRef}
          className="reader-content"
          onMouseUp={handleSelection}
          onTouchEnd={handleSelection}
          style={{
            fontSize: `${settings.fontSize}px`,
            fontFamily: settings.fontFamily,
            lineHeight: readerLineHeight,
          }}
        >
          {/* key theo chương → mỗi lần đổi chương (hoặc skeleton → nội dung)
              khối mới được mount lại và mờ dần vào (.reader-fade, chỉ opacity). */}
          {loadError ? (
            <div key={`err:${contentUrl}`} className="hd-error-block reader-fade" role="alert">
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
              {/* ?ban trỏ tới bản dịch không tồn tại/đã ẩn (404) → mời đọc bản mặc định. */}
              {ban && loadError?.response?.status === 404 && (
                <div className="hd-error-block__actions">
                  <Link to={`/novel/${slug}/read/${encodeURIComponent(chapter)}`} className="btn btn-secondary">
                    Đọc bản dịch mặc định
                  </Link>
                </div>
              )}
            </div>
          ) : loading ? (
            <div key={`skel:${contentUrl}`} className="reader-fade">
              <ChapterSkeleton />
            </div>
          ) : (
            <div key={`doc:${contentUrl}`} className="reader-fade">
              {renderedContent}
            </div>
          )}
        </div>

        {/* Bình luận theo chương — dưới nội dung, trước thanh điều hướng */}
        {ready && <ChapterComments slug={slug} chapter={chapter} />}

        <ReaderNavBar position="bottom" {...navProps} />
      </div>

      {/* Settings Panel (Mobile Drawer Style) — overlay mờ dần + sheet trượt lên
          (animation ở novel-reader.css, tự tắt khi giảm chuyển động) */}
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
          }}
        >
          {({ requestClose }) => (<>
          <div className="reader-settings-sheet__handle" aria-hidden="true" />

          <div className="reader-settings-sheet__header">
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Tuỳ chỉnh</h3>
            {/* requestClose: đóng có animation (trượt xuống + overlay mờ dần) như Escape/bấm nền */}
            <button type="button" className="reader-settings-sheet__close" onClick={requestClose} aria-label="Đóng tuỳ chỉnh">✕</button>
          </div>

          <div className="reader-settings-sheet__body">
            <ReaderSettingsPanel
              settings={settings}
              onChange={onChange}
              ttsVoices={tts.voices}
              customReplacementsCount={replacements.length}
              onOpenReplacementsManager={() => setIsReplacementsManagerOpen(true)}
            />

            {/* Đọc offline: tải trước N chương kế tiếp để service worker cache */}
            <div style={{ marginTop: 'var(--space-5, 24px)', marginBottom: '0.5rem' }}>
              <div className="reader-offline__label">ĐỌC OFFLINE</div>
              <button
                type="button"
                className="reader-offline__btn"
                onClick={downloadNextChapters}
                aria-busy={downloading}
                disabled={downloading || !nextChapter}
              >
                <Download size={18} aria-hidden="true" />
                {downloading
                  ? `Đang tải... đã tải ${dlProgress?.done ?? 0}/${dlProgress?.total ?? OFFLINE_BATCH_SIZE}`
                  : dlProgress
                    ? `Đã tải ${dlProgress.done}/${dlProgress.total} chương`
                    : `Tải ${OFFLINE_BATCH_SIZE} chương tiếp`}
              </button>
              <div className="reader-offline__hint">
                {nextChapter
                  ? 'Chương đã tải sẽ đọc được cả khi mất mạng.'
                  : 'Đây là chương cuối — không còn chương kế tiếp để tải.'}
              </div>
            </div>
          </div>
          </>)}
        </Modal>
      )}

      {/* FAB cuộn lên đầu — góc dưới TRÁI (48px, tránh safe-area), không đè
          vùng chạm "chương tiếp" bên phải. (Nút Cài đặt đã có ở cả 2 thanh
          điều hướng nên không cần FAB riêng.) */}
      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="reader-fab"
          aria-label="Cuộn lên đầu trang"
        >
          <ChevronUp size={22} aria-hidden="true" />
        </button>
      )}

      {/* Thanh nghe truyện (chỉ khi có phiên TTS): đoạn trước / phát-tạm dừng /
          đoạn sau / dừng. Trình duyệt chặn tự phát (sau khi tự sang chương) →
          nút "Tiếp tục nghe" (một lần chạm của người dùng là phát được). */}
      {tts.isPlaying && (
        <div className="reader-tts-bar" role="group" aria-label="Điều khiển nghe truyện">
          <button type="button" className="reader-tts-bar__btn" onClick={tts.prevParagraph}
            title="Đoạn trước" aria-label="Đọc đoạn trước">
            <SkipBack size={20} aria-hidden="true" />
          </button>
          {tts.error && (
            <span className="reader-tts-bar__msg" role="alert">
              {tts.error === 'language-unavailable' || tts.error === 'voice-unavailable'
                ? 'Máy chưa có giọng đọc phù hợp.'
                : 'Không phát được giọng đọc.'}
            </span>
          )}
          {tts.blocked ? (
            <button type="button" className="reader-tts-bar__btn reader-tts-bar__btn--resume" onClick={toggleTts}>
              <Play size={18} aria-hidden="true" /> {tts.error ? 'Thử lại' : 'Tiếp tục nghe'}
            </button>
          ) : (
            <button type="button" className="reader-tts-bar__btn" onClick={toggleTts}
              title={tts.isPaused ? 'Tiếp tục đọc' : 'Tạm dừng đọc'} aria-label={tts.isPaused ? 'Tiếp tục đọc' : 'Tạm dừng đọc'}>
              {tts.isPaused ? <Play size={20} aria-hidden="true" /> : <Pause size={20} aria-hidden="true" />}
            </button>
          )}
          <button type="button" className="reader-tts-bar__btn" onClick={tts.nextParagraph}
            title="Đoạn sau" aria-label="Đọc đoạn sau">
            <SkipForward size={20} aria-hidden="true" />
          </button>
          <button type="button" className="reader-tts-bar__btn" onClick={ttsStop}
            title="Dừng đọc" aria-label="Dừng nghe">
            <Square size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      {ttsNotice && !tts.isPlaying && (
        <div role="status" aria-live="polite" className="reader-sync-status">
          <AlertTriangle size={12} color="#fbbf24" /> {ttsNotice}
        </div>
      )}

      {/* C02: trạng thái đồng bộ tiến trình đọc — chỉ hiện khi có gì để báo,
          không hiện liên tục gây rối mắt (ẩn ở trạng thái 'saved' sau vài giây).
          pointer-events: none → không chặn chạm vào nội dung bên dưới. */}
      {syncStatus && (
        <div role="status" aria-live="polite" className="reader-sync-status">
          {syncStatus === 'saving' && (<><Loader2 size={12} className="spin" /> Đang lưu tiến trình...</>)}
          {syncStatus === 'saved' && (<><Check size={12} color="#4ade80" /> Đã lưu tiến trình</>)}
          {syncStatus === 'error' && (<><AlertTriangle size={12} color="#f87171" /> Chưa lưu được, sẽ thử lại</>)}
        </div>
      )}

      {/* Bản dịch phụ (?ban): ẩn nút "Sửa từ" (góp ý name + tra /names dựa trên
          glossary của bản AI mặc định, không khớp bản dịch khác). */}
      {selectionCoords && !ban && (
        <div
          className="reader-selection-popover"
          style={{
            left: `${selectionCoords.x}px`,
            top: `${selectionCoords.y}px`,
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              setIsInlineGlossaryOpen(true)
              setSelectionCoords(null)
            }}
            className="reader-selection-btn"
          >
            <span>✏️ Sửa từ</span>
          </button>
        </div>
      )}

      <InlineGlossaryModal
        isOpen={isInlineGlossaryOpen}
        onClose={() => setIsInlineGlossaryOpen(false)}
        initialFrom={selectedText}
        context={selectedContext}
        onApply={handleApplyReplacement}
        slug={slug}
        chapter={isNumberParam ? Number(chapter) : undefined}
      />

      <ReplacementsManagerModal
        isOpen={isReplacementsManagerOpen}
        onClose={() => setIsReplacementsManagerOpen(false)}
        replacements={replacements}
        onDelete={handleDeleteReplacement}
        slug={slug}
        onImport={handleImportReplacements}
      />
    </div>
  )
}
