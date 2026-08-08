import React from 'react'
import { Link } from 'react-router-dom'
import NovelCover from './NovelCover'
import { fmtTimeAgo } from '../utils/format'

/**
 * Thẻ truyện dạng dọc: bìa + tên (clamp 2 dòng) + số chương + thời gian cập nhật.
 * Toàn bộ thẻ là Link đến trang chi tiết truyện.
 */
export default function NovelCard({ novel, size = 'md', badge }) {
  const ago = fmtTimeAgo(novel.last_translated_at)
  const chapLabel = (novel.chapter_count || 0) > 0
    ? `${novel.chapter_count} chương`
    : (novel.has_epub ? 'EPUB' : `${novel.total_chapters || 0} chương`)

  const effectiveBadge = badge || (novel.has_epub ? 'EPUB' : undefined)

  return (
    <Link to={`/novel/${novel.slug}`} className="novel-card-v2">
      <NovelCover novel={novel} size={size} badge={effectiveBadge} />
      <span className="novel-card-v2__title">{novel.title}</span>
      <span className="novel-card-v2__meta">
        {chapLabel}
        {ago && <> · {ago}</>}
      </span>
    </Link>
  )
}
