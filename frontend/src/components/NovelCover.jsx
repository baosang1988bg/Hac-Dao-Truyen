import PropTypes from 'prop-types'
import { novelType } from '../utils/propTypes'
import { useState } from 'react'
import { coverGradient } from '../utils/coverColors'
import { novelDisplayTitle } from '../utils/format'
import { primaryGenre } from '../utils/genreLabels'

// Host bìa chặn hotlink (kiểm Referer) → đi qua /api/proxy-cover của Worker.
// Worker tự kiểm tra URL an toàn (isSafeCoverUrl) trước khi tải.
const PROXY_COVER_HOSTS = ['audiotruyenfull.org']

// Kích thước intrinsic gợi ý cho trình duyệt (giữ tỉ lệ 2/3, tránh layout shift).
const INTRINSIC = {
  xs: [36, 54],
  sm: [72, 108],
  md: [160, 240],
  lg: [240, 360],
}

function coverSource(url) {
  if (!url) return ''
  try {
    const host = new URL(url, 'https://placeholder.invalid').hostname
    if (PROXY_COVER_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) {
      return `/api/proxy-cover?url=${encodeURIComponent(url)}`
    }
  } catch { /* URL hỏng → dùng nguyên văn, onError sẽ lo fallback */ }
  return url
}

/**
 * Bìa truyện tỉ lệ 2/3.
 * - LUÔN vẽ lớp gradient (sinh từ slug) + chữ cái đầu + tên truyện phía dưới,
 *   nên ô bìa không bao giờ trống khi ảnh chậm/lỗi.
 * - Có cover_url → `<img>` đè lên, mờ dần hiện ra khi tải xong (onLoad);
 *   ảnh lỗi → gỡ `<img>`, chỉ còn gradient.
 * - `priority` (ảnh hero above-the-fold): tải ngay, fetchpriority=high;
 *   còn lại lazy + fetchpriority=low để không tranh băng thông.
 * - `alt` mặc định "" vì nơi gọi luôn hiện tên truyện cạnh bìa; truyền alt
 *   riêng nếu bìa đứng một mình.
 * - size 'lg' hiện thêm dải thể loại ở đáy.
 * Badge trạng thái (FULL/MỚI/EPUB...) không phải việc của component này —
 * nơi gọi tự phủ `components/ui/Badge.jsx` trong span `.badge-overlay` lên trên.
 */
export default function NovelCover({ novel, size = 'md', priority = false, alt = '', style, className = '' }) {
  const coverSrc = coverSource(novel?.cover_url || '')
  // Lưu theo src (không phải boolean) để đổi truyện là tự reset, không cần effect.
  const [failedSrc, setFailedSrc] = useState('')
  const [loadedSrc, setLoadedSrc] = useState('')
  const gradient = coverGradient(novel?.slug || '')
  const title = novelDisplayTitle(novel) || '?'
  const showImg = Boolean(coverSrc) && failedSrc !== coverSrc
  const loaded = showImg && loadedSrc === coverSrc
  const [w, h] = INTRINSIC[size] || INTRINSIC.md
  const genre = size === 'lg' ? primaryGenre(novel?.genre) : ''
  // fetchpriority viết thường: React 18 chưa biết prop camelCase `fetchPriority`.
  const priorityAttrs = { fetchpriority: priority ? 'high' : 'low' }

  return (
    <div className={`novel-cover novel-cover--${size}${className ? ` ${className}` : ''}`} style={style}>
      <div className="novel-cover__art" style={{ background: gradient }} aria-hidden="true">
        {/* Điểm sáng radial phía trên */}
        <span className="novel-cover__highlight" />
        {/* Vạch accent mảnh trên cùng */}
        <span className="novel-cover__topline" />
        {/* Chữ cái đầu lớn, mờ, phía sau */}
        <span className="novel-cover__letter">
          {title.trim().charAt(0).toUpperCase()}
        </span>
        {/* Tên truyện — clamp 3 dòng, canh giữa, 1/3 dưới */}
        <span className="novel-cover__title">{title}</span>
      </div>

      {showImg && (
        <img
          className={`novel-cover__img${loaded ? ' is-loaded' : ''}`}
          src={coverSrc}
          alt={alt}
          width={w}
          height={h}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          {...priorityAttrs}
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedSrc(coverSrc)}
          onError={() => setFailedSrc(coverSrc)}
        />
      )}

      {genre && <span className="novel-cover__genre">{genre}</span>}
    </div>
  )
}
NovelCover.propTypes = {
  novel: novelType,
  size: PropTypes.oneOf(['xs', 'sm', 'md', 'lg']),
  priority: PropTypes.bool,
  alt: PropTypes.string,
  style: PropTypes.object,
  className: PropTypes.string,
}
