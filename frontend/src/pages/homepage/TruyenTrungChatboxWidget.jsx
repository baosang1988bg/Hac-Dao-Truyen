import React from 'react'
import { MessageSquare, Users, ShieldAlert, Zap } from 'lucide-react'

/**
 * TruyenTrungChatboxWidget — Khung Chat Box & BXH Tu Vi Trực Tuyến (Chuẩn Truyentrung.com)
 */
export default function TruyenTrungChatboxWidget() {
  const onlineMembers = [
    { rank: 1, name: 'Thư Đồng Sơ Kỳ', exp: '67 EXP', time: 'Online 30h' },
    { rank: 2, name: 'Người Ẩn Danh 543947', exp: '20 EXP', time: 'Online 9h' },
    { rank: 3, name: 'Độc Giả 10293', exp: '12 EXP', time: 'Online 2h' },
    { rank: 4, name: 'Hắc Đạo Đạo Hữu', exp: '8 EXP', time: 'Online 45p' },
  ]

  return (
    <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '16px', marginBottom: '1.5rem' }}>
      {/* Header Chat Box */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.875rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.6rem' }}>
        <MessageSquare size={16} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
          Chat Box Đạo Hữu
        </h3>
      </div>

      {/* Nội dung Chat Box */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.2)',
        borderRadius: '10px',
        padding: '10px',
        minHeight: '80px',
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        marginBottom: '0.75rem',
        border: '1px solid rgba(255, 255, 255, 0.04)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent)', fontWeight: 600, marginBottom: '4px' }}>
          <Zap size={13} /> Chào mừng các Đạo Hữu đến Hắc Đạo Truyện!
        </div>
        <div>Cấm bàn luận về Chính trị, nội dung vi phạm pháp luật hoặc 18+...</div>
      </div>

      {/* BXH Tu Vi / Online */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
        <Users size={14} style={{ color: 'var(--success)' }} /> BXH Tu Vi & Trực Tuyến
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {onlineMembers.map(m => (
          <div key={m.rank} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.76rem', padding: '4px 6px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={`rank-num ${m.rank <= 3 ? `rank-${m.rank}` : ''}`} style={{ width: '18px', height: '18px', fontSize: '0.7rem' }}>
                {m.rank}
              </span>
              <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{m.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>{m.exp}</span>
              <span>{m.time}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
