import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Eye, Star } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import SectionHeader from '../../components/ui/SectionHeader'
import { fmtNumber, fmtNovelTitle } from '../../utils/format'

const TABS = [
  { key: 'views', label: 'Lượt xem', icon: <Eye size={13} /> },
  { key: 'rating', label: 'Đánh giá cao', icon: <Star size={13} /> },
]

const TOP_N = 5

/**
 * TopListSection – Bảng xếp hạng top 5 truyện, dùng dữ liệu views/rating THẬT
 * đã có sẵn trong D1 (không tự chế số liệu). Lấy cảm hứng từ nhiều bảng xếp
 * hạng nhỏ của truyentrung.com nhưng gộp lại 1 section có tab để gọn trên
 * mobile, không cần gọi thêm API vì dùng lại danh sách `novels` đã tải ở
 * HomePage.
 * Props:
 *   novels – toàn bộ visible novels (đã có field views, rating, rating_count)
 */
export default function TopListSection({ novels }) {
  const [activeTab, setActiveTab] = useState('views')

  const ranked = useMemo(() => {
    if (!novels || novels.length === 0) return []
    if (activeTab === 'rating') {
      return novels
        .filter(n => (n.rating_count || 0) > 0)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.rating_count || 0) - (a.rating_count || 0))
        .slice(0, TOP_N)
    }
    return novels
      .filter(n => (n.views || 0) > 0)
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, TOP_N)
  }, [novels, activeTab])

  if (!novels || novels.length === 0) return null
  // Chưa có đủ dữ liệu thật (site mới, chưa ai xem/đánh giá) → ẩn hẳn thay vì
  // hiện bảng rỗng hoặc số liệu giả.
  if (ranked.length === 0) return null

  return (
    <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader icon={<Trophy size={15} />} title="Bảng Xếp Hạng" />

      <div className="hp-tabs" style={{ marginBottom: '0.75rem' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`hp-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <div className="hp-toplist">
        {ranked.map((n, idx) => {
          const formattedTitle = fmtNovelTitle(n.title, n.slug)
          const metric = activeTab === 'rating'
            ? `★ ${(n.rating || 0).toFixed(1)} (${fmtNumber(n.rating_count)})`
            : `${fmtNumber(n.views)} lượt xem`
          return (
            <Link key={n.slug} to={`/novel/${n.slug}`} className="hp-toplist__item">
              <span className={`hp-toplist__rank${idx < 3 ? ' is-top3' : ''}`}>{idx + 1}</span>
              <NovelCover novel={n} size="sm" />
              <div className="hp-toplist__info">
                <span className="hp-toplist__title" title={formattedTitle}>{formattedTitle}</span>
                <span className="hp-toplist__metric">{metric}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
