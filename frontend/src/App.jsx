import React, { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import GuestLayout from './layouts/GuestLayout'
import AdminLayout from './layouts/AdminLayout'
import RequireAdmin from './components/admin/RequireAdmin'
import { SpinnerIcon } from './components/shared/ui'
// Trang lõi (luôn cần hiển thị ngay, không lazy để tránh nháy loading với đa số người dùng)
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import NovelPage from './pages/NovelPage'
import Reader from './pages/Reader'
import './index.css'

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
 * Bản đồ route:
 * - /login                     → đăng nhập admin (standalone, guest không cần login)
 * - /admin/*                   → khu quản trị (RequireAdmin + AdminLayout)
 *     index                    → AdminDashboard
 *     novels                   → AdminNovels
 *     novels/:slug             → AdminNovelDetail
 *     logs                     → Logs
 * - /logs                      → redirect /admin/logs (tương thích link cũ)
 * - Guest (public, GuestLayout):
 *     /                        → HomePage
 *     /library                 → LibraryPage
 *     /account                 → AccountPage (đăng nhập/đăng ký USER + theo dõi)
 *     /novel/:slug             → NovelPage
 *     /novel/:slug/read/:chapter → Reader
 */
function App() {
  return (
    <Suspense fallback={<PageLoading />}>
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
        <Route path="logs" element={<Logs />} />
      </Route>

      <Route path="/logs" element={<Navigate to="/admin/logs" replace />} />

      <Route element={<GuestLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/novel/:slug" element={<NovelPage />} />
        <Route path="/novel/:slug/read/:chapter" element={<Reader />} />
        <Route path="/novel/:slug/epub-reader" element={<EpubReader />} />
        <Route path="/epub" element={<EpubCatalogPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}

export default App
