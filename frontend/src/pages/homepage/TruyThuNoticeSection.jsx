import React, { useState } from 'react'
import { Ticket, Send } from 'lucide-react'
import RequestNovelModal from '../../components/RequestNovelModal'

/**
 * TruyThuNoticeSection — Top Banner Truy Thư Lệnh & Đăng Tin Tìm Truyện (Chuẩn Truyentrung.com)
 * Nút "Yêu cầu truyện mới" mở RequestNovelModal — độc giả gửi URL truyện muốn dịch,
 * admin duyệt/từ chối ở /admin/requests.
 */
export default function TruyThuNoticeSection() {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
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
          Chưa tìm thấy truyện bạn muốn đọc? <strong>Gửi yêu cầu truyện mới</strong>.
          <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }} className="desktop-only">
            Đội ngũ dịch thuật sẽ xem xét và phản hồi sớm nhất có thể.
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ fontSize: '0.78rem', padding: '5px 12px', minHeight: '32px' }}
          onClick={() => setModalOpen(true)}
        >
          <Send size={13} /> Yêu cầu truyện mới
        </button>
      </div>
    </div>

    {modalOpen && <RequestNovelModal onClose={() => setModalOpen(false)} />}
    </>
  )
}
