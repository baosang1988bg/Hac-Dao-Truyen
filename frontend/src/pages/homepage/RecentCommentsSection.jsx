import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import { fmtTimeAgo, fmtNovelTitle } from '../../utils/format'
import api from '../../api'

// created_at từ API là 'YYYY-MM-DD HH:MM:SS' (UTC) → epoch giây, giống ChapterComments.jsx
function toEpochSeconds(s) {
  if (!s) return 0
  const ms = Date.parse(String(s).replace(' ', 'T') + 'Z')
  return Number.isFinite(ms) ? ms / 1000 : 0
}

/**
 * RecentCommentsSection – Bình luận mới nhất TOÀN SITE, để trang chủ có cảm
 * giác cộng đồng đang hoạt động (dữ liệu thật, tận dụng hệ thống comment đã
 * có sẵn — không xây thêm gì mới ngoài 1 endpoint gộp).
 */
export default function RecentCommentsSection() {
  const [comments, setComments] = useState(null) // null = đang tải/lỗi im lặng

  useEffect(() => {
    let alive = true
    api.get('/comments/recent?limit=5')
      .then(res => { if (alive) setComments(Array.isArray(res.data) ? res.data : []) })
      .catch(() => { if (alive) setComments([]) })
    return () => { alive = false }
  }, [])

  if (!comments || comments.length === 0) return null

  return (
    <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader icon={<MessageSquare size={15} />} title="Đang Thảo Luận" />
      <div className="hp-toplist">
        {comments.map(c => (
          <Link
            key={c.id}
            to={`/novel/${c.slug}/read/${c.chapter || 1}`}
            className="hp-comment-row"
          >
            <div className="hp-comment-row__head">
              <span className="hp-comment-row__user">{c.user_name}</span>
              <span className="hp-comment-row__novel">
                {fmtNovelTitle(c.novel_title, c.slug) || c.slug}
              </span>
              <span className="hp-comment-row__ago">{fmtTimeAgo(toEpochSeconds(c.created_at))}</span>
            </div>
            <p className="hp-comment-row__content">{c.content}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
