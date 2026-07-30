import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import GuestLayout from './layouts/GuestLayout'
import AdminLayout from './layouts/AdminLayout'
import RequireAdmin from './components/admin/RequireAdmin'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import NovelPage from './pages/NovelPage'
import Reader from './pages/Reader'
import AccountPage from './pages/AccountPage'
import LoginPage from './pages/LoginPage'
import Logs from './pages/Logs'
import EpubReader from './pages/EpubReader'
import EpubCatalogPage from './pages/EpubCatalogPage'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminNovels from './pages/admin/AdminNovels'
import AdminNovelDetail from './pages/admin/AdminNovelDetail'
import './index.css'

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
  )
}

export default App
