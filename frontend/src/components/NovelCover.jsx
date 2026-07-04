import React, { useState } from 'react'
import { coverGradient } from '../utils/coverColors'

/**
 * Bìa truyện tỉ lệ 2/3.
 * - Có cover_url → hiện ảnh; ảnh lỗi → fallback gradient sinh từ slug.
 * - Không có ảnh → gradient + chữ cái đầu mờ + tên truyện (clamp 3 dòng).
 * - badge: 'FULL' (xanh lá) | 'MỚI' (accent) — góc trên trái.
 * - size 'lg' hiện thêm dải thể loại ở đáy.
 */
export default function NovelCover({ novel, size = 'md', badge }) {
  const [imgError, setImgError] = useState(false)
  const gradient = coverGradient(novel?.slug || '')
  const title = novel?.title || '?'
  const showImg = novel?.cover_url && !imgError

  return (
    <div className={`novel-cover novel-cover--${size}`}>
      {showImg ? (
        <img
          className="novel-cover__img"
          src={novel.cover_url}
          alt={title}
          loading="lazy"
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

      {badge && (
        <span className={`novel-cover__badge ${badge === 'FULL' ? 'is-full' : 'is-new'}`}>
          {badge}
        </span>
      )}

      {size === 'lg' && novel?.genre && (
        <span className="novel-cover__genre">{novel.genre}</span>
      )}
    </div>
  )
}
