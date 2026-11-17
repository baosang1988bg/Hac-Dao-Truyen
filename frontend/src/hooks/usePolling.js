import { useEffect, useRef } from 'react'

/**
 * usePolling — gọi `fn` ngay khi mount rồi lặp lại mỗi `intervalMs`, NHƯNG chỉ
 * khi tab đang hiển thị. Tab bị ẩn (chuyển tab, thu nhỏ, khoá màn hình) thì
 * dừng hẳn; hiện lại thì gọi ngay một lần rồi tiếp tục.
 *
 * Lý do: mỗi lượt poll là 1 request vào Worker. Một tab quản trị để quên qua
 * đêm với chu kỳ 5 giây là ~17.000 request/ngày — gần 1/5 hạn mức gói Free.
 *
 * `fn` nhận hàm `alive()` → false sau khi component unmount (để bỏ qua
 * response về muộn). `fn` mới nhất luôn được dùng, không cần useCallback.
 */
export default function usePolling(fn, intervalMs, { enabled = true } = {}) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    let timer = null
    const isAlive = () => alive
    const tick = () => fnRef.current(isAlive)
    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
    const stop = () => {
      if (timer !== null) { clearInterval(timer); timer = null }
    }
    const start = () => {
      if (timer !== null || isHidden()) return
      tick()
      timer = setInterval(tick, intervalMs)
    }
    const onVisibility = () => { if (isHidden()) stop(); else start() }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, enabled])
}
