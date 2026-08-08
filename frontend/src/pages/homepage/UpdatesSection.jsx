import React from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import SectionHeader from '../../components/ui/SectionHeader'
import { fmtTimeAgo } from '../../utils/format'

/**
 * UpdatesSection – Mới lên chương (list row v2 với cover nhỏ).
 * Phase 3: dùng update-row-v2 style, cover nhỏ 36px.
 * Props:
 *   novels – array (đã sort theo last_translated_at desc, slice 8)
 */
export default function UpdatesSection({ novels }) {
  if (!novels || novels.length === 0) return null

  return (
    <section>
      <SectionHeader
        icon={<Sparkles size={15} style={{ color: 'var(--accent)' }} />}
        title="Mới Lên Chương"
        count={novels.length}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {novels.map(n => (
          <Link key={n.slug} to={`/novel/${n.slug}`} className="update-row-v2">
            {/* Mini cover */}
            <div className="update-row-v2__cover">
              <NovelCover novel={n} size="sm" />
            </div>

            <div className="update-row-v2__body">
              <span className="update-row-v2__title">{n.title}</span>
              <span className="update-row-v2__chapter">
                {n.latest_chapter_title || `${n.chapter_count} chương`}
              </span>
            </div>

            <span className="update-row-v2__ago">
              {fmtTimeAgo(n.last_translated_at)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
