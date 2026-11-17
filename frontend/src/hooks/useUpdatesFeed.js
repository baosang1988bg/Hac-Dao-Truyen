import { useCallback, useEffect, useState } from 'react'
import { useCachedGet } from '../utils/apiCache'
import { UPDATES_URL, hasUnseenUpdates, latestUpdateMs, markSeen, readLastSeen } from '../utils/updatesFeed'

// Worker cache edge 5 phút → client giữ 2 phút là đủ, dùng chung giữa
// BottomTabBar (chấm đỏ), widget trang chủ và trang /cap-nhat (1 request).
const FEED_TTL = 120_000
const SEEN_EVENT = 'hd:updates-seen'

/** Dữ liệu feed + reload. */
export default function useUpdatesFeed({ enabled = true } = {}) {
  const { data, error, loading, reload } = useCachedGet(UPDATES_URL, { ttl: FEED_TTL, enabled })
  const items = Array.isArray(data?.items) ? data.items : []
  return { data, items, error, loading: loading && !data, reload }
}

/**
 * Chấm báo "có cập nhật mới" cho tab điều hướng. markAllSeen() được trang
 * /cap-nhat gọi khi mở → mọi nơi đang hiển thị chấm cập nhật ngay (qua event).
 */
export function useUnseenUpdates() {
  const { items } = useUpdatesFeed()
  const [lastSeen, setLastSeen] = useState(readLastSeen)

  useEffect(() => {
    const sync = () => setLastSeen(readLastSeen())
    window.addEventListener(SEEN_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SEEN_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // Nhận danh sách tuỳ chọn: trang /cap-nhat truyền bản nó vừa "Làm mới" để
  // mốc đã xem không bị tính theo bản cũ của instance hook này.
  const markAllSeen = useCallback((fresh) => {
    const latest = latestUpdateMs(Array.isArray(fresh) ? fresh : items)
    if (latest === null) return
    markSeen(latest)
    window.dispatchEvent(new Event(SEEN_EVENT))
  }, [items])

  return { hasUnseen: hasUnseenUpdates(items, lastSeen), markAllSeen }
}
