import { useEffect, useState } from 'react'
import { cachedGet, peekCache } from '../../utils/apiCache'
import { fmtNumber } from '../../utils/format'

const STATS_TTL = 5 * 60_000

/**
 * StatsSection – Thống kê tổng số truyện, chương, thuật ngữ.
 * Lấy từ GET /api/stats — server tự SUM/COUNT bằng SQL aggregate, không cần
 * tải cả catalog về client rồi cộng dồn (cách cũ chính là một phần nguyên
 * nhân HomePage quá tải D1 rows-read).
 *
 * Trung thực số liệu: `total_chapters` là tổng chương NGUỒN (gồm chương chưa
 * dịch) → nhãn "Tổng chương". Chỉ ghi "Chương đã dịch" khi API trả
 * `translated_chapters` (Worker mới); API cũ thì ẩn ô đó.
 */
export default function StatsSection() {
  const [stats, setStats] = useState(() => peekCache('/stats') || null)

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    cachedGet('/stats', { ttl: STATS_TTL, signal: controller.signal })
      .then(data => { if (alive) setStats(data) })
      .catch(() => { /* im lặng — section tự ẩn nếu không tải được */ })
    return () => { alive = false; controller.abort() }
  }, [])

  if (!stats) {
    return <div className="hp-stats" style={{ height: '76px' }} aria-hidden="true" />
  }

  const hasNumber = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
  const items = [
    { value: stats.total_novels, label: 'Bộ truyện' },
    hasNumber(stats.translated_chapters) && { value: stats.translated_chapters, label: 'Chương đã dịch' },
    { value: stats.total_chapters, label: 'Tổng chương' },
    { value: stats.total_glossary, label: 'Thuật ngữ' },
  ].filter(item => item && hasNumber(item.value))

  if (!items.length) return null

  return (
    <dl className={`hp-stats${items.length === 4 ? ' hp-stats--4' : ''}`}>
      {items.map(({ value, label }) => (
        <div key={label} className="hp-stats__item">
          <dt className="hp-stats__label">{label}</dt>
          <dd className="hp-stats__value">{fmtNumber(Number(value))}</dd>
        </div>
      ))}
    </dl>
  )
}
