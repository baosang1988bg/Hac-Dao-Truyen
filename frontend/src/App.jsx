import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import GuestLayout from './layouts/GuestLayout'
import AdminLayout from './layouts/AdminLayout'
import RequireAdmin from './components/admin/RequireAdmin'
import { SpinnerIcon } from './components/shared/ui'
import { initAnalytics, trackPageView } from './utils/analytics'
import { runWhenIdle } from './utils/idle'
// Trang chủ là điểm vào phổ biến nhất → giữ eager để không nháy loading.
import HomePage from './pages/HomePage'
import './index.css'
import './styles/reading.css'

// Trang đọc (chi tiết truyện, Reader, Tủ truyện) → chunk riêng. NovelPage được
// prefetch khi trình duyệt rảnh sau khi trang chủ tải xong (xem App bên dưới).
const loadNovelPage = () => import('./pages/NovelPage')
const NovelPage = lazy(loadNovelPage)
const Reader = lazy(() => import('./pages/Reader'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))

// Trang phụ / ít dùng (admin, epub, tài khoản, đăng nhập, logs) → tách chunk riêng, tải khi cần
const AccountPage = lazy(() => import('./pages/AccountPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const Logs = lazy(() => import('./pages/Logs'))
const EpubReader = lazy(() => import('./pages/EpubReader'))
const EpubCatalogPage = lazy(() => import('./pages/EpubCatalogPage'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminNovels = lazy(() => import('./pages/admin/AdminNovels'))
const AdminNovelDetail = lazy(() => import('./pages/admin/AdminNovelDetail'))
const AdminNovelRequests = lazy(() => import('./pages/admin/AdminNovelRequests'))
const AdminUsage = lazy(() => import('./pages/admin/AdminUsage'))

/** Fallback tối giản khi chờ tải chunk của trang lazy. */
function PageLoading() {
  return (
    <div style={{
      minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: '10px', color: 'var(--text-muted)', fontSize: '0.9rem',
    }}>
      <SpinnerIcon />
      Đang tải...
    </div>
  )
}

/**
 * Skeleton nhẹ cho trang guest lazy (NovelPage/Reader/LibraryPage): giữ nguyên
 * header/layout, chỉ thay vùng nội dung → không nháy trắng khi chờ chunk.
 */
function PageSkeleton() {
  return (
    <div className="container hd-page-skeleton" role="status" aria-live="polite" aria-label="Đang tải trang">
      <div className="hd-page-skeleton__hero">
        <span className="hd-skel hd-page-skeleton__cover" />
        <div className="hd-page-skeleton__lines">
          <span className="hd-skel hd-page-skeleton__line hd-page-skeleton__line--title" />
          <span className="hd-skel hd-page-skeleton__line" style={{ width: '45%' }} />
          <span className="hd-skel hd-page-skeleton__line" style={{ width: '30%' }} />
        </div>
      </div>
      <span className="hd-skel hd-page-skeleton__line" style={{ height: '120px', marginBottom: '1rem' }} />
      <span className="hd-skel hd-page-skeleton__line" style={{ height: '48px' }} />
    </div>
  )
}

/** Bọc trang lazy trong Suspense riêng để header/layout không bị thay bằng fallback. */
function lazyPage(element) {
  return <Suspense fallback={<PageSkeleton />}>{element}</Suspense>
}

/**
 * Bản đồ route:
 * - /login                     → đăng nhập admin (standalone, guest không cần login)
 * - /admin/*                   → khu quản trị (RequireAdmin + AdminLayout)
 *     index                    → AdminDashboard
 *     novels                   → AdminNovels
 *     novels/:slug             → AdminNovelDetail
 *     requests                 → AdminNovelRequests
 *     usage                    → AdminUsage (ước lượng ngân sách sync cục bộ)
 *     logs                     → Logs
 * - /logs                      → redirect /admin/logs (tương thích link cũ)
 * - Guest (public, GuestLayout):
 *     /                        → HomePage
 *     /library                 → LibraryPage
 *     /account                 → AccountPage (đăng nhập/đăng ký USER + theo dõi)
 *     /novel/:slug             → NovelPage
 *     /novel/:slug/read/:chapter → Reader
 */
/** Bắn page_view GA4 mỗi khi route SPA đổi (gtag mặc định chỉ bắn 1 lần lúc tải script). */
function AnalyticsTracker() {
  const location = useLocation()
  useEffect(() => {
    trackPageView(location.pathname + location.search)
  }, [location.pathname, location.search])
  return null
}

function App() {
  useEffect(() => { initAnalytics() }, [])

  // Prefetch chunk NovelPage khi trang đã tải xong + trình duyệt rảnh: click
  // vào một truyện từ trang chủ sẽ không phải chờ tải JS.
  useEffect(() => {
    let cancelIdle = () => {}
    const schedule = () => {
      cancelIdle = runWhenIdle(() => { loadNovelPage().catch(() => { /* offline — bỏ qua */ }) }, { timeout: 4000 })
    }
    if (document.readyState === 'complete') schedule()
    else window.addEventListener('load', schedule, { once: true })
    return () => {
      window.removeEventListener('load', schedule)
      cancelIdle()
    }
  }, [])

  return (
    <Suspense fallback={<PageLoading />}>
    <AnalyticsTracker />
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="novels" element={<AdminNovels />} />
        <Route path="novels/:slug" element={<AdminNovelDetail />} />
        <Route path="requests" element={<AdminNovelRequests />} />
        <Route path="usage" element={<AdminUsage />} />
        <Route path="logs" element={<Logs />} />
      </Route>

      <Route path="/logs" element={<Navigate to="/admin/logs" replace />} />

      <Route element={<GuestLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/library" element={lazyPage(<LibraryPage />)} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/novel/:slug" element={lazyPage(<NovelPage />)} />
        <Route path="/novel/:slug/read/:chapter" element={lazyPage(<Reader />)} />
        <Route path="/novel/:slug/epub-reader" element={<EpubReader />} />
        <Route path="/epub" element={<EpubCatalogPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}

export default App
