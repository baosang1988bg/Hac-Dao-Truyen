import React from 'react'
import { Newspaper, Bell } from 'lucide-react'
import announcements from '../../content/announcements.json'

/**
 * NewsAnnouncementsWidget — Khối Tin Tức & Thông Báo phong cách Truyentrung
 * Hiển thị các thông báo vá lỗi, cập nhật tính năng mới hoặc tin tức hệ thống.
 */
export default function NewsAnnouncementsWidget() {
  if (!Array.isArray(announcements) || announcements.length === 0) return null

  // Lọc các tin tức chung (không phải tin thông báo chương đơn thuần)
  const newsItems = announcements.slice(0, 4)

  return (
    <div className="news-widget glass-panel" style={{ padding: '1.25rem', borderRadius: '16px', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.875rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.6rem' }}>
        <Newspaper size={16} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
          Tin Tức & Thông Báo
        </h3>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {newsItems.map((item, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '8px', fontSize: '0.82rem', lineHeight: 1.4 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.72rem', flexShrink: 0, paddingTop: '1px' }}>
              [{item.date ? item.date.slice(5) : 'HOT'}]
            </span>
            <span style={{ color: 'var(--text-main)' }}>
              {item.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
