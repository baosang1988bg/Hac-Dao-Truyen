import { createContext, useContext } from 'react'

/**
 * Context đăng nhập NGƯỜI DÙNG (không phải admin). Provider ở
 * context/AuthContext.jsx — tách file để react-refresh không cảnh báo
 * (file .jsx chỉ nên export component).
 *
 * Giá trị: {
 *   user,                       // userInfo hiện tại hoặc null
 *   requireLogin(reason, opts), // → Promise<user>; reject LOGIN_CANCELLED khi đóng hộp
 *   openLogin(reason),          // mở hộp đăng nhập, không cần chờ kết quả
 *   completeLogin(user),        // gọi sau khi đăng nhập thành công ở bất kỳ đâu
 *   refreshMe(),                // GET /user/me → cập nhật user
 *   logout(),                   // đăng xuất máy này
 *   endLocalSession(),          // chỉ xoá phiên local (sau logout-all / xoá tài khoản)
 * }
 */
export const AuthContext = createContext(null)

const NOOP_AUTH = {
  user: null,
  requireLogin: () => Promise.reject(Object.assign(new Error('Chưa có AuthProvider'), { code: 'LOGIN_CANCELLED' })),
  openLogin: () => {},
  completeLogin: () => {},
  refreshMe: () => Promise.resolve(null),
  logout: () => Promise.resolve(),
  endLocalSession: () => {},
}

/** Hook đọc trạng thái đăng nhập. Ngoài Provider (test lẻ component) → giá trị rỗng an toàn. */
export function useAuth() {
  return useContext(AuthContext) || NOOP_AUTH
}
