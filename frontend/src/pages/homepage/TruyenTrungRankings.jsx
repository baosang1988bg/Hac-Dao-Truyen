import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Flame, Eye, Star, Sparkles, MessageSquare } from 'lucide-react'
import { fmtNovelTitle, fmtNumber } from '../../utils/format'

/**
 * TruyenTrungRankings — Khối 5 Bảng Xếp Hạng Độc Lập chuẩn Truyentrung.com
 * (BXH Nguyệt Phiếu, BXH Bán Chạy, BXH Lượt Đọc, BXH Sách Mới, BXH Đánh Giá & Bình Luận)
 */
export default function TruyenTrungRankings({ novels = [] }) {
  const [activeCategory, setActiveCategory] = useState('nguyetphieu')

  const categories = [
    { key: 'nguyetphieu', label: 'BXH Nguyệt Phiếu', icon: <Flame size={13} /> },
    { key: 'banchay',     label: 'BXH Bán Chạy',    icon: <Trophy size={13} /> },
    { key: 'luotdoc',     label: 'BXH Lượt Đọc',     icon: <Eye size={13} /> },
    { key: 'sachmoi',     label: 'BXH Sách Mới',     icon: <Sparkles size={13} /> },
    { key: 'danhgia',      label: 'BXH Đánh Giá',     icon: <Star size={13} /> },
  ]

  const currentList = useMemo(() => {
    if (!novels || novels.length === 0) return []

    const list = [...novels]

    if (activeCategory === 'luotdoc') {
      return list
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 10)
    }
    if (activeCategory === 'banchay') {
      return list
        .sort((a, b) => (b.chapter_count || 0) - (a.chapter_count || 0))
        .slice(0, 10)
    }
    if (activeCategory === 'sachmoi') {
      return list
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
        .slice(0, 10)
    }
    if (activeCategory === 'danhgia') {
      return list
        .sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.rating_count || 0) - (a.rating_count || 0))
        .slice(0, 10)
    }

    // Default: Nguyệt Phiếu (Phong Vân rank score)
    return list
      .sort((a, b) => {
        const sA = (a.views || 0) + (a.rating || 0) * 150 + (a.chapter_count || 0) * 2
        const sB = (b.views || 0) + (b.rating || 0) * 150 + (b.chapter_count || 0) * 2
        return sB - sA
      })
      .slice(0, 10)
  }, [novels, activeCategory])

  if (!novels || novels.length === 0) return null

  return (
    <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '16px', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Trophy size={17} style={{ color: '#f59e0b' }} />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
            Bảng Xếp Hạng Truyện Trung
          </h3>
        </div>
        <Link to="/epub" style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
          Xem Thêm
        </Link>
      </div>

      {/* Tabs Chuyển Bảng */}
      <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '6px', marginBottom: '0.75rem' }}>
        {categories.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`qidian-rank-tab ${activeCategory === cat.key ? 'active' : ''}`}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </div>

      {/* 10 Vị trí Top chuẩn Truyentrung */}
      <div className="qidian-rank-list">
        {currentList.map((novel, idx) => {
          const formattedTitle = fmtNovelTitle(novel.title, novel.slug)
          const chapCount = novel.chapter_count || novel.total_chapters || 0

          let rankBadgeClass = 'rank-num'
          if (idx === 0) rankBadgeClass += ' rank-1'
          else if (idx === 1) rankBadgeClass += ' rank-2'
          else if (idx === 2) rankBadgeClass += ' rank-3'

          let metricText = `${fmtNumber(chapCount)} chương`
          if (activeCategory === 'luotdoc') metricText = `${fmtNumber(novel.views || 0)} lượt xem`
          if (activeCategory === 'danhgia') metricText = `★ ${(novel.rating || 0).toFixed(1)}`

          return (
            <Link key={novel.slug} to={`/novel/${novel.slug}`} className="qidian-rank-item">
              <span className={rankBadgeClass}>{idx + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="qidian-rank-title" title={formattedTitle}>
                  {formattedTitle}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {novel.author || 'Tác giả'}
                </span>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>
                {metricText}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
