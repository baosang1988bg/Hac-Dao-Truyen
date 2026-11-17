import PropTypes from 'prop-types'
import { MessageSquare, Zap, ChevronDown } from 'lucide-react'

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
 *
 * Dùng <details> để thu gọn được: desktop mở sẵn (defaultOpen), mobile đóng sẵn
 * cho trang ngắn lại — nội dung tĩnh, không cần chiếm chỗ.
 */
export default function TruyenTrungChatboxWidget({ defaultOpen = true }) {
  return (
    <details className="glass-panel hp-board" open={defaultOpen}>
      {/* Header thông báo (KHÔNG phải chat realtime) — bấm để mở/đóng */}
      <summary className="hp-board__summary">
        <MessageSquare size={16} style={{ color: 'var(--accent)' }} aria-hidden="true" />
        <h3 className="hp-board__title">Thông Báo Đạo Hữu</h3>
        <ChevronDown size={16} className="hp-board__chevron" aria-hidden="true" />
      </summary>

      {/* Nội dung thông báo */}
      <div className="hp-board__body">
        <div className="hp-board__headline">
          <Zap size={13} aria-hidden="true" /> Chào mừng các Đạo Hữu đến Hắc Đạo Truyện!
        </div>
        <div>Cấm bàn luận về Chính trị, nội dung vi phạm pháp luật hoặc 18+...</div>
      </div>
    </details>
  )
}
TruyenTrungChatboxWidget.propTypes = {
  defaultOpen: PropTypes.bool,
}
