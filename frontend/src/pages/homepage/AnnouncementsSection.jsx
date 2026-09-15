import { Link } from 'react-router-dom'
import { Megaphone } from 'lucide-react'
import announcements from '../../content/announcements.json'

/**
 * AnnouncementsSection — thông báo tĩnh "vừa cập nhật chương mới", nguồn từ
 * frontend/src/content/announcements.json (tools/auto_check_lanh_chua.py ghi
 * mỗi lần dịch xong). Import tĩnh lúc build — KHÔNG gọi API, nên chỉ hiện dữ
 * liệu mới sau lần deploy frontend tiếp theo, không tức thời như UpdatesSection.
 *
 * Dữ liệu nguồn từng bị ghi trùng lặp (nhiều entry giống hệt nhau) — dedupe
 * theo (novel_slug, chapter), giữ bản xuất hiện trước (mới nhất, vì insert(0)).
 */
export default function AnnouncementsSection() {
  const seen = new Set()
  const items = announcements.filter(a => {
    const key = `${a.novel_slug}:${a.chapter}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 5)

  if (!items.length) return null

  return (
    <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '16px', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.875rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.6rem' }}>
        <Megaphone size={16} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
          Thông Báo Cập Nhật
        </h3>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {items.map(a => (
          <li key={`${a.novel_slug}:${a.chapter}`} style={{ fontSize: '0.8rem' }}>
            <Link to={`/novel/${a.novel_slug}/read/${a.chapter}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <div style={{ color: 'var(--text-muted)' }}>{a.text}</div>
              <time dateTime={a.date} style={{ color: 'var(--accent)', fontSize: '0.72rem' }}>{a.date}</time>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
