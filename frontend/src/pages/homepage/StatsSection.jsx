import { useEffect, useState } from 'react'
import api from '../../api'
import { fmtNumber } from '../../utils/format'

/**
 * StatsSection – Thống kê tổng số truyện, chương, thuật ngữ.
 * Lấy từ GET /api/stats — server tự SUM/COUNT bằng SQL aggregate, không cần
 * tải cả catalog về client rồi cộng dồn (cách cũ chính là một phần nguyên
 * nhân HomePage quá tải D1 rows-read).
 */
export default function StatsSection() {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    api.get('/stats', { signal: controller.signal })
      .then(res => { if (alive) setStats(res.data) })
      .catch(() => { /* im lặng — section tự ẩn nếu không tải được */ })
    return () => { alive = false; controller.abort() }
  }, [])

  if (!stats) {
    return <div className="hp-stats" style={{ height: '76px' }} />
  }

  const items = [
    { value: fmtNumber(stats.total_novels), label: 'Bộ truyện' },
    { value: fmtNumber(stats.total_chapters), label: 'Chương đã dịch' },
    { value: fmtNumber(stats.total_glossary), label: 'Thuật ngữ glossary' },
  ]

  return (
    <div className="hp-stats">
      {items.map(({ value, label }) => (
        <div key={label} className="hp-stats__item">
          <div className="hp-stats__value">{value}</div>
          <div className="hp-stats__label">{label}</div>
        </div>
      ))}
    </div>
  )
}
