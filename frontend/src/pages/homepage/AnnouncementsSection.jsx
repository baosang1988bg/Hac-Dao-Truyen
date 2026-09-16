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
    <div className="glass-panel" style={{ padding: 'var(--space-4, 16px)', borderRadius: '16px', marginBottom: 'var(--space-5, 24px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2, 8px)', marginBottom: 'var(--space-3, 12px)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 'var(--space-2, 8px)' }}>
        <Megaphone size={16} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
          Thông Báo Cập Nhật
        </h3>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2, 8px)' }}>
        {items.map(a => (
          <li key={`${a.novel_slug}:${a.chapter}`} style={{ fontSize: '0.8rem' }}>
            <Link className="hp-announcement-link" to={`/novel/${a.novel_slug}/read/${a.chapter}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="hp-announcement-text" style={{ color: 'var(--text-muted)' }}>{a.text}</div>
              <time dateTime={a.date} style={{ color: 'var(--accent)', fontSize: 'var(--font-xs, 0.75rem)' }}>{a.date}</time>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
