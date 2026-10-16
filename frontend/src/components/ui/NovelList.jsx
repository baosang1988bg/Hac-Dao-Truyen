import PropTypes from 'prop-types'
import { novelType } from '../../utils/propTypes'

import { Link } from 'react-router-dom'
import { BookOpen, User, Clock, Eye, Star } from 'lucide-react'
import NovelCover from '../NovelCover'
import { novelDisplayTitle, fmtTimeAgo, fmtNumber, cleanAuthor } from '../../utils/format'
import { primaryGenre } from '../../utils/genreLabels'

/**
 * NovelList — Component hiển thị danh sách truyện dạng LIST ROW COMPACT.
 * Thiết kế gọn nhẹ (chiều cao ~50px/dòng) giúp cuộn mượt mà và hiển thị được nhiều
 * truyện trên một màn hình theo đúng phong cách Qidian / Truyentrung.
 * showCover=false bỏ ảnh bìa thu nhỏ (danh sách dài: tránh tải hàng chục ảnh ngay).
 */
export default function NovelList({ novels = [], showRank = false, showViews = false, showRating = false, showCover = true }) {
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
        const titleFormatted = novelDisplayTitle(novel)
        const genre = primaryGenre(novel.genre)
        const author = cleanAuthor(novel.author)
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

            {showCover && (
              <div className="novel-list-cover">
                <NovelCover novel={novel} size="xs" />
              </div>
            )}

            <div className="novel-list-info">
              <div className="novel-list-header">
                <span className="novel-list-title" title={titleFormatted}>
                  {titleFormatted}
                </span>
                {genre && (
                  <span className="novel-list-genre">
                    {genre}
                  </span>
                )}
              </div>

              <div className="novel-list-meta">
                {author && (
                  <span className="meta-item">
                    <User size={11} aria-hidden="true" /> {author}
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
NovelList.propTypes = {
  novels: PropTypes.arrayOf(novelType),
  showRank: PropTypes.bool,
  showViews: PropTypes.bool,
  showRating: PropTypes.bool,
  showCover: PropTypes.bool,
};
