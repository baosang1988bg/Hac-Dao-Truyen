import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import api from '../../api'
import SectionHeader from '../../components/ui/SectionHeader'
import './ExternalRankingsSection.css'

const SOURCES = { qidian: 'Qidian', '69shuba': '69shuba', novel543: 'Novel543', fanqie: 'Fanqie', faloo: 'Faloo' }
const CATEGORIES = { views: 'Lượt đọc', follows: 'Theo dõi', recommend: 'Đề cử', general: 'Tổng quát' }
const WINDOWS = { daily: 'Ngày', weekly: 'Tuần', monthly: 'Tháng', quarterly: 'Quý', all_time: 'Toàn thời gian' }
const safeUrl = value => /^https?:\/\//i.test(value || '')

export default function ExternalRankingsSection() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('')
  const [combo, setCombo] = useState('')
  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    api.get('/rankings', { signal: controller.signal })
      .then(({ data }) => {
        if (alive && Array.isArray(data.groups)) setGroups(data.groups.filter(g => g.items?.length))
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
  return (
    <section className="home-section external-rankings" aria-label="Bảng xếp hạng truyện Trung Quốc">
      <SectionHeader icon={<Globe size={16} />} title="Khám Phá Truyện Trung Quốc" />
      {loading ? <div className="glass-panel external-rankings-loading" role="status" aria-label="Đang tải bảng xếp hạng" /> : <div className="glass-panel external-rankings-panel">
        <p>Truyện nổi bật trên các trang nguồn. Liên kết mở trang gốc.</p>
        <div className="external-rankings-sources" role="group" aria-label="Nguồn truyện">
          {sources.map(s => <button key={s} type="button" aria-pressed={s === activeSource} onClick={() => { setSource(s); setCombo('') }}>{SOURCES[s] || s}</button>)}
        </div>
        <label className="external-rankings-filter">Bảng xếp hạng
          <select value={`${group.category}/${group.window}`} onChange={e => setCombo(e.target.value)}>
            {available.map(g => <option key={`${g.category}/${g.window}`} value={`${g.category}/${g.window}`}>{CATEGORIES[g.category] || g.category} · {WINDOWS[g.window] || g.window}</option>)}
          </select>
        </label>
        <p>Cập nhật: <time dateTime={group.snapshot_date}>{group.snapshot_date}</time></p>
        <ol className="external-rankings-list">
          {group.items.map(item => <li key={item.rank}>
            <span className="external-rankings-rank">{item.rank}</span>
            {safeUrl(item.cover_url) && <img src={item.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none' }} />}
            <div>
              {safeUrl(item.source_url) ? <a href={item.source_url} target="_blank" rel="noopener noreferrer">{item.title}</a> : <span>{item.title}</span>}
              {item.author && <small>{item.author}</small>}
              {item.stat_label && <small>{item.stat_label}</small>}
            </div>
          </li>)}
        </ol>
      </div>}
    </section>
  )
}
