import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Eye, Star, Flame, Sparkles } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import { fmtNovelTitle, fmtNumber } from '../../utils/format'

const RANK_TABS = [
  { key: 'phongvan', label: 'Phong Vân Bảng', icon: <Flame size={13} /> },
  { key: 'views', label: 'Đọc Nhiều', icon: <Eye size={13} /> },
  { key: 'rating', label: 'Đề Cử Bảng', icon: <Star size={13} /> },
  { key: 'newest', label: 'Tân Thư Bảng', icon: <Sparkles size={13} /> },
]

const TOP_N = 8

/**
 * QidianRankingsWidget — Bảng Xếp Hạng truyện chuẩn Qidian (起点中文网) & Truyentrung.
 * Tự động sắp xếp dữ liệu theo Phong Vân / Đọc Nhiều / Đề Cử / Sách Mới.
 */
export default function QidianRankingsWidget({ novels = [] }) {
  const [activeTab, setActiveTab] = useState('phongvan')

  const rankedList = useMemo(() => {
    if (!novels || novels.length === 0) return []

    const list = [...novels]

    if (activeTab === 'views') {
      return list
        .sort((a, b) => (b.views || 0) - (a.views || 0) || (b.chapter_count || 0) - (a.chapter_count || 0))
        .slice(0, TOP_N)
    }

    if (activeTab === 'rating') {
      return list
        .sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.rating_count || 0) - (a.rating_count || 0))
        .slice(0, TOP_N)
    }

    if (activeTab === 'newest') {
      return list
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
        .slice(0, TOP_N)
    }

    // Phong Vân Bảng: Điểm số kết hợp (Views + Rating * 100 + ChapterCount * 2)
    return list
      .sort((a, b) => {
        const scoreA = (a.views || 0) + (a.rating || 0) * 100 + (a.chapter_count || 0) * 2
        const scoreB = (b.views || 0) + (b.rating || 0) * 100 + (b.chapter_count || 0) * 2
        return scoreB - scoreA
      })
      .slice(0, TOP_N)
  }, [novels, activeTab])

  if (!novels || novels.length === 0) return null

  return (
    <div className="qidian-rank-card glass-panel" style={{ padding: '1.25rem', borderRadius: '16px', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Trophy size={17} style={{ color: '#f59e0b' }} />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
            Bảng Xếp Hạng Qidian
          </h3>
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Top {TOP_N}</span>
      </div>

      {/* Tabs */}
      <div className="qidian-rank-tabs" style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '0.75rem' }}>
        {RANK_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`qidian-rank-tab ${activeTab === tab.key ? 'active' : ''}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Rank Items List */}
      <div className="qidian-rank-list">
        {rankedList.map((novel, idx) => {
          const formattedTitle = fmtNovelTitle(novel.title, novel.slug)
          const chapNum = novel.chapter_count || novel.total_chapters || 0

          let rankBadgeClass = 'rank-num'
          if (idx === 0) rankBadgeClass += ' rank-1'
          else if (idx === 1) rankBadgeClass += ' rank-2'
          else if (idx === 2) rankBadgeClass += ' rank-3'

          return (
            <Link key={novel.slug} to={`/novel/${novel.slug}`} className="qidian-rank-item">
              <span className={rankBadgeClass}>{idx + 1}</span>

              {/* Bìa chỉ hiện cho Top 3 để tạo chiều sâu giao diện */}
              {idx < 3 && (
                <div style={{ width: '32px', height: '44px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden' }}>
                  <NovelCover novel={novel} size="xs" />
                </div>
              )}

              <div className="qidian-rank-info" style={{ flex: 1, minWidth: 0 }}>
                <span className="qidian-rank-title" title={formattedTitle}>
                  {formattedTitle}
                </span>
                <div className="qidian-rank-sub">
                  <span className="genre-tag">{novel.genre ? novel.genre.split(',')[0].trim() : 'Tiên Hiệp'}</span>
                  <span className="dots">•</span>
                  <span>{fmtNumber(chapNum)} chương</span>
                </div>
              </div>

              {(novel.views || 0) > 0 && (
                <span className="qidian-rank-metric">
                  <Eye size={10} /> {fmtNumber(novel.views)}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
