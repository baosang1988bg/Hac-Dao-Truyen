import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react'
import api from '../api'
import { extractNovels, fetchAllNovels } from '../utils/novelsApi'

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
 * HomePage – Orchestrator trang chủ HacDaoTruyen.
 * Thứ tự ưu tiên thị giác (anchor chính lên đầu, phần cá nhân/phụ xuống
 * sidebar — xem audit UX 2026-09-11):
 *   1. Monthly Popular Hero: Section "Nhân Khí Tháng" (anchor chính, full-width)
 *   2. Top Notice Bar: Khung Truy Thư Lệnh & Thông Báo Tìm Truyện
 *   3. [Cột chính] Recently Updated Table → GenreChips → All Novels Tabbed List
 *   4. [Sidebar] Recently Read → Multi-Ranking Widgets → Khung thông báo tĩnh
 *      → Bình luận mới nhất → Thống kê hệ thống
 */
export default function HomePage() {
  const [novels, setNovels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeGenre, setActiveGenre] = useState('')

  // Nạp TOÀN BỘ danh sách truyện trang chủ — phân trang thật (không chỉ
  // page=1) để không bỏ sót truyện khi catalog lớn hơn 1 trang (B01).
  useEffect(() => {
    let alive = true
    fetchAllNovels(api)
      .then(list => {
        if (alive) {
          setNovels(list)
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

  // Xử lý tìm kiếm — B02: tham số đúng contract là `q` (không phải `search`).
  // Dùng AbortController + so sánh request id để bỏ qua response cũ đến muộn
  // (gõ nhanh có thể khiến request trước phản hồi SAU request sau).
  const searchReqId = useRef(0)
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      searchReqId.current += 1
      setSearchResults(null)
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    const myReqId = ++searchReqId.current
    const controller = new AbortController()
    const handle = setTimeout(() => {
      api.get('/novels', { params: { q, limit: 50 }, signal: controller.signal })
        .then(res => {
          if (searchReqId.current !== myReqId) return // response cũ đến muộn — bỏ qua
          setSearchResults(extractNovels(res.data))
          setSearchLoading(false)
        })
        .catch(() => {
          if (searchReqId.current !== myReqId) return
          setSearchLoading(false)
        })
    }, 250)
    return () => { clearTimeout(handle); controller.abort() }
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
          {/* 1. Anchor chính above-the-fold: Section "Nhân Khí Tháng" ngay sau
              thanh tìm kiếm — trước đây bị Thông báo/GenreChips/Recently Read
              che mất phía trên, không có điểm nhấn thị giác rõ ràng khi vào trang. */}
          <MonthlyPopularSection novel={popularMonthly} />

          {/* Top Notice Bar: Khung Truy Thư Lệnh & Thông Báo Tìm Truyện */}
          <TruyThuNoticeSection />

          {/* Bố cục 2 Cột Portal chuẩn Truyentrung.com */}
          <div className="hp-portal-layout" style={{ marginTop: '1.25rem' }}>
            {/* ── Cột Trái: Main Content (68%) ── */}
            <div className="hp-main-col">
              {/* Recently Updated Table: Bảng Mới Cập Nhật dạng Table chuẩn 5 cột */}
              <UpdatesSection novels={recentlyUpdated} />

              {/* Chip lọc thể loại — đặt sát trên All Novels vì đây là nơi nó
                  thực sự lọc, thay vì đứng tách biệt ở đầu trang. */}
              <GenreChips activeGenre={activeGenre} onSelect={setActiveGenre} />

              {/* All Novels Tabbed List: Tất cả truyện dạng Tab */}
              <AllNovelsSection novels={visible} activeGenre={activeGenre} />
            </div>

            {/* ── Cột Phải: Sidebar Widgets (32%) ── */}
            <div className="hp-sidebar-col">
              {/* Vừa đọc gần đây — nội dung cá nhân, hợp với sidebar hơn là
                  chiếm full-width ngay đầu trang cho mọi khách vãng lai. */}
              <RecentlyReadSection novels={visible} />

              {/* Multi-Ranking Widgets: 5 BXH Tổng Hợp/Nhiều Chương/Lượt Đọc/Sách Mới/Đánh Giá */}
              <TruyenTrungRankings novels={visible} />

              {/* Khung thông báo tĩnh (KHÔNG phải chat realtime) */}
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
