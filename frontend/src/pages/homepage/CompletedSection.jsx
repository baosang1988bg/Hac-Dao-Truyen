import React from 'react'
import { CheckCircle } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelGrid from '../../components/ui/NovelGrid'

/**
 * CompletedSection – Truyện hoàn thành (hiển thị demo 6 truyện + nút Xem tất cả).
 * Props:
 *   novels – array of completed novel objects
 */
export default function CompletedSection({ novels }) {
  if (!novels || novels.length === 0) return null

  const demoList = novels.slice(0, 6)

  return (
    <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<CheckCircle size={16} style={{ color: 'var(--success)' }} />}
        title="Truyện Hoàn Thành"
        count={novels.length}
        href="/epub?status=completed"
        hrefLabel="Xem tất cả"
      />
      <NovelGrid
        novels={demoList}
        cols={{ mobile: 3, tablet: 5, desktop: 6 }}
        getBadge={() => ({ variant: 'full', label: 'FULL' })}
      />
    </section>
  )
}
