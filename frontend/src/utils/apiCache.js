/**
 * Cache GET dùng chung cho phía khách (guest).
 *
 * Mục tiêu: nhiều section/trang cùng hỏi một URL (vd `/novels?sort=updated_at`
 * ở UpdatesSection và AllNovelsSection, danh sách chương ở NovelPage rồi Reader)
 * thì chỉ bắn MỘT request mạng: request đang bay được gộp (dedupe), kết quả giữ
 * trong bộ nhớ theo TTL. Không dùng thư viện ngoài (SWR/React Query) để bundle gọn.
 *
 * API:
 *   cachedGet(url, { params, ttl, signal, force }) -> Promise<data>
 *   peekCache(url, params) -> data | undefined   (đọc đồng bộ để render ngay)
 *   primeCache(url, params, data, ttl)            (nạp sẵn, vd từ Link state)
 *   invalidateCache(prefix?)                      (xoá theo tiền tố URL)
 *   useCachedGet(url, { params, ttl, enabled })   -> { data, error, loading, reload }
 *
 * Lưu ý: chỉ dùng cho dữ liệu công khai. Không cache request admin/đăng nhập.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api'

const DEFAULT_TTL = 60_000
const MAX_ENTRIES = 200
const store = new Map() // key -> { data, expires }
const inflight = new Map() // key -> Promise

export function cacheKey(url, params) {
  if (!params) return url
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (!entries.length) return url
  return `${url}?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`
}

function setEntry(key, data, ttl) {
  if (store.size >= MAX_ENTRIES) {
    // Bỏ mục cũ nhất (Map giữ thứ tự chèn).
    const first = store.keys().next().value
    store.delete(first)
  }
  store.set(key, { data, expires: Date.now() + ttl })
}

export function peekCache(url, params) {
  const hit = store.get(cacheKey(url, params))
  if (!hit) return undefined
  if (hit.expires < Date.now()) return undefined
  return hit.data
}

export function primeCache(url, params, data, ttl = DEFAULT_TTL) {
  if (data === undefined) return
  setEntry(cacheKey(url, params), data, ttl)
}

export function invalidateCache(prefix = '') {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

export function cachedGet(url, { params, ttl = DEFAULT_TTL, signal, force = false } = {}) {
  const key = cacheKey(url, params)
  if (!force) {
    const hit = store.get(key)
    if (hit && hit.expires >= Date.now()) return Promise.resolve(hit.data)
    const pending = inflight.get(key)
    if (pending) return pending
  }
  // Không truyền signal của một component vào request dùng chung: component
  // khác có thể đang chờ cùng promise. Huỷ chỉ áp dụng cho phía người gọi.
  const p = api.get(url, { params })
    .then(res => {
      setEntry(key, res.data, ttl)
      return res.data
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, p)
  if (!signal) return p
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error('canceled'), { name: 'CanceledError', code: 'ERR_CANCELED' }))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * Hook React: trả dữ liệu cache ngay lập tức (nếu có) rồi làm mới khi hết hạn.
 * `params` được so sánh theo cacheKey nên truyền object literal mỗi lần render
 * vẫn an toàn.
 */
export function useCachedGet(url, { params, ttl = DEFAULT_TTL, enabled = true } = {}) {
  const key = url ? cacheKey(url, params) : null
  const [state, setState] = useState(() => ({
    data: url ? peekCache(url, params) : undefined,
    error: null,
    loading: Boolean(url && enabled && peekCache(url, params) === undefined),
  }))
  const paramsRef = useRef(params)
  paramsRef.current = params
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!url || !enabled) return undefined
    const controller = new AbortController()
    const cached = peekCache(url, paramsRef.current)
    setState(s => ({ data: cached !== undefined ? cached : s.data, error: null, loading: cached === undefined }))
    if (cached !== undefined && nonce === 0) return () => controller.abort()
    cachedGet(url, { params: paramsRef.current, ttl, signal: controller.signal, force: nonce > 0 })
      .then(data => setState({ data, error: null, loading: false }))
      .catch(error => {
        if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return
        setState(s => ({ data: s.data, error, loading: false }))
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ttl, enabled, nonce])

  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { ...state, reload }
}
