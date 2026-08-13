import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Zap } from 'lucide-react'
import announcements from '../../content/announcements.json'

/**
 * NewChapterWidget – Khung thông báo chương mới ra mắt nằm bên phải.
 * Cho phép bạn đọc click trực tiếp vào đọc chương vừa cập nhật!
 */
export default function NewChapterWidget() {
  const chapterAlerts = announcements.filter(a => a.novel_slug && a.chapter)
  if (chapterAlerts.length === 0) return null

  return (
    <div className="glass-panel new-chapter-widget" style={{ padding: '1.25rem', borderRadius: '16px', border: '1px solid rgba(59, 130, 246, 0.25)', background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.875rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.6rem' }}>
        <Zap size={16} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
          Chương Mới Phát Hành
        </h3>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {chapterAlerts.map((item, idx) => (
          <div key={idx} style={{ background: 'rgba(255, 255, 255, 0.04)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600, marginBottom: '2px' }}>
              {item.date} • MỚI RA MẮT
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px', lineHeight: 1.35 }}>
              {item.text}
            </div>
            <Link
              to={`/novel/${item.novel_slug}/read/${item.chapter}`}
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '6px 12px',
                fontSize: '0.78rem',
                minHeight: '34px',
                borderRadius: '8px',
              }}
            >
              Đọc ngay Chương {item.chapter} <ArrowRight size={13} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
