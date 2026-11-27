/**
 * loginGate.js — hàng đợi THUẦN cho requireLogin(reason) (không React, test
 * được bằng node --test).
 *
 * Nhiều thao tác có thể cùng chờ đăng nhập (vd bấm "Theo dõi" rồi bấm gửi bình
 * luận khi hộp đăng nhập đang mở): tất cả dùng CHUNG một hộp đăng nhập; đăng
 * nhập xong → mọi Promise đang chờ resolve(user) theo đúng thứ tự gọi; người
 * dùng đóng hộp → mọi Promise reject(LoginCancelledError).
 * Lý do hiển thị (tiêu đề hộp) = lý do của lần gọi ĐẦU TIÊN còn đang chờ.
 */

export const LOGIN_CANCELLED = 'LOGIN_CANCELLED'

/** Lỗi khi người dùng đóng hộp đăng nhập — nơi gọi thường chỉ cần bỏ qua. */
export function createLoginCancelledError() {
  const err = new Error('Người dùng đã đóng hộp đăng nhập')
  err.code = LOGIN_CANCELLED
  return err
}

/** true nếu lỗi là "người dùng huỷ đăng nhập" (không cần báo lỗi đỏ). */
export function isLoginCancelled(err) {
  return Boolean(err && err.code === LOGIN_CANCELLED)
}

/**
 * Tạo hàng đợi. onChange(state) được gọi mỗi khi trạng thái mở/đóng hoặc lý do
 * đổi: state = { open: boolean, reason: string|null }.
 */
export function createLoginGate(onChange = () => {}) {
  let waiters = [] // [{ resolve, reject, reason }]

  const state = () => ({ open: waiters.length > 0, reason: waiters[0]?.reason ?? null })
  const emit = () => { try { onChange(state()) } catch { /* listener lỗi — bỏ qua */ } }

  /** Đăng ký 1 thao tác chờ đăng nhập → Promise<user>. */
  function request(reason) {
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject, reason: reason || null })
      emit()
    })
  }

  /** Đăng nhập thành công → giải phóng mọi thao tác đang chờ. */
  function resolveAll(user) {
    const list = waiters
    waiters = []
    for (const w of list) w.resolve(user)
    if (list.length) emit()
    return list.length
  }

  /** Người dùng đóng hộp → huỷ mọi thao tác đang chờ. */
  function rejectAll(err = createLoginCancelledError()) {
    const list = waiters
    waiters = []
    for (const w of list) w.reject(err)
    if (list.length) emit()
    return list.length
  }

  return { request, resolveAll, rejectAll, getState: state, pendingCount: () => waiters.length }
}
