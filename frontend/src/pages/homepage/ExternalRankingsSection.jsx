import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Globe, ChevronDown } from 'lucide-react'
import { cachedGet } from '../../utils/apiCache'
import SectionHeader from '../../components/ui/SectionHeader'
import { fmtStatLabel } from '../../utils/format'
import { withViewTransition } from '../../utils/motion'
import './ExternalRankingsSection.css'

const SOURCES = { qidian: 'Qidian', '69shuba': '69shuba', novel543: 'Novel543', fanqie: 'Fanqie', faloo: 'Faloo' }
const CATEGORIES = { views: 'Lượt đọc', follows: 'Theo dõi', recommend: 'Đề cử', general: 'Tổng quát' }
const WINDOWS = { daily: 'Ngày', weekly: 'Tuần', monthly: 'Tháng', quarterly: 'Quý', all_time: 'Toàn thời gian' }
// BXH nguồn ngoài chỉ đổi theo lượt sync (Worker cache 1 giờ).
const RANKINGS_TTL = 30 * 60_000
const safeUrl = value => /^https?:\/\//i.test(value || '')
// Mobile chỉ hiện ngần này mục đầu (CSS ẩn phần còn lại) — trước đây danh sách
// cuộn lồng trong khung 620px, khó cuộn trên điện thoại.
const MOBILE_VISIBLE = 5

export default function ExternalRankingsSection() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('')
  const [combo, setCombo] = useState('')
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    cachedGet('/rankings', { ttl: RANKINGS_TTL, signal: controller.signal })
      .then(data => {
        if (alive && Array.isArray(data?.groups)) setGroups(data.groups.filter(g => g.items?.length))
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; controller.abort() }
  }, [])

  if (!loading && !groups.length) return null
  const sources = [...new Set(groups.map(g => g.source))]
  const activeSource = sources.includes(source) ? source : sources[0]
  const available = groups.filter(g => g.source === activeSource)
  const group = available.find(g => `${g.category}/${g.window}` === combo) || available[0]
  // Đổi nguồn/bảng trong View Transition (dữ liệu đã có sẵn, chỉ đổi state).
  const switchTo = (nextSource, nextCombo) => withViewTransition(() => {
    flushSync(() => { setSource(nextSource); setCombo(nextCombo) })
  })
  return (
    <section className="home-section external-rankings" aria-label="Bảng xếp hạng truyện Trung Quốc">
      <SectionHeader icon={<Globe size={16} aria-hidden="true" />} title="Khám Phá Truyện Trung Quốc" />
      {loading ? <div className="hd-skel external-rankings-loading" role="status" aria-label="Đang tải bảng xếp hạng" /> : <div className="glass-panel external-rankings-panel">
        <p>Truyện nổi bật trên các trang nguồn. Liên kết mở trang gốc.</p>
        <div className="external-rankings-sources" role="group" aria-label="Nguồn truyện">
          {sources.map(s => <button key={s} type="button" aria-pressed={s === activeSource} className="hd-press" onClick={() => switchTo(s, '')}>{SOURCES[s] || s}</button>)}
        </div>
        <label className="external-rankings-filter">Bảng xếp hạng
          <select value={`${group.category}/${group.window}`} onChange={e => switchTo(activeSource, e.target.value)}>
            {available.map(g => <option key={`${g.category}/${g.window}`} value={`${g.category}/${g.window}`}>{CATEGORIES[g.category] || g.category} · {WINDOWS[g.window] || g.window}</option>)}
          </select>
        </label>
        <p>Cập nhật: <time dateTime={group.snapshot_date}>{group.snapshot_date}</time></p>
        <ol className={`external-rankings-list${expanded ? ' is-expanded' : ''}`}>
          {group.items.map(item => <li key={item.rank}>
            <span className="external-rankings-rank">{item.rank}</span>
            {safeUrl(item.cover_url) && <img src={item.cover_url} alt="" width={42} height={58} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none' }} />}
            <div>
              {safeUrl(item.source_url) ? <a href={item.source_url} target="_blank" rel="noopener noreferrer">{item.title}</a> : <span>{item.title}</span>}
              {item.author && <small>{item.author}</small>}
              {item.stat_label && <small>{fmtStatLabel(item.stat_label)}</small>}
            </div>
          </li>)}
        </ol>
        {group.items.length > MOBILE_VISIBLE && (
          <button type="button" className="external-rankings-more hd-press" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Thu gọn' : `Xem cả ${group.items.length} truyện`}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
      </div>}
    </section>
  )
}
