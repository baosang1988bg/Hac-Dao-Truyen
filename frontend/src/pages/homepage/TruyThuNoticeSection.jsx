import React from 'react'
import { Link } from 'react-router-dom'
import { Ticket, ShoppingBag, ArrowRight } from 'lucide-react'

/**
 * TruyThuNoticeSection — Top Banner Truy Thư Lệnh & Đăng Tin Tìm Truyện (Chuẩn Truyentrung.com)
 */
export default function TruyThuNoticeSection() {
  return (
    <div className="glass-panel truy-thu-banner" style={{
      padding: '0.85rem 1.2rem',
      borderRadius: '14px',
      marginBottom: '1.25rem',
      border: '1px solid rgba(59, 130, 246, 0.25)',
      background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      flexWrap: 'wrap'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: 'rgba(59, 130, 246, 0.15)',
          color: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <Ticket size={18} />
        </div>
        <div style={{ fontSize: '0.84rem', color: 'var(--text-main)', lineHeight: 1.4 }}>
          Sử dụng <strong>Truy Thư Lệnh</strong> để đăng tin tìm truyện. 
          <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }} className="desktop-only">
            Thành viên đăng nhập lần đầu được tặng 1 Truy Thư Lệnh Tàn Phiến miễn phí.
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '5px 10px', minHeight: '32px', cursor: 'default' }}>
          <ShoppingBag size={13} /> Cửa Hàng
        </span>
        <span className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '5px 12px', minHeight: '32px', cursor: 'default' }}>
          Xem bài đăng <ArrowRight size={13} />
        </span>
      </div>
    </div>
  )
}
