import PropTypes from 'prop-types'
import { useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { Sparkles, RefreshCw, BookOpen, ChevronRight, Search, X } from 'lucide-react'
import NovelCover from '../components/NovelCover'
import useDocumentTitle from '../hooks/useDocumentTitle'
import useUpdatesFeed, { useUnseenUpdates } from '../hooks/useUpdatesFeed'
import { getAllHistory } from '../utils/readingHistory'
import { fmtTimeAgo, fmtNumber } from '../utils/format'
import { withViewTransition } from '../utils/motion'
import {
  chapterRangeLabel, cleanChapterTitle, filterUpdates, groupByDay,
} from '../utils/updatesFeed'
import '../styles/updates.css'

const FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'reading', label: 'Đang đọc' },
  { id: 'new', label: 'Truyện mới' },
]

/**
 * UpdatesPage (/cap-nhat) — "Nhật ký cập nhật" công khai cho độc giả.
 * Dữ liệu thật từ GET /api/updates (chương lên site trong 7 ngày, gom theo
 * truyện + ngày giờ VN). Không bịa số liệu: chỉ hiện số chương thực sự mới.
 */
export default function UpdatesPage() {
  useDocumentTitle('Mới cập nhật')
  const { data, items, error, loading, reload } = useUpdatesFeed()
  const { markAllSeen } = useUnseenUpdates()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [history] = useState(getAllHistory)
  const [refreshing, setRefreshing] = useState(false)

  const readingBySlug = useMemo(
    () => new Map(history.map(h => [h.slug, h])),
    [history],
  )

  // Mở trang = đã xem → tắt chấm đỏ ở tab "Mới".
  useEffect(() => {
    if (items.length) markAllSeen(items)
  }, [items, markAllSeen])

  useEffect(() => {
    if (!loading) setRefreshing(false)
  }, [loading, data])

  const visible = useMemo(
    () => filterUpdates(items, { filter, readingSlugs: [...readingBySlug.keys()], query }),
    [items, filter, readingBySlug, query],
  )
  const groups = useMemo(() => groupByDay(visible), [visible])
  const readingCount = useMemo(
    () => items.filter(i => readingBySlug.has(i.slug)).length,
    [items, readingBySlug],
  )

  const changeFilter = (id) => {
    if (id === filter) return
    // flushSync: DOM phải cập nhật NGAY trong callback để View Transitions chụp
    // đúng trạng thái mới (không có thì hiệu ứng bị mất/nháy).
    withViewTransition(() => flushSync(() => setFilter(id)))
  }

  const refresh = () => {
    setRefreshing(true)
    reload()
  }

  const summary = data?.summary
  const windowDays = data?.window_days || 7

  return (
    <div className="container upd-page">
      <header className="upd-hero hd-reveal">
        <div className="upd-hero__title-row">
          <span className="upd-hero__icon" aria-hidden="true"><Sparkles size={20} /></span>
          <div>
            <h1 className="upd-hero__title">Nhật ký cập nhật</h1>
            <p className="upd-hero__sub">Chương mới lên site trong {windowDays} ngày qua</p>
          </div>
          <button
            type="button"
            className={`upd-refresh hd-press${refreshing ? ' is-spinning' : ''}`}
            onClick={refresh}
            aria-label="Làm mới"
            title="Làm mới"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
        {summary && (
          <div className="upd-stats" aria-live="polite">
            <div className="upd-stat">
              <span className="upd-stat__value">{fmtNumber(summary.new_chapters)}</span>
              <span className="upd-stat__label">chương mới</span>
            </div>
            <div className="upd-stat">
              <span className="upd-stat__value">{fmtNumber(summary.novels_updated)}</span>
              <span className="upd-stat__label">truyện cập nhật</span>
            </div>
            <div className="upd-stat upd-stat--live">
              <span className="hd-live-dot" aria-hidden="true" />
              <span className="upd-stat__label">Tự làm mới vài phút một lần</span>
            </div>
          </div>
        )}
      </header>

      <div className="upd-toolbar">
        <div className="upd-filters" role="tablist" aria-label="Lọc cập nhật">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`upd-filter hd-press${filter === f.id ? ' active' : ''}`}
              onClick={() => changeFilter(f.id)}
            >
              {f.label}
              {f.id === 'reading' && readingCount > 0 && <span className="upd-filter__count">{readingCount}</span>}
            </button>
          ))}
        </div>
        <label className="upd-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            enterKeyHint="search"
            placeholder="Lọc theo tên truyện, tác giả…"
            aria-label="Lọc theo tên truyện hoặc tác giả"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="upd-search__clear" onClick={() => setQuery('')} aria-label="Xóa bộ lọc">
              <X size={16} />
            </button>
          )}
        </label>
      </div>

      {loading ? (
        <FeedSkeleton />
      ) : error && !items.length ? (
        <div className="glass-panel upd-empty" role="alert">
          <p>Không tải được nhật ký cập nhật. Kiểm tra kết nối rồi thử lại.</p>
          <button type="button" className="btn btn-secondary" onClick={refresh}>
            <RefreshCw size={16} /> Thử lại
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="glass-panel upd-empty">
          <BookOpen size={28} aria-hidden="true" />
          <p>
            {items.length === 0
              ? `Chưa có chương mới trong ${windowDays} ngày qua.`
              : filter === 'reading'
                ? 'Các truyện bạn đang đọc chưa có chương mới.'
                : 'Không có cập nhật khớp bộ lọc.'}
          </p>
          {(filter !== 'all' || query) && (
            <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); changeFilter('all') }}>
              Xem tất cả
            </button>
          )}
        </div>
      ) : (
        <div className="upd-timeline">
          {groups.map(g => (
            <section key={g.day} className="upd-day" aria-label={g.label}>
              <h2 className="upd-day__head">
                <span>{g.label}</span>
                <span className="upd-day__meta">{fmtNumber(g.chapters)} chương</span>
              </h2>
              <ol className="upd-list" data-track-section="updates_feed">
                {g.items.map((it, i) => (
                  <UpdateItem
                    key={`${it.slug}-${it.day}`}
                    item={it}
                    index={i}
                    reading={readingBySlug.get(it.slug)}
                  />
                ))}
              </ol>
            </section>
          ))}
          {data?.truncated && (
            <p className="upd-note">Chỉ hiển thị {items.length} lượt cập nhật gần nhất.</p>
          )}
        </div>
      )}
    </div>
  )
}

function UpdateItem({ item, index, reading }) {
  const latest = cleanChapterTitle(item.latest_title)
  const readUrl = `/novel/${item.slug}/read/${item.to_chapter}`
  return (
    <li className="upd-item hd-reveal" style={{ '--i': Math.min(index, 8) }}>
      <span className="upd-item__dot" aria-hidden="true" />
      <article className="upd-card glass-panel">
        <Link to={`/novel/${item.slug}`} className="upd-card__cover" aria-label={item.title} tabIndex={-1}>
          <NovelCover novel={item} size="sm" />
        </Link>
        <div className="upd-card__body">
          <div className="upd-card__tags">
            {item.is_new_novel && <span className="upd-tag upd-tag--new">Truyện mới</span>}
            {reading && <span className="upd-tag upd-tag--reading">Đang đọc</span>}
            <span className="upd-card__time">
              <time dateTime={item.last_at || undefined}>{fmtTimeAgo(item.last_at)}</time>
            </span>
          </div>
          <Link to={`/novel/${item.slug}`} className="upd-card__title">{item.title}</Link>
          <div className="upd-card__range">
            <span className="upd-count">+{fmtNumber(item.count)} chương</span>
            <span>{chapterRangeLabel(item)}</span>
          </div>
          {latest && <p className="upd-card__latest" title={latest}>{latest}</p>}
        </div>
        <Link to={readUrl} className="upd-card__cta hd-press" aria-label={`Đọc ${chapterRangeLabel(item)} – ${item.title}`}>
          <span className="upd-card__cta-text">Đọc</span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      </article>
    </li>
  )
}

UpdateItem.propTypes = {
  item: PropTypes.shape({
    slug: PropTypes.string.isRequired,
    title: PropTypes.string,
    day: PropTypes.string,
    count: PropTypes.number,
    from_chapter: PropTypes.number,
    to_chapter: PropTypes.number,
    latest_title: PropTypes.string,
    last_at: PropTypes.string,
    is_new_novel: PropTypes.bool,
  }).isRequired,
  index: PropTypes.number,
  reading: PropTypes.object,
}

function FeedSkeleton() {
  return (
    <div className="upd-timeline" role="status" aria-label="Đang tải nhật ký cập nhật">
      <span className="hd-skel" style={{ height: 20, width: 120, marginBottom: 14 }} />
      {[0, 1, 2, 3].map(i => (
        <span key={i} className="hd-skel" style={{ height: 104, marginBottom: 12, borderRadius: 14 }} />
      ))}
    </div>
  )
}
