import PropTypes from 'prop-types'
import { useEffect, useState, useCallback, useRef } from 'react';

import { Search, SearchX, BookMarked, Star, Eye, BookOpen, SlidersHorizontal, X, Clock, AlignLeft } from 'lucide-react';
import { EpubCard } from '../components/EpubCard'
import { fmtNumber } from '../utils/format';
import { extractNovels } from '../utils/novelsApi'
import { cachedGet, peekCache } from '../utils/apiCache'
import { normalizeGenreList, GENRES_URL, GENRES_TTL } from '../utils/genreLabels'
import { withViewTransition } from '../utils/motion'
import { trackEvent, trackEventDebounced, trackSearch } from '../utils/analytics'
import '../styles/library-epub.css'

// 12 truyện mỗi lần tải: mỗi thẻ kéo thêm 1 ảnh bìa (đa số đi qua Worker
// /api/proxy-cover) nên 24 thẻ/lần là ~25 request cho một lượt xem. Người dùng
// bấm "Tải thêm" mới lấy lô kế tiếp.
const LIMIT = 12
// Tìm kiếm quét LIKE trên cả bảng truyện → chỉ gửi khi đủ 2 ký tự, chờ gõ xong.
const SEARCH_MIN_CHARS = 2
const SEARCH_DEBOUNCE_MS = 450

const SORT_OPTIONS = [
  { value: 'updated_at', label: 'Mới cập nhật', icon: Clock },
  { value: 'chapter_count', label: 'Nhiều chương nhất', icon: BookOpen },
  { value: 'views', label: 'Lượt xem nhiều nhất', icon: Eye },
  { value: 'rating', label: 'Đánh giá cao nhất', icon: Star },
  { value: 'title', label: 'A → Z', icon: AlignLeft },
]

/**
 * EpubCatalogPage — Trang khám phá & đọc toàn bộ kho EPUB.
 * URL: /epub
 */
export default function EpubCatalogPage() {
  const [novels, setNovels]       = useState([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [pages, setPages]         = useState(1)
  const [loading, setLoading]     = useState(true)
  const [genres, setGenres]       = useState(() => normalizeGenreList(peekCache(GENRES_URL)))

  // Filter state
  const [q, setQ]               = useState('')
  const [sort, setSort]         = useState('updated_at')
  const [genre, setGenre]       = useState('')
  const [status, setStatus]     = useState('')
  const [hasEpub, setHasEpub]   = useState(false)
  const [showFilter, setShowFilter] = useState(false)

  const debounceRef = useRef(null)

  // Load genres — dùng chung cache với GenreChips trang chủ; chuẩn hoá nhãn
  // tiếng Việt (tách chuỗi gộp, "cultivation"→"Tu Tiên", bỏ Unknown/trùng).
  useEffect(() => {
    let alive = true
    cachedGet(GENRES_URL, { ttl: GENRES_TTL })
      .then(data => { if (alive) setGenres(normalizeGenreList(data)) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Từ khoá thực sự gửi lên server: bỏ khoảng trắng thừa, dưới 2 ký tự coi như
  // không tìm (đang gõ dở) → không bắn request cho từng phím đầu tiên.
  const qTrim = q.trim()
  const qEffective = qTrim.length >= SEARCH_MIN_CHARS ? qTrim : ''
  // Bỏ qua response của lượt tải cũ đến muộn (đổi bộ lọc nhanh liên tiếp).
  const reqIdRef = useRef(0)

  const fetchNovels = useCallback(async (pg = 1, reset = false) => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    try {
      // cachedGet: gộp request trùng + nhớ kết quả trong phiên (đổi qua lại
      // giữa các bộ lọc/sắp xếp đã xem không gọi lại mạng), và KHÔNG gửi token
      // nên luôn dùng được edge cache của Worker.
      const data = await cachedGet('/novels', {
        params: {
          sort, order: sort === 'title' ? 'asc' : 'desc',
          page: pg, limit: LIMIT,
          q: qEffective, genre, status, has_epub: hasEpub ? '1' : '',
        },
      })
      if (reqIdRef.current !== myReq) return
      const list = extractNovels(data) // chịu được cả {novels} lẫn mảng thẳng
      setTotal(data?.total ?? list.length)
      setPages(data?.pages ?? 1)
      setNovels(prev => (reset || pg === 1) ? list : [...prev, ...list])
      setPage(pg)
      if (pg === 1) {
        if (qEffective) trackSearch(qEffective, { location: 'epub_catalog', resultsCount: data?.total ?? list.length })
        // Bộ lọc đang áp dụng (debounce: đổi liên tục chỉ gửi trạng thái cuối).
        if (genre || status || hasEpub || sort !== 'updated_at') {
          trackEventDebounced('epub_filter', 'filter_apply', {
            filter_genre: genre || undefined, filter_status: status || undefined,
            filter_has_epub: hasEpub, sort, results_count: data?.total ?? list.length,
          })
        }
      } else {
        trackEvent('load_more', { list_name: 'epub_catalog', page_number: pg })
      }
    } catch { /* silent */ }
    finally { if (reqIdRef.current === myReq) setLoading(false) }
  }, [qEffective, sort, genre, status, hasEpub])

  // Fetch khi filter thay đổi
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchNovels(1, true), qEffective ? SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(debounceRef.current)
  }, [qEffective, sort, genre, status, hasEpub, fetchNovels])

  const loadMore = () => { if (page < pages && !loading) fetchNovels(page + 1) }

  // Đổi bộ lọc/sắp xếp bọc trong View Transition (chip đổi trạng thái mượt);
  // trình duyệt không hỗ trợ hoặc giảm chuyển động → cập nhật ngay.
  const applyFilter = (update) => { withViewTransition(update) }

  const resetFilters = () => applyFilter(() => {
    setQ(''); setSort('updated_at'); setGenre(''); setStatus(''); setHasEpub(false)
  })
  const hasActiveFilters = q || genre || status || hasEpub || sort !== 'updated_at'

  return (
    <div className="container animate-fade-in epub-catalog">

      {/* ── Header ── */}
      <div className="hd-page-head">
        <h1 className="page-title">
          <BookMarked size={24} style={{ color: 'var(--accent)' }} aria-hidden="true" /> Kho EPUB
        </h1>
        <p className="page-subtitle" aria-live="polite">
          {total > 0 ? `${fmtNumber(total)} truyện` : 'Đang tải...'} — đọc trực tiếp trên trình duyệt, không cần tải về.
        </p>
      </div>

      {/* ── Search + Filter bar (sticky dưới header guest) ── */}
      <div className="epub-catalog__toolbar">
        <div className="epub-catalog__search-row" role="search">
          {/* Search */}
          <div className="epub-catalog__search-wrap">
            <Search size={16} className="epub-catalog__search-icon" aria-hidden="true" />
            <input
              id="epub-search"
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              aria-label="Tìm tên truyện hoặc tác giả"
              className="epub-catalog__search-input"
              placeholder="Tìm tên truyện, tác giả..."
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            {q && (
              <button type="button" className="epub-catalog__clear" onClick={() => setQ('')} aria-label="Xóa tìm kiếm">
                <X size={16} />
              </button>
            )}
          </div>

          {/* Filter toggle */}
          <button
            id="epub-filter-toggle"
            type="button"
            className="epub-catalog__filter-toggle"
            onClick={() => applyFilter(() => setShowFilter(s => !s))}
            aria-expanded={showFilter}
            aria-controls="epub-filter-panel"
            aria-label={hasActiveFilters ? 'Lọc (đang áp dụng bộ lọc)' : 'Lọc'}
          >
            <SlidersHorizontal size={16} aria-hidden="true" /> Lọc
            {hasActiveFilters && <span aria-hidden="true" className="epub-catalog__filter-dot" />}
          </button>
        </div>

        {/* Expanded filter panel */}
        {showFilter && (
          <div id="epub-filter-panel" className="glass-panel epub-catalog__filter-panel">
            {/* Sort */}
            <div>
              <div className="epub-catalog__filter-label">Sắp xếp</div>
              <div className="epub-catalog__filter-options epub-catalog__filter-options--scroll">
                {SORT_OPTIONS.map(opt => {
                  const Icon = opt.icon
                  return (
                    <button
                      type="button"
                      key={opt.value}
                      className="epub-filter-chip"
                      aria-pressed={sort === opt.value}
                      onClick={() => applyFilter(() => setSort(opt.value))}
                    >
                      <Icon size={14} aria-hidden="true" /> {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Genre */}
            {genres.length > 0 && (
              <div>
                <div className="epub-catalog__filter-label">Thể loại</div>
                <div className="epub-catalog__filter-options epub-catalog__filter-options--scroll">
                  <FilterChip label="Tất cả" active={!genre} onClick={() => applyFilter(() => setGenre(''))} />
                  {genres.map(g => (
                    <FilterChip key={g} label={g} active={genre === g} onClick={() => applyFilter(() => setGenre(g === genre ? '' : g))} />
                  ))}
                </div>
              </div>
            )}

            {/* Status + Has EPUB */}
            <div className="epub-catalog__filter-row">
              <div>
                <div className="epub-catalog__filter-label">Trạng thái</div>
                <div className="epub-catalog__filter-options">
                  <FilterChip label="Tất cả" active={!status} onClick={() => applyFilter(() => setStatus(''))} />
                  <FilterChip label="Đang dịch" active={status === 'ongoing'} onClick={() => applyFilter(() => setStatus(status === 'ongoing' ? '' : 'ongoing'))} />
                  <FilterChip label="Hoàn thành" active={status === 'completed'} onClick={() => applyFilter(() => setStatus(status === 'completed' ? '' : 'completed'))} />
                </div>
              </div>
              <label className="epub-catalog__checkbox">
                <input
                  type="checkbox"
                  checked={hasEpub}
                  onChange={e => { const v = e.target.checked; applyFilter(() => setHasEpub(v)) }}
                />
                Chỉ hiện truyện có EPUB
              </label>
            </div>

            {hasActiveFilters && (
              <button type="button" className="epub-filter-chip epub-filter-chip--ghost" onClick={resetFilters}>
                <X size={14} aria-hidden="true" /> Xóa bộ lọc
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Quick sort chips (luôn hiện, cuộn ngang trên mobile) ── */}
      <div className="epub-catalog__quick-sort" role="group" aria-label="Sắp xếp nhanh">
        {SORT_OPTIONS.slice(0, 4).map(opt => {
          const Icon = opt.icon
          return (
            <button
              type="button"
              key={opt.value}
              className="epub-filter-chip"
              aria-pressed={sort === opt.value}
              onClick={() => applyFilter(() => setSort(opt.value))}
            >
              <Icon size={14} aria-hidden="true" /> {opt.label}
            </button>
          )
        })}
      </div>

      {/* ── Grid ── */}
      {loading && novels.length === 0 ? (
        <div className="epub-catalog__grid hd-stagger" role="status" aria-label="Đang tải danh sách truyện">
          {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : novels.length === 0 ? (
        <div className="glass-panel hd-empty">
          <div className="hd-empty__icon"><SearchX size={28} aria-hidden="true" /></div>
          <div className="hd-empty__title">Không tìm thấy truyện nào</div>
          <p className="hd-empty__text">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.</p>
          {hasActiveFilters && (
            <div className="hd-empty__actions">
              <button type="button" onClick={resetFilters} className="btn btn-secondary">
                <X size={16} aria-hidden="true" /> Xóa bộ lọc
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="epub-catalog__grid" data-track-section="epub_catalog">
            {novels.map((n, i) => (
              // .hd-reveal ở lớp bọc (không đặt lên .epub-card) để hiệu ứng
              // hover/nhấn của thẻ không bị trễ theo transition-delay so le.
              <div key={n.slug} className="epub-catalog__cell hd-reveal" style={{ '--i': i % 6 }}>
                <EpubCard novel={n} />
              </div>
            ))}
          </div>

          {/* Load more */}
          {page < pages && (
            <div className="epub-catalog__more">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="btn btn-secondary epub-catalog__load-more"
              >
                {loading ? 'Đang tải...' : `Tải thêm (${fmtNumber(total - novels.length)} còn lại)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function FilterChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      className="epub-filter-chip"
      aria-pressed={Boolean(active)}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
FilterChip.propTypes = {
  label: PropTypes.node,
  active: PropTypes.bool,
  onClick: PropTypes.func,
};


function SkeletonCard() {
  return (
    <div className="epub-skel-card" aria-hidden="true">
      <span className="hd-skel epub-skel-card__cover" />
      <div className="epub-skel-card__body">
        <span className="hd-skel epub-skel-card__line" />
        <span className="hd-skel epub-skel-card__line epub-skel-card__line--short" />
        <span className="hd-skel epub-skel-card__btn" />
      </div>
    </div>
  )
}
