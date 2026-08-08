import React, { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import api from '../api'

// ── Section components (mỗi file độc lập, cập nhật riêng biệt) ──
import SearchSection from './homepage/SearchSection'
import RecentlyReadSection from './homepage/RecentlyReadSection'
import HeroSection from './homepage/HeroSection'
import InProgressSection from './homepage/InProgressSection'
import UpdatesSection from './homepage/UpdatesSection'
import CompletedSection from './homepage/CompletedSection'
import AllNovelsSection from './homepage/AllNovelsSection'
import StatsSection from './homepage/StatsSection'

/**
 * HomePage – Orchestrator trang chủ.
 * Chỉ chịu trách nhiệm: fetch data + tính toán datasets + sắp xếp layout.
 * Mọi UI/UX đều được delegate xuống section components trong /homepage/.
 *
 * Layout Phase 3 (truyentrung.com inspired):
 *   [Search]
 *   [Recently Read]
 *   [Hero Banner – truyện nổi bật]
 *   [InProgress Grid – 5 cột]
 *   [2-col: Updates | Completed]
 *   [AllNovels với tabs]
 *   [Stats]
 */
export default function HomePage() {
  const [novels, setNovels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)

  // Nạp danh sách truyện trang chủ (limit=200 để hiển thị phong phú)
  useEffect(() => {
    let alive = true
    api.get('/novels?limit=200')
      .then(res => {
        if (alive) {
          const data = res.data
          setNovels(Array.isArray(data) ? data : (data.novels || []))
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) {
          setError('Không thể kết nối máy chủ. Vui lòng thử lại sau.')
          setLoading(false)
        }
      })
    return () => { alive = false }
  }, [])

  // Tìm kiếm trực tiếp qua API (toàn bộ D1 + R2)
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults(null)
      setSearchLoading(false)
      return
    }

    setSearchLoading(true)
    const timer = setTimeout(() => {
      api.get(`/novels?q=${encodeURIComponent(q)}&limit=100`)
        .then(res => {
          const data = res.data
          setSearchResults(Array.isArray(data) ? data : (data.novels || []))
          setSearchLoading(false)
        })
        .catch(() => {
          setSearchResults([])
          setSearchLoading(false)
        })
    }, 200)

    return () => clearTimeout(timer)
  }, [searchQuery])

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '3rem', color: 'var(--text-muted)' }}>
        Đang tải trang chủ...
      </div>
    )
  }

  if (error) {
    return (
      <div className="container" style={{ paddingTop: '2rem' }}>
        <div className="glass-panel p-6" style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)' }}>
          <AlertCircle size={20} style={{ flexShrink: 0 }} />
          {error}
        </div>
      </div>
    )
  }

  // ── Datasets cho từng section ──
  const visible = novels.filter(n =>
    (n.chapter_count || 0) > 0 || n.has_epub === 1 || n.has_epub === true || (n.total_chapters || 0) > 0
  )
  const nowSec = Math.floor(Date.now() / 1000)

  const featured = visible.reduce(
    (best, n) => (!best || (n.chapter_count || 0) > (best.chapter_count || 0) ? n : best),
    null
  )
  const inProgress = visible.filter(n =>
    (n.chapter_count || 0) > 0 && (n.total_chapters === 0 || n.chapter_count < n.total_chapters)
  )
  // Mới nhất – tăng lên 8 để đủ cho 2-col layout
  const recentlyUpdated = visible
    .filter(n => n.last_translated_at && (n.chapter_count || 0) > 0)
    .sort((a, b) => b.last_translated_at - a.last_translated_at)
    .slice(0, 8)
  const completed = visible.filter(n =>
    n.total_chapters > 0 && n.chapter_count >= n.total_chapters && (n.chapter_count || 0) > 0
  )

  const isSearching = searchQuery.trim().length > 0

  return (
    <div className="container animate-fade-in" style={{ paddingTop: '1rem' }}>
      {/* 🔍 Search – luôn hiển thị */}
      <SearchSection
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        searchLoading={searchLoading}
      />

      {/* Các section chính – ẩn khi đang tìm kiếm */}
      {!isSearching && (
        <>
          {/* Vừa đọc */}
          <RecentlyReadSection novels={visible} />

          {/* Hero banner */}
          <HeroSection novel={featured} />

          {/* Đang dịch – grid 5 cột */}
          <InProgressSection novels={inProgress} nowSec={nowSec} />

          {/* 2-column: Updates | Completed */}
          {(recentlyUpdated.length > 0 || completed.length > 0) && (
            <div className="hp-two-col">
              <UpdatesSection novels={recentlyUpdated} />
              <CompletedSection novels={completed} />
            </div>
          )}

          {/* Tất cả truyện với tab filter */}
          <AllNovelsSection novels={visible} />

          {/* Stats */}
          <StatsSection novels={visible} />
        </>
      )}
    </div>
  )
}
