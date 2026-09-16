import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Flame, Eye, Star, Sparkles } from 'lucide-react';
import api from '../../api'
import { extractNovels } from '../../utils/novelsApi'
import { fmtNovelTitle, fmtNumber } from '../../utils/format'

// Mỗi tab tương ứng 1 cột sort mà backend hỗ trợ (xem SORT_COLS trong
// src/index.js getNovels) — server trả sẵn top 10, không cần tải cả catalog
// về rồi tự sort/slice trên client như trước.
const SORT_BY_CATEGORY = {
  luotdoc: 'views',
  banchay: 'chapter_count',
  sachmoi: 'updated_at',
  danhgia: 'rating',
}
// "Tổng Hợp" dùng công thức nội bộ (views + rating*150 + chapter_count*2),
// backend không có cột sort tương ứng — lấy 30 truyện xem nhiều nhất làm tập
// xấp xỉ rồi tự tính công thức trên tập nhỏ này (không cần cả 28k+ truyện).
const TONGHOP_SAMPLE_SIZE = 30

/**
 * TruyenTrungRankings — Khối 5 Bảng Xếp Hạng Độc Lập chuẩn Truyentrung.com
 * (BXH Tổng Hợp, BXH Nhiều Chương, BXH Lượt Đọc, BXH Sách Mới, BXH Đánh Giá)
 *
 * Lưu ý (B05): đây KHÔNG phải hệ thống "nguyệt phiếu" (vote/mua phiếu tháng) hay
 * "bán chạy" (doanh số) thật — dự án không có tính năng đó. Các bảng này chỉ
 * sắp xếp lại dữ liệu thật đã có (views, chapter_count, rating, updated_at):
 * - "Tổng Hợp": công thức nội bộ views + rating*150 + chapter_count*2, không
 *   phải điểm phiếu bầu của người dùng.
 * - "Nhiều Chương": sắp theo chapter_count (không phải doanh số bán).
 * Đổi nhãn để không gây hiểu nhầm có tính năng bán hàng/vote thật.
 *
 * Mỗi tab tự fetch top 10 riêng theo tab đang chọn — không nhận cả catalog
 * từ HomePage (trước đây HomePage tải toàn bộ truyện chỉ để component này
 * tự sort/slice trên client, một trong các nguyên nhân chính gây quá tải D1).
 */
export default function TruyenTrungRankings() {
  const [activeCategory, setActiveCategory] = useState('tonghop')
  const [currentList, setCurrentList] = useState([])
  const [loading, setLoading] = useState(true)

  const categories = [
    { key: 'tonghop',   label: 'BXH Tổng Hợp',      icon: <Flame size={13} /> },
    { key: 'banchay',   label: 'BXH Nhiều Chương',  icon: <Trophy size={13} /> },
    { key: 'luotdoc',   label: 'BXH Lượt Đọc',      icon: <Eye size={13} /> },
    { key: 'sachmoi',   label: 'BXH Sách Mới',      icon: <Sparkles size={13} /> },
    { key: 'danhgia',   label: 'BXH Đánh Giá',      icon: <Star size={13} /> },
  ]

  useEffect(() => {
    let alive = true
    setLoading(true)
    const controller = new AbortController()

    const request = activeCategory === 'tonghop'
      ? api.get('/novels', { params: { sort: 'views', order: 'desc', limit: TONGHOP_SAMPLE_SIZE }, signal: controller.signal })
      : api.get('/novels', { params: { sort: SORT_BY_CATEGORY[activeCategory], order: 'desc', limit: 10 }, signal: controller.signal })

    request.then(res => {
      if (!alive) return
      let list = extractNovels(res.data)
      if (activeCategory === 'tonghop') {
        list = [...list].sort((a, b) => {
          const sA = (a.views || 0) + (a.rating || 0) * 150 + (a.chapter_count || 0) * 2
          const sB = (b.views || 0) + (b.rating || 0) * 150 + (b.chapter_count || 0) * 2
          return sB - sA
        }).slice(0, 10)
      }
      setCurrentList(list)
    }).catch(() => { /* im lặng — giữ danh sách cũ (nếu có) khi lỗi */ })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false; controller.abort() }
  }, [activeCategory])

  if (loading && currentList.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '16px', marginBottom: '1.5rem', height: '420px' }} />
    )
  }
  if (currentList.length === 0) return null

  return (
    <div className="glass-panel" style={{ padding: 'var(--space-4, 16px)', borderRadius: '16px', marginBottom: 'var(--space-5, 24px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2, 8px)', marginBottom: 'var(--space-3, 12px)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 'var(--space-2, 8px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Trophy size={17} style={{ color: '#f59e0b' }} />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
            Bảng Xếp Hạng Truyện Trung
          </h3>
        </div>
        <Link to="/epub" className="hp-secondary-link" style={{ fontSize: 'var(--font-xs, 0.75rem)', color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
          Xem Thêm
        </Link>
      </div>

      {/* Tabs Chuyển Bảng */}
      <div className="qidian-rank-tabs" style={{ display: 'flex', gap: 'var(--space-2, 8px)', overflowX: 'auto', padding: '0 var(--space-1, 4px) var(--space-2, 8px)', marginBottom: 'var(--space-3, 12px)', scrollSnapType: 'x proximity', scrollPaddingInline: 'var(--space-1, 4px)' }}>
        {categories.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`qidian-rank-tab ${activeCategory === cat.key ? 'active' : ''}`}
            style={{ scrollSnapAlign: 'start' }}
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
                <span className="qidian-rank-author">
                  {novel.author || 'Tác giả'}
                </span>
              </div>
              <span className="qidian-rank-metric">
                {metricText}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
