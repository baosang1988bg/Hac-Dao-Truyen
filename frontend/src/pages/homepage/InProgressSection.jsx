import React from 'react'
import { Flame } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelGrid from '../../components/ui/NovelGrid'

const THREE_DAYS = 3 * 24 * 3600

/**
 * InProgressSection – Truyện đang dịch (grid 6 cột gọn gàng, hiển thị demo 12 truyện + nút Xem tất cả).
 * Props:
 *   novels  – array of novel objects
 *   nowSec  – current timestamp in seconds
 */
export default function InProgressSection({ novels, nowSec }) {
  if (!novels || novels.length === 0) return null

  const demoList = novels.slice(0, 12)

  return (
    <section className="hp-in-progress" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<Flame size={16} style={{ color: 'var(--accent)' }} />}
        title="Đang Dịch"
        count={novels.length}
        href="/epub?status=ongoing"
        hrefLabel="Xem tất cả"
      />
      <NovelGrid
        novels={demoList}
        cols={{ mobile: 3, tablet: 5, desktop: 6 }}
        getBadge={(n) =>
          n.last_translated_at && nowSec - n.last_translated_at < THREE_DAYS
            ? { variant: 'new', label: 'MỚI' }
            : null
        }
      />
    </section>
  )
}
