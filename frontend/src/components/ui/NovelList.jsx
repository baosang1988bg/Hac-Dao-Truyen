import React from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, User, Clock, Eye, Star } from 'lucide-react'
import NovelCover from '../NovelCover'
import { fmtNovelTitle, fmtTimeAgo, fmtNumber } from '../../utils/format'

/**
 * NovelList — Component hiển thị danh sách truyện dạng LIST ROW COMPACT.
 * Thiết kế gọn nhẹ (chiều cao ~50px/dòng) giúp cuộn mượt mà và hiển thị được nhiều
 * truyện trên một màn hình theo đúng phong cách Qidian / Truyentrung.
 */
export default function NovelList({ novels = [], showRank = false, showViews = false, showRating = false }) {
  if (!novels || novels.length === 0) {
    return (
      <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Không tìm thấy truyện nào.
      </div>
    )
  }

  return (
    <div className="novel-list">
      {novels.map((novel, index) => {
        const titleFormatted = fmtNovelTitle(novel.title, novel.slug)
        const chapCount = novel.chapter_count || novel.total_chapters || 0
        const updatedTime = novel.updated_at || novel.last_translated_at

        return (
          <Link
            key={novel.slug}
            to={`/novel/${novel.slug}`}
            className="novel-list-row"
          >
            {showRank && (
              <span className={`novel-list-rank ${index < 3 ? `top-${index + 1}` : ''}`}>
                {index + 1}
              </span>
            )}

            <div className="novel-list-cover">
              <NovelCover novel={novel} size="xs" />
            </div>

            <div className="novel-list-info">
              <div className="novel-list-header">
                <span className="novel-list-title" title={titleFormatted}>
                  {titleFormatted}
                </span>
                {novel.genre && (
                  <span className="novel-list-genre">
                    {novel.genre.split(',')[0].trim()}
                  </span>
                )}
              </div>

              <div className="novel-list-meta">
                {novel.author && (
                  <span className="meta-item">
                    <User size={11} /> {novel.author}
                  </span>
                )}
                {chapCount > 0 && (
                  <span className="meta-item accent">
                    <BookOpen size={11} /> {fmtNumber(chapCount)} chương
                  </span>
                )}
                {showViews && (novel.views || 0) > 0 && (
                  <span className="meta-item">
                    <Eye size={11} /> {fmtNumber(novel.views)} xem
                  </span>
                )}
                {showRating && (novel.rating || 0) > 0 && (
                  <span className="meta-item rating">
                    <Star size={11} /> {(novel.rating || 0).toFixed(1)}
                  </span>
                )}
                {updatedTime && (
                  <span className="meta-item muted desktop-only">
                    <Clock size={11} /> {fmtTimeAgo(updatedTime)}
                  </span>
                )}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
