import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, User, Key, ArrowRight, BookOpen } from 'lucide-react'

export default function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('')
  const [isAdminMode, setIsAdminMode] = useState(false)
  const navigate = useNavigate()

  const handleLogin = (role) => {
    if (role === 'admin') {
      // Password đơn giản cho admin, bạn có thể đổi ở đây
      if (password === 'pongsa3105') {
        onLogin('admin')
        navigate('/')
      } else {
        alert('Sai mật khẩu quản trị!')
      }
    } else {
      onLogin('guest')
      navigate('/')
    }
  }

  return (
    <div className="login-container" style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(circle at top right, #1e293b, #0f172a)',
      padding: '20px'
    }}>
      <div className="glass-panel animate-fade-in" style={{
        width: '100%', maxWidth: '400px', padding: '2.5rem', textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
      }}>
        <div style={{
          background: 'var(--accent-gradient)', width: '60px', height: '60px',
          borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 1.5rem', boxShadow: '0 0 20px rgba(59,130,246,0.4)'
        }}>
          <BookOpen size={30} color="white" />
        </div>

        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.5rem', color: 'white' }}>
          Hắc Đạo<span style={{ color: 'var(--accent)' }}>Truyện</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Chào mừng bạn quay trở lại
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {!isAdminMode ? (
            <>
              <button
                onClick={() => handleLogin('guest')}
                className="btn-login-option"
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  padding: '1rem', borderRadius: '12px', color: 'white', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.2s',
                  textAlign: 'left'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              >
                <div style={{ background: 'rgba(16,185,129,0.2)', padding: '8px', borderRadius: '8px' }}>
                  <User size={20} color="#10b981" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Vào đọc truyện</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quyền hạn Độc giả (Guest)</div>
                </div>
                <ArrowRight size={18} color="rgba(255,255,255,0.3)" />
              </button>

              <button
                onClick={() => setIsAdminMode(true)}
                style={{
                  background: 'none', border: 'none', color: 'var(--accent)',
                  fontSize: '0.85rem', cursor: 'pointer', marginTop: '0.5rem'
                }}
              >
                Đăng nhập quản trị viên
              </button>
            </>
          ) : (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ position: 'relative' }}>
                <Key size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  placeholder="Mật khẩu Admin"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin('admin')}
                  autoFocus
                  style={{
                    width: '100%', padding: '0.8rem 1rem 0.8rem 2.5rem', borderRadius: '10px',
                    background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'white', outline: 'none'
                  }}
                />
              </div>
              <button
                onClick={() => handleLogin('admin')}
                className="btn btn-primary"
                style={{ width: '100%', padding: '0.8rem', justifyContent: 'center' }}
              >
                Xác nhận Admin
              </button>
              <button
                onClick={() => setIsAdminMode(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Quay lại
              </button>
            </div>
          )}
        </div>

        <div style={{ marginTop: '2.5rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.2)' }}>
          Hệ thống dịch thuật Hắc Đạo Truyện v2.0
        </div>
      </div>
    </div>
  )
}
