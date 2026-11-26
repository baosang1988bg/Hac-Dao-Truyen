import { useEffect, useRef, useState } from 'react'

import { DEFAULT_SETTINGS, THEMES, READER_FONTS, sanitizeSettings } from '../utils/readerSettingsSchema'
import { startPrefsSync, schedulePrefsPush, subscribePrefsSync } from '../utils/prefsSyncClient'

// Giữ đường import cũ (ReaderSettingsPanel, Reader, EpubReader, test trình duyệt).
export { DEFAULT_SETTINGS, THEMES, READER_FONTS, sanitizeSettings }

const LEGACY_KEYS = ['epub_theme', 'epub_fontSize', 'epub_font']

function readSettings() {
  try {
    const raw = localStorage.getItem('readerSettings')
    if (raw !== null) {
      const saved = JSON.parse(raw)
      return { settings: sanitizeSettings(saved), migrate: false }
    }
    const [theme, size, fontFamily] = LEGACY_KEYS.map(key => localStorage.getItem(key))
    const settings = { ...DEFAULT_SETTINGS }
    if (theme) settings.theme = theme
    if (size && Number.isFinite(Number(size)) && Number(size) > 0) settings.fontSize = Number(size)
    if (fontFamily) settings.fontFamily = fontFamily
    return { settings, migrate: [theme, size, fontFamily].some(value => value !== null) }
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, migrate: false }
  }
}

export default function useReaderSettings() {
  const [initial] = useState(readSettings)
  const [settings, setSettings] = useState(initial.settings)
  const migrationPending = useRef(initial.migrate)

  useEffect(() => {
    try {
      localStorage.setItem('readerSettings', JSON.stringify(settings))
      // Chỉ xóa nguồn cũ sau khi lưu đích thành công (kể cả StrictMode).
      if (migrationPending.current) {
        LEGACY_KEYS.forEach(key => localStorage.removeItem(key))
        migrationPending.current = false
      }
    } catch { /* Storage bị chặn/đầy: giữ settings trong bộ nhớ và key cũ. */ }
    // Đồng bộ lên server (đã đăng nhập): gom 3 giây; không đổi gì so với bản
    // trên server thì không ghi. Chưa đăng nhập → no-op.
    schedulePrefsPush()
  }, [settings])

  // Kéo cài đặt từ server chạy NỀN (không chặn hiển thị). Server mới hơn mốc
  // đồng bộ local → áp vào state (giữ giọng đọc TTS của thiết bị này).
  useEffect(() => {
    const unsubscribe = subscribePrefsSync((evt) => {
      if (evt?.type !== 'reader' || !evt.reader) return
      setSettings(previous => {
        const next = { ...sanitizeSettings(evt.reader), ttsVoice: previous.ttsVoice }
        return JSON.stringify(next) === JSON.stringify(previous) ? previous : next
      })
    })
    startPrefsSync()
    return unsubscribe
  }, [])

  const onChange = (key, value) => setSettings(previous => ({ ...previous, [key]: value }))
  return { settings, onChange }
}
