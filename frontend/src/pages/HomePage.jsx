import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { extractNovels } from '../utils/novelsApi'
import { cachedGet } from '../utils/apiCache'
import LazyMount from '../components/LazyMount'
import { prefersReducedMotion } from '../utils/motion'
import { trackSearch } from '../utils/analytics'
import { readSearchParam, urlWithSearchParam } from '../utils/engagement'
import '../styles/home.css'

// ── Truyentrung.com UI Components ──
import SearchSection from './homepage/SearchSection'
import GenreChips from './homepage/GenreChips'
import RecentlyReadSection from './homepage/RecentlyReadSection'
import TruyThuNoticeSection from './homepage/TruyThuNoticeSection'
import MonthlyPopularSection from './homepage/MonthlyPopularSection'
import UpdatesSection from './homepage/UpdatesSection'
import ExternalRankingsSection from './homepage/ExternalRankingsSection'
import TruyenTrungRankings from './homepage/TruyenTrungRankings'
import ViewRankingsSection from './homepage/ViewRankingsSection'
import TruyenTrungChatboxWidget from './homepage/TruyenTrungChatboxWidget'
import LatestChaptersWidget from './homepage/LatestChaptersWidget'
import AllNovelsSection from './homepage/AllNovelsSection'
import RecentCommentsSection from './homepage/RecentCommentsSection'
import StatsSection from './homepage/StatsSection'

// Breakpoint 2 cột (khớp .hp-portal-layout trong index.css).
const DESKTOP_MQ = '(min-width: 1024px)'

// Tìm kiếm quét LIKE trên cả bảng truyện (không có index) → chỉ gửi khi đủ 2
// ký tự và người dùng ngừng gõ; lấy 24 kết quả đầu (đủ cho lưới gợi ý).
const SEARCH_MIN_CHARS = 2
const SEARCH_DEBOUNCE_MS = 400
const SEARCH_LIMIT = 24

function getDesktopMql() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DESKTOP_MQ)
    : null
}
function subscribeDesktop(onChange) {
  const mql = getDesktopMql()
  if (!mql) return () => {}
  if (mql.addEventListener) {
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }
  mql.addListener?.(onChange) // Safari < 14
  return () => mql.removeListener?.(onChange)
}
function getIsDesktop() {
  return getDesktopMql()?.matches ?? true
}

/**
 * HomePage – Orchestrator trang chủ HacDaoTruyen.
 * Thứ tự ưu tiên thị giác (anchor chính lên đầu, phần cá nhân/phụ xuống
 * sidebar — xem audit UX 2026-09-11):
 *   1. Hero "Xem Nhiều Nhất" (MonthlyPopularSection — tổng lượt xem, anchor chính, full-width)
 *   2. Top Notice Bar: Khung Truy Thư Lệnh & Thông Báo Tìm Truyện
 *   3. [Cột chính] Recently Updated Table → GenreChips → All Novels Tabbed List
 *   4. [Sidebar] Recently Read → Multi-Ranking Widgets → Khung thông báo tĩnh
 *      → Bình luận mới nhất → Thống kê hệ thống
 * Mobile/tablet (<1024px, 1 cột): Hero → Vừa đọc → Chương mới lên → Truy Thư
 *   → Mới cập nhật → BXH → Thể loại + Tất cả truyện → BXH nguồn → Bình luận
 *   → Thông báo (thu gọn) → Thống kê. Chọn bố cục bằng matchMedia để thứ tự
 *   DOM khớp thứ tự hiển thị (CSS order làm lệch thứ tự Tab/đọc màn hình).
 *
 * KHÔNG còn tải cả catalog ở đây (trước đây fetchAllNovels kéo tới hàng chục
 * nghìn truyện chỉ để các section con tự lọc/sort trong RAM — nguyên nhân
 * chính khiến trang chủ chậm và làm cạn quota D1 rows-read, 2026-09-11).
 * Mỗi section bên dưới tự gọi API riêng, nhỏ, độc lập — section nào tải xong
 * trước thì hiện trước, không còn 1 màn hình loading chờ tất cả.
 */
export default function HomePage() {
  const location = useLocation()
  const navigate = useNavigate()
  // /?q=... (SearchAction JSON-LD, link chia sẻ) → điền sẵn ô tìm và chạy tìm
  // ngay như khi người dùng gõ (effect tìm kiếm bên dưới tự lo).
  const [searchQuery, setSearchQuery] = useState(() => readSearchParam(location.search))
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeGenre, setActiveGenre] = useState('')

  // Xử lý tìm kiếm — B02: tham số đúng contract là `q` (không phải `search`).
  // Dùng AbortController + so sánh request id để bỏ qua response cũ đến muộn
  // (gõ nhanh có thể khiến request trước phản hồi SAU request sau).
  const searchReqId = useRef(0)
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < SEARCH_MIN_CHARS) {
      searchReqId.current += 1
      setSearchResults(null)
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    const myReqId = ++searchReqId.current
    const controller = new AbortController()
    const handle = setTimeout(() => {
      // cachedGet: gõ lại đúng từ khoá cũ (xoá bớt rồi gõ lại) không gọi mạng lần 2.
      cachedGet('/novels', { params: { q, limit: SEARCH_LIMIT }, signal: controller.signal })
        .then(data => {
          if (searchReqId.current !== myReqId) return // response cũ đến muộn — bỏ qua
          const list = extractNovels(data)
          setSearchResults(list)
          // GA4 `search` (debounce 1.5s trong trackSearch → chỉ từ khoá cuối cùng).
          // results_count = 0 → danh sách "truyện người đọc tìm mà chưa có".
          trackSearch(q, { location: 'home', resultsCount: list.length })
          setSearchLoading(false)
        })
        .catch(() => {
          if (searchReqId.current !== myReqId) return
          setSearchLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => { clearTimeout(handle); controller.abort() }
  }, [searchQuery])

  // Đồng bộ ô tìm → ?q= (replace, không đẩy lịch sử mỗi phím). Ghi thẳng bằng
  // history.replaceState thay vì navigate(): đổi location của router sẽ làm
  // AnalyticsTracker bắn page_view cho MỖI lần đổi từ khoá. Giữ nguyên
  // history.state (router lưu key/idx trong đó) để Back/Forward vẫn đúng.
  // Debounce như request tìm kiếm; xoá hẳn ô tìm thì bỏ ?q= ngay.
  const lastUrlQ = useRef(readSearchParam(location.search))
  useEffect(() => {
    const q = searchQuery.trim()
    const value = q.length >= SEARCH_MIN_CHARS ? q : ''
    const write = () => {
      if (typeof window === 'undefined') return
      const next = urlWithSearchParam(window.location, value)
      if (next === null) return
      lastUrlQ.current = value
      window.history.replaceState(window.history.state, '', next)
    }
    if (!value) { write(); return undefined }
    const handle = setTimeout(write, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchQuery])

  // Router điều hướng tới /?q=khác khi đang ở trang chủ (vd link nội bộ) →
  // nạp từ khoá mới vào ô tìm. So với giá trị đã ghi gần nhất để không ghi đè
  // chữ người dùng đang gõ. Nút Tìm kiếm ở header (state.focusSearch, URL '/')
  // chỉ để focus ô tìm → không xoá từ khoá đang có.
  const routerQ = readSearchParam(location.search)
  const focusOnly = Boolean(location.state?.focusSearch)
  useEffect(() => {
    if (focusOnly || routerQ === lastUrlQ.current) return
    lastUrlQ.current = routerQ
    setSearchQuery(routerQ)
  }, [routerQ, focusOnly])

  const isSearching = searchQuery.trim().length >= SEARCH_MIN_CHARS

  // Nút Tìm kiếm ở header mobile điều hướng về '/' kèm state.focusSearch →
  // focus + cuộn tới ô tìm kiếm, rồi xoá state (replace) để bấm Back quay lại
  // trang chủ không tự focus lần nữa.
  const searchInputRef = useRef(null)
  useEffect(() => {
    if (!location.state?.focusSearch) return
    const input = searchInputRef.current
    if (input) {
      input.focus({ preventScroll: true })
      // Cuộn khối .hp-search-wrap (có scroll-margin-top = chiều cao header sticky).
      const target = input.closest('.hp-search-wrap') || input
      target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }
    // search lấy từ window.location: ?q= có thể đã được replaceState cập nhật
    // (router không biết) — dùng location.search sẽ khôi phục từ khoá cũ.
    navigate(`${location.pathname}${window.location.search}${location.hash}`, { replace: true, state: null })
  }, [location, navigate])

  const isDesktop = useSyncExternalStore(subscribeDesktop, getIsDesktop, () => true)

  // Mỗi khối bọc trong .hp-slot.hd-reveal: hiện dần khi cuộn tới. --i chỉ dùng
  // cho vài khối đầu (cùng lúc trong màn hình đầu) để so le nhẹ.
  // .hp-slot:empty bị ẩn (home.css) → section trả null không để lại khoảng trống.
  const slot = (key, node, i = 0) => (
    <div
      key={key}
      className={`hp-slot hp-slot--${key} hd-reveal`}
      style={i ? { '--i': i } : undefined}
      // GA4: click vào truyện/chương trong khối này → select_content{section: key}
      data-track-section={`home_${key}`}
    >
      {node}
    </div>
  )
  // Khối nằm dưới màn hình đầu bọc trong <LazyMount>: chỉ mount (và gọi API
  // của nó) khi người dùng cuộn tới gần. Khách xem lướt rồi rời đi không còn
  // tốn request cho thể loại, BXH nguồn ngoài, bình luận, thống kê.
  const lazy = (node, minHeight) => <LazyMount minHeight={minHeight}>{node}</LazyMount>
  const recent = slot('recent', <RecentlyReadSection />, 1)
  const latest = slot('latest', <LatestChaptersWidget />, 2)
  const notice = slot('notice', <TruyThuNoticeSection />, 1)
  const updates = slot('updates', <UpdatesSection />)
  const external = slot('external', lazy(<ExternalRankingsSection />, 320))
  const genresAndAll = slot('all', lazy(
    <>
      {/* Chip lọc thể loại — đặt sát trên All Novels vì đây là nơi nó
          thực sự lọc, thay vì đứng tách biệt ở đầu trang. */}
      <GenreChips activeGenre={activeGenre} onSelect={setActiveGenre} />
      {/* All Novels Tabbed List: Tất cả truyện dạng Tab */}
      <AllNovelsSection activeGenre={activeGenre} />
    </>,
    480,
  ))
  const rankings = slot('rankings', <TruyenTrungRankings />)
  // BXH lượt đọc thật theo Ngày/Tuần/Tháng — lazy: chỉ gọi API khi cuộn tới.
  const views = slot('views', lazy(<ViewRankingsSection />, 360))
  const board = slot('board', <TruyenTrungChatboxWidget defaultOpen={isDesktop} />)
  const comments = slot('comments', lazy(<RecentCommentsSection />, 120))
  const stats = slot('stats', lazy(<StatsSection />, 76))

  return (
    <div className="container animate-fade-in hp-home" style={{ paddingTop: '1rem' }}>
      {/* 🔍 Search Bar – luôn hiển thị ở trên cùng */}
      <SearchSection
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        searchLoading={searchLoading}
        inputRef={searchInputRef}
        placeholder={isDesktop ? undefined : 'Tìm truyện, tác giả, EPUB…'}
      />

      {/* Các section chính – ẩn khi đang tìm kiếm */}
      {!isSearching && (
        <>
          {/* 1. Anchor chính above-the-fold: hero "Xem Nhiều Nhất" ngay sau
              thanh tìm kiếm — trước đây bị Thông báo/GenreChips/Recently Read
              che mất phía trên, không có điểm nhấn thị giác rõ ràng khi vào trang. */}
          {slot('hero', <MonthlyPopularSection />)}

          {isDesktop ? (
            <>
              {/* Top Notice Bar: Khung Truy Thư Lệnh & Thông Báo Tìm Truyện */}
              {notice}

              {/* Bố cục 2 Cột Portal chuẩn Truyentrung.com */}
              <div className="hp-portal-layout" style={{ marginTop: 'var(--space-5, 24px)' }}>
                {/* ── Cột Trái: Main Content ── */}
                <div className="hp-main-col">
                  {/* Recently Updated Table: Bảng Mới Cập Nhật */}
                  {updates}
                  {external}
                  {genresAndAll}
                </div>

                {/* ── Cột Phải: Sidebar Widgets ── */}
                <div className="hp-sidebar-col">
                  {/* Vừa đọc gần đây — nội dung cá nhân, hợp với sidebar hơn là
                      chiếm full-width ngay đầu trang cho mọi khách vãng lai. */}
                  {recent}
                  {/* Multi-Ranking Widgets: 5 BXH */}
                  {rankings}
                  {/* Đọc nhiều theo kỳ (lượt đọc thật) */}
                  {views}
                  {/* Chương mới lên — dữ liệu sống từ /api/updates */}
                  {latest}
                  {/* Khung thông báo tĩnh (KHÔNG phải chat realtime) */}
                  {board}
                  {/* Thảo luận / Bình luận mới nhất */}
                  {comments}
                  {/* Thống kê hệ thống */}
                  {stats}
                </div>
              </div>
            </>
          ) : (
            /* Mobile/tablet (<1024px): 1 cột, render theo đúng thứ tự hiển thị
               (không dùng CSS order → thứ tự Tab/đọc màn hình khớp thị giác).
               Nội dung "của tôi" + chương mới lên ngay sau hero; widget phụ
               (thông báo tĩnh, thống kê) xuống cuối và thu gọn. */
            <div className="hp-mobile-stack">
              {recent}
              {latest}
              {notice}
              {updates}
              {rankings}
              {views}
              {genresAndAll}
              {external}
              {comments}
              {board}
              {stats}
            </div>
          )}
        </>
      )}
    </div>
  )
}
