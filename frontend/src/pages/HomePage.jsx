import React, { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import api from '../api'

// ── Section components (mỗi file độc lập, cập nhật riêng biệt) ──
import SearchSection from './homepage/SearchSection'
import RecentlyReadSection from './homepage/RecentlyReadSection'
import HeroSection from './homepage/HeroSection'
import UpdatesSection from './homepage/UpdatesSection'
import InProgressSection from './homepage/InProgressSection'
import CompletedSection from './homepage/CompletedSection'
import AllNovelsSection from './homepage/AllNovelsSection'
import StatsSection from './homepage/StatsSection'

/**
 * HomePage – Orchestrator trang chủ.
 * Sắp xếp thứ tự các section:
 *   1. SearchSection
 *   2. RecentlyReadSection (Vừa đọc gần đây)
 *   3. HeroSection (Truyện nổi bật)
 *   4. UpdatesSection (Truyện mới cập nhật - cuộn ngang)
 *   5. InProgressSection (Đang dịch - demo 12 truyện)
 *   6. CompletedSection (Hoàn thành - demo 6 truyện + xem tất cả)
 *   7. AllNovelsSection (Tất cả truyện với tabs)
 *   8. StatsSection (Thống kê tổng)
 */
export default function HomePage() {
  const [novels, setNovels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)

  // Nạp danh sách truyện trang chủ (limit=200)
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
  const recentlyUpdated = visible
    .filter(n => n.last_translated_at && (n.chapter_count || 0) > 0)
    .sort((a, b) => b.last_translated_at - a.last_translated_at)
    .slice(0, 15) // 15 truyện mới cập nhật để cuộn ngang mượt mà

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
          {/* Vừa đọc gần đây */}
          <RecentlyReadSection novels={visible} />

          {/* Banner truyện nổi bật */}
          <HeroSection novel={featured} />

          {/* Session riêng: Truyện mới cập nhật (cuộn ngang) */}
          <UpdatesSection novels={recentlyUpdated} />

          {/* Truyện đang dịch (grid 6 cột compact) */}
          <InProgressSection novels={inProgress} nowSec={nowSec} />

          {/* Truyện hoàn thành (demo 6 truyện + nút Xem tất cả) */}
          <CompletedSection novels={completed} />

          {/* Tất cả truyện với tab filter */}
          <AllNovelsSection novels={visible} />

          {/* Thống kê tổng */}
          <StatsSection novels={visible} />
        </>
      )}
    </div>
  )
}
