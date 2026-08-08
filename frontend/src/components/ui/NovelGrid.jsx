import React from 'react'
import { Link } from 'react-router-dom'
import NovelCover from '../NovelCover'
import Badge from './Badge'
import { fmtNumber } from '../../utils/format'

/**
 * NovelGrid – Grid truyện responsive dùng chung.
 * Props:
 *   novels  – array of novel objects
 *   cols    – { mobile, tablet, desktop } số cột (mặc định 2/3/4)
 *   getBadge – fn(novel) → { variant, label } hoặc null
 */
export default function NovelGrid({ novels, cols, getBadge }) {
  const { mobile = 2, tablet = 3, desktop = 4 } = cols ?? {}

  return (
    <div
      className="novel-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${mobile}, 1fr)`,
        gap: '12px',
      }}
      data-cols-mobile={mobile}
      data-cols-tablet={tablet}
      data-cols-desktop={desktop}
    >
      {novels.map(n => {
        const badge = getBadge ? getBadge(n) : null
        return (
          <Link
            key={n.slug}
            to={`/novel/${n.slug}`}
            className="novel-grid__card"
          >
            <div className="novel-grid__cover-wrap">
              <NovelCover novel={n} size="md" />
              {badge && (
                <span className="novel-grid__badge">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </span>
              )}
            </div>
            <div className="novel-grid__info">
              <span className="novel-grid__title">{n.title}</span>
              {(n.chapter_count || 0) > 0 && (
                <span className="novel-grid__count">
                  {fmtNumber(n.chapter_count)} ch.
                </span>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
