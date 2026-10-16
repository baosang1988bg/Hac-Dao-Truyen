import PropTypes from 'prop-types'
import { useEffect, useRef, useState } from 'react'
import { BookOpen, LayoutGrid, List, AlignJustify, Loader2 } from 'lucide-react'
import api from '../../api'
import { extractNovels, LATEST_UPDATED_PARAMS } from '../../utils/novelsApi'
import { cachedGet, peekCache } from '../../utils/apiCache'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelGrid from '../../components/ui/NovelGrid'
import NovelTable from '../../components/ui/NovelTable'
import NovelList from '../../components/ui/NovelList'
import { isNovelCompleted } from '../../utils/novelStatus'

const TABS = [
  { key: 'all',       label: 'Tất cả' },
  { key: 'ongoing',   label: 'Đang dịch' },
  { key: 'completed', label: 'Hoàn thành' },
  { key: 'epub',      label: 'EPUB' },
]
const PAGE_SIZE = 30

// Trang 1 tab "Tất cả" (không lọc thể loại) trùng đúng LATEST_UPDATED_PARAMS
// mà UpdatesSection dùng → apiCache gộp thành 1 request.
function paramsForTab(tab, genre) {
  const params = { ...LATEST_UPDATED_PARAMS, limit: PAGE_SIZE }
  delete params.page
  if (genre) params.genre = genre
  if (tab === 'ongoing') params.status = 'ongoing'
  else if (tab === 'completed') params.status = 'completed'
  else if (tab === 'epub') params.has_epub = '1'
  return params
}

/**
 * AllNovelsSection – Danh sách toàn bộ truyện với tab filter & 3 chế độ xem.
 * Hỗ trợ Dạng Danh Sách (List Compact - Mặc định) | Dạng Lưới (Grid) | Dạng Bảng (Table).
 *
 * Tự fetch theo trang (PAGE_SIZE truyện/lần) qua GET /api/novels với
 * status/has_epub/genre — KHÔNG nhận cả catalog từ HomePage rồi lọc trong
 * RAM như trước (catalog có thể lên tới hàng chục nghìn truyện).
 */
export default function AllNovelsSection({ activeGenre = '' }) {
  const [activeTab, setActiveTab] = useState('all')
  const [viewMode, setViewMode] = useState('list') // 'list' (default) | 'grid' | 'table'
  // Có sẵn trong cache (UpdatesSection đã tải) → render ngay, không nháy skeleton.
  const initial = peekCache('/novels', { ...paramsForTab('all', activeGenre), page: 1 })
  const [novels, setNovels] = useState(() => extractNovels(initial))
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(() => initial?.total || 0)
  const [loading, setLoading] = useState(initial === undefined)
  const tabRefs = useRef({})
  const [loadingMore, setLoadingMore] = useState(false)

  // Đổi tab/thể loại → về trang 1, tải lại từ đầu.
  useEffect(() => {
    let alive = true
    setLoading(true)
    setPage(1)
    const controller = new AbortController()
    cachedGet('/novels', { params: { ...paramsForTab(activeTab, activeGenre), page: 1 }, signal: controller.signal })
      .then(data => {
        if (!alive) return
        setNovels(extractNovels(data))
        setTotal(data?.total || 0)
      })
      .catch(err => {
        if (err?.name === 'CanceledError') return
        if (alive) { setNovels([]); setTotal(0) }
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; controller.abort() }
  }, [activeTab, activeGenre])

  const hasMore = novels.length < total

  function loadMore() {
    const nextPage = page + 1
    setLoadingMore(true)
    api.get('/novels', { params: { ...paramsForTab(activeTab, activeGenre), page: nextPage } })
      .then(res => {
        setNovels(prev => [...prev, ...extractNovels(res.data)])
        setPage(nextPage)
      })
      .catch(() => { /* giữ nguyên danh sách hiện có nếu tải thêm lỗi */ })
      .finally(() => setLoadingMore(false))
  }

  // Bàn phím cho tablist (WAI-ARIA Tabs): ←/→/Home/End chuyển tab.
  function onTabKeyDown(e, idx) {
    let next = null
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next === null) return
    e.preventDefault()
    const key = TABS[next].key
    setActiveTab(key)
    tabRefs.current[key]?.focus()
  }

  if (loading && novels.length === 0) {
    return (
      <section style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
        <SectionHeader icon={<BookOpen size={15} style={{ color: 'var(--accent)' }} />} title="Tất Cả Truyện" />
        <div className="glass-panel" style={{ height: '400px', borderRadius: '14px' }} />
      </section>
    )
  }

  return (
    <section style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<BookOpen size={15} style={{ color: 'var(--accent)' }} />}
        title="Tất Cả Truyện"
        count={total}
      />

      {/* Tabs + Toggle View Mode */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div className="hp-tabs" role="tablist" aria-label="Lọc truyện theo trạng thái" style={{ flex: 1, marginBottom: 0, borderBottom: 'none' }}>
          {TABS.map((tab, idx) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`all-novels-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls="all-novels-panel"
              tabIndex={activeTab === tab.key ? 0 : -1}
              ref={el => { tabRefs.current[tab.key] = el }}
              className={`hp-tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
              onKeyDown={e => onTabKeyDown(e, idx)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="hp-view-toggle" role="group" aria-label="Chế độ hiển thị">
          <button
            type="button"
            aria-pressed={viewMode === 'list'}
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
            title="Dạng danh sách gọn"
            aria-label="Dạng danh sách gọn"
          >
            <AlignJustify size={14} />
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'grid'}
            className={viewMode === 'grid' ? 'active' : ''}
            onClick={() => setViewMode('grid')}
            title="Dạng lưới"
            aria-label="Dạng lưới"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'table'}
            className={viewMode === 'table' ? 'active' : ''}
            onClick={() => setViewMode('table')}
            title="Dạng bảng"
            aria-label="Dạng bảng"
          >
            <List size={14} />
          </button>
        </div>
      </div>
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '1rem', marginTop: '0.5rem' }} />

      {/* Render View theo ViewMode */}
      <div id="all-novels-panel" role="tabpanel" aria-labelledby={`all-novels-tab-${activeTab}`} aria-busy={loading}>
      {novels.length > 0 ? (
        <>
          {viewMode === 'list' ? (
            <div className="glass-panel" style={{ padding: '0.75rem', borderRadius: '14px' }}>
              {/* Danh sách dài → không hiện bìa (trước đây ~30 ảnh tải ngay khi vào
                  trang chủ). Muốn xem bìa thì chuyển sang dạng lưới (lazy-load). */}
              <NovelList novels={novels} showViews={true} showRating={true} showCover={false} />
            </div>
          ) : viewMode === 'table' ? (
            <div className="glass-panel" style={{ borderRadius: '14px', overflow: 'hidden' }}>
              <NovelTable novels={novels} />
            </div>
          ) : (
            <NovelGrid
              novels={novels}
              cols={{ mobile: 3, tablet: 4, desktop: 5 }}
              getBadge={(n) => {
                if (n.has_epub === 1 || n.has_epub === true) return { variant: 'epub', label: 'EPUB' }
                if (isNovelCompleted(n)) return { variant: 'full', label: 'FULL' }
                return null
              }}
            />
          )}

          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: 'var(--space-4, 16px)' }}>
              <button
                className="btn btn-secondary"
                onClick={loadMore}
                disabled={loadingMore}
                style={{ minWidth: '160px', minHeight: 'var(--tap-target-min, 44px)', justifyContent: 'center' }}
              >
                {loadingMore ? <><Loader2 size={16} className="spin" /> Đang tải...</> : 'Xem thêm truyện'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0', fontSize: '0.9rem' }}>
          Không có truyện nào trong danh mục này.
        </div>
      )}
      </div>
    </section>
  )
}
AllNovelsSection.propTypes = {
  activeGenre: PropTypes.string,
};
