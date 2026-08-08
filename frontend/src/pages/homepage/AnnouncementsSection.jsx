import React from 'react'
import { Megaphone } from 'lucide-react'
import announcements from '../../content/announcements.json'

const MAX_SHOWN = 3

/**
 * AnnouncementsSection – Khối thông báo cập nhật ngắn, admin tự sửa tay file
 * announcements.json khi có tin cần báo (không cần CMS/bảng D1 riêng — phù
 * hợp quy mô site cá nhân). Chỉ hiện MAX_SHOWN dòng mới nhất.
 */
export default function AnnouncementsSection() {
  if (!Array.isArray(announcements) || announcements.length === 0) return null

  const items = [...announcements]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, MAX_SHOWN)

  return (
    <div className="hp-announcements" style={{ marginBottom: '1.5rem' }}>
      <div className="hp-announcements__icon">
        <Megaphone size={15} />
      </div>
      <div className="hp-announcements__list">
        {items.map((a, i) => (
          <div key={i} className="hp-announcements__item">
            <span className="hp-announcements__date">{a.date}</span>
            <span>{a.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
