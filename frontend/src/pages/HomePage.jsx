import React, { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import api from '../api'

// ── Section & Widget components ──
import SearchSection from './homepage/SearchSection'
import GenreChips from './homepage/GenreChips'
import RecentlyReadSection from './homepage/RecentlyReadSection'
import RecentCommentsSection from './homepage/RecentCommentsSection'
import HeroSection from './homepage/HeroSection'
import UpdatesSection from './homepage/UpdatesSection'
import InProgressSection from './homepage/InProgressSection'
import CompletedSection from './homepage/CompletedSection'
import AllNovelsSection from './homepage/AllNovelsSection'
import StatsSection from './homepage/StatsSection'
import NewChapterWidget from './homepage/NewChapterWidget'
import QidianRankingsWidget from './homepage/QidianRankingsWidget'
import NewsAnnouncementsWidget from './homepage/NewsAnnouncementsWidget'

/**
 * HomePage – Orchestrator trang chủ HacDaoTruyen.
 * Bố cục 2 Cột Portal (Main Left + Sidebar Right) lấy cảm hứng từ Qidian & Truyentrung:
 *   - Main Left (68%): Search, Genre Chips, Recently Read, Hero, Updates (List view), In Progress, Completed, All Novels (List default).
 *   - Sidebar Right (32%): New Chapter Alert, Qidian Rankings (Phong Vân/Views/Rating/Newest), News & Announcements, Recent Comments, Stats.
 */
export default function HomePage() {
  const [novels, setNovels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeGenre, setActiveGenre] = useState('')

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

  // Xử lý tìm kiếm
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults(null)
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    const handle = setTimeout(() => {
      api.get(`/novels?search=${encodeURIComponent(q)}&limit=50`)
        .then(res => {
          const data = res.data
          setSearchResults(Array.isArray(data) ? data : (data.novels || []))
          setSearchLoading(false)
        })
        .catch(() => setSearchLoading(false))
    }, 250)
    return () => clearTimeout(handle)
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
        <div className="glass-panel p-6" style={{ color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={18} /> {error}
        </div>
      </div>
    )
  }

  const visible = novels.filter(n => (n.chapter_count || 0) > 0 || n.total_chapters > 0)
  const featured = visible.find(n => n.cover_url) || visible[0]
  const nowSec = Math.floor(Date.now() / 1000)

  const inProgress = visible.filter(n =>
    (n.chapter_count || 0) > 0 && (n.total_chapters === 0 || n.chapter_count < n.total_chapters)
  )
  const recentlyUpdated = visible
    .filter(n => n.last_translated_at && (n.chapter_count || 0) > 0)
    .sort((a, b) => b.last_translated_at - a.last_translated_at)
    .slice(0, 15)

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
          {/* Chip lọc thể loại nhanh */}
          <GenreChips activeGenre={activeGenre} onSelect={setActiveGenre} />

          {/* Vừa đọc gần đây */}
          <RecentlyReadSection novels={visible} />

          {/* Bố cục 2 Cột Portal (Main Left + Sidebar Right) */}
          <div className="hp-portal-layout" style={{ marginTop: '1rem' }}>
            {/* ── Cột Trái: Main Content (68%) ── */}
            <div className="hp-main-col">
              {/* Banner truyện nổi bật */}
              <HeroSection novel={featured} />

              {/* Truyện mới cập nhật (dạng List Compact gọn gàng) */}
              <UpdatesSection novels={recentlyUpdated} />

              {/* Truyện đang dịch */}
              <InProgressSection novels={inProgress} nowSec={nowSec} />

              {/* Truyện hoàn thành */}
              <CompletedSection novels={completed} />

              {/* Tất cả truyện (Mặc định dạng List Compact + hỗ trợ Grid/Table) */}
              <AllNovelsSection novels={visible} activeGenre={activeGenre} />
            </div>

            {/* ── Cột Phải: Sidebar Widgets (32%) ── */}
            <div className="hp-sidebar-col">
              {/* ⚡ Khung Thông Báo Chương Mới */}
              <NewChapterWidget />

              {/* 🏆 Bảng Xếp Hạng Qidian (Phong Vân / Đọc Nhiều / Đề Cử / Tân Thư) */}
              <QidianRankingsWidget novels={visible} />

              {/* 📰 Khung Tin Tức & Thông Báo */}
              <NewsAnnouncementsWidget />

              {/* 💬 Bình Luận Mới Nhất */}
              <RecentCommentsSection />

              {/* 📊 Thống Kê Tổng */}
              <StatsSection novels={visible} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
