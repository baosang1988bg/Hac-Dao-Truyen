import React from 'react'
import { CheckCircle } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelGrid from '../../components/ui/NovelGrid'

/**
 * CompletedSection – Truyện hoàn thành (grid).
 * Phase 3: dùng NovelGrid với badge FULL.
 * Props:
 *   novels – array of completed novel objects
 */
export default function CompletedSection({ novels }) {
  if (!novels || novels.length === 0) return null

  return (
    <section>
      <SectionHeader
        icon={<CheckCircle size={15} style={{ color: 'var(--success)' }} />}
        title="Hoàn Thành"
        count={novels.length}
      />
      <NovelGrid
        novels={novels}
        cols={{ mobile: 3, tablet: 4, desktop: 4 }}
        getBadge={() => ({ variant: 'full', label: 'FULL' })}
      />
    </section>
  )
}
