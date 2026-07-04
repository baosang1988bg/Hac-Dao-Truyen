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
  return (
    <Link to={`/novel/${novel.slug}`} className="novel-card-v2">
      <NovelCover novel={novel} size={size} badge={badge} />
      <span className="novel-card-v2__title">{novel.title}</span>
      <span className="novel-card-v2__meta">
        {novel.chapter_count || 0} chương
        {ago && <> · {ago}</>}
      </span>
    </Link>
  )
}
