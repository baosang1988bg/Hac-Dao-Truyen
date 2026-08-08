import React from 'react'
import { fmtNumber } from '../../utils/format'

/**
 * StatsSection – Thống kê tổng số truyện, chương, thuật ngữ.
 * Phase 3: redesign với hp-stats CSS (gradient text + border).
 * Props:
 *   novels – toàn bộ danh sách novel
 */
export default function StatsSection({ novels }) {
  if (!novels || novels.length === 0) return null

  const totalNovels = novels.length
  const totalChapters = novels.reduce((a, n) => a + (n.chapter_count || 0), 0)
  const totalGlossary = novels.reduce((a, n) => a + (n.glossary_count || 0), 0)

  const items = [
    { value: fmtNumber(totalNovels), label: 'Bộ truyện' },
    { value: fmtNumber(totalChapters), label: 'Chương đã dịch' },
    { value: fmtNumber(totalGlossary), label: 'Thuật ngữ glossary' },
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
