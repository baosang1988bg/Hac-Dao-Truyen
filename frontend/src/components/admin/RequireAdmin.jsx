import React, { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import api from '../../api'

/**
 * Guard cho khu vực /admin:
 * - Không có token hoặc role !== 'admin' → chuyển về /login (nhớ trang đích).
 * - Có token → xác thực GET /auth/verify khi mount (spinner khi chờ).
 *   Lỗi 401 → interceptor của axios tự xóa phiên và redirect, ở đây render null.
 */
export default function RequireAdmin({ children }) {
  const location = useLocation()
  const hasToken = !!localStorage.getItem('authToken')
  const isAdmin = localStorage.getItem('userRole') === 'admin'
  const [verify, setVerify] = useState('pending') // pending | ok | fail

  useEffect(() => {
    if (!hasToken || !isAdmin) return
    let alive = true
    api.get('/auth/verify')
      .then(() => { if (alive) setVerify('ok') })
      .catch(() => { if (alive) setVerify('fail') })
    return () => { alive = false }
  }, [hasToken, isAdmin])

  if (!hasToken || !isAdmin) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (verify === 'pending') {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '12px',
        color: 'var(--text-muted)',
      }}>
        <span style={{
          width: '28px', height: '28px', borderRadius: '50%',
          border: '3px solid rgba(59,130,246,0.25)', borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite', display: 'inline-block',
        }} />
        <span style={{ fontSize: '0.85rem' }}>Đang xác thực phiên quản trị...</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  if (verify === 'fail') return null // interceptor lo phần redirect

  return children
}
