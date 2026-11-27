import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { cachedGet } from '../utils/apiCache'
import useDocumentTitle from '../hooks/useDocumentTitle'
import '../styles/library-epub.css'

const UPDATED_AT = '27/11/2026'

/**
 * Trang /chinh-sach-bao-mat — chính sách bảo mật ngắn gọn bằng tiếng Việt.
 * Nội dung phải khớp code thật:
 * - GA4: utils/analytics.js (không PII, user_id băm SHA-256, tắt Google
 *   Signals + quảng cáo cá nhân hoá, tôn trọng DNT/GPC, không đo trang quản trị).
 * - Google: chỉ scope mặc định của Google Identity Services (openid email profile).
 * - Xoá tài khoản: trang Tài khoản → DELETE /api/user/account (userDeleteAccount:
 *   xoá yêu cầu truyện + góp ý name đang chờ, xoá trắng ghi chú; giữ bình luận,
 *   góp ý đã duyệt, URL yêu cầu đã xử lý dưới tên "Người dùng đã xoá").
 * - Gộp lịch sử đọc local vào tài khoản khi đăng nhập lần đầu: utils/authMerge.js.
 * Email liên hệ lấy từ GET /api/config (contact_email, Worker đọc env
 * CONTACT_EMAIL) — không hardcode email cá nhân trong mã nguồn.
 */
export default function PrivacyPage() {
  useDocumentTitle('Chính sách bảo mật')
  const [contactEmail, setContactEmail] = useState('')

  useEffect(() => {
    let alive = true
    cachedGet('/config', { ttl: 60 * 60 * 1000 })
      .then(data => {
        const email = typeof data?.contact_email === 'string' ? data.contact_email.trim() : ''
        if (alive && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) setContactEmail(email)
      })
      .catch(() => { /* không có cấu hình → dùng lời nhắn chung */ })
    return () => { alive = false }
  }, [])

  return (
    <div className="container animate-fade-in privacy-page">
      <article className="glass-panel privacy-page__body">
        <header className="privacy-page__head">
          <span className="auth-panel__icon" aria-hidden="true"><ShieldCheck size={22} /></span>
          <h1>Chính sách bảo mật</h1>
          <p className="privacy-page__meta">Cập nhật lần cuối: {UPDATED_AT}</p>
        </header>

        <p>
          Hắc Đạo Truyện là trang đọc truyện dịch. Bạn có thể đọc mà không cần tài khoản;
          tài khoản chỉ dùng để lưu và đồng bộ những thứ bạn chủ động tạo ra.
        </p>

        <h2>1. Dữ liệu chúng tôi lưu</h2>
        <ul>
          <li><strong>Thông tin tài khoản:</strong> email, tên hiển thị; nếu đăng nhập bằng Google thì thêm ảnh đại diện và mã định danh tài khoản Google. Mật khẩu (nếu bạn đặt) chỉ được lưu dưới dạng băm, không ai đọc được.</li>
          <li><strong>Tiến độ đọc:</strong> truyện, chương và vị trí đoạn bạn đang đọc; danh sách truyện đang theo dõi.</li>
          <li><strong>Cài đặt đọc:</strong> cỡ chữ, giao diện, các quy tắc sửa tên bạn tự đặt — để dùng lại trên máy khác.</li>
          <li><strong>Nội dung bạn gửi:</strong> bình luận, đánh giá sao, góp ý sửa tên (name), yêu cầu truyện mới.</li>
          <li><strong>Phiên đăng nhập:</strong> thời điểm đăng nhập và loại trình duyệt/thiết bị, để bạn xem và đăng xuất từ xa trong trang Tài khoản.</li>
          <li><strong>Trên trình duyệt của bạn:</strong> lịch sử đọc, cài đặt đọc và phiên đăng nhập được lưu ở bộ nhớ cục bộ (localStorage) của trình duyệt.</li>
          <li><strong>Gộp lịch sử đọc khi đăng nhập:</strong> lần đầu bạn đăng nhập trên một trình duyệt, lịch sử đọc đang lưu
            trên trình duyệt đó được gộp vào tài khoản của bạn — kể cả lịch sử của người khác từng dùng chung máy/trình duyệt
            trước đó. Nếu dùng máy chung, hãy xoá dữ liệu trang web trước khi đăng nhập.</li>
        </ul>

        <h2>2. Thống kê truy cập (Google Analytics 4)</h2>
        <ul>
          <li>Chúng tôi dùng GA4 để biết trang nào được đọc nhiều, chương nào bị bỏ dở… nhằm cải thiện trang.</li>
          <li>Không gửi email, tên, nội dung bình luận hay đường link bạn dán. Nếu đã đăng nhập, chỉ gửi một mã đã băm một chiều (SHA-256) thay cho mã tài khoản.</li>
          <li>Đã tắt Google Signals và quảng cáo cá nhân hoá. Trang quản trị không được đo.</li>
          <li>Nếu trình duyệt bật <em>Do Not Track</em> hoặc <em>Global Privacy Control</em>, chúng tôi hoàn toàn không tải GA4.</li>
        </ul>

        <h2>3. Mục đích sử dụng</h2>
        <p>
          Chỉ để vận hành các tính năng bạn dùng: đăng nhập, đồng bộ tiến độ và cài đặt giữa các máy,
          hiển thị bình luận/đánh giá/góp ý, thông báo chương mới của truyện đang theo dõi, và chống spam.
          <strong> Chúng tôi không bán, không cho thuê và không chia sẻ dữ liệu của bạn cho bên thứ ba để quảng cáo.</strong>
        </p>

        <h2>4. Đăng nhập bằng Google</h2>
        <p>
          Chúng tôi chỉ yêu cầu các quyền cơ bản <code>openid email profile</code>: mã tài khoản Google, email
          (đã được Google xác minh), tên và ảnh đại diện. Chúng tôi không truy cập Gmail, Drive, danh bạ hay bất kỳ
          dữ liệu Google nào khác. Bạn có thể thu hồi quyền bất cứ lúc nào tại trang quản lý tài khoản Google
          (mục Bảo mật → Ứng dụng bên thứ ba).
        </p>

        <h2>5. Xoá tài khoản</h2>
        <p>
          Vào <Link to="/account">trang Tài khoản</Link> → mục <em>Xoá tài khoản</em>, gõ đúng email để xác nhận và
          nhập mật khẩu hiện tại (tài khoản chỉ dùng Google có thể được yêu cầu xác nhận lại bằng Google).
          Thao tác này không hoàn tác được. Khi xoá, chúng tôi:
        </p>
        <ul>
          <li>xoá phiên đăng nhập, danh sách theo dõi, tiến độ đọc, cài đặt đọc và đánh giá sao của bạn;</li>
          <li>gỡ email, tên, ảnh đại diện, mật khẩu và liên kết Google khỏi tài khoản;</li>
          <li>xoá các yêu cầu truyện và góp ý sửa tên (name) đang chờ duyệt, và xoá trắng ghi chú bạn đã viết kèm các yêu cầu/góp ý cũ.</li>
        </ul>
        <p>
          Nội dung bình luận, các góp ý name đã được duyệt và địa chỉ (URL) của các yêu cầu truyện đã được xử lý vẫn được giữ lại,
          hiển thị dưới tên <em>“Người dùng đã xoá”</em> — không còn gắn với email hay thông tin nào nhận ra bạn.
        </p>
        <p>
          Dữ liệu lưu trên trình duyệt (mục 1) bạn có thể tự xoá bằng cách xoá dữ liệu trang web trong cài đặt trình duyệt.
        </p>

        <h2>6. Liên hệ</h2>
        <p>
          {contactEmail
            ? <>Mọi câu hỏi về dữ liệu cá nhân, vui lòng gửi email tới <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</>
            : <>Mọi câu hỏi về dữ liệu cá nhân, vui lòng liên hệ quản trị viên qua kênh liên hệ được công bố trên trang.</>}
        </p>
      </article>
    </div>
  )
}
