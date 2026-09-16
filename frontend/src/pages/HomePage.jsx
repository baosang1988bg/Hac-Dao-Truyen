import { useEffect, useRef, useState } from 'react';
import api from '../api'
import { extractNovels } from '../utils/novelsApi'

// ── Truyentrung.com UI Components ──
import SearchSection from './homepage/SearchSection'
import GenreChips from './homepage/GenreChips'
import RecentlyReadSection from './homepage/RecentlyReadSection'
import TruyThuNoticeSection from './homepage/TruyThuNoticeSection'
import MonthlyPopularSection from './homepage/MonthlyPopularSection'
import UpdatesSection from './homepage/UpdatesSection'
import ExternalRankingsSection from './homepage/ExternalRankingsSection'
import TruyenTrungRankings from './homepage/TruyenTrungRankings'
import TruyenTrungChatboxWidget from './homepage/TruyenTrungChatboxWidget'
import AnnouncementsSection from './homepage/AnnouncementsSection'
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
 *
 * KHÔNG còn tải cả catalog ở đây (trước đây fetchAllNovels kéo tới hàng chục
 * nghìn truyện chỉ để các section con tự lọc/sort trong RAM — nguyên nhân
 * chính khiến trang chủ chậm và làm cạn quota D1 rows-read, 2026-09-11).
 * Mỗi section bên dưới tự gọi API riêng, nhỏ, độc lập — section nào tải xong
 * trước thì hiện trước, không còn 1 màn hình loading chờ tất cả.
 */
export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeGenre, setActiveGenre] = useState('')

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
          <MonthlyPopularSection />

          {/* Top Notice Bar: Khung Truy Thư Lệnh & Thông Báo Tìm Truyện */}
          <TruyThuNoticeSection />

          {/* Bố cục 2 Cột Portal chuẩn Truyentrung.com */}
          <div className="hp-portal-layout" style={{ marginTop: 'var(--space-5, 24px)' }}>
            {/* ── Cột Trái: Main Content (68%) ── */}
            <div className="hp-main-col">
              {/* Recently Updated Table: Bảng Mới Cập Nhật dạng Table chuẩn 5 cột */}
              <UpdatesSection />
              <ExternalRankingsSection />

              {/* Chip lọc thể loại — đặt sát trên All Novels vì đây là nơi nó
                  thực sự lọc, thay vì đứng tách biệt ở đầu trang. */}
              <GenreChips activeGenre={activeGenre} onSelect={setActiveGenre} />

              {/* All Novels Tabbed List: Tất cả truyện dạng Tab */}
              <AllNovelsSection activeGenre={activeGenre} />
            </div>

            {/* ── Cột Phải: Sidebar Widgets (32%) ── */}
            <div className="hp-sidebar-col">
              {/* Vừa đọc gần đây — nội dung cá nhân, hợp với sidebar hơn là
                  chiếm full-width ngay đầu trang cho mọi khách vãng lai. */}
              <RecentlyReadSection />

              {/* Multi-Ranking Widgets: 5 BXH Tổng Hợp/Nhiều Chương/Lượt Đọc/Sách Mới/Đánh Giá */}
              <TruyenTrungRankings />

              {/* Thông báo "vừa cập nhật chương mới" (tĩnh, từ announcements.json) */}
              <AnnouncementsSection />

              {/* Khung thông báo tĩnh (KHÔNG phải chat realtime) */}
              <TruyenTrungChatboxWidget />

              {/* Thảo luận / Bình luận mới nhất */}
              <RecentCommentsSection />

              {/* Thống kê hệ thống */}
              <StatsSection />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
