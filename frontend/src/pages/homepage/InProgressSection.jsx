import React from 'react'
import { Flame } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelGrid from '../../components/ui/NovelGrid'
import Badge from '../../components/ui/Badge'

const THREE_DAYS = 3 * 24 * 3600

/**
 * InProgressSection – Truyện đang dịch (grid thay vì scroll ngang).
 * Phase 3: dùng NovelGrid responsive thay vì section-row-scroll.
 * Props:
 *   novels  – array of novel objects
 *   nowSec  – current timestamp in seconds
 */
export default function InProgressSection({ novels, nowSec }) {
  if (!novels || novels.length === 0) return null

  return (
    <section className="hp-in-progress">
      <SectionHeader
        icon={<Flame size={15} style={{ color: 'var(--accent)' }} />}
        title="Đang Dịch"
        count={novels.length}
      />
      <NovelGrid
        novels={novels}
        cols={{ mobile: 3, tablet: 4, desktop: 5 }}
        getBadge={(n) =>
          n.last_translated_at && nowSec - n.last_translated_at < THREE_DAYS
            ? { variant: 'new', label: 'MỚI' }
            : null
        }
      />
    </section>
  )
}
