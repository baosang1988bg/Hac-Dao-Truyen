
import { MessageSquare, Zap } from 'lucide-react'

/**
 * TruyenTrungChatboxWidget — Khung THÔNG BÁO/NỘI QUY tĩnh (không phải chat realtime).
 *
 * Lưu ý (B05): tên cũ "Chat Box Đạo Hữu" khiến người dùng tưởng đây là khung chat
 * trực tiếp — thực tế đây chỉ là nội dung thông báo/nội quy tĩnh, không có gửi/nhận
 * tin nhắn nào. Đổi nhãn cho đúng bản chất, không bịa tính năng chat.
 *
 * Ngoài ra đã bỏ khối "BXH Tu Vi & Trực Tuyến" từng hiển thị 4 thành viên/EXP/thời
 * gian online HOÀN TOÀN giả (hard-code, không lấy từ dữ liệu thật nào) — vi phạm
 * nguyên tắc "không bịa số liệu trong UI" của dự án. Nếu sau này có API đếm
 * user đang online thật (ví dụ dựa trên session token còn hạn), có thể thêm lại
 * khối này bằng dữ liệu thật.
 */
export default function TruyenTrungChatboxWidget() {
  return (
    <div className="glass-panel" style={{ padding: 'var(--space-4, 16px)', borderRadius: '16px', marginBottom: 'var(--space-5, 24px)' }}>
      {/* Header thông báo (KHÔNG phải chat realtime) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2, 8px)', marginBottom: 'var(--space-3, 12px)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 'var(--space-2, 8px)' }}>
        <MessageSquare size={16} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, fontFamily: 'Outfit, sans-serif' }}>
          Thông Báo Đạo Hữu
        </h3>
      </div>

      {/* Nội dung thông báo */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.2)',
        borderRadius: '10px',
        padding: 'var(--space-3, 12px)',
        minHeight: '80px',
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        marginBottom: '0.75rem',
        border: '1px solid rgba(255, 255, 255, 0.04)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2, 8px)', color: 'var(--accent)', fontWeight: 600, marginBottom: 'var(--space-1, 4px)' }}>
          <Zap size={13} /> Chào mừng các Đạo Hữu đến Hắc Đạo Truyện!
        </div>
        <div>Cấm bàn luận về Chính trị, nội dung vi phạm pháp luật hoặc 18+...</div>
      </div>
    </div>
  )
}
