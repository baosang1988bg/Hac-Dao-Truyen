import React, { useState } from 'react'
import { BookOpen } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelGrid from '../../components/ui/NovelGrid'

const TABS = [
  { key: 'all',       label: 'Tất cả' },
  { key: 'ongoing',   label: 'Đang dịch' },
  { key: 'completed', label: 'Hoàn thành' },
  { key: 'epub',      label: 'EPUB' },
]

/**
 * AllNovelsSection – Grid toàn bộ truyện với tab filter.
 * Dùng kiểu tab giống truyentrung.com.
 * Props:
 *   novels      – toàn bộ visible novels
 *   activeGenre – string ('' nghĩa là không lọc), đến từ GenreChips ở HomePage
 */
export default function AllNovelsSection({ novels, activeGenre = '' }) {
  const [activeTab, setActiveTab] = useState('all')

  const filtered = novels.filter(n => {
    if (activeGenre && n.genre !== activeGenre) return false
    if (activeTab === 'all') return true
    if (activeTab === 'ongoing')   return (n.chapter_count || 0) > 0 && (n.total_chapters === 0 || n.chapter_count < n.total_chapters)
    if (activeTab === 'completed') return n.total_chapters > 0 && n.chapter_count >= n.total_chapters
    if (activeTab === 'epub')      return n.has_epub === 1 || n.has_epub === true
    return true
  })

  if (!novels || novels.length === 0) return null

  return (
    <section style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<BookOpen size={15} style={{ color: 'var(--accent)' }} />}
        title="Tất Cả Truyện"
        count={filtered.length}
      />

      {/* Tabs */}
      <div className="hp-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`hp-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <NovelGrid
          novels={filtered}
          cols={{ mobile: 3, tablet: 4, desktop: 5 }}
          getBadge={(n) => {
            if (n.has_epub === 1 || n.has_epub === true) return { variant: 'epub', label: 'EPUB' }
            if (n.total_chapters > 0 && n.chapter_count >= n.total_chapters) return { variant: 'full', label: 'FULL' }
            return null
          }}
        />
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0', fontSize: '0.9rem' }}>
          Không có truyện nào trong danh mục này.
        </div>
      )}
    </section>
  )
}
