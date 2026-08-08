import React from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

/**
 * SectionHeader – Tiêu đề section chuẩn hóa cho trang chủ.
 * Props:
 *   icon       – React element icon (optional)
 *   title      – string tiêu đề
 *   href       – link "Xem thêm" (optional)
 *   hrefLabel  – nhãn link, mặc định "Xem thêm"
 *   count      – số lượng hiển thị kèm (optional)
 */
export default function SectionHeader({ icon, title, href, hrefLabel = 'Xem thêm', count }) {
  return (
    <div className="section-header">
      <h2 className="section-header__title">
        {icon && <span className="section-header__icon">{icon}</span>}
        {title}
        {count != null && (
          <span className="section-header__count">{count}</span>
        )}
      </h2>
      {href && (
        <Link to={href} className="section-header__link">
          {hrefLabel}
          <ChevronRight size={14} />
        </Link>
      )}
    </div>
  )
}
