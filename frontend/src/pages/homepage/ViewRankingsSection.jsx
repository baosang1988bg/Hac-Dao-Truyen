import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, RefreshCw } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import { fetchViewRankings } from '../../engagementApi'
import { fmtNumber } from '../../utils/format'
import { VIEW_PERIODS, viewPeriodLabel, normalizeViewRankings, rankingDisplayTitle } from '../../utils/engagement'

const LIMIT = 10

/**
 * ViewRankingsSection — BXH "Đọc nhiều" theo kỳ Ngày | Tuần | Tháng (học từ
 * truyentrung). Số liệu là lượt đọc THẬT trong kỳ (novel_views_daily, chỉ
 * cộng khi người đọc ở lại chương đủ lâu — xem trackView của Worker), khác
 * tab "BXH Lượt Đọc" (tổng tích luỹ) ở TruyenTrungRankings.
 *
 * - HomePage bọc trong LazyMount → chỉ gọi API khi cuộn tới.
 * - Nhớ kết quả từng kỳ trong state: chuyển qua lại giữa các kỳ không gọi lại.
 * - API báo `unavailable` (migration 015 chưa chạy) hoặc rỗng → trạng thái
 *   trống lịch sự, KHÔNG điền số giả.
 */
export default function ViewRankingsSection() {
  const [period, setPeriod] = useState('week')
  // { [period]: { items, unavailable } } — đã tải xong (kể cả rỗng)
  const [byPeriod, setByPeriod] = useState({})
  const [errorPeriod, setErrorPeriod] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  const current = byPeriod[period]

  useEffect(() => {
    if (byPeriod[period]) return undefined
    let alive = true
    setErrorPeriod('')
    fetchViewRankings(period, LIMIT)
      .then(data => {
        if (alive) setByPeriod(prev => ({ ...prev, [period]: normalizeViewRankings(data) }))
      })
      .catch(() => { if (alive) setErrorPeriod(period) })
    return () => { alive = false }
    // byPeriod cố ý không nằm trong deps: chỉ tải khi đổi kỳ / bấm thử lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, reloadTick])

  const loading = !current && errorPeriod !== period
  const items = current?.items || []
  const periodLabel = viewPeriodLabel(period).toLowerCase()

  return (
    <div className="glass-panel hp-view-rank" style={{ padding: 'var(--space-4, 16px)', borderRadius: '16px', marginBottom: 'var(--space-5, 24px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-3, 12px)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 'var(--space-2, 8px)' }}>
        <TrendingUp size={17} style={{ color: '#f59e0b' }} aria-hidden="true" />
        <h3 id="hp-view-rank-title" style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
          Đọc nhiều
        </h3>
      </div>

      {/* Chọn kỳ — cùng kiểu nút với tab BXH nội bộ */}
      <div className="qidian-rank-tabs" role="group" aria-labelledby="hp-view-rank-title" style={{ display: 'flex', gap: 'var(--space-2, 8px)', marginBottom: 'var(--space-3, 12px)' }}>
        {VIEW_PERIODS.map(p => (
          <button
            key={p.key}
            type="button"
            aria-pressed={period === p.key}
            className={`qidian-rank-tab ${period === p.key ? 'active' : ''}`}
            onClick={() => setPeriod(p.key)}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="hd-skel" style={{ height: '260px', borderRadius: '10px' }} role="status" aria-label="Đang tải bảng xếp hạng đọc nhiều" />
      ) : errorPeriod === period ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0' }} role="alert">
          Không tải được bảng xếp hạng.{' '}
          <button type="button" className="link-btn" onClick={() => setReloadTick(t => t + 1)}>
            <RefreshCw size={13} aria-hidden="true" /> Thử lại
          </button>
        </div>
      ) : items.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0', margin: 0 }}>
          Chưa có đủ dữ liệu lượt đọc cho kỳ này
        </p>
      ) : (
        // Không dùng class qidian-rank-list: home.css ẩn hạng 6+ của class đó trên mobile.
        <ol className="hp-view-rank__list" aria-label={`Truyện đọc nhiều theo ${periodLabel}`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2, 8px)' }}>
          {items.map((item, idx) => {
            const title = rankingDisplayTitle(item)
            let rankCls = 'rank-num'
            if (idx === 0) rankCls += ' rank-1'
            else if (idx === 1) rankCls += ' rank-2'
            else if (idx === 2) rankCls += ' rank-3'
            return (
              <li key={item.slug}>
                <Link to={`/novel/${item.slug}`} className="qidian-rank-item">
                  <span className={rankCls}>{idx + 1}</span>
                  <NovelCover novel={{ ...item, title }} size="xs" style={{ width: '30px', height: '45px', flexShrink: 0 }} />
                  <span className="qidian-rank-title" title={title} style={{ flex: 1, minWidth: 0 }}>
                    {title}
                  </span>
                  <span className="qidian-rank-metric">
                    {fmtNumber(Number(item.period_views) || 0)} lượt đọc
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
