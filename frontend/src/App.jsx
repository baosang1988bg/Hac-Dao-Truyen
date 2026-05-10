import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { BookOpen, Home, ScrollText } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import NovelDetail from './pages/NovelDetail'
import Reader from './pages/Reader'
import Logs from './pages/Logs'
import LoginPage from './pages/LoginPage'
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

function App() {
  const [role, setRole] = useState(localStorage.getItem('userRole'))

  const handleLogin = (newRole) => {
    localStorage.setItem('userRole', newRole)
    setRole(newRole)
  }

  const handleLogout = () => {
    localStorage.removeItem('userRole')
    setRole(null)
  }

  return (
    <BrowserRouter>
      {!role ? (
        <Routes>
          <Route path="*" element={<LoginPage onLogin={handleLogin} />} />
        </Routes>
      ) : (
        <div className="app-container">
          {/* Sidebar for Desktop */}
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

          {/* Main Content */}
          <div className="main-content">
            <Routes>
              <Route path="/"                             element={<Dashboard />} />
              <Route path="/novel/:slug"                  element={<NovelDetail />} />
              <Route path="/novel/:slug/read/:chapter"    element={<Reader />} />
              <Route path="/logs"                         element={<Logs />} />
              <Route path="/login"                        element={<LoginPage onLogin={handleLogin} />} />
            </Routes>
          </div>

          {/* Bottom Navigation for Mobile */}
          <div className="bottom-nav">
            <Link to="/">
              <Home size={22} />
              <span>Thư viện</span>
            </Link>
            {role === 'admin' && (
              <Link to="/logs">
                <ScrollText size={22} />
                <span>Lịch sử</span>
              </Link>
            )}
          </div>
        </div>
      )}
    </BrowserRouter>
  )
}


export default App

