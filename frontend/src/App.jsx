import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, Home, ScrollText } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import NovelDetail from './pages/NovelDetail'
import Reader from './pages/Reader'
import Logs from './pages/Logs'
import LoginPage from './pages/LoginPage'
import api from './api'
import './index.css'

function NavLink({ to, icon, label, adminOnly }) {
  const location = useLocation()
  const role = localStorage.getItem('userRole')
  const active = location.pathname === to
  
  if (adminOnly && role !== 'admin') return null

  return (
    <Link
      to={to}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 14px', borderRadius: '10px',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        background: active ? 'rgba(59,130,246,0.1)' : 'transparent',
        border: active ? '1px solid rgba(59,130,246,0.2)' : '1px solid transparent',
        textDecoration: 'none', fontSize: '0.9rem', fontWeight: active ? 600 : 400,
        transition: 'all 0.15s',
      }}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
  return null;
}

function App() {
  const [role, setRole] = useState(localStorage.getItem('userRole'))
  const location = useLocation()
  const navigate = useNavigate()

  // Nếu là admin nhưng không còn token (đã hết hạn / bị xóa) → hạ quyền, quay về đăng nhập
  useEffect(() => {
    if (localStorage.getItem('userRole') === 'admin' && !localStorage.getItem('authToken')) {
      localStorage.removeItem('userRole')
      setRole(null)
    }
  }, [])

  useEffect(() => {
    if (!role) return // Chưa đăng nhập thì không redirect

    const autoRedirected = sessionStorage.getItem('autoRedirected')
    if (!autoRedirected) {
      sessionStorage.setItem('autoRedirected', 'true')
      
      const lastNovel = localStorage.getItem('last_read_novel') || getCookie('last_read_novel')
      if (lastNovel) {
        const lastChapter = localStorage.getItem(`last_read_chapter_${lastNovel}`) || getCookie(`last_read_chapter_${lastNovel}`)
        if (lastChapter) {
          if (location.pathname === '/' || location.pathname === '/login' || location.pathname === '') {
            navigate(`/novel/${lastNovel}/read/${lastChapter}`)
          }
        }
      }
    }
  }, [role, navigate, location.pathname])

  const handleLogin = (newRole) => {
    localStorage.setItem('userRole', newRole)
    setRole(newRole)
  }

  const handleLogout = () => {
    if (role === 'admin' && localStorage.getItem('authToken')) {
      api.post('/auth/logout').catch(() => {})
    }
    localStorage.removeItem('authToken')
    localStorage.removeItem('userRole')
    setRole(null)
  }

  // Detect if we are in reader mode to hide sidebar
  const isReaderPage = location.pathname.includes('/read/')

  return (
    <div className="app-root">
      {!role ? (
        <Routes>
          <Route path="*" element={<LoginPage onLogin={handleLogin} />} />
        </Routes>
      ) : (
        <div className={`app-container ${isReaderPage ? 'reader-mode' : ''}`}>
          {/* Sidebar - Hidden in Reader Mode */}
          {!isReaderPage && (
            <div className="glass-panel sidebar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2rem', padding: '0 4px' }}>
                <div style={{ background: 'var(--accent-gradient)', padding: '8px', borderRadius: '8px', flexShrink: 0 }}>
                  <BookOpen size={22} color="white" />
                </div>
                <h1 style={{ fontSize: '1.15rem', fontWeight: 700, letterSpacing: '0.3px' }}>
                  Hắc Đạo<span style={{ color: 'var(--accent)' }}>Truyện</span>
                </h1>
              </div>

              <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <NavLink to="/"     icon={<Home size={18} />}       label="Thư viện" />
                <NavLink to="/logs" icon={<ScrollText size={18} />} label="Lịch sử" adminOnly />
                <button 
                  onClick={handleLogout}
                  style={{ 
                    marginTop: 'auto', background: 'none', border: 'none', 
                    color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer',
                    padding: '10px', textAlign: 'left'
                  }}
                >
                  Đăng xuất
                </button>
              </nav>
            </div>
          )}

          {/* Main Content Area */}
          <div className="main-content">
            <div className="content-wrap">
              <Routes>
                <Route path="/"                             element={<Dashboard />} />
                <Route path="/novel/:slug"                  element={<NovelDetail />} />
                <Route path="/novel/:slug/read/:chapter"    element={<Reader />} />
                <Route path="/logs"                         element={<Logs />} />
                <Route path="/login"                        element={<LoginPage onLogin={handleLogin} />} />
              </Routes>
            </div>

            {/* Global Footer */}
            <footer className="app-footer">
              <div style={{ opacity: 0.3, fontSize: '0.8rem' }}>
                Hắc Đạo Truyện &copy; 2026 • Premium Novel Translation
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}




export default App

