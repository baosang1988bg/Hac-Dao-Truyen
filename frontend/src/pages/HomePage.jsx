import React, { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import api from '../api'

// ── Truyentrung.com UI Components ──
import SearchSection from './homepage/SearchSection'
import GenreChips from './homepage/GenreChips'
import RecentlyReadSection from './homepage/RecentlyReadSection'
import TruyThuNoticeSection from './homepage/TruyThuNoticeSection'
import MonthlyPopularSection from './homepage/MonthlyPopularSection'
import UpdatesSection from './homepage/UpdatesSection'
import TruyenTrungRankings from './homepage/TruyenTrungRankings'
import TruyenTrungChatboxWidget from './homepage/TruyenTrungChatboxWidget'
import AllNovelsSection from './homepage/AllNovelsSection'
import RecentCommentsSection from './homepage/RecentCommentsSection'
import StatsSection from './homepage/StatsSection'

/**
 * HomePage – Orchestrator trang chủ HacDaoTruyen (Bản Clone 100% UI Truyentrung.com Giai đoạn 1).
 * Cấu trúc 6 Section chính:
 *   1. Top Notice Bar: Khung Truy Thư Lệnh & Thông Báo Tìm Truyện
 *   2. Monthly Popular Hero: Section "Nhân Khí Tháng" (Card nổi bật lớn)
 *   3. Recently Updated Table: Bảng Mới Cập Nhật dạng Table chuẩn 5 cột
 *   4. Multi-Ranking Widgets: 5 BXH Nguyệt Phiếu / Bán Chạy / Lượt Đọc / Sách Mới / Đánh Giá
 *   5. All Novels Tabbed List: Tất cả truyện dạng Tab
 *   6. Live Chatbox & Online Ranking: Khung chatbox & thành viên online
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
        Đang tải trang chủ Truyện Trung...
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
  const popularMonthly = visible.find(n => n.views && n.views > 0) || visible[0]

  const recentlyUpdated = visible
    .filter(n => n.last_translated_at && (n.chapter_count || 0) > 0)
    .sort((a, b) => b.last_translated_at - a.last_translated_at)

  const isSearching = searchQuery.trim().length > 0

  return (
    <div className="container animate-fade-in" style={{ paddingTop: '1rem' }}>
      {/* 🔍 Search Bar – luôn hiển thị ở trên cùng */}
      <SearchSection
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        searchLoading={searchLoading}
      />

      {/* Các section chính – ẩn khi đang tìm kiếm */}
      {!isSearching && (
        <>
          {/* 1. Top Notice Bar: Khung Truy Thư Lệnh & Thông Báo Tìm Truyện */}
          <TruyThuNoticeSection />

          {/* Chip lọc thể loại nhanh */}
          <GenreChips activeGenre={activeGenre} onSelect={setActiveGenre} />

          {/* Vừa đọc gần đây */}
          <RecentlyReadSection novels={visible} />

          {/* Bố cục 2 Cột Portal chuẩn Truyentrung.com */}
          <div className="hp-portal-layout" style={{ marginTop: '1.25rem' }}>
            {/* ── Cột Trái: Main Content (68%) ── */}
            <div className="hp-main-col">
              {/* 2. Monthly Popular Hero: Section "Nhân Khí Tháng" */}
              <MonthlyPopularSection novel={popularMonthly} />

              {/* 3. Recently Updated Table: Bảng Mới Cập Nhật dạng Table chuẩn 5 cột */}
              <UpdatesSection novels={recentlyUpdated} />

              {/* 5. All Novels Tabbed List: Tất cả truyện dạng Tab */}
              <AllNovelsSection novels={visible} activeGenre={activeGenre} />
            </div>

            {/* ── Cột Phải: Sidebar Widgets (32%) ── */}
            <div className="hp-sidebar-col">
              {/* 4. Multi-Ranking Widgets: 5 BXH Nguyệt Phiếu/Bán Chạy/Lượt Đọc/Sách Mới/Đánh Giá */}
              <TruyenTrungRankings novels={visible} />

              {/* 6. Live Chatbox & Online Ranking: Khung chat & thành viên online */}
              <TruyenTrungChatboxWidget />

              {/* Thảo luận / Bình luận mới nhất */}
              <RecentCommentsSection />

              {/* Thống kê hệ thống */}
              <StatsSection novels={visible} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
