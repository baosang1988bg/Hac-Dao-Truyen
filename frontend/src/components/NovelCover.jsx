import PropTypes from 'prop-types'
import { novelType } from '../utils/propTypes'
import { useState } from 'react';
import { coverGradient } from '../utils/coverColors'
import { fmtNovelTitle } from '../utils/format'

/**
 * Bìa truyện tỉ lệ 2/3.
 * - Có cover_url → hiện ảnh; ảnh lỗi → fallback gradient sinh từ slug.
 * - Không có ảnh → gradient + chữ cái đầu mờ + tên truyện (clamp 3 dòng).
 * - size 'lg' hiện thêm dải thể loại ở đáy.
 * Badge trạng thái (FULL/MỚI/EPUB...) không phải việc của component này —
 * nơi gọi tự phủ `components/ui/Badge.jsx` trong span `.badge-overlay` lên trên.
 */
export default function NovelCover({ novel, size = 'md' }) {
  const [imgError, setImgError] = useState(false)
  const gradient = coverGradient(novel?.slug || '')
  const title = fmtNovelTitle(novel?.title, novel?.slug) || '?'
  let coverSrc = novel?.cover_url || ''
  if (coverSrc && coverSrc.includes('audiotruyenfull.org')) {
    coverSrc = `/api/proxy-cover?url=${encodeURIComponent(coverSrc)}`
  }
  const showImg = Boolean(coverSrc) && !imgError


  return (
    <div className={`novel-cover novel-cover--${size}`}>
      {showImg ? (
        <img
          className="novel-cover__img"
          src={coverSrc}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="novel-cover__art" style={{ background: gradient }}>
          {/* Điểm sáng radial phía trên */}
          <span className="novel-cover__highlight" aria-hidden="true" />
          {/* Vạch accent mảnh trên cùng */}
          <span className="novel-cover__topline" aria-hidden="true" />
          {/* Chữ cái đầu lớn, mờ, phía sau */}
          <span className="novel-cover__letter" aria-hidden="true">
            {title.trim().charAt(0).toUpperCase()}
          </span>
          {/* Tên truyện — clamp 3 dòng, canh giữa, 1/3 dưới */}
          <span className="novel-cover__title">{title}</span>
        </div>
      )}

      {size === 'lg' && novel?.genre && (
        <span className="novel-cover__genre">{novel.genre}</span>
      )}
    </div>
  )
}
NovelCover.propTypes = {
  novel: novelType,
  size: PropTypes.string,
};
