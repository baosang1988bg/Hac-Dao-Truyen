import React from 'react'
import { Sparkles } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelList from '../../components/ui/NovelList'

/**
 * UpdatesSection – Section Truyện Mới Cập Nhật dạng LIST ROW COMPACT.
 * Giúp người đọc dễ dàng lướt nhanh 10-15 truyện mới nhất trên 1 trang màn hình.
 */
export default function UpdatesSection({ novels }) {
  if (!novels || novels.length === 0) return null

  // Hiển thị top 10 mới cập nhật
  const displayList = novels.slice(0, 10)

  return (
    <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<Sparkles size={16} style={{ color: 'var(--accent)' }} />}
        title="Truyện Mới Cập Nhật"
        count={novels.length}
      />
      <div className="glass-panel" style={{ padding: '0.75rem', borderRadius: '14px' }}>
        <NovelList novels={displayList} showViews={true} />
      </div>
    </section>
  )
}
