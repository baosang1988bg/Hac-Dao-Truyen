import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'

/**
 * Hook quản lý phiên dịch của một truyện (tách từ NovelDetail.jsx cũ):
 * - Poll /translate/status mỗi 2s khi đang chạy.
 * - start(count, url?) / stop().
 * - Đếm thời gian elapsed (giây).
 * - Dọn interval khi unmount, bỏ qua setState sau unmount (StrictMode-safe).
 *
 * @param {string} slug
 * @param {{ onFinished?: () => void }} options — gọi khi status = finished (refetch data)
 */
export default function useTranslationStatus(slug, { onFinished } = {}) {
  const [taskStatus, setTaskStatus] = useState(null)
  const [translating, setTranslating] = useState(false) // đang gửi lệnh start
  const [elapsedSec, setElapsedSec] = useState(0)

  const startTimeRef = useRef(null)
  const timerRef = useRef(null)
  const pollRef = useRef(null)
  const aliveRef = useRef(true)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get(`/novels/${slug}/translate/status`)
      if (!aliveRef.current) return
      setTaskStatus(res.data)
      if (res.data.status === 'finished') {
        onFinishedRef.current?.()
        setElapsedSec(0)
      }
    } catch (err) {
      console.error(err)
    }
  }, [slug])

  // Mount / đổi slug → lấy trạng thái hiện tại
  useEffect(() => {
    aliveRef.current = true
    setTaskStatus(null)
    setElapsedSec(0)
    startTimeRef.current = null
    fetchStatus()
    return () => { aliveRef.current = false }
  }, [fetchStatus])

  // Poll 2s + đếm thời gian khi đang chạy
  useEffect(() => {
    if (taskStatus?.status === 'running') {
      pollRef.current = setInterval(fetchStatus, 2000)
      if (!startTimeRef.current) startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        if (aliveRef.current) {
          setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000))
        }
      }, 1000)
    } else {
      startTimeRef.current = null
    }
    return () => {
      clearInterval(pollRef.current)
      clearInterval(timerRef.current)
      pollRef.current = null
      timerRef.current = null
    }
  }, [taskStatus?.status, fetchStatus])

  /** Bắt đầu dịch: count = số chương (0 = toàn bộ), url = dịch từ chương cụ thể. */
  const start = useCallback(async (count, url) => {
    setTranslating(true)
    setElapsedSec(0)
    startTimeRef.current = Date.now()
    try {
      const body = { chapters: parseInt(count), force: false }
      if (url) body.url = url
      await api.post(`/novels/${slug}/translate`, body)
      fetchStatus()
    } catch (err) {
      console.error(err)
      alert('Không thể bắt đầu dịch: ' + (err.response?.data?.detail || 'kiểm tra lại backend.'))
    } finally {
      if (aliveRef.current) setTranslating(false)
    }
  }, [slug, fetchStatus])

  /** Dừng phiên dịch đang chạy. */
  const stop = useCallback(async () => {
    try {
      await api.post(`/novels/${slug}/translate/stop`)
      // Poll nhanh hơn để cập nhật UI
      setTimeout(fetchStatus, 500)
      setTimeout(fetchStatus, 1500)
    } catch (err) {
      console.error('Stop failed:', err)
    }
  }, [slug, fetchStatus])

  return {
    taskStatus,
    isRunning: taskStatus?.status === 'running',
    translating,
    elapsedSec,
    start,
    stop,
    refreshStatus: fetchStatus,
  }
}
