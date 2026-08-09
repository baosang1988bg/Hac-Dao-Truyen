import React, { useState } from 'react'
import { BookOpen, LayoutGrid, List, AlignJustify } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelGrid from '../../components/ui/NovelGrid'
import NovelTable from '../../components/ui/NovelTable'
import NovelList from '../../components/ui/NovelList'

const TABS = [
  { key: 'all',       label: 'Tất cả' },
  { key: 'ongoing',   label: 'Đang dịch' },
  { key: 'completed', label: 'Hoàn thành' },
  { key: 'epub',      label: 'EPUB' },
]

/**
 * AllNovelsSection – Danh sách toàn bộ truyện với tab filter & 3 chế độ xem.
 * Hỗ trợ Dạng Danh Sách (List Compact - Mặc định) | Dạng Lưới (Grid) | Dạng Bảng (Table).
 */
export default function AllNovelsSection({ novels, activeGenre = '' }) {
  const [activeTab, setActiveTab] = useState('all')
  const [viewMode, setViewMode] = useState('list') // 'list' (default) | 'grid' | 'table'

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

      {/* Tabs + Toggle View Mode */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div className="hp-tabs" style={{ flex: 1, marginBottom: 0, borderBottom: 'none' }}>
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

        <div className="hp-view-toggle" style={{ display: 'flex', gap: '4px' }}>
          <button
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
            title="Dạng danh sách gọn"
          >
            <AlignJustify size={14} />
          </button>
          <button
            className={viewMode === 'grid' ? 'active' : ''}
            onClick={() => setViewMode('grid')}
            title="Dạng lưới"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            className={viewMode === 'table' ? 'active' : ''}
            onClick={() => setViewMode('table')}
            title="Dạng bảng"
          >
            <List size={14} />
          </button>
        </div>
      </div>
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '1rem', marginTop: '0.5rem' }} />

      {/* Render View theo ViewMode */}
      {filtered.length > 0 ? (
        viewMode === 'list' ? (
          <div className="glass-panel" style={{ padding: '0.75rem', borderRadius: '14px' }}>
            <NovelList novels={filtered} showViews={true} showRating={true} />
          </div>
        ) : viewMode === 'table' ? (
          <div className="glass-panel" style={{ borderRadius: '14px', overflow: 'hidden' }}>
            <NovelTable novels={filtered} />
          </div>
        ) : (
          <NovelGrid
            novels={filtered}
            cols={{ mobile: 3, tablet: 4, desktop: 5 }}
            getBadge={(n) => {
              if (n.has_epub === 1 || n.has_epub === true) return { variant: 'epub', label: 'EPUB' }
              if (n.total_chapters > 0 && n.chapter_count >= n.total_chapters) return { variant: 'full', label: 'FULL' }
              return null
            }}
          />
        )
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0', fontSize: '0.9rem' }}>
          Không có truyện nào trong danh mục này.
        </div>
      )}
    </section>
  )
}
