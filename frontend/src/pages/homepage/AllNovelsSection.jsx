import PropTypes from 'prop-types'
import { useEffect, useState } from 'react'
import { BookOpen, LayoutGrid, List, AlignJustify, Loader2 } from 'lucide-react'
import api from '../../api'
import { extractNovels } from '../../utils/novelsApi'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelGrid from '../../components/ui/NovelGrid'
import NovelTable from '../../components/ui/NovelTable'
import NovelList from '../../components/ui/NovelList'

const TABS = [
  { key: 'all',       label: 'Tất cả' },
  { key: 'ongoing',   label: 'Đang dịch' },
  { key: 'completed', label: 'Hoàn thành' },
  { key: 'epub',      label: 'EPUB' },
]
const PAGE_SIZE = 30

function paramsForTab(tab, genre) {
  const params = { sort: 'updated_at', order: 'desc', limit: PAGE_SIZE }
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
  const [novels, setNovels] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Đổi tab/thể loại → về trang 1, tải lại từ đầu.
  useEffect(() => {
    let alive = true
    setLoading(true)
    setPage(1)
    const controller = new AbortController()
    api.get('/novels', { params: { ...paramsForTab(activeTab, activeGenre), page: 1 }, signal: controller.signal })
      .then(res => {
        if (!alive) return
        setNovels(extractNovels(res.data))
        setTotal(res.data?.total || 0)
      })
      .catch(() => { if (alive) { setNovels([]); setTotal(0) } })
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

  if (loading) {
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
        <div className="hp-tabs" style={{ flex: 1, marginBottom: 0, borderBottom: 'none' }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`hp-tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="hp-view-toggle">
          <button
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
            title="Dạng danh sách gọn"
            aria-label="Dạng danh sách gọn"
          >
            <AlignJustify size={14} />
          </button>
          <button
            className={viewMode === 'grid' ? 'active' : ''}
            onClick={() => setViewMode('grid')}
            title="Dạng lưới"
            aria-label="Dạng lưới"
          >
            <LayoutGrid size={14} />
          </button>
          <button
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
      {novels.length > 0 ? (
        <>
          {viewMode === 'list' ? (
            <div className="glass-panel" style={{ padding: '0.75rem', borderRadius: '14px' }}>
              <NovelList novels={novels} showViews={true} showRating={true} />
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
                if (n.total_chapters > 0 && n.chapter_count >= n.total_chapters) return { variant: 'full', label: 'FULL' }
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
    </section>
  )
}
AllNovelsSection.propTypes = {
  activeGenre: PropTypes.string,
};
